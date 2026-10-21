// Finite-force contacts between the existing rigid weapon panels. The rig owns
// mass, articulated Jacobians, supports and actuator recovery; this module owns
// only continuous contact geometry and the equal/opposite contact response.
import {ArticulatedRig} from './articulated-rig.js';

// Water-wet polished blades must slide after their brief grip. Higher dry-like
// coefficients held the same axe contact for thousands of physical steps.
export const WEAPON_BIND=Object.freeze({maxForce:54,restitution:.08,tolerance:1e-7,staticFriction:.10,dynamicFriction:.05});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const dot=(p,n)=>p.x*n.x+p.y*n.y;
const panels=rig=>rig.collisionPanels().filter(p=>p.body==='weapon'&&p.material!=='wood');
const project=(p,n)=>{const a=p.vertices.map(v=>dot(v,n));return {min:Math.min(...a),max:Math.max(...a)};};
const half=(p,axis)=>Math.max(...p.vertices.map(v=>Math.abs(dot({x:v.x-p.center.x,y:v.y-p.center.y},axis))));
const anchor=(p,v)=>p.axes.map(axis=>dot({x:v.x-p.center.x,y:v.y-p.center.y},axis)/Math.max(half(p,axis),1e-9));
const located=(p,uv)=>({x:p.center.x+p.axes.reduce((s,n,i)=>s+n.x*uv[i]*half(p,n),0),
  y:p.center.y+p.axes.reduce((s,n,i)=>s+n.y*uv[i]*half(p,n),0),z:p.z});
const support=(p,n,tangent,coordinate)=>{
  const extent=project(p,n).max,face=p.vertices.filter(v=>extent-dot(v,n)<1e-7),along=face.map(v=>dot(v,tangent));
  const t=clamp(coordinate,Math.min(...along),Math.max(...along));
  return {x:n.x*extent+tangent.x*t,y:n.y*extent+tangent.y*t};
};

function separation(a,b,dir=1){
  let gap=-Infinity,normal;
  for(const axis of [...a.axes,...b.axes]){
    let n=axis;const facing=dot({x:b.center.x-a.center.x,y:b.center.y-a.center.y},n);
    if(facing< -1e-12||(Math.abs(facing)<1e-12&&(n.x*dir< -1e-12||(Math.abs(n.x)<1e-12&&n.y<0))))n={x:-n.x,y:-n.y};
    const A=project(a,n),B=project(b,n),g=B.min-A.max;
    if(g>gap){gap=g;normal=n;}
  }
  const zGap=Math.abs(a.z-b.z)-(a.depth+b.depth)/2;
  return {gap:Math.max(gap,zGap),xyGap:gap,normal,axis:zGap>gap?{x:0,y:0,z:1}:{...normal,z:0}};
}

function manifold(a,b,normal){
  const tangent={x:-normal.y,y:normal.x},reverse={x:-normal.x,y:-normal.y};
  const extentA=project(a,normal).max,extentB=project(b,reverse).max;
  const faceA=a.vertices.filter(v=>extentA-dot(v,normal)<1e-7).map(v=>dot(v,tangent));
  const faceB=b.vertices.filter(v=>extentB-dot(v,reverse)<1e-7).map(v=>dot(v,tangent));
  const along=(Math.max(Math.min(...faceA),Math.min(...faceB))+Math.min(Math.max(...faceA),Math.max(...faceB)))/2;
  const z=(Math.max(a.z-a.depth/2,b.z-b.depth/2)+Math.min(a.z+a.depth/2,b.z+b.depth/2))/2;
  return {pointA:{...support(a,normal,tangent,along),z},pointB:{...support(b,reverse,tangent,along),z}};
}

// Bound on travel of any material point over this step. Every active weapon
// hinge is included, and the lever exceeds the whole torso/arm/blade chain.
// Conservative advancement therefore cannot jump across a thin rotating blade.
function travelBound(rig,axis){
  if(axis?.z)return 0; // Weapon layers have constant depth during rig interpolation.
  const dx=(rig.q?.[0]??0)-(rig.previousQ?.[0]??rig.q?.[0]??0),dy=(rig.q?.[1]??0)-(rig.previousQ?.[1]??rig.q?.[1]??0);
  let travel=axis?Math.abs(dx*axis.x+dy*axis.y):Math.hypot(dx,dy);
  const lever=5*(rig.scale??1)+Math.max(rig.swordLength??1,rig.previousSwordLength??1);
  for(let i=2;i<(rig.q?.length??0);i++)travel+=Math.abs(rig.q[i]-(rig.previousQ?.[i]??rig.q[i]))*lever;
  return travel+Math.abs((rig.swordLength??1)-(rig.previousSwordLength??rig.swordLength??1));
}

function accelerationBound(rig){
  let angular=0;for(let i=2;i<(rig.q?.length??0);i++)angular+=Math.abs(rig.q[i]-(rig.previousQ?.[i]??rig.q[i]));
  const lever=5*(rig.scale??1)+Math.max(rig.swordLength??1,rig.previousSwordLength??1);
  return lever*angular*angular+2*Math.abs((rig.swordLength??1)-(rig.previousSwordLength??rig.swordLength??1))*angular;
}

function advance(query,rate,accelerationA=0,accelerationB=0){
  const cache=new Map(),sample=t=>{if(!cache.has(t))cache.set(t,query(t));return cache.get(t);},bound=rate();let t=0;
  // A grazing angular contact can converge too slowly for advancement alone.
  // Subdivide the unresolved interval in temporal order. A midpoint separation
  // exceeding all possible travel certifies the entire interval as empty; only
  // a genuinely touching sample can be returned. No fixed sample grid or
  // end-frame-only fallback may skip an earlier entry.
  const search=(lo,hi,left=sample(lo),right=sample(hi))=>{
    if(!left||!right)return null;
    if(left.gap<=WEAPON_BIND.tolerance)return {...left,t:lo};
    const mid=(lo+hi)/2,center=sample(mid);if(!center)return null;
    const width=hi-lo,axis=center.axis;
    // Every panel vertex is a sum of fixed links sin/cos(linear q), plus the
    // linearly extending blade. If |f''|<=A, its derivative differs from the
    // interval chord slope by at most A*width/2. This tightens grazing bounds
    // without replacing the curved motion by that chord.
    const speed=(a,b,acceleration)=>axis.z?Math.abs(b.z-a.z)/width:
      Math.max(...a.vertices.map((v,i)=>Math.abs((b.vertices[i].x-v.x)*axis.x+(b.vertices[i].y-v.y)*axis.y)/width))+acceleration*width/2;
    const intervalSpeed=speed(left.a,right.a,accelerationA)+speed(left.b,right.b,accelerationB);
    if(center.gap>Math.min(rate(axis),intervalSpeed)*width/2+WEAPON_BIND.tolerance)return null;
    if((hi-lo)*bound<=WEAPON_BIND.tolerance||mid===lo||mid===hi){
      if(center.gap<=WEAPON_BIND.tolerance)return {...center,t:mid};
      return right.gap<=WEAPON_BIND.tolerance?{...right,t:hi}:null;
    }
    return search(lo,mid,left,center)||search(mid,hi,center,right);
  };
  for(let iteration=0;iteration<64;iteration++){
    const s=sample(t);if(!s)return null;
    if(s.gap<=WEAPON_BIND.tolerance)return {...s,t};
    const speed=rate(s.axis);if(speed<1e-12)return null;
    const next=t+s.gap/speed;
    if(next>1+1e-12)return null;
    if(next<=t+1e-14)return search(t,1);
    t=Math.min(1,next);
  }
  return search(t,1);
}

export function firstWeaponContact(a,b){
  if(!a?.collisionPanelsAt||!b?.collisionPanelsAt)return null;
  const A=panels(a),B=panels(b),rate=axis=>travelBound(a,axis)+travelBound(b,axis),cacheA=new Map(),cacheB=new Map();let best=null;
  const at=(rig,cache,t)=>{if(!cache.has(t))cache.set(t,new Map(rig.collisionPanelsAt(t).map(p=>[p.key,p])));return cache.get(t);};
  for(const pa of A)for(const pb of B){
    const hit=advance(t=>{
      const p=at(a,cacheA,t).get(pa.key),q=at(b,cacheB,t).get(pb.key);if(!p||!q)return null;
      return {...separation(p,q,a.dir??1),a:p,b:q};
    },rate,accelerationBound(a),accelerationBound(b));
    if(hit&&(!best||hit.t<best.t)){
      const points=manifold(hit.a,hit.b,hit.normal);
      best={t:hit.t,normal:hit.normal,...points,keyA:pa.key,keyB:pb.key,
        anchorA:anchor(hit.a,points.pointA),anchorB:anchor(hit.b,points.pointB)};
    }
  }
  return best;
}

export function firstWeaponPointContact(rig,from,to){
  if(!rig?.collisionPanelsAt||!from||!to||![from.x,from.y,to.x,to.y,from.z??0,to.z??0].every(Number.isFinite))return null;
  const dx=to.x-from.x,dy=to.y-from.y,dz=(to.z??0)-(from.z??0);
  const rate=axis=>travelBound(rig,axis)+(axis?Math.abs(dx*axis.x+dy*axis.y+dz*(axis.z??0)):Math.hypot(dx,dy,dz)),cache=new Map();let best=null;
  for(const panel of panels(rig)){
    const hit=advance(t=>{
      if(!cache.has(t))cache.set(t,new Map(rig.collisionPanelsAt(t).map(p=>[p.key,p])));
      const p=cache.get(t).get(panel.key);if(!p)return null;
      const point={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:(from.z??0)+((to.z??0)-(from.z??0))*t};
      const q={center:point,vertices:[point],axes:[],z:point.z,depth:0};
      return {...separation(p,q,rig.dir??1),point,a:p,b:q};
    },rate,accelerationBound(rig),0);
    if(hit&&(!best||hit.t<best.t))best={t:hit.t,point:hit.point,key:panel.key};
  }
  return best;
}

export function weaponBindManifold(a,b,c){
  if(!c?.anchorA||!c?.anchorB)return [];
  const pa=panels(a).find(p=>p.key===c.keyA),pb=panels(b).find(p=>p.key===c.keyB);if(!pa||!pb)return [];
  const tangent={x:-c.normal.y,y:c.normal.x},A=project(pa,tangent),B=project(pb,tangent);
  if(Math.max(A.min,B.min)>Math.min(A.max,B.max)+WEAPON_BIND.tolerance||Math.abs(pa.z-pb.z)>(pa.depth+pb.depth)/2+WEAPON_BIND.tolerance)return [];
  let pointA=located(pa,c.anchorA),pointB=located(pb,c.anchorB),normal=c.normal;
  const withinEnd=(point,panel)=>{const extent=project(panel,panel.axes[0]),along=dot(point,panel.axes[0]);return along>=extent.min-WEAPON_BIND.tolerance&&along<=extent.max+WEAPON_BIND.tolerance;};
  if(!withinEnd(pointA,pb)||!withinEnd(pointB,pa)){
    const current=separation(pa,pb,a.dir??1);if(current.gap>WEAPON_BIND.tolerance)return [];
    // Sliding to another real contact replaces the old material anchors; it
    // does not extend their constraint beyond either finite blade endpoint.
    normal=current.normal;({pointA,pointB}=manifold(pa,pb,normal));
  }
  const penetration=-(pointB.x-pointA.x)*normal.x-(pointB.y-pointA.y)*normal.y;
  if(penetration<=1e-6)return [];
  return [{bodyA:'weapon',bodyB:'weapon',keyA:`steel:${c.keyA}`,keyB:`steel:${c.keyB}`,pointA,pointB,normal,penetration,projectOnly:true}];
}

function contactInertia(rig,point,normal,friction){
  if(friction&&typeof rig.contactInertia==='function'){
    const value=rig.contactInertia({body:'weapon',point,normal});
    if(value&&[value.normal,value.tangent,value.cross].every(Number.isFinite))return {...value,complete:true};
  }
  return {normal:rig.effectiveInverseMass({body:'weapon',point,normal}),tangent:0,cross:0,complete:false};
}
function frictionResponse(vn,vt,kn,kt,kc,cap,restitution,staticFriction,dynamicFriction){
  const target=(1+restitution)*vn;
  let normal=kn>1e-9?clamp(target/kn,0,cap):0,tangent=0,state='free';
  if(normal>0&&kt>1e-9&&staticFriction>0){
    const determinant=kn*kt-kc*kc;
    const stickNormal=determinant>1e-12?(target*kt-vt*kc)/determinant:-1;
    const stickTangent=determinant>1e-12?(vt*kn-target*kc)/determinant:Infinity;
    if(stickNormal>0&&stickNormal<=cap&&Math.abs(stickTangent)<=staticFriction*stickNormal){
      normal=stickNormal;tangent=stickTangent;state='sticking';
    }else{
      // Polished steel loses its initial grip as it slides. Neither static nor
      // moving friction may exceed the finite normal load or weld two blades.
      const mu=dynamicFriction+(staticFriction-dynamicFriction)*Math.exp(-((vt/.18)**2));
      const sign=Math.sign(vt-kc*normal),denominator=kn+kc*sign*mu;
      if(denominator>1e-9)normal=clamp(target/denominator,0,cap);
      const slip=vt-kc*normal,stop=slip/kt;
      tangent=clamp(stop,-mu*normal,mu*normal);
      state=Math.abs(stop)<=mu*normal?'sticking':'sliding';
    }
    // The coupled contact must be passive even at a force cap or nearly
    // singular articulation. Scale this same equal/opposite impulse, never a
    // target pose, motor gain, collision mask or future hit eligibility.
    const work=vn*normal+vt*tangent,quadratic=kn*normal*normal+2*kc*normal*tangent+kt*tangent*tangent;
    if(work<=0){normal=0;tangent=0;state='free';}
    else if(quadratic>2*work){const scale=2*work/quadratic;normal*=scale;tangent*=scale;}
  }
  return {normal,tangent,state};
}

export function resolveWeaponBind(a,b,{dt=1/120,maxForce=WEAPON_BIND.maxForce,restitution=WEAPON_BIND.restitution,project=true,
  staticFriction=WEAPON_BIND.staticFriction,dynamicFriction=WEAPON_BIND.dynamicFriction}={}){
  const c=firstWeaponContact(a,b);if(!c)return {impulse:0,reason:'no-contact'};
  const current=()=>({a:panels(a).find(p=>p.key===c.keyA),b:panels(b).find(p=>p.key===c.keyB)});
  let p=current(),pointA=located(p.a,c.anchorA),pointB=located(p.b,c.anchorB),n=c.normal;
  const va=a.pointVelocity({body:'weapon',point:pointA}),vb=b.pointVelocity({body:'weapon',point:pointB});
  if(!va||!vb)return {...c,impulse:0,reason:'invalid-contact'};
  const closingSpeed=(va.x-vb.x)*n.x+(va.y-vb.y)*n.y;
  const tangent={x:-n.y,y:n.x},slide=(va.x-vb.x)*tangent.x+(va.y-vb.y)*tangent.y,slideSpeed=Math.abs(slide);
  const muStatic=clamp(finite(staticFriction),0,1),muDynamic=Math.min(muStatic,clamp(finite(dynamicFriction),0,1));
  const A=contactInertia(a,pointA,n,muStatic>0),B=contactInertia(b,pointB,n,muStatic>0);
  // A duck-typed legacy collider exposes only normal inverse mass. Without
  // both complete tensors, preserve its normal response rather than predict
  // tangential work using only half of the actual system.
  const complete=A.complete&&B.complete;
  const inverseMass=A.normal+B.normal,tangentMass=complete?A.tangent+B.tangent:0,crossMass=complete?A.cross+B.cross:0;
  const cap=Math.min(.45,Math.max(0,finite(maxForce))*clamp(finite(dt),0,1/30));
  const response=frictionResponse(closingSpeed,slide,inverseMass,tangentMass,crossMass,cap,clamp(finite(restitution),0,.3),muStatic,muDynamic);
  const impulse=response.normal,frictionImpulse=response.tangent;
  if(impulse>0){
    const x=n.x*impulse+tangent.x*frictionImpulse,y=n.y*impulse+tangent.y*frictionImpulse;
    a.reactImpulse({body:'weapon',point:pointA,impulse:{x:-x,y:-y}});
    b.reactImpulse({body:'weapon',point:pointB,impulse:{x,y}});
  }
  // The swept material anchors remain ordered on their entry normal. Project
  // penetration now, so the next head sweep cannot use a blade that tunneled
  // through its rival. Motors keep their original target and recover normally.
  let penetration=0,iterations=0;
  for(;project&&iterations<24;iterations++){
    const constraint=weaponBindManifold(a,b,c)[0];
    if(!constraint){penetration=0;break;}
    ({pointA,pointB,penetration}=constraint);
    const projected=ArticulatedRig.projectContact(a,b,{pointA,pointB,normal:n,penetration:penetration+1e-7});
    if(!projected.applied)break;
  }
  if(!project)penetration=weaponBindManifold(a,b,c)[0]?.penetration??0;
  p=current();pointA=located(p.a,c.anchorA);pointB=located(p.b,c.anchorB);
  const slipAfterNormal=slide-crossMass*impulse;
  const slidePower=Math.max(0,frictionImpulse*slipAfterNormal-.5*tangentMass*frictionImpulse**2)/Math.max(finite(dt),1e-9);
  return {...c,pointA,pointB,bodyA:'weapon',bodyB:'weapon',impulse,frictionImpulse,frictionState:response.state,slidePower,closingSpeed,slideSpeed,penetration:Math.max(0,penetration),iterations,
    at:{x:(c.pointA.x+c.pointB.x)/2,y:(c.pointA.y+c.pointB.y)/2,z:(c.pointA.z+c.pointB.z)/2}};
}
