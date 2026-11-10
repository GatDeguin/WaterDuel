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
const project=(p,n)=>{
  let min=Infinity,max=-Infinity;for(const v of p.vertices){const value=dot(v,n);min=Math.min(min,value);max=Math.max(max,value);}return {min,max};
};
const half=(p,axis)=>{
  let extent=-Infinity;for(const v of p.vertices)extent=Math.max(extent,Math.abs((v.x-p.center.x)*axis.x+(v.y-p.center.y)*axis.y));return extent;
};
const anchor=(p,v)=>p.axes.map(axis=>dot({x:v.x-p.center.x,y:v.y-p.center.y},axis)/Math.max(half(p,axis),1e-9));
const located=(p,uv)=>{
  let x=0,y=0;for(let i=0;i<p.axes.length;i++){const n=p.axes[i],extent=half(p,n);x+=n.x*uv[i]*extent;y+=n.y*uv[i]*extent;}return {x:p.center.x+x,y:p.center.y+y,z:p.z};
};
const supportFace=(p,n,tangent)=>{
  const extent=project(p,n).max;let min=Infinity,max=-Infinity;
  for(const v of p.vertices)if(extent-dot(v,n)<1e-7){const value=dot(v,tangent);min=Math.min(min,value);max=Math.max(max,value);}return {extent,min,max};
};
const support=(face,n,tangent,coordinate)=>{
  const t=clamp(coordinate,face.min,face.max);return {x:n.x*face.extent+tangent.x*t,y:n.y*face.extent+tangent.y*t};
};

function separation(a,b,dir=1){
  let gap=-Infinity,normal;
  for(let i=0;i<a.axes.length+b.axes.length;i++){
    const axis=i<a.axes.length?a.axes[i]:b.axes[i-a.axes.length];
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
  const faceA=supportFace(a,normal,tangent),faceB=supportFace(b,reverse,tangent);
  const along=(Math.max(faceA.min,faceB.min)+Math.min(faceA.max,faceB.max))/2;
  const z=(Math.max(a.z-a.depth/2,b.z-b.depth/2)+Math.min(a.z+a.depth/2,b.z+b.depth/2))/2;
  return {pointA:{...support(faceA,normal,tangent,along),z},pointB:{...support(faceB,reverse,tangent,along),z}};
}

// Bound on travel of any material point over this step. Every active weapon
// hinge is included, and the lever exceeds the whole torso/arm/blade chain.
// Conservative advancement therefore cannot jump across a thin rotating blade.
function travelBound(rig,axis,depthTravel){
  const dx=(rig.q?.[0]??0)-(rig.previousQ?.[0]??rig.q?.[0]??0),dy=(rig.q?.[1]??0)-(rig.previousQ?.[1]??rig.q?.[1]??0);
  let travel=axis?Math.abs(dx*axis.x+dy*axis.y):Math.hypot(dx,dy);
  const lever=5*(rig.scale??1)+Math.max(rig.swordLength??1,rig.previousSwordLength??1);
  for(let i=2;i<(rig.q?.length??0);i++)travel+=Math.abs(rig.q[i]-(rig.previousQ?.[i]??rig.q[i]))*lever;
  return travel+Math.abs((rig.swordLength??1)-(rig.previousSwordLength??rig.swordLength??1))+2*Math.abs((rig.weaponFlex?.offset??0)-(rig.weaponFlex?.previousOffset??0))+(axis?0:depthTravel);
}

function accelerationBound(rig){
  let angular=0;for(let i=2;i<(rig.q?.length??0);i++)angular+=Math.abs(rig.q[i]-(rig.previousQ?.[i]??rig.q[i]));
  const lever=5*(rig.scale??1)+Math.max(rig.swordLength??1,rig.previousSwordLength??1);
  const bend=Math.abs((rig.weaponFlex?.offset??0)-(rig.weaponFlex?.previousOffset??0));
  return lever*angular*angular+2*Math.abs((rig.swordLength??1)-(rig.previousSwordLength??rig.swordLength??1))*angular+4*bend*angular+4*bend*bend/Math.max(.45,rig.swordLength??1);
}

// A loaded compound can begin embedded (spawn, reset or a changed loadout).
// Its shaft and head may choose opposite minimum SAT normals independently.
// Choose the shortest common separating side along the real pieces' SAT axes;
// otherwise unilateral rows keep driving the blade into the same solid head.
function compoundOverlapRecovery(A,B,dir=1){
  if(!A.some(p=>p.key==='weapon-head')&&!B.some(p=>p.key==='weapon-head'))return null;
  const overlaps=[];
  for(const a of A)for(const b of B){const s=separation(a,b,dir);if(s.gap< -1e-6&&s.xyGap< -1e-6)overlaps.push({a,b,normal:s.normal});}
  if(overlaps.length<2||!overlaps.some((p,i)=>overlaps.some((q,j)=>j>i&&dot(p.normal,q.normal)<0)))return null;
  let best=null;
  for(const pair of overlaps)for(const axis of [...pair.a.axes,...pair.b.axes])for(const sign of [1,-1]){
    const normal={x:axis.x*sign,y:axis.y*sign};let depth=-Infinity,blocking=null;
    for(const p of overlaps){const amount=project(p.a,normal).max-project(p.b,normal).min;if(amount>depth){depth=amount;blocking=p;}}
    if(depth>0&&(!best||depth<best.depth))best={...blocking,normal,depth};
  }
  return best;
}


// Bound the planar acceleration of native rectangle corners in step time.
// Along a bent blade the tangent is angle + fraction * (2 * bend / length).
// Integrating it gives the tip and segment endpoints; the chord normal turns
// at the segment's midpoint angle. The root trim covers just .15 units of
// that first chord. The extra unit bounds the rigid head and corner offsets.
function weaponCornerMotion(rig){
  const q=rig.q,prior=rig.previousQ??q,scale=rig.scale;
  if((rig.dir!==1&&rig.dir!==-1)||!(Math.abs(rig.wristRestAngle)<=64))return null;
  const length=rig.swordLength,previousLength=rig.previousSwordLength??length;
  const lo=Math.min(length,previousLength),hi=Math.max(length,previousLength);
  const bend=rig.weaponFlex?.offset??0,previousBend=rig.weaponFlex?.previousOffset??0;
  // Keep a positive span after trimming .15 units from the first segment.
  if(!(lo>=.65&&hi<=2&&scale>0&&scale<=2&&Math.max(Math.abs(bend),Math.abs(previousBend))<=.04))return null;
  for(const i of [0,1,2,3,4,5,13])if(!(Math.abs(q[i])<=64&&Math.abs(prior[i])<=64))return null;
  const torso=(q[2]-prior[2])+(q[3]-prior[3]);
  const upper=torso+(q[4]-prior[4]),fore=upper+(q[5]-prior[5]),wrist=fore+(q[13]-prior[13]);
  const dl=length-previousLength,db=bend-previousBend;
  // A linear bend divided by a linear length has a constant derivative
  // numerator. Bound both derivatives at the shortest length of the step.
  const turnRate=2*Math.abs(db*previousLength-previousBend*dl)/(lo*lo);
  const turnAcceleration=2*turnRate*Math.abs(dl)/lo;
  const speed=Math.abs(wrist)+turnRate;
  const acceleration=scale*(1.1*torso**2+.6*upper**2+.6*fore**2)+
    (hi+1)*(speed**2+turnAcceleration)+2*Math.abs(dl)*speed;
  const linearSpeed=Math.hypot(q[0]-prior[0],q[1]-prior[1])+scale*(1.1*Math.abs(torso)+.6*Math.abs(upper)+.6*Math.abs(fore))+
    Math.abs(dl)+(hi+1)*speed;
  return {acceleration,linearSpeed,speed,turnAcceleration};
}


function weaponSweepMotion(a,b){
  const left=weaponCornerMotion(a),right=weaponCornerMotion(b);
  return left&&right?{a:left,b:right,linearSpeed:left.linearSpeed+right.linearSpeed,acceleration:left.acceleration+right.acceleration}:null;
}

function turningAxisSeparated(left,right,width,motion){
  if(!motion||!(left.xyGap>WEAPON_BIND.tolerance+1e-8))return false;
  const normal=left.normal;
  for(const part of ['a','b'])for(let i=0;i<left[part].axes.length;i++){
    const axis=left[part].axes[i];
    const sign=axis.x===normal.x&&axis.y===normal.y?1:axis.x===-normal.x&&axis.y===-normal.y?-1:0;
    if(!sign)continue;
    const endAxis=right[part].axes[i];
    const {speed,turnAcceleration}=motion[part];
    const radius=p=>(p.maxX-p.minX+p.maxY-p.minY)/2;
    const reach=Math.hypot(left.b.center.x-left.a.center.x,left.b.center.y-left.a.center.y)+
      radius(left.a)+radius(left.b)+motion.linearSpeed*width;
    // d is a relative corner vector and n is this panel's rotating axis.
    // Bound (d·n)'' by the acceleration, speed and reach terms.
    const bound=motion.acceleration+2*motion.linearSpeed*speed+reach*(speed**2+turnAcceleration);
    const margin=WEAPON_BIND.tolerance+1e-8+bound*width*width/8;
    if(!(left.xyGap>margin))return false;
    const end={x:sign*endAxis.x,y:sign*endAxis.y};
    let maxA=-Infinity,minB=Infinity;
    for(const vertex of right.a.vertices)maxA=Math.max(maxA,dot(vertex,end));
    for(const vertex of right.b.vertices)minB=Math.min(minB,dot(vertex,end));
    return minB-maxA>margin;
  }
  return false;
}

function advance(query,rate,accelerationA=0,accelerationB=0,before=Infinity,motionForSweep=null){
  const cache=new Map(),sample=t=>{if(!cache.has(t))cache.set(t,query(t));return cache.get(t);},bound=rate();let t=0;
  // A grazing angular contact can converge too slowly for advancement alone.
  // Subdivide the unresolved interval in temporal order. A midpoint separation
  // exceeding all possible travel certifies the entire interval as empty; only
  // a genuinely touching sample can be returned. No fixed sample grid or
  // end-frame-only fallback may skip an earlier entry.
  const search=(lo,hi,left=sample(lo),right=sample(hi))=>{
    if(lo>=before||!left||!right)return null;
    if(left.gap<=WEAPON_BIND.tolerance)return {...left,t:lo};
    const motion=motionForSweep?.();
    if(motion&&(turningAxisSeparated(left,right,hi-lo,motion)||turningAxisSeparated(right,left,hi-lo,motion)))return null;
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
    if(t>=before)return null;
    const s=sample(t);if(!s)return null;
    if(s.gap<=WEAPON_BIND.tolerance)return {...s,t};
    const speed=rate(s.axis);if(speed<1e-12)return null;
    const next=t+s.gap/speed;
    if(next>1+1e-12)return null;
    if(next<=t+1e-14)return search(t,1);
    t=Math.min(1,next);
  }
  return t>=before?null:search(t,1);
}

const rigPrototype=ArticulatedRig.prototype;
const nativePanels=rigPrototype.collisionPanels,nativePanelsAt=rigPrototype.collisionPanelsAt,nativeGeometryAt=rigPrototype.collisionGeometryAt;
const nativeSweep=rig=>Object.getPrototypeOf(rig)===rigPrototype&&rig.collisionPanels===nativePanels&&
  rig.collisionPanelsAt===nativePanelsAt&&rig.collisionGeometryAt===nativeGeometryAt;

// Owned by one CCD query only. Selected geometry preserves the full API's
// last-key lookup; legacy colliders still sample and cache the complete frame.
function panelSampler(rig){
  const cache=new Map(),selected=typeof rig.collisionGeometryAt==='function';
  return (t,key)=>{
    let sample=cache.get(t);
    if(!sample){sample=new Map();cache.set(t,sample);if(!selected)for(const p of rig.collisionPanelsAt(t))sample.set(p.key,p);}
    if(selected&&!sample.has(key)){
      let panel;
      for(const p of rig.collisionGeometryAt(t,key))if(p.key===key||p.key!==p.key&&key!==key)panel=p;
      sample.set(key,panel);
    }
    return sample.get(key);
  };
}

export function firstWeaponContact(a,b){
  if(!a?.collisionPanelsAt||!b?.collisionPanelsAt)return null;
  const zA=a.weaponDepthOffset??0,zB=b.weaponDepthOffset??0,previousA=a.previousWeaponDepthOffset??zA,previousB=b.previousWeaponDepthOffset??zB;
  const dzA=zA-previousA,dzB=zB-previousB;
  const travelA=Math.abs(dzA),travelB=Math.abs(dzB),relativeDepth=Math.abs(dzA-dzB);
  const rate=axis=>axis?.z?relativeDepth:travelBound(a,axis,travelA)+travelBound(b,axis,travelB);
  const A=panels(a),B=panels(b),atA=panelSampler(a),atB=panelSampler(b);let best=null;
  const depthActive=zA!==0||zB!==0||previousA!==0||previousB!==0;
  const prune=nativeSweep(a)&&nativeSweep(b);
  let motion;
  const motionForSweep=prune?()=>{
    if(motion===undefined)motion=weaponSweepMotion(a,b);
    return motion;
  }:null;
  // Later pairs can only win strictly before the current hit. Keep the same
  // subdivisions and pair order, including equal-time and overlap recovery.
  pairs: for(const pa of A)for(const pb of B){
    if(prune&&best?.t===0)break pairs;
    const hit=advance(t=>{
      const p=atA(t,pa.key),q=atB(t,pb.key);if(!p||!q)return null;
      return {...separation(p,q,a.dir??1),a:p,b:q};
    },rate,accelerationBound(a),accelerationBound(b),prune?best?.t:Infinity,motionForSweep);
    if(hit&&(!best||hit.t<best.t)){
      const points=manifold(hit.a,hit.b,hit.normal);
      const side=depthActive&&hit.axis.z?Math.sign(hit.b.z-hit.a.z)||Math.sign(dzA-dzB):0;
      const normal=side?{x:0,y:0,z:side}:hit.normal;
      if(side){
        points.pointA.z=hit.a.z+side*hit.a.depth/2;
        points.pointB.z=hit.b.z-side*hit.b.depth/2;
      }
      best={t:hit.t,normal,...points,keyA:pa.key,keyB:pb.key,
        anchorA:anchor(hit.a,points.pointA),anchorB:anchor(hit.b,points.pointB)};
    }
  }
  if(best?.t===0&&!best.normal.z&&(A.some(p=>p.key==='weapon-head')||B.some(p=>p.key==='weapon-head'))){
    const recovery=compoundOverlapRecovery(A.map(p=>atA(0,p.key)).filter(Boolean),B.map(p=>atB(0,p.key)).filter(Boolean),a.dir??1);
    if(recovery){
      const {a:pa,b:pb,normal}=recovery,points=manifold(pa,pb,normal);
      best={t:0,normal,...points,keyA:pa.key,keyB:pb.key,anchorA:anchor(pa,points.pointA),anchorB:anchor(pb,points.pointB)};
    }
  }
  return best;
}

export function firstWeaponPointContact(rig,from,to){
  if(!rig?.collisionPanelsAt||!from||!to||![from.x,from.y,to.x,to.y,from.z??0,to.z??0].every(Number.isFinite))return null;
  const dx=to.x-from.x,dy=to.y-from.y,dz=(to.z??0)-(from.z??0);
  const depth=rig.weaponDepthOffset??0,depthDelta=depth-(rig.previousWeaponDepthOffset??depth);
  const rate=axis=>axis?.z?Math.abs(depthDelta-dz):travelBound(rig,axis,Math.abs(depthDelta))+
    (axis?Math.abs(dx*axis.x+dy*axis.y):Math.hypot(dx,dy,dz));
  const at=panelSampler(rig);let best=null;
  for(const panel of panels(rig)){
    const hit=advance(t=>{
      const p=at(t,panel.key);if(!p)return null;
      const point={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:(from.z??0)+((to.z??0)-(from.z??0))*t};
      const q={center:point,vertices:[point],axes:[],z:point.z,depth:0};
      return {...separation(p,q,rig.dir??1),point,a:p,b:q};
    },rate,accelerationBound(rig),0);
    if(hit&&(!best||hit.t<best.t))best={t:hit.t,point:hit.point,key:panel.key};
  }
  return best;
}

function anchoredManifold(a,b,c,panelsA,panelsB){
  if(!c?.anchorA||!c?.anchorB)return [];
  const pa=panelsA.find(p=>p.key===c.keyA),pb=panelsB.find(p=>p.key===c.keyB);if(!pa||!pb)return [];
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
export function weaponBindManifold(a,b,c){
  if(c?.normal?.z)return [];
  const A=panels(a),B=panels(b);
  let contacts=anchoredManifold(a,b,c,A,B);
  if(A.length===1&&B.length===1)return contacts;
  const coherent=c?.t===0&&compoundOverlapRecovery(A,B,a.dir??1)?c.normal:null;
  if(coherent)contacts=contacts.flatMap(contact=>{
    const pa=A.find(p=>'steel:'+p.key===contact.keyA),pb=B.find(p=>'steel:'+p.key===contact.keyB);if(!pa||!pb)return [];
    const points=manifold(pa,pb,coherent),penetration=-(points.pointB.x-points.pointA.x)*coherent.x-(points.pointB.y-points.pointA.y)*coherent.y;
    return penetration>1e-6?[{...contact,...points,normal:coherent,penetration}]:[];
  });
  // A rigid head/shaft compound needs the same complete set as a bent beam.
  // Solving only its first swept shaft anchor can leave a solid head buried.
  for(const pa of A)for(const pb of B){
    if(contacts.some(q=>q.keyA===`steel:${pa.key}`&&q.keyB===`steel:${pb.key}`))continue;
    const s=separation(pa,pb,a.dir??1);if(s.gap>=-1e-6||s.xyGap>0)continue;
    const normal=coherent??s.normal,points=manifold(pa,pb,normal);
    const penetration=coherent?-(points.pointB.x-points.pointA.x)*normal.x-(points.pointB.y-points.pointA.y)*normal.y:-s.xyGap;
    contacts.push({bodyA:'weapon',bodyB:'weapon',keyA:`steel:${pa.key}`,keyB:`steel:${pb.key}`,normal,penetration,...points,projectOnly:true});
  }
  return contacts;
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

function signedFrictionResponse(a,b,pointA,pointB,n,t,vn,vt,cap,restitution,muStatic,muDynamic){
  if(typeof a.trialContactImpulse!=='function'||typeof b.trialContactImpulse!=='function')return null;
  const queryA=ArticulatedRig.createNativeContactQuery?.(a,{body:'weapon',point:pointA,normal:n}),
    queryB=queryA?ArticulatedRig.createNativeContactQuery?.(b,{body:'weapon',point:pointB,normal:n}):null;
  const prepared=queryA&&queryB;
  const trial=response=>{
    const x=n.x*response.normal+t.x*response.tangent,y=n.y*response.normal+t.y*response.tangent;
    const A=prepared?queryA.trial({impulse:{x:-x,y:-y},compact:true}):a.trialContactImpulse({body:'weapon',point:pointA,normal:n,impulse:{x:-x,y:-y},compact:true}),
      B=prepared?queryB.trial({impulse:{x,y},compact:true}):b.trialContactImpulse({body:'weapon',point:pointB,normal:n,impulse:{x,y},compact:true});
    if(!A||!B)return null;
    const relative={x:A.pointVelocityAfter.x-B.pointVelocityAfter.x,y:A.pointVelocityAfter.y-B.pointVelocityAfter.y};
    return {A,B,kn:A.normal+B.normal,kt:A.tangent+B.tangent,kc:A.cross+B.cross,vn:dot(relative,n),vt:dot(relative,t)};
  };
  let response={normal:0,tangent:0,state:'free'},result,converged=false,iterations=0;
  // Each iterate starts from the unchanged initial velocities. A(-p), B(+p)
  // select their own common active sets for that same signed TOTAL impulse.
  for(;iterations<8;iterations++){
    result=trial(response);if(!result)break;
    const {kn,kt,kc}=result;
    // The frozen-set response is affine because velocity/gap stabilization
    // need not be zero. Recover its intercept before solving the Coulomb cone.
    const baseN=result.vn+kn*response.normal+kc*response.tangent,
      baseT=result.vt+kc*response.normal+kt*response.tangent;
    const next=frictionResponse(baseN+restitution*Math.max(0,vn),baseT,kn,kt,kc,cap,0,muStatic,muDynamic);
    if(Math.hypot(next.normal-response.normal,next.tangent-response.tangent)<1e-9){response=next;converged=true;break;}
    response=next;
  }
  const admissible=(r,p)=>r&&[r.A,r.B].every(s=>s.constraintSummary.minMultiplier>=0&&s.constraintSummary.minSlack>=-1e-7&&s.constraintSummary.maxComplementarity<1e-7)&&
    r.A.energyAfter+r.B.energyAfter<=r.A.energyBefore+r.B.energyBefore+1e-9&&r.vn<=vn+1e-8&&
    p.normal>=0&&p.normal<=cap+1e-12&&Math.abs(p.tangent)<=muStatic*p.normal+1e-12;
  result=trial(response);
  // A bounded solver need not converge on a change of active set. Backtrack
  // only this same physical impulse and validate the real unilateral result;
  // never apply an unchecked tensor prediction or mutate either rig in trials.
  let backtracks=0;
  while(!admissible(result,response)&&backtracks<8){
    response={...response,normal:response.normal*.5,tangent:response.tangent*.5};result=trial(response);backtracks++;
  }
  if(!admissible(result,response)){response={normal:0,tangent:0,state:'free'};result=trial(response);converged=false;}
  return {response,inverseMass:result?.kn??0,tangentMass:result?.kt??0,crossMass:result?.kc??0,
    dissipatedWork:response.normal>0?Math.max(0,result.A.energyBefore+result.B.energyBefore-result.A.energyAfter-result.B.energyAfter):0,
    contactIterations:Math.min(iterations+1,8),contactConverged:converged&&backtracks===0,contactBacktracks:backtracks};
}

function depthPenetration(a,b,c){
  const pa=panels(a).find(p=>p.key===c.keyA),pb=panels(b).find(p=>p.key===c.keyB);
  if(!pa||!pb||separation(pa,pb,a.dir??1).xyGap>WEAPON_BIND.tolerance)return 0;
  return Math.max(0,(pa.depth+pb.depth)/2-(pb.z-pa.z)*c.normal.z);
}

export function projectWeaponDepthContact(a,b,c){
  const penetration=depthPenetration(a,b,c);
  if(penetration<=1e-7||!a.projectWeaponDepth||!b.projectWeaponDepth)return penetration;
  const massA=a.weaponDepthInverseMass,massB=b.weaponDepthInverseMass,inverseMass=massA+massB;
  if(!(inverseMass>0))return penetration;
  const side=c.normal.z,amount=Math.min(.035,penetration+1e-7);
  let movedA=-side*a.projectWeaponDepth(-side*amount*massA/inverseMass);
  const movedB=side*b.projectWeaponDepth(side*(amount-movedA));
  const remaining=amount-movedA-movedB;
  if(remaining>1e-7)movedA-=side*a.projectWeaponDepth(-side*remaining);
  return Math.max(0,penetration-movedA-movedB);
}

function resolveDepthBind(a,b,c,{cap,bounce,project,observeVelocities}){
  const inverseMass=a.weaponDepthInverseMass+b.weaponDepthInverseMass;
  const speedA=a.weaponDepthVelocity,speedB=b.weaponDepthVelocity;
  if(!(inverseMass>0)||![speedA,speedB,inverseMass].every(Number.isFinite)||!a.applyWeaponDepthImpulse||!b.applyWeaponDepthImpulse)
    return {...c,impulse:0,reason:'invalid-depth-contact'};
  const side=c.normal.z,closingSpeed=(speedA-speedB)*side;
  const impulse=clamp((1+bounce)*closingSpeed/inverseMass,0,cap);
  const va=a.pointVelocity({body:'weapon',point:c.pointA}),vb=b.pointVelocity({body:'weapon',point:c.pointB});
  const slideSpeed=va&&vb?Math.hypot(va.x-vb.x,va.y-vb.y):0;
  if(impulse>0){a.applyWeaponDepthImpulse(-side*impulse);b.applyWeaponDepthImpulse(side*impulse);}
  const penetration=project?projectWeaponDepthContact(a,b,c):depthPenetration(a,b,c);
  const velocities=observeVelocities&&va&&vb?{beforeA:{...va,z:speedA},beforeB:{...vb,z:speedB},
    afterA:{...va,z:a.weaponDepthVelocity},afterB:{...vb,z:b.weaponDepthVelocity}}:null;
  const dissipatedWork=Math.max(0,closingSpeed*impulse-.5*inverseMass*impulse**2);
  return {...c,bodyA:'weapon',bodyB:'weapon',impulse,closingSpeed,slideSpeed,penetration,dissipatedWork,
    frictionImpulse:0,frictionState:'free',slidePower:0,flexWork:0,iterations:Number(project),...(velocities?{velocities}:{}),
    at:{x:(c.pointA.x+c.pointB.x)/2,y:(c.pointA.y+c.pointB.y)/2,z:(c.pointA.z+c.pointB.z)/2}};
}

export function resolveWeaponBind(a,b,{dt=1/120,maxForce=WEAPON_BIND.maxForce,restitution=WEAPON_BIND.restitution,project=true,
  staticFriction=WEAPON_BIND.staticFriction,dynamicFriction=WEAPON_BIND.dynamicFriction,observeVelocities=false}={}){
  const c=firstWeaponContact(a,b);if(!c)return {impulse:0,reason:'no-contact'};
  const cap=Math.min(.45,Math.max(0,finite(maxForce))*clamp(finite(dt),0,1/30)),bounce=clamp(finite(restitution),0,.3);
  if(c.normal.z)return resolveDepthBind(a,b,c,{cap,bounce,project,observeVelocities});
  const current=()=>({a:panels(a).find(p=>p.key===c.keyA),b:panels(b).find(p=>p.key===c.keyB)});
  let p=current(),pointA=located(p.a,c.anchorA),pointB=located(p.b,c.anchorB),n=c.normal;
  const va=a.pointVelocity({body:'weapon',point:pointA}),vb=b.pointVelocity({body:'weapon',point:pointB});
  if(!va||!vb)return {...c,impulse:0,reason:'invalid-contact'};
  const closingSpeed=(va.x-vb.x)*n.x+(va.y-vb.y)*n.y;
  const tangent={x:-n.y,y:n.x},slide=(va.x-vb.x)*tangent.x+(va.y-vb.y)*tangent.y,slideSpeed=Math.abs(slide);
  const muStatic=clamp(finite(staticFriction),0,1),muDynamic=Math.min(muStatic,clamp(finite(dynamicFriction),0,1));
  const signed=signedFrictionResponse(a,b,pointA,pointB,n,tangent,closingSpeed,slide,cap,bounce,muStatic,muDynamic);
  const A=signed?null:contactInertia(a,pointA,n,muStatic>0),B=signed?null:contactInertia(b,pointB,n,muStatic>0);
  // A duck-typed legacy collider exposes only normal inverse mass. Without
  // both complete tensors, preserve its normal response rather than predict
  // tangential work using only half of the actual system.
  const complete=!signed&&A.complete&&B.complete;
  const inverseMass=signed?.inverseMass??A.normal+B.normal,tangentMass=signed?.tangentMass??(complete?A.tangent+B.tangent:0),crossMass=signed?.crossMass??(complete?A.cross+B.cross:0);
  const response=signed?.response??frictionResponse(closingSpeed,slide,inverseMass,tangentMass,crossMass,cap,bounce,muStatic,muDynamic);
  const impulse=response.normal,frictionImpulse=response.tangent;
  const dissipatedWork=Math.min(signed?.dissipatedWork??Infinity,Math.max(0,closingSpeed*impulse+slide*frictionImpulse-.5*(inverseMass*impulse**2+2*crossMass*impulse*frictionImpulse+tangentMass*frictionImpulse**2)));
  let flexWork=0;
  let velocities;
  if(impulse>0){
    const x=n.x*impulse+tangent.x*frictionImpulse,y=n.y*impulse+tangent.y*frictionImpulse;
    a.reactImpulse({body:'weapon',point:pointA,impulse:{x:-x,y:-y}});
    b.reactImpulse({body:'weapon',point:pointB,impulse:{x,y}});
    if(observeVelocities)velocities={beforeA:{...va},beforeB:{...vb},afterA:a.pointVelocity({body:'weapon',point:pointA}),afterB:b.pointVelocity({body:'weapon',point:pointB})};
    // A small share of already dissipated work is stored in internal bending,
    // rather than adding another whole contact impulse/rig velocity. Zero work,
    // separated blades and rigid equipment cannot manufacture a vibration.
    for(const [rig,sign,point] of [[a,-1,pointA],[b,1,pointB]]){
      if(!rig.weaponFlex?.maximum)continue;
      const p=rig.pose(),angle=p.angles.weapon,transverse=-Math.sin(angle)*x+Math.cos(angle)*y;
      const lever=clamp(Math.hypot(point.x-p.mainHand.x,point.y-p.mainHand.y)/Math.max(.45,rig.swordLength),0,1);
      flexWork+=rig.weaponFlex.excite(sign*transverse*rig.dir,dissipatedWork*.125*lever*lever);
    }
  }
  // The swept material anchors remain ordered on their entry normal. Project
  // penetration now, so the next head sweep cannot use a blade that tunneled
  // through its rival. Motors keep their original target and recover normally.
  let penetration=0,iterations=0;
  for(;project&&iterations<24;iterations++){
    const constraint=weaponBindManifold(a,b,c)[0];
    if(!constraint){penetration=0;break;}
    ({pointA,pointB,penetration}=constraint);
    const projected=ArticulatedRig.projectContact(a,b,{pointA,pointB,normal:constraint.normal,penetration:penetration+1e-7});
    if(!projected.applied)break;
  }
  if(!project)penetration=weaponBindManifold(a,b,c)[0]?.penetration??0;
  p=current();pointA=located(p.a,c.anchorA);pointB=located(p.b,c.anchorB);
  const slipAfterNormal=slide-crossMass*impulse;
  const slidePower=Math.max(0,frictionImpulse*slipAfterNormal-.5*tangentMass*frictionImpulse**2)/Math.max(finite(dt),1e-9);
  return {...c,pointA,pointB,bodyA:'weapon',bodyB:'weapon',impulse,frictionImpulse,frictionState:response.state,slidePower,closingSpeed,slideSpeed,dissipatedWork,flexWork,
    ...(signed?{contactIterations:signed.contactIterations,contactConverged:signed.contactConverged,contactBacktracks:signed.contactBacktracks}:{}),...(velocities?{velocities}:{}),penetration:Math.max(0,penetration),iterations,
    at:{x:(c.pointA.x+c.pointB.x)/2,y:(c.pointA.y+c.pointB.y)/2,z:(c.pointA.z+c.pointB.z)/2}};
}
