// Reduced-coordinate planar multibody plus a reduced lateral neck hinge.
// Other limb depth remains a layer; this is not a full 3D/Coulomb-contact solver.
import {TABLE_TOP} from './dimensions.js';
import {normalizeLoadout,getWeapon,getDefense} from '../equipment.js';
import {ApronHinge,apronParentFrame} from './apron.js';
import {DetachedCluster} from './detached-cluster.js';
import {WeaponFlex,bladeLocalAt} from './weapon-flex.js';
export const RIG_STEP=1/120;
export const REFERENCE_STANCE=Object.freeze({hipHeight:.98,hipSocket:.11,frontFoot:.47,backFoot:-.64,
  thigh:.53,shin:.55,torso:.755,neck:.56,shoulderHalfWidth:.275,shoulderDrop:.05,lean:.12,mainReach:.82,mainRise:.02,offReach:-.76,offRise:.02});
export const NECK_CONE=25*Math.PI/180;
const N=14,PI=Math.PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const names=['baseX','baseY','pelvis','torso','mainShoulder','mainElbow','offShoulder','offElbow','frontHip','frontKnee','backHip','backKnee','neck','wrist'];
const severedBodies={mainShoulder:['mainUpper','mainForearm','weapon'],mainElbow:['mainForearm','weapon'],wrist:['weapon'],
  offShoulder:['offUpper','offForearm','offWeapon'],offElbow:['offForearm','offWeapon'],frontHip:['frontThigh','frontShin'],frontKnee:['frontShin'],backHip:['backThigh','backShin'],backKnee:['backShin']};
const severedCoordinates={mainShoulder:[4,5,13],mainElbow:[5,13],wrist:[13],offShoulder:[6,7],offElbow:[7],frontHip:[8,9],frontKnee:[9],backHip:[10,11],backKnee:[11]};
const jointPivot={mainShoulder:'mainShoulder',mainElbow:'mainElbow',wrist:'mainHand',offShoulder:'offShoulder',offElbow:'offElbow',frontHip:'frontHip',frontKnee:'kneeF',backHip:'backHip',backKnee:'kneeB',pelvis:'hip',torso:'hip',neck:'shoulder'};
const limits=[[-20,20],[.40,1.95],[-.32,.32],[-.92,.92],[-3.12,1.48],[.035,2.96],[-1.52,2.85],[-2.96,-.035],[-3.10,-.035],[-2.82,-.025],[-3.10,-.035],[-2.82,-.025],[-.40,.40],[-PI/4,PI/4]];
const STOP_ROWS=Array.from({length:N},(_,i)=>[-1,1].map(sign=>{const row=new Float64Array(N);row[i]=sign;return row;}));
const masses={pelvis:.55,torso:1.35,neck:.13,mainUpper:.34,mainForearm:.25,offUpper:.31,offForearm:.23,frontThigh:.34,frontShin:.25,backThigh:.34,backShin:.25,weapon:.16,offWeapon:.055};
const PASSIVE_DRAG=Object.freeze([3,3,4,2,4,4,4,4,10,10,10,10,2,4]);
// Bounds measured in the delivered v2 shin frame, normalized by authored scale.
// Include normal and armoured geometry with a 2e-5 export/float margin. Its distal
// end is the ankle (.115 above the sole), not the .075-high foot proxy centre.
const SHIN_FLOOR=[
  {body:'frontShin',knee:'kneeF',foot:'footF',length:.5546372701022435,ankleZ:-.095,
    min:[-.10187,-.07043,-.09091],max:[.10187,.51998,.13504]},
  {body:'backShin',knee:'kneeB',foot:'footB',length:.5558772302552334,ankleZ:-.015,
    min:[-.10187,-.07053,-.09062],max:[.10187,.52130,.13504]}
];
const point=(x,y,derivatives=true)=>({x,y,jx:derivatives?new Array(N).fill(0):null,jy:derivatives?new Array(N).fill(0):null});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const dot=(a,b)=>{let value=0;for(let i=0;i<a.length;i++)value+=a[i]*b[i];return value;};
const factor=matrix=>{
  const n=matrix.length,L=Array.from({length:n},()=>new Float64Array(n));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let value=matrix[i][j];for(let k=0;k<j;k++)value-=L[i][k]*L[j][k];
    L[i][j]=i===j?Math.sqrt(Math.max(value,1e-10)):value/L[j][j];
  }
  return L;
};
const solve=(L,rhs)=>{
  const n=L.length,x=new Float64Array(n);
  for(let i=0;i<n;i++){let value=rhs[i];for(let j=0;j<i;j++)value-=L[i][j]*x[j];x[i]=value/L[i][i];}
  for(let i=n-1;i>=0;i--){let value=x[i];for(let j=i+1;j<n;j++)value-=L[j][i]*x[j];x[i]=value/L[i][i];}
  return x;
};
// Adjacent links intentionally overlap inside their hinge/clevis mounting.
const adjacent=new Set(['pelvis:torso','frontThigh:pelvis','backThigh:pelvis','frontShin:frontThigh','backShin:backThigh',
  'mainUpper:torso','mainForearm:mainUpper','offUpper:torso','offForearm:offUpper','mainForearm:weapon']);
const neighborNames=new Map();
for(const pair of adjacent){const [a,b]=pair.split(':');for(const [from,to]of [[a,b],[b,a]]){if(!neighborNames.has(from))neighborNames.set(from,new Set());neighborNames.get(from).add(to);}}
const neighbors=(a,b)=>a===b||neighborNames.get(a)?.has(b)===true;
const appendFloorPanel=(samples,body,a,b,width,floorKey)=>{
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length,h=width/2;
  const vertices=[{x:a.x-uy*h,y:a.y+ux*h},{x:a.x+uy*h,y:a.y-ux*h},{x:b.x+uy*h,y:b.y-ux*h},{x:b.x-uy*h,y:b.y+ux*h}];
  for(const v of vertices){v.body=body;if(floorKey)v.floorKey=floorKey;samples.push(v);}
};
const collisionPanel=(body,a,b,width,z,depth,key=body)=>{
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length,h=width/2;
  return {body,key,z,depth,axes:[{x:ux,y:uy},{x:-uy,y:ux}],center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},
    minX:Math.min(a.x,b.x)-Math.abs(uy)*h,maxX:Math.max(a.x,b.x)+Math.abs(uy)*h,
    minY:Math.min(a.y,b.y)-Math.abs(ux)*h,maxY:Math.max(a.y,b.y)+Math.abs(ux)*h,
    vertices:[{x:a.x-uy*h,y:a.y+ux*h},{x:a.x+uy*h,y:a.y-ux*h},{x:b.x+uy*h,y:b.y-ux*h},{x:b.x-uy*h,y:b.y+ux*h}]};
};
// Preserve the exact vertex-projection arithmetic of collisionPanel -> OBB,
// while avoiding the temporary panel, vertex objects and nested map arrays.
const collisionSolid=(body,a,b,width,z,depth,key=body)=>{
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length,h=width/2;
  const x=(a.x+b.x)/2,y=(a.y+b.y)/2;
  const x0=a.x-uy*h,y0=a.y+ux*h,x1=a.x+uy*h,y1=a.y-ux*h;
  const x2=b.x+uy*h,y2=b.y-ux*h,x3=b.x-uy*h,y3=b.y+ux*h;
  const extent=(vx,vy)=>Math.max(Math.abs((x0-x)*vx+(y0-y)*vy),Math.abs((x1-x)*vx+(y1-y)*vy),
    Math.abs((x2-x)*vx+(y2-y)*vy),Math.abs((x3-x)*vx+(y3-y)*vy));
  return {body,key,center:{x,y,z},axes:[{x:ux,y:uy,z:0},{x:-uy,y:ux,z:0},{x:0,y:0,z:1}],half:[extent(ux,uy),extent(-uy,ux),depth/2]};
};
const projection=(panel,n)=>{
  const values=panel.vertices.map(p=>p.x*n.x+p.y*n.y);
  return {min:Math.min(...values),max:Math.max(...values)};
};
const sharesContactFace=(a,b,n)=>{
  if(!a||!b||Math.abs(a.z-b.z)>=(a.depth+b.depth)/2-.00001)return false;
  const tangent={x:-n.y,y:n.x},A=projection(a,tangent),B=projection(b,tangent);
  return A.max>=B.min-1e-6&&B.max>=A.min-1e-6;
};
const supportFace=(panel,n,tangent)=>{
  const extent=projection(panel,n).max,face=panel.vertices.filter(p=>extent-p.x*n.x-p.y*n.y<1e-7);
  const along=face.map(p=>p.x*tangent.x+p.y*tangent.y);
  return {extent,min:Math.min(...along),max:Math.max(...along)};
};
const support=(face,n,tangent,coordinate)=>{
  const t=clamp(coordinate,face.min,face.max);
  return {x:n.x*face.extent+tangent.x*t,y:n.y*face.extent+tangent.y*t};
};
const panelContact=(a,b,dir,external=false)=>{
  // Rendered wooden panels occupy distinct extruded z intervals. An XY crossing
  // of opposite arms/legs is not a physical contact when these intervals miss.
  if(Math.abs(a.z-b.z)>=(a.depth+b.depth)/2-.00001||(!external&&neighbors(a.body,b.body)))return null;
  if(a.maxX+.001<b.minX||b.maxX+.001<a.minX||a.maxY+.001<b.minY||b.maxY+.001<a.minY)return null;
  let penetration=Infinity,normal;const axes=[];
  for(const axis of [...a.axes,...b.axes]){
    let n=axis;
    const facing=(b.center.x-a.center.x)*n.x+(b.center.y-a.center.y)*n.y;
    if(facing< -1e-10||(Math.abs(facing)<1e-10&&(n.x*dir< -1e-10||(Math.abs(n.x)<1e-10&&n.y<0))))n={x:-n.x,y:-n.y};
    const A=projection(a,n),B=projection(b,n),overlap=A.max-B.min;
    if(overlap<-.001)return null;
    axes.push({normal:n,penetration:overlap});
    if(overlap<penetration){penetration=overlap;normal=n;}
  }
  const contact=(normal,penetration)=>{
    const tangent={x:-normal.y,y:normal.x},reverse={x:-normal.x,y:-normal.y};
    const A=supportFace(a,normal,tangent),B=supportFace(b,reverse,tangent);
    const along=(Math.max(A.min,B.min)+Math.min(A.max,B.max))/2;
    return {a:a.body,b:b.body,keyA:a.key,keyB:b.key,normal,penetration,
      pointA:support(A,normal,tangent,along),pointB:support(B,reverse,tangent,along)};
  };
  const z=(Math.max(a.z-a.depth/2,b.z-b.depth/2)+Math.min(a.z+a.depth/2,b.z+b.depth/2))/2;
  const result=contact(normal,penetration);result.pointA.z=z;result.pointB.z=z;
  result.separationAxes=axes.map(c=>{const p=contact(c.normal,c.penetration);p.pointA.z=z;p.pointB.z=z;return p;});return result;
};

export class ArticulatedRig{
  #kinematicCache=null;
  #massCache=new WeakMap();
  #constraintCache=new WeakMap();
  #floorCache=new WeakMap();
  #flexibleWeapons=false;
  #weaponFlex=null;
  #surfaceSnapshot=null;
  constructor({dir=1,scale=1,baseX=0,pose=null,gravity=-9.81,massScale=1,groundHeight=TABLE_TOP+.075,apronVariant='normal',flexibleWeapons=false,surfaceSnapshot=null}={}){
    this.limits=limits.map(value=>value.slice());this.passive=false;
    this.dir=dir<0?-1:1;this.scale=clamp(finite(scale,1),.75,1.6);
    this.massScale=clamp(finite(massScale,1),.1,20);this.gravity=clamp(finite(gravity,-9.81),-20,0);
    this.groundHeight=clamp(finite(groundHeight,TABLE_TOP+.075),.1,.55);
    this.q=new Float64Array([finite(baseX),TABLE_TOP+REFERENCE_STANCE.hipHeight*this.scale,0,-REFERENCE_STANCE.lean,-2.0,1.25,2.6,-1.5,-.74,-.89,-1.85,-.48,0,0]);
    this.velocity=new Float64Array(N);this.target=this.q.slice();this.accumulator=0;this.time=0;
    this.waterLoad={mass:0,offset:{x:0,y:0},inertia:0,lateralInertia:0,lateralOffset:0};this.wristRestAngle=-.68;this.swordLength=1.02;
    this.neckLateral={angle:0,velocity:0,target:0,inertia:0,motorTorque:0};
    this.defenseDepth={position:-.08,velocity:0,target:-.08};
    this.intentBase=finite(baseX);this.intentVX=0;this.shieldRadius=.23;this.shieldRadiusX=.23;this.shieldRadiusY=.23;
    this.equipment=normalizeLoadout();this.weaponMass=.16;this.twoHanded=false;this.gripOffset=0;this.defenseLength=0;this.defenseRestAngle=0;
    // Constructor capabilities and their class instances are not a plain
    // coordinate snapshot. Copying mechanical fields must not enable a mode
    // in another rig or turn its solver into a structured-cloned plain object.
    this.#flexibleWeapons=flexibleWeapons===true;this.#weaponFlex=this.flexibleWeapons?new WeaponFlex(pose?.equipment?.weapon??'sword'):null;
    this.#surfaceSnapshot=typeof surfaceSnapshot==='function'?surfaceSnapshot:null;
    this.depth={hip:0,frontHip:.20,backHip:-.18,shoulder:0,head:.025,mainShoulder:.11,mainElbow:.14,mainHand:.17,tip:.17,offShoulder:-.11,offElbow:-.10,offHand:-.08,offGrip:.17,defenseTip:.17,kneeF:.20,kneeB:-.18,footF:.29,footB:-.22};
    this.contacts=[];this.gait={swing:null,next:0,stanceBase:finite(baseX)};
    this.jointDamage={};this.jointDamageVersion=0;this.detachedBodies=new Set();this.detachedCoordinates=new Set();this.fragments=[];this.jointEvents=[];this.topologyVersion=0;this.gripReleased=false;
    this.lastReaction=[0,0,0,0];this.lastMotor=new Float64Array(N);this.lastGravity=new Float64Array(N);this.lastImpulse=null;this.lastSelfContactImpulse=0;
    this.setIntent(pose,{baseX});
    this.q.set(this.target);
    const state=this.#kinematics();
    this.contacts=[{key:'footF',x:state.points.footF.x,y:state.points.footF.y,stance:true,vx:0,vy:0},
      {key:'footB',x:state.points.footB.x,y:state.points.footB.y,stance:true,vx:0,vy:0}];
    for(const c of this.contacts){c.offset=c.x-this.intentBase;c.floor=c.y;}
    this.apron=new ApronHinge(apronVariant);this.#advanceApron(0,state);
  }

  get flexibleWeapons(){return this.#flexibleWeapons;}
  get weaponFlex(){return this.#weaponFlex;}

  isBodyAttached(body){return !this.detachedBodies.has(body);}
  drainJointEvents(){const events=this.jointEvents;this.jointEvents=[];return events;}
  damageJoint(name,amount,{surface=null}={}){
    if(!Number.isFinite(amount)||amount<0)throw new RangeError('joint damage must be finite and nonnegative');
    if(!Object.hasOwn(jointPivot,name))return {applied:false};
    const old=this.jointDamage[name]??{damage:0,detached:false};if(old.detached||amount===0)return {applied:false,...old};
    if(severedBodies[name]?.every(body=>!this.isBodyAttached(body)))return {applied:false,damage:old.damage,detached:true};
    const damage=clamp(old.damage+amount,0,1);if(damage===old.damage)return {applied:false,...old};
    const state=this.#kinematics(),sourcePose=this.pose(),at={...sourcePose[jointPivot[name]]};
    if(surface)sourcePose.surface=surface;
    delete sourcePose.joints;delete sourcePose.detached;
    const record={damage,detached:false};this.jointDamage[name]=record;this.jointDamageVersion++;
    if(damage===1&&severedBodies[name]){
      const removed=severedBodies[name].filter(body=>this.isBodyAttached(body)),bodies=state.bodies.filter(b=>removed.includes(b.name));
      if(bodies.length){
        const panels=this.#collisionPanels(state,true).filter(p=>removed.includes(p.body)),defense=getDefense(sourcePose.equipment);
        if(removed.includes('offForearm')&&defense.kind==='shield'&&sourcePose.shieldDepth){
          // The shield asset is centred on offHand in world XY; its captured
          // radii/depth already include guard state. The existing forearm mass
          // owns this proxy, so fracture does not manufacture equipment mass.
          const h=sourcePose.offHand,rx=sourcePose.shieldRadiusX,ry=sourcePose.shieldRadiusY,{min,max}=sourcePose.shieldDepth;
          if(rx>0&&ry>0&&max>min)panels.push(collisionPanel('offForearm',{x:h.x-rx,y:h.y},{x:h.x+rx,y:h.y},2*ry,(min+max)/2,max-min,'detached-shield'));
        }
        const vertices=[...panels.flatMap(p=>p.key==='detached-shield'?p.vertices.flatMap(v=>[p.z-p.depth/2,p.z+p.depth/2].map(z=>({...v,z}))):p.vertices.map(v=>({...v,z:p.z}))),...this.#floorSamples(state).filter(p=>removed.includes(p.body))];
        const fragment=new DetachedCluster({id:`joint-${++this.topologyVersion}`,joint:name,bodies,panels,vertices,velocity:this.velocity,dir:this.dir,sourcePose,gravity:this.gravity});
        this.fragments.push(fragment);record.detached=true;record.fragmentId=fragment.id;
        for(const body of removed)this.detachedBodies.add(body);
        for(const index of severedCoordinates[name])this.detachedCoordinates.add(index);
        if(name.startsWith('main')||name==='wrist'||name.startsWith('off')){this.gripReleased=true;this.twoHanded=false;}
        if(removed.includes('frontShin'))this.contacts=this.contacts.filter(c=>c.key!=='footF');
        if(removed.includes('backShin'))this.contacts=this.contacts.filter(c=>c.key!=='footB');
        this.gait.swing=null;this.#kinematicCache=null;
      }
    }
    const event={type:record.detached?'joint-detach':'joint-damage',joint:name,damage,amount:damage-old.damage,detached:record.detached,at,...(record.fragmentId?{fragmentId:record.fragmentId}:{})};
    this.jointEvents.push(event);return {applied:true,...record};
  }

  #attachedPanels(panels){return this.detachedBodies.size?panels.filter(p=>this.isBodyAttached(p.body)):panels;}

  projectContact({body='weapon',point,normal,penetration=0}={}){
    if(!point||!normal||![point.x,point.y,normal.x,normal.y,penetration].every(Number.isFinite)||penetration<=0)return false;
    const response=ArticulatedRig.#contactResponse(this,body,point,normal);if(!response||response.mass<1e-9)return false;
    const amount=Math.min(.035,penetration)/response.mass;let rate=1;
    for(let i=0;i<N;i++)rate=Math.min(rate,.035/Math.max(Math.abs(response.delta[i]*amount),1e-12));
    for(let i=0;i<N;i++)this.q[i]+=response.delta[i]*amount*rate;
    this.#projectPositions(this.#massFactor(this.#kinematics()));this.#limitNeck();return true;
  }

  #advanceApron(dt,state){
    const p={};for(const name of ['hip','mainShoulder','offShoulder'])p[name]={x:state.points[name].x,y:state.points[name].y,z:this.depth[name]??0};
    this.apron.advance(dt,{frame:apronParentFrame(p,this.dir,this.scale,this.apron.geometry),passive:this.passive,gravity:this.gravity});
  }

  #advanceNeck(h){
    const n=this.neckLateral,s=this.scale,L=REFERENCE_STANCE.neck*s;
    const dry=masses.neck*this.massScale*s**3,mass=dry/2+this.waterLoad.mass;
    const inertia=Math.max(1e-5,(dry/3+this.waterLoad.mass)*L*L+this.waterLoad.lateralInertia);
    const K=this.passive?0:80*s**5,damping=(this.passive?2:1.8)*Math.sqrt(inertia*(this.passive?1:K));
    const neckAngle=PI/2+this.q[2]+this.q[3]+this.q[12];
    // The lateral hinge sees the actual retained mass and measured lateral COM.
    // Its Z reaction is not fed back into the planar torso coordinates.
    const gravity=-this.gravity*(mass*L*Math.sin(n.angle)*Math.sin(neckAngle)+this.waterLoad.mass*this.waterLoad.lateralOffset*Math.cos(n.angle));
    n.inertia=inertia;n.motorTorque=this.passive?0:K*(n.target-n.angle)-damping*n.velocity;
    n.velocity=clamp((inertia*n.velocity+h*(K*(n.target-n.angle)+gravity))/(inertia+h*damping+h*h*K),-4,4);
    n.angle+=h*n.velocity;this.#limitNeck();
  }

  #advanceDefenseDepth(h){
    if(this.twoHanded)return;
    const d=this.defenseDepth,mass=(masses.offForearm+.12)*this.massScale*this.scale**3,K=this.passive?0:45,drag=this.passive?2:2*Math.sqrt(K*mass);
    d.velocity=clamp((mass*d.velocity+h*K*(d.target-d.position))/(mass+h*drag+h*h*K),-.9,.9);
    d.position=clamp(d.position+h*d.velocity,-.08,.10);
    this.depth.offHand=d.position;this.depth.offElbow=-.10+.55*(d.position+.08);
  }

  #limitNeck(){
    const n=this.neckLateral,limit=this.passive?NECK_CONE:Math.sqrt(Math.max(0,NECK_CONE**2-this.q[12]**2));
    const bounded=clamp(n.angle,-limit,limit);
    if(bounded!==n.angle){n.angle=bounded;if(n.velocity*bounded>=0)n.velocity=0;}
  }

  #offset(origin,x,y,angle,rotations){
    const c=Math.cos(angle),s=Math.sin(angle),dx=this.dir*(x*c-y*s),dy=x*s+y*c;
    const p={x:origin.x+dx,y:origin.y+dy,jx:origin.jx?origin.jx.slice():null,jy:origin.jy?origin.jy.slice():null};
    if(origin.jx){
      for(const i of rotations){p.jx[i]-=this.dir*dy;p.jy[i]+=this.dir*dx;}
    }else if(origin.jy){
      for(const i of rotations)p.jy[i]+=this.dir*dx;
    }
    return p;
  }

  #kinematics(q=this.q,swordLength=this.swordLength,derivatives=true,bend=this.weaponFlex?.offset??0,yOnly=false){
    // Contact manifolds, their Jacobians and render queries often inspect the
    // exact same coordinates. Reuse only a numerically identical current state;
    // interpolated CCD states remain independent. No tolerance or stale-frame
    // reuse is allowed because small motion can change first contact ordering.
    const current=q===this.q&&derivatives,load=this.waterLoad;
    const parameters=current?[this.scale,this.dir,this.massScale,this.weaponMass,this.twoHanded,this.gripOffset,
      this.defenseLength,this.defenseRestAngle,this.wristRestAngle,this.neckLateral.angle,
      load.mass,load.offset.x,load.offset.y,load.inertia,this.topologyVersion,bend,this.weaponFlex?.previousOffset??0]:null;
    const cached=this.#kinematicCache;
    if(current&&cached&&cached.length===swordLength&&parameters.every((v,i)=>v===cached.parameters[i])&&q.every((v,i)=>v===cached.q[i]))return cached.state;
    // Only the private actuator goal needs Y derivatives. A complete current
    // cache may serve it, but a reduced state must never replace that cache.
    const s=this.scale,hip=point(q[0],q[1],derivatives&&!yOnly);if(derivatives){if(yOnly)hip.jy=new Array(N).fill(0);else hip.jx[0]=1;hip.jy[1]=1;}
    const points={hip},bodies=[],angles={},frames={};
    const add=(name,origin,angle,length,rotations,endName)=>{
      const end=this.#offset(origin,length,0,angle,rotations);
      if(derivatives){
        const center=this.#offset(origin,length/2,0,angle,rotations);
        const mass=(name==='weapon'?this.weaponMass:masses[name])*this.massScale*s**3,inertia=mass*(length*length+(.11*s)**2)/12;
        const worldAngle=this.dir===1?angle:PI-angle;
        bodies.push({name,mass,inertia,center,rotations});angles[name]=worldAngle;
        frames[name]={origin:{x:origin.x,y:origin.y},end:{x:end.x,y:end.y},center:{x:center.x,y:center.y},angle:worldAngle};
      }
      if(endName)points[endName]=end;return end;
    };
    const pelvisMass=masses.pelvis*this.massScale*s**3;
    if(derivatives){
      bodies.push({name:'pelvis',mass:pelvisMass,inertia:pelvisMass*(.36*s)**2/12,center:hip,rotations:[2]});angles.pelvis=this.dir===1?q[2]:PI-q[2];
      frames.pelvis={origin:{x:hip.x,y:hip.y},end:{x:hip.x,y:hip.y},center:{x:hip.x,y:hip.y},angle:angles.pelvis};
    }
    const torsoAngle=PI/2+q[2]+q[3],torsoRot=[2,3];
    const shoulder=add('torso',hip,torsoAngle,REFERENCE_STANCE.torso*s,torsoRot,'shoulder');
    const neckAngle=torsoAngle+q[12],head=add('neck',shoulder,neckAngle,REFERENCE_STANCE.neck*s*Math.cos(this.neckLateral.angle),[2,3,12],'head');
    const mainShoulder=this.#offset(shoulder,REFERENCE_STANCE.shoulderHalfWidth*s,-REFERENCE_STANCE.shoulderDrop*s,torsoAngle-PI/2,torsoRot);points.mainShoulder=mainShoulder;
    const mainAngle=torsoAngle+q[4],mainRot=[2,3,4];
    const mainElbow=add('mainUpper',mainShoulder,mainAngle,.52*s,mainRot,'mainElbow');
    const mainFore=mainAngle+q[5],mainForeRot=[2,3,4,5];
    const mainHand=add('mainForearm',mainElbow,mainFore,.52*s,mainForeRot,'mainHand');
    const weaponAngle=mainFore+this.wristRestAngle+q[13],weaponRot=[...mainForeRot,13];
    add('weapon',mainHand,weaponAngle,swordLength,weaponRot,'tip');
    let weaponCurve=null;
    if(this.weaponFlex?.maximum&&(bend!==0||this.weaponFlex.offset!==0||this.weaponFlex.previousOffset!==0)){
      weaponCurve=Array.from({length:5},(_,i)=>{const local=bladeLocalAt(swordLength,bend,i/4);return this.#offset(mainHand,local.x,local.y,weaponAngle,weaponRot);});
      points.tip=weaponCurve[4];
      if(derivatives){const body=bodies[bodies.length-1];body.center=weaponCurve[2];frames.weapon.end={x:points.tip.x,y:points.tip.y};frames.weapon.center={x:body.center.x,y:body.center.y};}
    }
    if(this.twoHanded)points.offGrip=this.#offset(mainHand,-this.gripOffset,0,weaponAngle,weaponRot);
    const offShoulder=this.#offset(shoulder,-REFERENCE_STANCE.shoulderHalfWidth*s,-REFERENCE_STANCE.shoulderDrop*s,torsoAngle-PI/2,torsoRot);points.offShoulder=offShoulder;
    const offAngle=torsoAngle+q[6],offRot=[2,3,6],offElbow=add('offUpper',offShoulder,offAngle,.48*s,offRot,'offElbow');
    const offHand=add('offForearm',offElbow,offAngle+q[7],.47*s,[2,3,6,7],'offHand');
    if(this.defenseLength>0)add('offWeapon',offHand,offAngle+q[7]+this.defenseRestAngle,this.defenseLength,[2,3,6,7],'defenseTip');
    const frontHip=this.#offset(hip,REFERENCE_STANCE.hipSocket*s,0,q[2],[2]),backHip=this.#offset(hip,-REFERENCE_STANCE.hipSocket*s,0,q[2],[2]);
    points.frontHip=frontHip;points.backHip=backHip;
    const frontAngle=q[2]+q[8],frontKnee=add('frontThigh',frontHip,frontAngle,REFERENCE_STANCE.thigh*s,[2,8],'kneeF');
    add('frontShin',frontKnee,frontAngle+q[9],REFERENCE_STANCE.shin*s,[2,8,9],'footF');
    const backAngle=q[2]+q[10],backKnee=add('backThigh',backHip,backAngle,REFERENCE_STANCE.thigh*s,[2,10],'kneeB');
    add('backShin',backKnee,backAngle+q[11],REFERENCE_STANCE.shin*s,[2,10,11],'footB');
    if(derivatives&&this.waterLoad.mass>0){
      const center=this.#offset(head,this.waterLoad.offset.x,this.waterLoad.offset.y,neckAngle-PI/2,[2,3,12]);
      bodies.push({name:'water',mass:this.waterLoad.mass,inertia:this.waterLoad.inertia,center,rotations:[2,3,12]});
    }
    const state={points,bodies:this.detachedBodies.size?bodies.filter(b=>this.isBodyAttached(b.name)):bodies,angles,frames,pelvisAngle:q[2],weaponCurve,weaponLength:swordLength,
      weaponRootDirection:{x:this.dir*Math.cos(weaponAngle),y:Math.sin(weaponAngle)}};
    if(current&&!yOnly)this.#kinematicCache={q:q.slice(),length:swordLength,parameters,state};
    return state;
  }

  #geometryOffset(origin,x,y,angle){
    const c=Math.cos(angle),sn=Math.sin(angle),dx=this.dir*(x*c-y*sn),dy=x*sn+y*c;
    return {x:origin.x+dx,y:origin.y+dy};
  }

  #geometryState(q,swordLength,key,bend=this.weaponFlex?.offset??0){
    const s=this.scale,p={hip:{x:q[0],y:q[1]}},state={points:p,pelvisAngle:q[2],weaponLength:swordLength};
    if(key==='pelvis')return state;
    if(key==='frontThigh'||key==='frontShin'){
      p.frontHip=this.#geometryOffset(p.hip,REFERENCE_STANCE.hipSocket*s,0,q[2]);
      const angle=q[2]+q[8];p.kneeF=this.#geometryOffset(p.frontHip,REFERENCE_STANCE.thigh*s,0,angle);
      if(key==='frontShin')p.footF=this.#geometryOffset(p.kneeF,REFERENCE_STANCE.shin*s,0,angle+q[9]);
      return state;
    }
    if(key==='backThigh'||key==='backShin'){
      p.backHip=this.#geometryOffset(p.hip,-REFERENCE_STANCE.hipSocket*s,0,q[2]);
      const angle=q[2]+q[10];p.kneeB=this.#geometryOffset(p.backHip,REFERENCE_STANCE.thigh*s,0,angle);
      if(key==='backShin')p.footB=this.#geometryOffset(p.kneeB,REFERENCE_STANCE.shin*s,0,angle+q[11]);
      return state;
    }
    const torsoAngle=PI/2+q[2]+q[3];p.shoulder=this.#geometryOffset(p.hip,REFERENCE_STANCE.torso*s,0,torsoAngle);
    const main=key==='mainUpper'||key==='mainForearm'||key==='weapon'||key.startsWith('weapon-flex-')||key==='weapon-head'||key==='main-palm'||key==='off-palm'&&this.twoHanded;
    if(main){
      p.mainShoulder=this.#geometryOffset(p.shoulder,REFERENCE_STANCE.shoulderHalfWidth*s,-REFERENCE_STANCE.shoulderDrop*s,torsoAngle-PI/2);
      const angle=torsoAngle+q[4];p.mainElbow=this.#geometryOffset(p.mainShoulder,.52*s,0,angle);
      if(key!=='mainUpper'){
        const fore=angle+q[5];p.mainHand=this.#geometryOffset(p.mainElbow,.52*s,0,fore);
        if(key!=='mainForearm'){
          const angle=fore+this.wristRestAngle+q[13];p.tip=this.#geometryOffset(p.mainHand,swordLength,0,angle);
          state.weaponRootDirection={x:this.dir*Math.cos(angle),y:Math.sin(angle)};
          if(this.weaponFlex?.maximum&&(bend!==0||this.weaponFlex.offset!==0||this.weaponFlex.previousOffset!==0)){
            state.weaponCurve=Array.from({length:5},(_,i)=>{const local=bladeLocalAt(swordLength,bend,i/4);return this.#geometryOffset(p.mainHand,local.x,local.y,angle);});p.tip=state.weaponCurve[4];
          }
        }
      }
    }
    if(key==='offUpper'||key==='offForearm'||key==='off-palm'){
      p.offShoulder=this.#geometryOffset(p.shoulder,-REFERENCE_STANCE.shoulderHalfWidth*s,-REFERENCE_STANCE.shoulderDrop*s,torsoAngle-PI/2);
      const angle=torsoAngle+q[6];p.offElbow=this.#geometryOffset(p.offShoulder,.48*s,0,angle);
      if(key!=='offUpper'){
        p.offHand=this.#geometryOffset(p.offElbow,.47*s,0,angle+q[7]);
        if(this.defenseLength>0&&!this.twoHanded&&key==='off-palm')p.defenseTip=this.#geometryOffset(p.offHand,this.defenseLength,0,angle+q[7]+this.defenseRestAngle);
      }
    }
    return state;
  }

  #matrix(state){
    const cached=this.#massCache.get(state);if(cached)return cached.matrix;
    const M=Array.from({length:N},()=>new Float64Array(N));
    for(const b of state.bodies){
      for(let i=0;i<N;i++)for(let j=0;j<=i;j++)M[i][j]+=b.mass*(b.center.jx[i]*b.center.jx[j]+b.center.jy[i]*b.center.jy[j]);
      for(const i of b.rotations)for(const j of b.rotations)if(j<=i)M[i][j]+=b.inertia;
    }
    for(let i=0;i<N;i++){M[i][i]+=1e-6;for(let j=0;j<i;j++)M[j][i]=M[i][j];}
    this.#massCache.set(state,{matrix:M,factor:null});return M;
  }

  #massFactor(state){
    const matrix=this.#matrix(state),cached=this.#massCache.get(state);
    return cached.factor??(cached.factor=factor(matrix));
  }

  setIntent(pose,{baseX=this.intentBase,baseVX=0,waterLoad=null}={}){
    this.intentBase=finite(baseX,this.intentBase);this.intentVX=clamp(finite(baseVX),-2,2);
    const angle=(a,b,fallback)=>a&&b?Math.atan2(b.y-a.y,this.dir*(b.x-a.x)):fallback;
    const t=this.target,s=this.scale,p=pose||{};
    if(p.equipment)this.equipment=normalizeLoadout(p.equipment);
    if(this.flexibleWeapons&&this.weaponFlex?.weapon!==this.equipment.weapon)this.#weaponFlex=new WeaponFlex(this.equipment.weapon);
    this.weaponMass=clamp(finite(p.weaponMass,this.weaponMass),.05,1);
    this.twoHanded=!!p.twoHanded&&!this.gripReleased;this.gripOffset=clamp(finite(p.gripOffset),0,.35);
    t[0]=clamp(finite(p.hip?.x,this.intentBase),this.limits[0][0],this.limits[0][1]);t[1]=clamp(finite(p.hip?.y,TABLE_TOP+REFERENCE_STANCE.hipHeight*s),this.limits[1][0],this.limits[1][1]);t[2]=0;
    const torso=angle(p.hip,p.shoulder,PI/2-REFERENCE_STANCE.lean);t[3]=wrap(torso-PI/2);
    const main=angle(p.mainShoulder,p.mainElbow,torso+t[4]),fore=angle(p.mainElbow,p.mainHand,main+t[5]);
    t[4]=wrap(main-torso);t[5]=wrap(fore-main);
    const off=angle(p.offShoulder,p.offElbow,torso+t[6]),offFore=angle(p.offElbow,p.offHand,off+t[7]);
    t[6]=wrap(off-torso);t[7]=wrap(offFore-off);
    for(const [hipIndex,kneeIndex,key,side] of [[8,9,'footF',1],[10,11,'footB',-1]]){
      const foot=p[key]||{x:t[0]+this.dir*(side>0?REFERENCE_STANCE.frontFoot:REFERENCE_STANCE.backFoot)*s,y:this.groundHeight};
      const socketX=t[0]+this.dir*side*REFERENCE_STANCE.hipSocket*s;
      const x=this.dir*(foot.x-socketX),y=Math.max(this.groundHeight,foot.y)-t[1],l1=REFERENCE_STANCE.thigh*s,l2=REFERENCE_STANCE.shin*s,d=clamp(Math.hypot(x,y),.001,l1+l2-.001);
      const bend=-Math.acos(clamp((d*d-l1*l1-l2*l2)/(2*l1*l2),-1,1));
      t[hipIndex]=Math.atan2(y,x)-Math.atan2(l2*Math.sin(bend),l1+l2*Math.cos(bend));t[kneeIndex]=bend;
    }
    t[12]=wrap(angle(p.shoulder,p.head,torso)-torso);
    this.neckLateral.target=clamp(finite(p.neckYawTarget),-NECK_CONE,NECK_CONE);
    for(let i=2;i<N;i++)t[i]=clamp(finite(t[i]),this.limits[i][0],this.limits[i][1]);
    if(p.mainHand&&p.tip){
      this.swordLength=clamp(distance(p.mainHand,p.tip),.45,2);
      t[13]=clamp(wrap(angle(p.mainHand,p.tip,0)-fore-this.wristRestAngle),this.limits[13][0],this.limits[13][1]);
    }
    this.defenseDepth.target=clamp(finite(p.defenseDepthTarget,-.08),-.08,.10);
    for(const key of Object.keys(this.depth)){
      if(key==='head'&&Number.isFinite(p.neckYawTarget))continue;
      if(!this.twoHanded&&Number.isFinite(p.defenseDepthTarget)&&['offHand','offElbow'].includes(key))continue;
      this.depth[key]=finite(p[key]?.z,this.depth[key]);
    }
    if(Number.isFinite(p.headBaseZ))this.depth.head=p.headBaseZ;
    this.shieldRadius=clamp(finite(p.shieldRadius,.23),0,.5);
    this.shieldRadiusX=clamp(finite(p.shieldRadiusX,this.shieldRadius),0,.5);
    this.shieldRadiusY=clamp(finite(p.shieldRadiusY,this.shieldRadius),0,.6);
    this.defenseLength=p.offHand&&p.defenseTip?clamp(distance(p.offHand,p.defenseTip),0,.6):0;
    if(this.defenseLength>0)this.defenseRestAngle=wrap(angle(p.offHand,p.defenseTip,offFore)-offFore);
    if(waterLoad){
      const mass=clamp(finite(waterLoad.mass),0,8),head=waterLoad.referenceHead||p.head||this.#kinematics().points.head;
      const dx=clamp(this.dir*(finite(waterLoad.center?.x,head.x)-head.x),-.5*s,.5*s),dy=clamp(finite(waterLoad.center?.y,head.y)-head.y,-.5*s,.5*s);
      const neck=waterLoad.referenceHead?this.q[2]+this.q[3]+this.q[12]:torso+t[12]-PI/2,c=Math.cos(neck),sn=Math.sin(neck);
      this.waterLoad={mass,offset:{x:clamp(dx*c+dy*sn,-.5*s,.5*s),y:clamp(-dx*sn+dy*c,-.5*s,.5*s)},inertia:clamp(finite(waterLoad.inertia,mass*.065*s*s),0,4),
        lateralInertia:clamp(finite(waterLoad.lateralInertia,waterLoad.inertia??mass*.065*s*s),0,4),
        lateralOffset:clamp(finite(waterLoad.center?.z,head.z??this.depth.head)-(head.z??this.depth.head),-.5*s,.5*s)};
    }
    return this;
  }

  #gaitStep(h){
    if(this.passive||this.contacts.length!==2)return;
    const gait=this.gait;
    if(!gait.swing&&Math.abs(this.intentBase-gait.stanceBase)>.09){
      const index=gait.next,c=this.contacts[index],endX=clamp(this.intentBase+c.offset,c.x-.32*this.scale,c.x+.32*this.scale);
      gait.swing={index,time:0,duration:.28,startX:c.x,endX};c.stance=false;
    }
    if(!gait.swing)return;
    const swing=gait.swing,c=this.contacts[swing.index];swing.time=Math.min(swing.duration,swing.time+h);
    const t=swing.time/swing.duration,u=t*t*(3-2*t),du=6*t*(1-t)/swing.duration;
    c.x=swing.startX+(swing.endX-swing.startX)*u;c.y=c.floor+.095*this.scale*Math.sin(PI*t);
    c.vx=(swing.endX-swing.startX)*du;c.vy=.095*this.scale*PI*Math.cos(PI*t)/swing.duration;
    if(t>=1){c.y=c.floor;c.stance=true;c.vx=0;c.vy=0;gait.next=1-swing.index;gait.swing=null;gait.stanceBase=this.contacts.reduce((sum,foot)=>sum+foot.x-foot.offset,0)/2;}
  }

  // Returns M^-1 J^T lambda. Contact impulses use the same coupled mass as
  // external forces; they are not independent edits of the ankle coordinates.
  #constraintDelta(L,rows,values){
    if(!rows.length)return {delta:new Float64Array(N),lambda:new Float64Array(0)};
    let entries=this.#constraintCache.get(L);if(!entries){entries=[];this.#constraintCache.set(L,entries);}
    let system=entries.find(entry=>entry.rows.length===rows.length&&entry.rows.every((row,i)=>row.every((value,j)=>value===rows[i][j])));
    if(!system){
      const inverseRows=rows.map(row=>solve(L,row));
      const S=rows.map((row,i)=>Float64Array.from(rows,(_,j)=>dot(row,inverseRows[j])+(i===j?1e-9:0)));
      system={rows:rows.map(row=>row.slice()),inverseRows,factor:factor(S)};
      if(entries.length===8)entries.shift();entries.push(system);
    }
    const {inverseRows}=system,lambda=solve(system.factor,values),delta=new Float64Array(N);
    for(let i=0;i<rows.length;i++)for(let j=0;j<N;j++)delta[j]+=inverseRows[i][j]*lambda[i];
    return {delta,lambda};
  }

  #body(state,name){
    let lookup=state.bodyLookup;if(!lookup){lookup=Object.create(null);for(const body of state.bodies)lookup[body.name]=body;state.bodyLookup=lookup;}
    return lookup[name];
  }

  #floorRow(state,sample){
    if(sample.jy)return sample.jy;
    let row;
    if(sample.knee){
      row=new Array(N);
      for(let i=0;i<N;i++)row[i]=sample.knee.jy[i]+sample.gx*(sample.foot.jx[i]-sample.knee.jx[i])+sample.gy*(sample.foot.jy[i]-sample.knee.jy[i]);
    }else{
      const part=this.#body(state,sample.body);row=part.center.jy.slice();
      for(const i of part.rotations)row[i]+=this.dir*(sample.x-part.center.x);
    }
    sample.jy=row;return row;
  }

  #unilateralDelta(L,rows,values,inequalities){
    const base=this.#constraintDelta(L,rows,values).delta,delta=base.slice(),active=[],responses=[],products=[],baseValues=[];
    const response=index=>{
      if(!responses[index]){
        const free=solve(L,inequalities[index].row),reaction=this.#constraintDelta(L,rows,rows.map(r=>-dot(r,free)));
        responses[index]=Float64Array.from(free,(v,i)=>v+reaction.delta[i]);
      }
      return responses[index];
    };
    const product=(i,j)=>{
      const row=products[i]??(products[i]=[]);
      if(row[j]===undefined)row[j]=dot(inequalities[i].row,response(j));return row[j];
    };
    const baseValue=i=>{if(baseValues[i]===undefined)baseValues[i]=inequalities[i].value-dot(inequalities[i].row,base);return baseValues[i];};
    for(let pass=0;pass<N*8;pass++){
      let worst=-1,violation=1e-9;
      for(let i=0;i<inequalities.length;i++)if(!active.includes(i)){
        const error=inequalities[i].value-dot(inequalities[i].row,delta);
        if(error>violation&&product(i,i)>1e-9){violation=error;worst=i;}
      }
      if(worst<0)break;
      active.push(worst);
      while(active.length){
        const matrix=active.map((index,i)=>Float64Array.from(active,(other,j)=>product(index,other)+(i===j?1e-10:0)));
        const rhs=active.map(i=>baseValue(i)),lambda=solve(factor(matrix),rhs);
        let remove=-1,lowest=-1e-9;
        for(let i=0;i<lambda.length;i++)if(lambda[i]<lowest){lowest=lambda[i];remove=i;}
        if(remove>=0){active.splice(remove,1);continue;}
        delta.set(base);
        for(let j=0;j<active.length;j++)for(let i=0;i<N;i++)delta[i]+=response(active[j])[i]*Math.max(0,lambda[j]);
        break;
      }
      if(!active.length)delta.set(base);
    }
    return delta;
  }

  #floorInequalities(state,velocity=false,h=RIG_STEP){
    const result=this.#floorSamples(state).filter(sample=>!this.contacts.some(c=>c.key===sample.floorKey&&c.y>=TABLE_TOP+.075-1e-9)).map(sample=>{
      const row=this.#floorRow(state,sample),depth=TABLE_TOP-sample.y;
      return {row,value:velocity?Math.min(0,depth/h)-dot(row,this.velocity):depth+(depth>1e-9?1e-7:0)};
    });
    for(let i=1;i<N;i++)for(const sign of [-1,1]){
      const row=STOP_ROWS[i][sign===-1?0:1];
      const gap=sign===1?this.limits[i][0]-this.q[i]:this.q[i]-this.limits[i][1];
      result.push({row,value:velocity?gap/h-sign*this.velocity[i]:gap});
    }
    return result;
  }

  #contactRows(state,velocity=false,h=RIG_STEP,includeFloor=true){
    const rows=[],values=[];
    for(const c of this.contacts){
      const p=state.points[c.key];rows.push(p.jx,p.jy);
      if(velocity)values.push(c.vx-.22*(p.x-c.x)/h-dot(p.jx,this.velocity),c.vy-.22*(p.y-c.y)/h-dot(p.jy,this.velocity));
      else values.push(c.x-p.x,c.y-p.y);
    }
    if(this.twoHanded){
      const hand=state.points.offHand,grip=state.points.offGrip;
      for(const axis of ['x','y']){
        const jacobian=axis==='x'?'jx':'jy',row=Float64Array.from(hand[jacobian],(v,i)=>v-grip[jacobian][i]);
        rows.push(row);const error=hand[axis]-grip[axis];
        values.push(velocity?-.22*error/h-dot(row,this.velocity):-error);
      }
    }
    for(const sample of includeFloor?this.#floorSamples(state):[]){
      if(!velocity&&sample.y>TABLE_TOP+1e-7)continue;
      const row=this.#floorRow(state,sample);
      if(velocity){
        const speed=dot(row,this.velocity),allowed=Math.min(0,(TABLE_TOP-sample.y)/h);
        if(speed<0&&speed<allowed){rows.push(row);values.push(allowed-speed);}
      }else if(sample.y<=TABLE_TOP+1e-7){rows.push(row);values.push(Math.max(0,TABLE_TOP-sample.y));}
    }
    return {rows,values};
  }

  #floorSamples(state,weaponOnly=false){
    const parameters=[this.scale,this.dir,this.equipment.weapon,this.depth.footF,this.depth.footB,this.depth.kneeF,this.depth.kneeB,this.topologyVersion];
    const cached=this.#floorCache.get(state),cacheKey=weaponOnly?'weapon':'all';
    if(cached&&parameters.every((v,i)=>v===cached.parameters[i])&&cached[cacheKey])return cached[cacheKey];
    const p=state.points,s=this.scale,samples=[];
    const links=[['torso',p.hip,p.shoulder,.60*s],['pelvis',{x:p.hip.x-.17*s,y:p.hip.y},{x:p.hip.x+.17*s,y:p.hip.y},.17*s],
      ['neck',p.shoulder,p.head,.11*s],['mainUpper',p.mainShoulder,p.mainElbow,.23*s],['mainForearm',p.mainElbow,p.mainHand,.20*s],
      ['offUpper',p.offShoulder,p.offElbow,.23*s],['offForearm',p.offElbow,p.offHand,.20*s],
      ['frontThigh',p.frontHip,p.kneeF,.23*s],['backThigh',p.backHip,p.kneeB,.23*s]];
    if(!weaponOnly){
      for(const [body,a,b,width] of links)appendFloorPanel(samples,body,a,b,width);
      for(const shape of SHIN_FLOOR){
        const knee=p[shape.knee],foot=p[shape.foot],dx=foot.x-knee.x,dy=foot.y-.075+.115*s-knee.y;
        const dz=(this.depth[shape.foot]??0)+this.dir*shape.ankleZ*s-(this.depth[shape.knee]??0),h=Math.hypot(dx,dy),length=Math.hypot(h,dz);
        if(h<1e-9)continue;
        // Same affine limb frame used by characterTransforms. Differentiate its
        // vertices through both endpoints; a rigid-body point Jacobian would be
        // wrong because the ankle frame stays attached to the supported foot.
        const bend=1/(h*h*h*length)+1/(h*length*length*length);
        for(const bx of [shape.min[0],shape.max[0]])for(const by of [shape.min[1],shape.max[1]])for(const bz of [shape.min[2],shape.max[2]]){
          const x=knee.x+dy/h*bx*s+dx/shape.length*by-dx*dz/(h*length)*bz*s;
          const y=knee.y-dx/h*bx*s+dy/shape.length*by-dy*dz/(h*length)*bz*s;
          const gx=-dy*dy/(h*h*h)*bx*s+dy*dz*dx*bend*bz*s;
          const gy=dx*dy/(h*h*h)*bx*s+by/shape.length+(-dz/(h*length)+dy*dy*dz*bend)*bz*s;
          samples.push({body:shape.body,x,y,knee,foot,gx,gy});
        }
      }
      for(const [body,key] of [['frontShin','footF'],['backShin','footB']])for(const dx of [-.13,.13])samples.push({body,floorKey:key,x:p[key].x+dx*s,y:p[key].y-.075,jy:p[key].jy});
    }
    const weapon=getWeapon(this.equipment),width=weapon.shaftWidth??.034;
    if(state.weaponCurve)for(let i=0;i<4;i++)appendFloorPanel(samples,'weapon',state.weaponCurve[i],state.weaponCurve[i+1],width);
    else appendFloorPanel(samples,'weapon',p.mainHand,p.tip,width);
    if(weapon.headLength){
      const ux=(p.tip.x-p.mainHand.x)/this.swordLength,uy=(p.tip.y-p.mainHand.y)/this.swordLength;
      const center={x:p.tip.x+uy*weapon.headAcross,y:p.tip.y-ux*weapon.headAcross};
      appendFloorPanel(samples,'weapon',{x:center.x-ux*weapon.headLength,y:center.y-uy*weapon.headLength},center,weapon.headWidth,'weapon-head');
    }
    const result=this.detachedBodies.size?samples.filter(p=>this.isBodyAttached(p.body)):samples;
    const next=cached&&parameters.every((v,i)=>v===cached.parameters[i])?cached:{parameters};next[cacheKey]=result;this.#floorCache.set(state,next);
    return result;
  }

  collapse(){
    if(this.passive)return false;
    this.passive=true;this.contacts=[];this.gait.swing=null;this.intentVX=0;
    // Passive joints retain physical stops, but release the upright balance
    // stops that deliberately held an intact puppet in its fencing stance.
    this.limits[1]=[TABLE_TOP-.25,1.95];this.limits[2]=[-Math.PI,Math.PI];this.limits[3]=[-2.8,2.8];this.limits[12]=[-1.3,1.3];
    return true;
  }

  #collisionPanels(state,external=false,onlyKey=null,asSolids=false){
    const p=state.points,weapon=!onlyKey||onlyKey==='weapon'||onlyKey.startsWith('weapon-flex-')||onlyKey==='weapon-head'?getWeapon(this.equipment):null;
    const panels=[],wants=key=>!onlyKey||onlyKey===key,createPanel=asSolids?collisionSolid:collisionPanel;
    // The shoulder mount is an excluded .12-unit attachment band. These are
    // interior timber proxies, not bounding spheres around decorative hardware.
    if(wants('chest-front')||wants('chest-back')){
      const torso={x:p.shoulder.x-p.hip.x,y:p.shoulder.y-p.hip.y},length=Math.hypot(torso.x,torso.y);
      const waist={x:p.hip.x+torso.x*.28,y:p.hip.y+torso.y*.28},chest={x:p.shoulder.x-torso.x/length*.12,y:p.shoulder.y-torso.y/length*.12};
      if(wants('chest-front'))panels.push(createPanel('torso',waist,chest,.35,.155,.14,'chest-front'));
      if(wants('chest-back'))panels.push(createPanel('torso',waist,chest,.32,-.16,.07,'chest-back'));
    }
    if(wants('pelvis')){
      const a=this.#offset(p.hip,-.16,.075,state.pelvisAngle,[2]),b=this.#offset(p.hip,.16,.075,state.pelvisAngle,[2]);
      panels.push(createPanel('pelvis',a,b,.12,0,.28));
    }
    if(wants('mainUpper'))panels.push(createPanel('mainUpper',p.mainShoulder,p.mainElbow,.21,.145,.19));
    if(wants('mainForearm'))panels.push(createPanel('mainForearm',p.mainElbow,p.mainHand,.17,.172,.16));
    if(wants('offUpper'))panels.push(createPanel('offUpper',p.offShoulder,p.offElbow,.20,external?(this.depth.offShoulder+this.depth.offElbow)/2:-.14+.275*(this.depth.offHand+.08),
      .16+Math.max(0,Math.abs(this.depth.offElbow-this.depth.offShoulder)-.01)));
    if(wants('offForearm'))panels.push(createPanel('offForearm',p.offElbow,p.offHand,.17,this.twoHanded||external?(this.depth.offElbow+this.depth.offHand)/2:-.10,
      .15+Math.max(0,Math.abs(this.depth.offHand-this.depth.offElbow)-(this.twoHanded?0:.02))));
    if(wants('frontThigh'))panels.push(createPanel('frontThigh',p.frontHip,p.kneeF,.19,.19,.18));
    if(wants('frontShin'))panels.push(createPanel('frontShin',p.kneeF,p.footF,.18,.19,.18));
    if(wants('backThigh'))panels.push(createPanel('backThigh',p.backHip,p.kneeB,.20,-.17,.18));
    if(wants('backShin'))panels.push(createPanel('backShin',p.kneeB,p.footB,.17,-.17,.18));
    const swordLength=!onlyKey||onlyKey==='weapon'||onlyKey==='weapon-head'||onlyKey==='main-palm'?distance(p.mainHand,p.tip):0;
    if(state.weaponCurve&&(!onlyKey||onlyKey==='weapon'||onlyKey.startsWith('weapon-flex-'))){
      const curve=state.weaponCurve;
      for(let i=0;i<4;i++){
        const key=i===3?'weapon':`weapon-flex-${i}`;if(!wants(key))continue;
        const a=i===0?{x:curve[0].x+(curve[1].x-curve[0].x)*(.15/(state.weaponLength/4)),y:curve[0].y+(curve[1].y-curve[0].y)*(.15/(state.weaponLength/4))}:curve[i];
        panels.push(createPanel('weapon',a,curve[i+1],weapon.shaftWidth??.034,.177,weapon.shaftWidth??.034,key));
      }
    }else if(wants('weapon')){
      const blade={x:p.mainHand.x+(p.tip.x-p.mainHand.x)*.15/swordLength,y:p.mainHand.y+(p.tip.y-p.mainHand.y)*.15/swordLength};
      panels.push(createPanel('weapon',blade,p.tip,weapon.shaftWidth??.034,.177,weapon.shaftWidth??.034));
    }
    if(wants('weapon-head')&&weapon.headLength){
      const ux=(p.tip.x-p.mainHand.x)/swordLength,uy=(p.tip.y-p.mainHand.y)/swordLength;
      const center={x:p.tip.x+uy*weapon.headAcross,y:p.tip.y-ux*weapon.headAcross};
      panels.push(createPanel('weapon',{x:center.x-ux*weapon.headLength,y:center.y-uy*weapon.headLength},center,
        weapon.headWidth,.177,weapon.id==='maul'?.35:.06,'weapon-head'));
    }
    if(!external||onlyKey&&onlyKey!=='main-palm'&&onlyKey!=='off-palm')return this.#attachedPanels(panels);
    // Measured rigid palm AABB in the delivered hand/grip frame (both variants
    // share these normalized dimensions). The palm follows the wrist/weapon
    // frame; it is timber, not another length of blade.
    const s=this.scale;
    if(wants('main-palm')){
      const ux=state.weaponCurve?state.weaponRootDirection.x:(p.tip.x-p.mainHand.x)/swordLength,uy=state.weaponCurve?state.weaponRootDirection.y:(p.tip.y-p.mainHand.y)/swordLength;
      const palm=along=>({x:p.mainHand.x+ux*along*s-uy*.002743*s,y:p.mainHand.y+uy*along*s+ux*.002743*s});
      const hand=createPanel('weapon',palm(-.073147),palm(.072433),.127148*s,this.depth.mainHand+.007362*s,.14271*s,'main-palm');hand.material='wood';panels.push(hand);
    }
    if(!wants('off-palm'))return this.#attachedPanels(panels);
    const offVector=this.twoHanded?{x:p.tip.x-p.mainHand.x,y:p.tip.y-p.mainHand.y,z:this.depth.tip-this.depth.mainHand}:this.defenseLength>0?{x:p.defenseTip.x-p.offHand.x,y:p.defenseTip.y-p.offHand.y,z:this.depth.defenseTip-this.depth.offHand}:{x:p.offHand.x-p.offElbow.x,y:p.offHand.y-p.offElbow.y,z:this.depth.offHand-this.depth.offElbow};
    const offLength=Math.hypot(offVector.x,offVector.y)||1,ox=offVector.x/offLength,oy=offVector.y/offLength;
    const spatialLength=Math.hypot(offLength,offVector.z),c=offLength/spatialLength,uz=offVector.z/spatialLength;
    const alongMin=-.075001*c+Math.min(.042*uz,-.057617*uz),alongMax=.099982*c+Math.max(.042*uz,-.057617*uz);
    const depthMin=Math.min(-.075001*uz,.099982*uz)-.042*c,depthMax=Math.max(-.075001*uz,.099982*uz)+.057617*c;
    const offPalm=along=>({x:p.offHand.x+ox*along*s+oy*.001353*s,y:p.offHand.y+oy*along*s-ox*.001353*s});
    const other=createPanel('offForearm',offPalm(alongMin),offPalm(alongMax),.106707*s,this.depth.offHand+(depthMin+depthMax)/2*s,(depthMax-depthMin)*s,'off-palm');other.material='wood';panels.push(other);
    return this.#attachedPanels(panels);
  }

  #selfContacts(state){
    const panels=this.#collisionPanels(state),contacts=[];
    for(let i=0;i<panels.length;i++)for(let j=i+1;j<panels.length;j++){
      const contact=panelContact(panels[i],panels[j],this.dir);if(contact)contacts.push(contact);
    }
    return contacts;
  }

  #selfContactRow(state,c){
    const a=this.#pointJacobian(state,c.a,c.pointA),b=this.#pointJacobian(state,c.b,c.pointB),n=c.normal;
    return Float64Array.from(a.jx,(v,i)=>(b.jx[i]-v)*n.x+(b.jy[i]-a.jy[i])*n.y);
  }

  #supportedResponse(L,state,row,includeFloor=true){
    const freeResponse=solve(L,row),rows=this.#contactRows(state,false,RIG_STEP,includeFloor).rows,active=new Set();
    // Respect the foot anchors and optional two-hand grip with the same mass metric.
    // Stops must join that solve: clamping a joint afterwards breaks the anchors
    // and can trap a shorter torso's folded arm inside its own chest.
    for(let pass=0;pass<N;pass++){
      const response=freeResponse.slice(),reaction=this.#constraintDelta(L,rows,rows.map(r=>-dot(r,freeResponse)));
      for(let i=0;i<N;i++)response[i]+=reaction.delta[i];
      let blocked=false;
      for(let i=1;i<N;i++)if(!active.has(i)&&((this.q[i]<=this.limits[i][0]+1e-7&&response[i]<0)||(this.q[i]>=this.limits[i][1]-1e-7&&response[i]>0))){
        const stop=STOP_ROWS[i][1];rows.push(stop);active.add(i);blocked=true;
      }
      if(!blocked)return response;
    }
    return new Float64Array(N);
  }

  #projectSelfVelocity(L,state){
    const contacts=this.#selfContacts(state);
    for(let pass=0;pass<24;pass++){
      let worst=0;
      for(const c of contacts){
      const row=this.#selfContactRow(state,c),closing=dot(row,this.velocity);
      worst=Math.min(worst,closing);
      if(closing>=0)continue;
      const response=this.#supportedResponse(L,state,row),inverseMass=dot(row,response);
      if(inverseMass<1e-9)continue;
      const impulse=-closing/inverseMass;
      for(let i=0;i<N;i++)this.velocity[i]+=response[i]*impulse;
      this.lastSelfContactImpulse+=impulse;
      }
      if(worst>=-1e-9)break;
    }
  }

  #projectFloorVelocity(L,state,h=RIG_STEP){
    const {rows,values}=this.#contactRows(state,true,h,false),delta=this.#unilateralDelta(L,rows,values,this.#floorInequalities(state,true,h));
    for(let i=0;i<N;i++)this.velocity[i]+=delta[i];
  }

  #projectPositions(L){
    for(let iteration=0;iteration<24;iteration++){
      const state=this.#kinematics(),{rows,values}=this.#contactRows(state,false,RIG_STEP,false);
      for(let i=1;i<N;i++)if(this.q[i]<this.limits[i][0]||this.q[i]>this.limits[i][1]){
        const row=STOP_ROWS[i][1];rows.push(row);values.push(clamp(this.q[i],this.limits[i][0],this.limits[i][1])-this.q[i]);
      }
      const contacts=this.#selfContacts(state).filter(c=>c.penetration>1e-6);
      const floorPenetration=Math.max(0,...this.#floorSamples(state).map(p=>TABLE_TOP-p.y));
      if(Math.max(...values.map(Math.abs))<1e-9&&!contacts.length&&floorPenetration<1e-7)break;
      if(Math.max(...values.map(Math.abs))>=1e-9){
        const {delta}=this.#constraintDelta(L,rows,values);
        for(let i=0;i<N;i++)this.q[i]+=clamp(delta[i],-.18,.18);
      }
      for(const previousContact of contacts){
        const current=this.#kinematics(),panels=this.#collisionPanels(current);
        const panelA=panels.find(p=>p.key===previousContact.keyA),panelB=panels.find(p=>p.key===previousContact.keyB);
        const c=panelA&&panelB&&panelContact(panelA,panelB,this.dir);if(!c||c.penetration<=1e-6)continue;
        let row=this.#selfContactRow(current,c),response=this.#supportedResponse(L,current,row),inverseMass=dot(row,response),depth=c.penetration;
        // An initially interpenetrating long blade can be wedged between two
        // panels. Choose a feasible separating axis in the same mass metric
        // instead of insisting on the shortest world-space displacement when
        // its angular stops prevent that displacement.
        if(iteration>=4&&c.penetration>.01){
          let cost=depth*depth/Math.max(inverseMass,1e-12);
          for(const alternative of c.separationAxes??[]){
            const candidateRow=this.#selfContactRow(current,alternative),candidateResponse=this.#supportedResponse(L,current,candidateRow),candidateMass=dot(candidateRow,candidateResponse);
            const candidateCost=alternative.penetration**2/Math.max(candidateMass,1e-12);
            if(candidateMass>1e-9&&candidateCost<cost){cost=candidateCost;row=candidateRow;response=candidateResponse;inverseMass=candidateMass;depth=alternative.penetration;}
          }
        }
        if(inverseMass<1e-9)continue;
        const lambda=(depth+.00001)/inverseMass;
        let rate=1;for(let i=0;i<N;i++)rate=Math.min(rate,.08/Math.max(Math.abs(response[i]*lambda),1e-12));
        for(let i=0;i<N;i++)this.q[i]+=response[i]*lambda*rate;
      }
      // Floor is unilateral. Repair its deepest support point in the same mass
      // metric and with foot/grip anchors and angular stops still enforced.
      // Asking all buried corners for equality to the plane is incompatible
      // for a tilted convex piece; reread the minimum after each repair.
      const current=this.#kinematics(),anchors=this.#contactRows(current,false,RIG_STEP,false);
      const delta=this.#unilateralDelta(L,anchors.rows,anchors.values,this.#floorInequalities(current));
      let rate=1;for(let i=0;i<N;i++)rate=Math.min(rate,.08/Math.max(Math.abs(delta[i]),1e-12));
      for(let i=0;i<N;i++)this.q[i]+=delta[i]*rate;
    }
    for(let i=0;i<N;i++)this.q[i]=clamp(this.q[i],this.limits[i][0],this.limits[i][1]);
  }

  #substep(h){
    this.lastSelfContactImpulse=0;
    if(this.weaponFlex&&this.isBodyAttached('weapon'))this.weaponFlex.advance(h,{preservePrevious:true});
    this.#gaitStep(h);
    this.#advanceNeck(h);
    this.#advanceDefenseDepth(h);
    // Pelvis/torso are serial joints of an inverted pendulum. Their combined
    // stiffness must exceed the gravitational load gradient of the filled head;
    // independently soft springs otherwise settle against both angular stops.
    const state=this.#kinematics(),M=this.#matrix(state),K=[500,1800,420,300,24,14,20,13,60,45,60,45,100,26];
    const gravity=new Float64Array(N),bias=new Float64Array(N),feedforward=new Float64Array(N),epsilon=1e-5;
    const advanced=Float64Array.from(this.q,(q,i)=>q+this.velocity[i]*epsilon),next=this.#kinematics(advanced);
    for(let b=0;b<state.bodies.length;b++){
      const body=state.bodies[b],future=next.bodies[b],p=body.center;
      const ax=(dot(future.center.jx,this.velocity)-dot(p.jx,this.velocity))/epsilon;
      const ay=(dot(future.center.jy,this.velocity)-dot(p.jy,this.velocity))/epsilon;
      for(let i=0;i<N;i++){gravity[i]+=body.mass*this.gravity*p.jy[i];bias[i]+=body.mass*(p.jx[i]*ax+p.jy[i]*ay);}
    }
    // Active actuators support known dry weight at the requested configuration.
    // Upper support joints use partial feedforward: the entire water moment,
    // mass/inertia, dynamic imbalance and contact response remain in the solve.
    const goal=this.passive?null:this.#kinematics(this.target,this.swordLength,true,this.weaponFlex?.offset??0,true);
    if(goal)for(const body of goal.bodies)if(!this.passive&&body.name!=='water'){
      for(const i of [4,5,6,7,13])feedforward[i]-=body.mass*this.gravity*body.center.jy[i];
      for(const i of [2,3,12])feedforward[i]-=.85*body.mass*this.gravity*body.center.jy[i];
    }
    if(!this.passive&&this.waterLoad.mass>0){
      // Balance anticipates only a centered, nominal fill load. Actual lateral
      // COM displacement/slosh remains a disturbance; its torque is not erased.
      const nominal=this.#offset(goal.points.head,0,-.08*this.scale,this.target[2]+this.target[3]+this.target[12],[2,3,12]);
      for(const i of [2,3,12])feedforward[i]-=.65*this.waterLoad.mass*this.gravity*nominal.jy[i];
    }
    const A=M.map(row=>row.slice()),rhs=new Float64Array(N);
    for(let i=0;i<N;i++){
      K[i]=this.passive?0:K[i]*this.scale**(i<2?3:5);
      const joint=this.jointDamage[names[i]];if(joint?.damage)K[i]*=Math.max(i===2||i===3?.8:.45,1-.55*joint.damage);
      if(this.detachedCoordinates.has(i)){K[i]=0;feedforward[i]=0;this.velocity[i]=0;}
      if(this.fragments.length&&this.contacts.length===0){feedforward[i]=0;if(i<2)K[i]=0;}
      const damping=this.passive?PASSIVE_DRAG[i]*Math.sqrt(M[i][i]):1.8*Math.sqrt(K[i]*M[i][i]),error=this.target[i]-this.q[i];
      const desiredVelocity=!this.passive&&i===0?this.intentVX:0;
      A[i][i]+=h*damping+h*h*K[i];
      rhs[i]=dot(M[i],this.velocity)+h*(K[i]*error+damping*desiredVelocity+gravity[i]-bias[i]+feedforward[i]);
      this.lastMotor[i]=this.passive?0:K[i]*error+damping*(desiredVelocity-this.velocity[i])+feedforward[i];
    }
    this.velocity=solve(factor(A),rhs);
    for(let i=0;i<N;i++){
      const speed=this.passive?(i<2?2:6):(i<2?4:14);this.velocity[i]=clamp(this.velocity[i],-speed,speed);
    }
    const massFactor=this.#massFactor(state),contacts=this.#contactRows(state,true,h,false);
    // Active angular stops participate in the same velocity constraint solve.
    for(let i=1;i<N;i++){
      const proposed=this.q[i]+h*this.velocity[i],bounded=clamp(proposed,this.limits[i][0],this.limits[i][1]);
      if(proposed!==bounded){const row=STOP_ROWS[i][1];contacts.rows.push(row);contacts.values.push((bounded-this.q[i])/h-this.velocity[i]);}
    }
    const reaction=this.#constraintDelta(massFactor,contacts.rows,contacts.values);
    for(let i=0;i<N;i++)this.velocity[i]+=reaction.delta[i];
    this.#projectFloorVelocity(massFactor,state,h);
    for(let i=0;i<N;i++)this.q[i]+=h*this.velocity[i];
    this.lastReaction=Array.from(reaction.lambda.slice(0,4),value=>value/h);this.lastGravity.set(gravity);
    this.#projectPositions(massFactor);
    // Remove residual normal/tangential drift after nonlinear position repair.
    const after=this.#kinematics(),correction=this.#contactRows(after,true,h,false),settled=this.#constraintDelta(massFactor,correction.rows,correction.values);
    for(let i=0;i<N;i++)this.velocity[i]+=settled.delta[i];
    this.#projectSelfVelocity(massFactor,after);
    this.#projectFloorVelocity(massFactor,after,h);
    this.#limitNeck();
    this.#advanceApron(h,this.#kinematics());
    this.time+=h;
  }

  step(dt){
    // A stalled frame does not ask the multibody to integrate a huge unstable step.
    // Up to .25 s is retained; excess is reported for the host's pause policy.
    const supplied=Math.max(0,finite(dt)),accepted=Math.min(.25,supplied);
    this.previousQ=this.q.slice();this.previousSwordLength=this.lastSwordLength??this.swordLength;this.lastSwordLength=this.swordLength;
    if(this.weaponFlex)this.weaponFlex.previousOffset=this.weaponFlex.offset;
    for(const fragment of this.fragments)fragment.beginStep();
    this.droppedTime=(this.droppedTime||0)+supplied-accepted;this.accumulator+=accepted;
    let steps=0;
    while(this.accumulator>=RIG_STEP-1e-12){this.#substep(RIG_STEP);for(const fragment of this.fragments)fragment.step(RIG_STEP,{preservePrevious:true});this.accumulator-=RIG_STEP;steps++;}
    return steps;
  }

  collisionPanels(){return this.#collisionPanels(this.#kinematics(),true);}

  collisionPanelsAt(t){
    t=clamp(finite(t,1),0,1);
    const q=Float64Array.from(this.q,(value,i)=>(this.previousQ?.[i]??value)*(1-t)+value*t);
    const bend=(this.weaponFlex?.previousOffset??0)*(1-t)+(this.weaponFlex?.offset??0)*t;
    return this.#collisionPanels(this.#kinematics(q,(this.previousSwordLength??this.swordLength)*(1-t)+this.swordLength*t,true,bend),true);
  }

  collisionGeometryAt(t,onlyKey=null){
    t=clamp(finite(t,1),0,1);
    const q=new Array(N);for(let i=0;i<N;i++)q[i]=(this.previousQ?.[i]??this.q[i])*(1-t)+this.q[i]*t;
    const length=(this.previousSwordLength??this.swordLength)*(1-t)+this.swordLength*t;
    const bend=(this.weaponFlex?.previousOffset??0)*(1-t)+(this.weaponFlex?.offset??0)*t;
    return this.#collisionPanels(onlyKey?this.#geometryState(q,length,onlyKey,bend):this.#kinematics(q,length,false,bend),true,onlyKey);
  }

  collisionSolidsAt(t,onlyKey=null){
    t=clamp(finite(t,1),0,1);
    const q=new Array(N);for(let i=0;i<N;i++)q[i]=(this.previousQ?.[i]??this.q[i])*(1-t)+this.q[i]*t;
    const length=(this.previousSwordLength??this.swordLength)*(1-t)+this.swordLength*t;
    const bend=(this.weaponFlex?.previousOffset??0)*(1-t)+(this.weaponFlex?.offset??0)*t;
    return this.#collisionPanels(onlyKey?this.#geometryState(q,length,onlyKey,bend):this.#kinematics(q,length,false,bend),true,onlyKey,true);
  }

  static #contactResponse(r,body,p,n){
    const state=r.#kinematics(),j=r.#pointJacobian(state,body,p);
    if(!j)return null;
    const row=Float64Array.from(j.jx,(v,i)=>v*n.x+j.jy[i]*n.y),delta=r.#supportedResponse(r.#massFactor(state),state,row);
    return {delta,row,mass:dot(row,delta),speed:dot(row,r.velocity)};
  }

  static #projectContactSet(a,b,contacts){
    // All contact columns use one support/stop projector per rig. Per-contact
    // stop choices would make this shared Schur matrix non-symmetric.
    const systems=[a,b].map(r=>{const state=r.#kinematics();return {r,state,L:r.#massFactor(state),rows:r.#contactRows(state).rows,stops:new Set()};});
    const jacobian=(s,body,p,n)=>{const j=s.r.#pointJacobian(s.state,body,p);return j?Float64Array.from(j.jx,(v,i)=>v*n.x+j.jy[i]*n.y):null;};
    const data=contacts.map(c=>({c,rowA:jacobian(systems[0],c.a,c.pointA,c.normal),rowB:jacobian(systems[1],c.b,c.pointB,c.normal)})).filter(d=>d.rowA&&d.rowB);
    if(!data.length)return;
    const response=(s,row)=>{const free=solve(s.L,row),reaction=s.r.#constraintDelta(s.L,s.rows,s.rows.map(r=>-dot(r,free)));return Float64Array.from(free,(v,i)=>v+reaction.delta[i]);};
    for(let stopPass=0;stopPass<=2*N;stopPass++){
      for(const d of data){d.da=response(systems[0],d.rowA);d.db=response(systems[1],d.rowB);}
      const S=data.map((d,i)=>Float64Array.from(data,(other,j)=>dot(d.rowA,other.da)+dot(d.rowB,other.db)+(i===j?1e-8:0)));
      let active=data.map((_,i)=>i);const lambda=new Float64Array(data.length);
      for(let pass=0;pass<data.length&&active.length;pass++){
        const matrix=active.map(i=>Float64Array.from(active,j=>S[i][j])),values=active.map(i=>data[i].c.penetration+2e-6),solution=solve(factor(matrix),values);
        let lowest=-1,worst=-1e-9;for(let i=0;i<solution.length;i++)if(solution[i]<worst){lowest=i;worst=solution[i];}
        if(lowest>=0){active.splice(lowest,1);continue;}
        for(let i=0;i<active.length;i++)lambda[active[i]]=Math.max(0,solution[i]);break;
      }
      const da=new Float64Array(N),db=new Float64Array(N);
      for(let j=0;j<data.length;j++)for(let i=0;i<N;i++){da[i]-=data[j].da[i]*lambda[j];db[i]+=data[j].db[i]*lambda[j];}
      let blocked=false;
      for(const [index,s]of systems.entries())for(let i=1;i<N;i++){
        const delta=index?db[i]:da[i];
        if(!s.stops.has(i)&&((s.r.q[i]<=s.r.limits[i][0]+1e-7&&delta<0)||(s.r.q[i]>=s.r.limits[i][1]-1e-7&&delta>0))){const row=STOP_ROWS[i][1];s.rows.push(row);s.stops.add(i);blocked=true;}
      }
      if(blocked)continue;
      let rate=1;for(let i=0;i<N;i++)rate=Math.min(rate,.05/Math.max(Math.abs(da[i]),Math.abs(db[i]),1e-12));
      for(let i=0;i<N;i++){a.q[i]+=da[i]*rate;b.q[i]+=db[i]*rate;}return;
    }
  }

  static projectContact(a,b,{bodyA='weapon',bodyB='weapon',pointA,pointB,normal,penetration=0,maxCorrection=.035}={}){
    const length=normal&&Math.hypot(normal.x,normal.y);
    if(!Number.isFinite(length)||length<1e-9||!Number.isFinite(penetration)||penetration<0)return {applied:false,reason:'invalid-contact'};
    const n={x:normal.x/length,y:normal.y/length},ar=this.#contactResponse(a,bodyA,pointA,n),br=this.#contactResponse(b,bodyB,pointB,n);
    if(!ar||!br||ar.mass+br.mass<1e-9)return {applied:false,reason:'constrained'};
    const amount=(Math.min(2,penetration)+2e-6)/(ar.mass+br.mass),cap=clamp(finite(maxCorrection,.035),.001,.08);let rate=1;
    for(let i=0;i<N;i++)rate=Math.min(rate,cap/Math.max(Math.abs(ar.delta[i]*amount),Math.abs(br.delta[i]*amount),1e-12));
    for(let i=0;i<N;i++){a.q[i]-=ar.delta[i]*amount*rate;b.q[i]+=br.delta[i]*amount*rate;}
    for(const r of [a,b]){r.#projectPositions(r.#massFactor(r.#kinematics()));r.#limitNeck();r.#advanceApron(0,r.#kinematics());}
    return {applied:true,rate,poseA:a.pose(),poseB:b.pose()};
  }

  firstTimberContact(from,to){
    if(!from||!to||![from.x,from.y,to.x,to.y,from.z??0,to.z??0].every(Number.isFinite))return null;
    const states=new Map(),at=t=>{
      if(!states.has(t)){
        const q=Float64Array.from(this.q,(value,i)=>(this.previousQ?.[i]??value)*(1-t)+value*t),length=(this.previousSwordLength??this.swordLength)*(1-t)+this.swordLength*t;
        states.set(t,this.#collisionPanels(this.#kinematics(q,length),true));
      }return states.get(t);
    };
    let rotation=0;for(let i=2;i<N;i++)rotation+=Math.abs(this.q[i]-(this.previousQ?.[i]??this.q[i]));
    const steps=Math.max(1,Math.min(128,Math.ceil(rotation/.01+Math.hypot(to.x-from.x,to.y-from.y,(to.z??0)-(from.z??0))/.025)));
    const position=t=>({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:(from.z??0)+((to.z??0)-(from.z??0))*t});
    const local=(p,panel)=>[...panel.axes.map(axis=>(p.x-panel.center.x)*axis.x+(p.y-panel.center.y)*axis.y),(p.z??0)-panel.z];
    const half=panel=>[...panel.axes.map(axis=>Math.max(...panel.vertices.map(p=>Math.abs((p.x-panel.center.x)*axis.x+(p.y-panel.center.y)*axis.y)))),panel.depth/2];
    for(let k=0;k<steps;k++){
      const t0=k/steps,t1=(k+1)/steps,A=at(t0),B=at(t1),p=position(t0),q=position(t1);let best=null;
      for(let index=0;index<A.length;index++){
        const a=A[index],b=B[index];if(a.body==='weapon'&&a.material!=='wood')continue;
        const x=local(p,a),y=local(q,b),ha=half(a),hb=half(b);let enter=0,exit=1,valid=true;
        for(let axis=0;axis<3;axis++){
          const h=Math.max(ha[axis],hb[axis]),speed=y[axis]-x[axis];
          if(Math.abs(speed)<1e-12){if(Math.abs(x[axis])>h+1e-10){valid=false;break;}continue;}
          let lo=(-h-x[axis])/speed,hi=(h-x[axis])/speed;if(lo>hi)[lo,hi]=[hi,lo];enter=Math.max(enter,lo);exit=Math.min(exit,hi);
          if(enter>exit+1e-12){valid=false;break;}
        }
        if(valid&&exit>=0&&enter<=1){const t=t0+(t1-t0)*Math.max(0,enter);if(!best||t<best.t)best={t,point:position(t),body:a.body,key:a.key,material:'wood'};}
      }
      if(best)return best;
    }
    return null;
  }

  static resolvePair(a,b,{headRadiiA=null,headRadiiB=null,extraContacts=null}={}){
    const events=new Map();
    const external=()=>{
      if(typeof extraContacts!=='function')return [];
      const values=extraContacts();if(!Array.isArray(values))return [];
      return values.slice(0,8).filter(c=>c&&Number.isFinite(c.penetration)&&c.penetration>1e-6&&c.pointA&&c.pointB&&c.normal&&
        [c.pointA.x,c.pointA.y,c.pointB.x,c.pointB.y,c.normal.x,c.normal.y].every(Number.isFinite)).map(c=>({...c,a:c.bodyA,b:c.bodyB,
        keyA:`external:${c.keyA??c.bodyA}`,keyB:`external:${c.keyB??c.bodyB}`,external:true}));
    };
    const interpolate=(r,t)=>r.#kinematics(Float64Array.from(r.q,(q,i)=>(r.previousQ?.[i]??q)*(1-t)+q*t),
      (r.previousSwordLength??r.swordLength)*(1-t)+r.swordLength*t,true,(r.weaponFlex?.previousOffset??0)*(1-t)+(r.weaponFlex?.offset??0)*t);
    const allowed=(pa,pb)=>!(pa.body==='weapon'&&pb.body==='weapon'&&pa.material!=='wood'&&pb.material!=='wood');
    const anchor=(state,body,p)=>{
      const f=state.frames[body],dx=p.x-f.origin.x,dy=p.y-f.origin.y,c=Math.cos(f.angle),s=Math.sin(f.angle);
      if(body==='weapon'&&state.weaponCurve){
        let best=null;
        for(let i=0;i<4;i++){const a=state.weaponCurve[i],b=state.weaponCurve[i+1],x=b.x-a.x,y=b.y-a.y,length=Math.hypot(x,y),t=clamp(((p.x-a.x)*x+(p.y-a.y)*y)/(length*length),0,1),px=a.x+x*t,py=a.y+y*t,d=(p.x-px)**2+(p.y-py)**2;
          if(!best||d<best.distance)best={distance:d,arcFraction:(i+t)/4,across:(-(p.x-px)*y+(p.y-py)*x)/length,z:p.z};
        }
        return best;
      }
      return {x:dx*c+dy*s,y:-dx*s+dy*c,z:p.z,length:distance(f.origin,f.end)};
    };
    const located=(state,body,p)=>{
      if(body==='weapon'&&state.weaponCurve&&p.arcFraction!==undefined){
        const i=Math.min(3,Math.floor(p.arcFraction*4)),t=p.arcFraction*4-i,a=state.weaponCurve[i],b=state.weaponCurve[i+1],x=b.x-a.x,y=b.y-a.y,length=Math.hypot(x,y);
        return {x:a.x+x*t-y/length*p.across,y:a.y+y*t+x/length*p.across,z:p.z};
      }
      const f=state.frames[body],c=Math.cos(f.angle),s=Math.sin(f.angle),x=p.x*(body==='weapon'?distance(f.origin,f.end)/Math.max(p.length,1e-8):1);
      return {x:f.origin.x+x*c-p.y*s,y:f.origin.y+x*s+p.y*c,z:p.z};
    };
    const swept=[];
    if(a.previousQ&&b.previousQ){
      const A0=interpolate(a,0),B0=interpolate(b,0),A1=interpolate(a,1),B1=interpolate(b,1);
      const p0=a.#collisionPanels(A0,true),q0=b.#collisionPanels(B0,true),p1=a.#collisionPanels(A1,true),q1=b.#collisionPanels(B1,true);
      let travel=Math.abs(a.swordLength-a.previousSwordLength)+Math.abs(b.swordLength-b.previousSwordLength);
      for(const r of [a,b])travel+=2*Math.abs((r.weaponFlex?.offset??0)-(r.weaponFlex?.previousOffset??0));
      for(const r of [a,b])for(let i=0;i<N;i++)travel+=Math.abs(r.q[i]-r.previousQ[i])*(i<2?1:3);
      const steps=Math.max(1,Math.min(64,Math.ceil(travel/.035))),samples=new Map([[0,{A:A0,B:B0,ap:p0,bp:q0}],[steps,{A:A1,B:B1,ap:p1,bp:q1}]]);
      const sample=index=>{
        if(!samples.has(index)){const A=interpolate(a,index/steps),B=interpolate(b,index/steps);samples.set(index,{A,B,ap:a.#collisionPanels(A,true),bp:b.#collisionPanels(B,true)});}
        return samples.get(index);
      };
      const broad=(p,old,q,prior)=>Math.min(p.minX,old.minX)<=Math.max(q.maxX,prior.maxX)+.035&&Math.max(p.maxX,old.maxX)>=Math.min(q.minX,prior.minX)-.035&&
        Math.min(p.minY,old.minY)<=Math.max(q.maxY,prior.maxY)+.035&&Math.max(p.maxY,old.maxY)>=Math.min(q.minY,prior.minY)-.035;
      for(let i=0;i<p1.length;i++)for(let j=0;j<q1.length;j++){
        if(!allowed(p1[i],q1[j])||!broad(p1[i],p0[i],q1[j],q0[j]))continue;
        for(let k=0;k<=steps;k++){
          let s=sample(k),c=panelContact(s.ap[i],s.bp[j],a.dir,true);if(!c)continue;
          if(k>0){
            let low=(k-1)/steps,high=k/steps;
            for(let n=0;n<14;n++){const t=(low+high)/2,A=interpolate(a,t),B=interpolate(b,t),contact=panelContact(a.#collisionPanels(A,true)[i],b.#collisionPanels(B,true)[j],a.dir,true);if(contact){high=t;s={A,B};c=contact;}else low=t;}
          }
          swept.push({...c,anchorA:anchor(s.A,c.a,c.pointA),anchorB:anchor(s.B,c.b,c.pointB)});break;
        }
      }
    }
    const contacts=()=>{
      const as=a.#kinematics(),bs=b.#kinematics(),A=a.#collisionPanels(as,true),B=b.#collisionPanels(bs,true),out=[];
      for(const pa of A)for(const pb of B){
        if(!allowed(pa,pb))continue;
        const c=panelContact(pa,pb,a.dir,true);if(c&&c.penetration>1e-6)out.push(c);
      }
      for(const c of swept){
        if(!sharesContactFace(A.find(p=>p.key===c.keyA),B.find(p=>p.key===c.keyB),c.normal))continue;
        const pointA=located(as,c.a,c.anchorA),pointB=located(bs,c.b,c.anchorB),depth=-((pointB.x-pointA.x)*c.normal.x+(pointB.y-pointA.y)*c.normal.y);
        if(depth>1e-6){const index=out.findIndex(o=>o.keyA===c.keyA&&o.keyB===c.keyB),current={...c,pointA,pointB,penetration:depth};if(index>=0)out[index]=current;else out.push(current);}
      }
      if(headRadiiA&&headRadiiB){
        const p=a.pose().head,q=b.pose().head,rx=headRadiiA.x+headRadiiB.x,ry=headRadiiA.y+headRadiiB.y,rz=headRadiiA.z+headRadiiB.z;
        const yz=((q.y-p.y)/ry)**2+((q.z-p.z)/rz)**2,required=rx*Math.sqrt(Math.max(0,1-yz)),dx=q.x-p.x;
        if(yz<1&&Math.abs(dx)<required)out.push({a:'neck',b:'neck',keyA:'head',keyB:'head',normal:{x:dx<0?-1:1,y:0},penetration:required-Math.abs(dx),pointA:p,pointB:q,head:true});
      }
      out.push(...external());return out;
    };
    const contactByKey=old=>{
      if(old.external)return external().find(c=>c.keyA===old.keyA&&c.keyB===old.keyB);
      if(old.head)return contacts().find(c=>c.head);
      const as=a.#kinematics(),bs=b.#kinematics(),pa=a.#collisionPanels(as,true).find(p=>p.key===old.keyA),pb=b.#collisionPanels(bs,true).find(p=>p.key===old.keyB);
      let c=pa&&pb&&panelContact(pa,pb,a.dir,true);if(c&&c.penetration<=1e-6)c=null;
      const sweep=swept.find(c=>c.keyA===old.keyA&&c.keyB===old.keyB);
      if(sweep&&sharesContactFace(pa,pb,sweep.normal)){
        const pointA=located(as,sweep.a,sweep.anchorA),pointB=located(bs,sweep.b,sweep.anchorB),depth=-((pointB.x-pointA.x)*sweep.normal.x+(pointB.y-pointA.y)*sweep.normal.y);
        if(depth>1e-6)c={...sweep,pointA,pointB,penetration:depth};
      }
      return c;
    };
    for(let iteration=0;iteration<24;iteration++){
      const list=contacts();if(!list.length)break;
      const coupled=list.some(c=>c.external)&&list.some(c=>!c.external);
      for(const old of list){
        // External steel already received its sole impulse. In joint mode its
        // position row is solved below; a second velocity response is unused.
        if(coupled&&old.external)continue;
        const c=contactByKey(old);if(!c)continue;
        const ar=this.#contactResponse(a,c.a,c.pointA,c.normal),br=this.#contactResponse(b,c.b,c.pointB,c.normal);if(!ar||!br)continue;
        const inverseMass=ar.mass+br.mass;if(inverseMass<1e-9)continue;
        const closing=br.speed-ar.speed,impulse=c.external?0:Math.max(0,-closing/inverseMass);
        if(impulse>0){
          for(let i=0;i<N;i++){a.velocity[i]-=ar.delta[i]*impulse;b.velocity[i]+=br.delta[i]*impulse;}
          const key=`${c.keyA}/${c.keyB}`,prior=events.get(key),at={x:(c.pointA.x+c.pointB.x)/2,y:(c.pointA.y+c.pointB.y)/2,z:(c.pointA.z??c.pointB.z??.17)};
          events.set(key,{bodyA:c.a,bodyB:c.b,keyA:c.keyA,keyB:c.keyB,pointA:{...c.pointA},pointB:{...c.pointB},material:c.head?'latex':'wood',at,normal:c.normal,impulse:(prior?.impulse??0)+impulse,
            closingSpeed:-closing,peakClosingSpeed:Math.max(prior?.peakClosingSpeed??0,-closing)});
        }
        if(!coupled){
          const amount=(c.penetration+2e-6)/inverseMass;let rate=1;
          for(let i=0;i<N;i++)rate=Math.min(rate,.035/Math.max(Math.abs(ar.delta[i]*amount),Math.abs(br.delta[i]*amount),1e-12));
          for(let i=0;i<N;i++){a.q[i]-=ar.delta[i]*amount*rate;b.q[i]+=br.delta[i]*amount*rate;}
        }
      }
      if(coupled)this.#projectContactSet(a,b,contacts());
      for(const r of [a,b]){r.#projectPositions(r.#massFactor(r.#kinematics()));r.#limitNeck();}
    }
    for(const r of [a,b])r.#advanceApron(0,r.#kinematics());
    return {contacts:contacts().map(c=>({bodyA:c.a,bodyB:c.b,keyA:c.keyA,keyB:c.keyB,external:!!c.external,penetration:c.penetration,head:!!c.head})),events:[...events.values()]};
  }

  #pointJacobian(state,body,hit){
    const part=this.#body(state,body);
    if(!part||!hit||![hit.x,hit.y].every(Number.isFinite)||distance(hit,part.center)>2*this.scale)return null;
    const dx=hit.x-part.center.x,dy=hit.y-part.center.y,jx=part.center.jx.slice(),jy=part.center.jy.slice();
    for(const i of part.rotations){jx[i]-=this.dir*dy;jy[i]+=this.dir*dx;}
    return {jx,jy};
  }

  pointVelocity({body='weapon',point:hit}={}){
    const jacobian=this.#pointJacobian(this.#kinematics(),body,hit);
    return jacobian?{x:dot(jacobian.jx,this.velocity),y:dot(jacobian.jy,this.velocity)}:null;
  }

  effectiveInverseMass({body='weapon',point:hit,normal}={}){
    const state=this.#kinematics(),jacobian=this.#pointJacobian(state,body,hit);
    if(!jacobian||!normal||![normal.x,normal.y].every(Number.isFinite))return 0;
    const length=Math.hypot(normal.x,normal.y);if(!Number.isFinite(length)||length<1e-8)return 0;
    const nx=normal.x/length,ny=normal.y/length;
    const generalized=Float64Array.from(jacobian.jx,(value,i)=>value*nx+jacobian.jy[i]*ny);
    const L=this.#massFactor(state),delta=solve(L,generalized),rows=this.#contactRows(state).rows;
    const constrained=this.#constraintDelta(L,rows,rows.map(row=>-dot(row,delta)));
    for(let i=0;i<N;i++)delta[i]+=constrained.delta[i];
    return Math.max(0,dot(generalized,delta));
  }

  contactInertia({body='weapon',point:hit,normal}={}){
    const state=this.#kinematics(),jacobian=this.#pointJacobian(state,body,hit);
    if(!jacobian||!normal||![normal.x,normal.y].every(Number.isFinite))return null;
    const length=Math.hypot(normal.x,normal.y);if(length<1e-8||!Number.isFinite(length))return null;
    const nx=normal.x/length,ny=normal.y/length;
    const normalRow=Float64Array.from(jacobian.jx,(value,i)=>value*nx+jacobian.jy[i]*ny);
    const tangentRow=Float64Array.from(jacobian.jx,(value,i)=>-value*ny+jacobian.jy[i]*nx);
    // Both directions use this one pose, Jacobian and mass factor. Nothing is
    // cached across impulses or projections, which can change the supports.
    const L=this.#massFactor(state),rows=this.#contactRows(state).rows;
    const response=row=>{
      const delta=solve(L,row),reaction=this.#constraintDelta(L,rows,rows.map(row=>-dot(row,delta)));
      for(let i=0;i<N;i++)delta[i]+=reaction.delta[i];return delta;
    };
    const normalDelta=response(normalRow),tangentDelta=response(tangentRow);
    return {normal:Math.max(0,dot(normalRow,normalDelta)),tangent:Math.max(0,dot(tangentRow,tangentDelta)),cross:dot(normalRow,tangentDelta)};
  }

  reactImpulse({point:hit,impulse,body='weapon'}={}){
    const state=this.#kinematics(),jacobian=this.#pointJacobian(state,body,hit);
    if(!jacobian||!impulse||![impulse.x,impulse.y].every(Number.isFinite))return false;
    const {jx,jy}=jacobian;
    let px=clamp(impulse.x,-5,5),py=clamp(impulse.y,-5,5);
    const magnitude=Math.hypot(px,py);if(magnitude>5){px*=5/magnitude;py*=5/magnitude;}
    const generalized=Float64Array.from(jx,(value,i)=>value*px+jy[i]*py);
    const L=this.#massFactor(state),delta=solve(L,generalized);
    for(let i=0;i<N;i++)this.velocity[i]+=delta[i];
    const contacts=this.#contactRows(state,true,RIG_STEP,false),reaction=this.#constraintDelta(L,contacts.rows,contacts.values);
    for(let i=0;i<N;i++)this.velocity[i]+=reaction.delta[i];
    this.#projectFloorVelocity(L,state);
    this.lastImpulse={body,point:{x:hit.x,y:hit.y},impulse:{x:px,y:py},generalized:Array.from(generalized)};
    return true;
  }

  pose(){
    const state=this.#kinematics(),pose={};
    for(const [key,p] of Object.entries(state.points))pose[key]={x:p.x,y:p.y,z:this.depth[key]??0};
    pose.neckPivot={...pose.shoulder,z:this.depth.head};
    pose.head.z=this.depth.head+REFERENCE_STANCE.neck*this.scale*Math.sin(this.neckLateral.angle);
    pose.headBaseZ=this.depth.head;pose.neckYawTarget=this.neckLateral.target;pose.neckLateral={...this.neckLateral};
    pose.defenseDepth={...this.defenseDepth};pose.defenseDepthTarget=this.defenseDepth.target;
    const defense=getDefense(this.equipment);if(defense.kind==='shield'&&!this.twoHanded)pose.shieldDepth={min:pose.offHand.z+defense.guardDepthMin,max:pose.offHand.z+defense.guardDepthMax};
    pose.shieldRadius=this.shieldRadius;pose.shieldRadiusX=this.shieldRadiusX;pose.shieldRadiusY=this.shieldRadiusY;
    pose.equipment={...this.equipment};pose.twoHanded=this.twoHanded;pose.gripOffset=this.gripOffset;
    pose.angles={...state.angles};pose.bodyFrames=Object.fromEntries(Object.entries(state.frames).map(([name,f])=>[name,{...f,origin:{...f.origin},end:{...f.end},center:{...f.center}}]));
    pose.wristAngle=this.q[13];pose.dynamic=true;pose.passive=this.passive;pose.apron=this.apron?.snapshot();
    if(state.weaponCurve){pose.weaponCurve=state.weaponCurve.map(p=>({x:p.x,y:p.y,z:this.depth.tip}));pose.weaponCurve[0]={...pose.mainHand};pose.weaponFlex={offset:this.weaponFlex.offset,length:this.swordLength};pose.weaponRootDirection={...state.weaponRootDirection,z:0};}
    if(this.jointDamageVersion){pose.joints=Object.fromEntries(Object.entries(this.jointDamage).map(([name,record])=>[name,{damage:record.damage,detached:record.detached}]));pose.detached=this.fragments.map(f=>f.snapshot());}
    if(this.#surfaceSnapshot)pose.surface=this.#surfaceSnapshot(pose,this);
    return pose;
  }

  diagnostics(){
    const state=this.#kinematics(),M=this.#matrix(state);
    const selfContacts=this.#selfContacts(state).map(c=>({...c,normalVelocity:dot(this.#selfContactRow(state,c),this.velocity)}));
    return {passive:this.passive,neckLateral:{...this.neckLateral},minimumWeaponY:Math.min(...this.#floorSamples(state).filter(p=>p.body==='weapon').map(p=>p.y)),minimumGroundY:Math.min(...this.#floorSamples(state).map(p=>p.y)),coordinates:names.map((name,i)=>({name,position:this.q[i],velocity:this.velocity[i],target:this.target[i],min:this.limits[i][0],max:this.limits[i][1]})),
      bodies:state.bodies.map(b=>({name:b.name,mass:b.mass,inertia:b.inertia,center:{x:b.center.x,y:b.center.y}})),massMatrix:M.map(row=>Array.from(row)),
      contacts:this.contacts.map(c=>({...c,error:distance(c,state.points[c.key])})),waterLoad:{...this.waterLoad,offset:{...this.waterLoad.offset}},time:this.time,
      kineticEnergy:.5*this.velocity.reduce((sum,v,i)=>sum+v*dot(M[i],this.velocity),0),gravityTorque:Array.from(this.lastGravity),motorTorque:Array.from(this.lastMotor),
      contactReaction:this.lastReaction.slice(),lastImpulse:this.lastImpulse,droppedTime:this.droppedTime||0,
      selfContacts,maxSelfPenetration:Math.max(0,...selfContacts.map(c=>c.penetration)),selfContactImpulse:this.lastSelfContactImpulse};
  }
}

// Contact normal points from A toward B. Only approaching contacts receive an
// impulse. This rule has no player/AI branch and cannot award a puncture.
export function resolveRigContact(a,b,{point,normal,bodyA='weapon',bodyB='weapon',restitution=.1,maxImpulse=.45}={}){
  const length=normal&&Math.hypot(normal.x,normal.y);
  if(!Number.isFinite(length)||length<1e-8)return {impulse:0,reason:'invalid-normal'};
  const n={x:normal.x/length,y:normal.y/length},va=a.pointVelocity({body:bodyA,point}),vb=b.pointVelocity({body:bodyB,point});
  if(!va||!vb)return {impulse:0,reason:'invalid-contact'};
  const closingSpeed=-((vb.x-va.x)*n.x+(vb.y-va.y)*n.y);
  if(closingSpeed<=0)return {impulse:0,closingSpeed,reason:'separating'};
  const inverseMass=a.effectiveInverseMass({body:bodyA,point,normal:n})+b.effectiveInverseMass({body:bodyB,point,normal:n});
  const cap=clamp(finite(maxImpulse,.45),0,.75),magnitude=clamp((1+clamp(finite(restitution,.1),0,.5))*closingSpeed/Math.max(inverseMass,1e-8),0,cap);
  a.reactImpulse({body:bodyA,point,impulse:{x:-n.x*magnitude,y:-n.y*magnitude}});
  b.reactImpulse({body:bodyB,point,impulse:{x:n.x*magnitude,y:n.y*magnitude}});
  return {impulse:magnitude,closingSpeed,normal:n,capped:magnitude===cap};
}
