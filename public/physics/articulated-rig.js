// Reduced-coordinate planar multibody with lateral neck, body and weapon-arm motion.
import {TABLE_TOP} from './dimensions.js';
import {normalizeLoadout,getWeapon,getDefense,equipmentAcrossSign} from '../equipment.js';
import {ApronCloth,apronParentFrame} from './apron.js';
import {DetachedCluster} from './detached-cluster.js';
import {WeaponFlex,bladeLocalAt} from './weapon-flex.js';
import {knifeHandDirection} from '../knife-technique.js';
import {FOOT_SHAPES} from './foot-geometry.js';
import {shinFloorSupport} from './shin-geometry.js';
export const RIG_STEP=1/120;
export const REFERENCE_STANCE=Object.freeze({hipHeight:.98,hipSocket:.11,frontFoot:.47,backFoot:-.64,
  thigh:.53,shin:.55,torso:.755,neck:.56,shoulderHalfWidth:.275,shoulderDrop:.05,lean:.12,mainReach:.82,mainRise:.02,offReach:-.76,offRise:.02});
export const NECK_CONE=25*Math.PI/180;
const N=16,PI=Math.PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const names=['baseX','baseY','pelvis','torso','mainShoulder','mainElbow','offShoulder','offElbow','frontHip','frontKnee','backHip','backKnee','neck','wrist','frontAnkle','backAnkle'];
const severedBodies={mainShoulder:['mainUpper','mainForearm','weapon'],mainElbow:['mainForearm','weapon'],wrist:['weapon'],
  offShoulder:['offUpper','offForearm','offWeapon'],offElbow:['offForearm','offWeapon'],frontHip:['frontThigh','frontShin','frontFoot'],frontKnee:['frontShin','frontFoot'],backHip:['backThigh','backShin','backFoot'],backKnee:['backShin','backFoot']};
const severedCoordinates={mainShoulder:[4,5,13],mainElbow:[5,13],wrist:[13],offShoulder:[6,7],offElbow:[7],frontHip:[8,9,14],frontKnee:[9,14],backHip:[10,11,15],backKnee:[11,15]};
const jointPivot={mainShoulder:'mainShoulder',mainElbow:'mainElbow',wrist:'mainHand',offShoulder:'offShoulder',offElbow:'offElbow',frontHip:'frontHip',frontKnee:'kneeF',backHip:'backHip',backKnee:'kneeB',pelvis:'hip',torso:'hip',neck:'shoulder'};
const limits=[[-20,20],[.40,1.95],[-.32,.32],[-.92,.92],[-3.12,1.48],[.035,2.96],[-1.52,2.85],[-2.96,-.035],[-3.10,-.035],[-2.82,-.025],[-3.10,-.035],[-2.82,-.025],[-.40,.40],[-PI/4,PI/4],[-1.25,1.25],[-1.25,1.25]];
const STOP_ROWS=Array.from({length:N},(_,i)=>[-1,1].map(sign=>{const row=new Float64Array(N);row[i]=sign;return row;}));
const masses={pelvis:.55,torso:1.35,neck:.13,mainUpper:.34,mainForearm:.25,offUpper:.31,offForearm:.23,frontThigh:.34,frontShin:.25,backThigh:.34,backShin:.25,weapon:.16,offWeapon:.055,frontFoot:.12,backFoot:.12};
const PASSIVE_DRAG=Object.freeze([3,3,4,2,4,4,4,4,10,10,10,10,2,4,4,4]);
const BODY_DEPTH_LIMIT=.28,ARM_DEPTH_LIMIT=.14,DEPTH_SPEED=.85,DEPTH_ACCELERATION=6;
const DEPTH_STEP_DEADZONE=.028;
const ELBOW_DEPTH_SHARE=.55;
const KNEE_DEPTH_SHARE=.65;
const legPoints={kneeF:[0,KNEE_DEPTH_SHARE],kneeB:[1,KNEE_DEPTH_SHARE],ankleF:[0,1],ankleB:[1,1],footF:[0,1],footB:[1,1]};
const legPanels={frontThigh:[0,KNEE_DEPTH_SHARE/2,KNEE_DEPTH_SHARE],backThigh:[1,KNEE_DEPTH_SHARE/2,KNEE_DEPTH_SHARE],
  frontShin:[0,(1+KNEE_DEPTH_SHARE)/2,1-KNEE_DEPTH_SHARE],backShin:[1,(1+KNEE_DEPTH_SHARE)/2,1-KNEE_DEPTH_SHARE],frontFoot:[0,1,0],backFoot:[1,1,0]};
const weaponPoints={mainElbow:ELBOW_DEPTH_SHARE,mainHand:1,tip:1,offGrip:1};
const supportPoints={offElbow:ELBOW_DEPTH_SHARE,offHand:1};
const weaponPanels={mainUpper:ELBOW_DEPTH_SHARE/2,mainForearm:(1+ELBOW_DEPTH_SHARE)/2};
const supportPanels={offUpper:ELBOW_DEPTH_SHARE/2,offForearm:(1+ELBOW_DEPTH_SHARE)/2,'off-palm':1};
const weaponMassBodies=new Set(['mainUpper','mainForearm','weapon']),supportMassBodies=new Set(['offUpper','offForearm']);
const depthMotion=()=>({position:0,previous:0,velocity:0});
const translatedDepth=(z,offset)=>offset===0?z:z+offset;
const sampledDepth=(motion,t)=>t===0?motion.previous:t===1||motion.previous===motion.position?motion.position:
  motion.previous+(motion.position-motion.previous)*t;
function advanceDepth(motion,target,limit,h,passive){
  if(motion.velocity===0&&(passive||motion.position===target))return;
  const desired=passive?0:clamp((target-motion.position)*12,-DEPTH_SPEED,DEPTH_SPEED);
  motion.velocity+=clamp(desired-motion.velocity,-DEPTH_ACCELERATION*h,DEPTH_ACCELERATION*h);
  const next=motion.position+motion.velocity*h;
  motion.position=clamp(next,-limit,limit);
  if(next!==motion.position)motion.velocity=0;
  if(!passive&&Math.abs(target-motion.position)<1e-9&&Math.abs(motion.velocity)<1e-8){motion.position=target;motion.velocity=0;}
}
// Exact v4 wood/hardware hulls are measured in shin-geometry.js. Their distal
// endpoint is the achieved ankle, never the legacy proxy centre of the foot.
const SHIN_FLOOR=[
  {body:'frontShin',knee:'kneeF',foot:'ankleF'},
  {body:'backShin',knee:'kneeB',foot:'ankleB'}
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
const adjacent=new Set(['pelvis:torso','frontThigh:pelvis','backThigh:pelvis','frontShin:frontThigh','backShin:backThigh','frontFoot:frontShin','backFoot:backShin',
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
// Shared timber endpoints for polygon contacts and selected fluid solids.
const chestTimber=(x,y,sx,sy,key,create,panels)=>{
  const dx=sx-x,dy=sy-y,length=Math.hypot(dx,dy);
  const waist={x:x+dx*.28,y:y+dy*.28},chest={x:sx-dx/length*.12,y:sy-dy/length*.12};
  if(!key||key==='chest-front'){
    const front=create('torso',waist,chest,.35,.155,.14,'chest-front');
    if(key)return front;
    panels.push(front);
  }
  const back=create('torso',waist,chest,.32,-.16,.07,'chest-back');
  if(key)return back;
  panels.push(back);
};
const projection=(panel,n)=>{
  let min=Infinity,max=-Infinity;
  for(const p of panel.vertices){const value=p.x*n.x+p.y*n.y;min=Math.min(min,value);max=Math.max(max,value);}
  return {min,max};
};
const sharesContactFace=(a,b,n)=>{
  if(!a||!b||Math.abs(a.z-b.z)>=(a.depth+b.depth)/2-.00001)return false;
  const tangent={x:-n.y,y:n.x},A=projection(a,tangent),B=projection(b,tangent);
  return A.max>=B.min-1e-6&&B.max>=A.min-1e-6;
};
const supportFace=(panel,n,tangent)=>{
  const extent=projection(panel,n).max;let min=Infinity,max=-Infinity;
  for(const p of panel.vertices)if(extent-p.x*n.x-p.y*n.y<1e-7){
    const value=p.x*tangent.x+p.y*tangent.y;min=Math.min(min,value);max=Math.max(max,value);
  }
  return {extent,min,max};
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
  #bodyDepthMotion=depthMotion();
  #armDepthMotion=depthMotion();
  #bodyDepthTarget=0;
  #depthFeet=null;
  #gaitTiming;
  constructor({dir=1,scale=1,baseX=0,pose=null,gravity=-9.81,massScale=1,groundHeight=TABLE_TOP+.075,apronVariant='normal',flexibleWeapons=false,surfaceSnapshot=null,gaitTiming=null}={}){
    this.limits=limits.map(value=>value.slice());this.passive=false;
    this.dir=dir<0?-1:1;this.scale=clamp(finite(scale,1),.75,1.6);
    this.massScale=clamp(finite(massScale,1),.1,20);this.gravity=clamp(finite(gravity,-9.81),-20,0);
    this.groundHeight=clamp(finite(groundHeight,TABLE_TOP+.075),.1,.55);
    this.q=new Float64Array([finite(baseX),TABLE_TOP+REFERENCE_STANCE.hipHeight*this.scale,0,-REFERENCE_STANCE.lean,-2.0,1.25,2.6,-1.5,-.74,-.89,-1.85,-.48,0,0,0,0]);
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
    this.#gaitTiming=gaitTiming&&{
      duration:clamp(finite(gaitTiming.duration,this.scale>1.1?.34:.28),.18,.65),
      delay:clamp(finite(gaitTiming.delay,.12),.03,.24),
      lift:clamp(finite(gaitTiming.lift,.095),.04,.14)
    };
    this.depth={hip:0,frontHip:.20,backHip:-.18,shoulder:0,head:.025,mainShoulder:.11,mainElbow:.14,mainHand:.17,tip:.17,offShoulder:-.11,offElbow:-.10,offHand:-.08,offGrip:.17,defenseTip:.17,kneeF:.20,kneeB:-.18,footF:.29,footB:-.22,ankleF:.20,ankleB:-.18};
    this.contacts=[];this.gait={swing:null,next:0,stanceBase:finite(baseX)};
    this.jointDamage={};this.jointDamageVersion=0;this.detachedBodies=new Set();this.detachedCoordinates=new Set();this.fragments=[];this.jointEvents=[];this.topologyVersion=0;this.gripReleased=false;
    this.lastReaction=[0,0,0,0];this.lastMotor=new Float64Array(N);this.lastGravity=new Float64Array(N);this.lastImpulse=null;this.lastSelfContactImpulse=0;
    this.#bodyDepthMotion.position=this.#bodyDepthMotion.previous=clamp(finite(pose?.bodyDepth),-BODY_DEPTH_LIMIT,BODY_DEPTH_LIMIT);
    const weaponDepth=finite(pose?.weaponDepthOffset,this.bodyDepth);
    this.#armDepthMotion.position=this.#armDepthMotion.previous=clamp(weaponDepth-this.bodyDepth,-ARM_DEPTH_LIMIT,ARM_DEPTH_LIMIT);
    this.setIntent(pose,{baseX,bodyDepthTarget:this.bodyDepth});
    this.q.set(this.target);
    const state=this.#kinematics();
    this.contacts=[{key:'footF',x:state.points.footF.x,y:state.points.footF.y,stance:true,vx:0,vy:0},
      {key:'footB',x:state.points.footB.x,y:state.points.footB.y,stance:true,vx:0,vy:0}];
    for(const c of this.contacts){c.offset=c.x-this.intentBase;c.floor=c.y;c.groundReaction=0;c.tangentReaction=0;}
    this.apron=new ApronCloth(apronVariant);this.#advanceApron(0,state);
  }

  get flexibleWeapons(){return this.#flexibleWeapons;}
  get weaponFlex(){return this.#weaponFlex;}
  get bodyDepth(){return this.#bodyDepthMotion.position;}
  get previousBodyDepth(){return this.#bodyDepthMotion.previous;}
  get feetMovingInDepth(){return this.#depthFeet?.some(foot=>foot.position!==foot.previous)??false;}
  get bodyDepthVelocity(){return this.#bodyDepthMotion.velocity;}
  get weaponDepthOffset(){return this.bodyDepth+this.#armDepthMotion.position;}
  get previousWeaponDepthOffset(){return this.previousBodyDepth+this.#armDepthMotion.previous;}
  get weaponDepthVelocity(){return this.bodyDepthVelocity+this.#armDepthMotion.velocity;}

  #depthMass(arm=false){
    let mass=0;
    for(const body of this.#kinematics().bodies){
      if(!arm||weaponMassBodies.has(body.name)||this.twoHanded&&supportMassBodies.has(body.name))mass+=body.mass;
    }
    return Math.max(.05,mass);
  }
  get bodyDepthInverseMass(){return 1/this.#depthMass();}
  get weaponDepthInverseMass(){return this.isBodyAttached('weapon')?this.bodyDepthInverseMass+1/this.#depthMass(true):0;}

  applyBodyDepthImpulse(impulse){
    if(!Number.isFinite(impulse)||impulse===0)return false;
    const motion=this.#bodyDepthMotion;
    motion.velocity=clamp(motion.velocity+impulse*this.bodyDepthInverseMass,-DEPTH_SPEED,DEPTH_SPEED);
    return true;
  }
  applyWeaponDepthImpulse(impulse){
    if(!Number.isFinite(impulse)||impulse===0||!this.isBodyAttached('weapon'))return false;
    const motion=this.#armDepthMotion;
    motion.velocity=clamp(motion.velocity+impulse/this.#depthMass(true),-DEPTH_SPEED,DEPTH_SPEED);
    return this.applyBodyDepthImpulse(impulse);
  }
  projectBodyDepth(delta){
    if(!Number.isFinite(delta)||delta===0)return 0;
    const motion=this.#bodyDepthMotion,before=motion.position;
    motion.position=clamp(before+delta,-BODY_DEPTH_LIMIT,BODY_DEPTH_LIMIT);
    if(motion.position!==before)this.#advanceApron(0,this.#kinematics());
    return motion.position-before;
  }
  projectWeaponDepth(delta){
    if(!Number.isFinite(delta)||delta===0||!this.isBodyAttached('weapon'))return 0;
    const motion=this.#armDepthMotion,before=motion.position;
    motion.position=clamp(before+delta,-ARM_DEPTH_LIMIT,ARM_DEPTH_LIMIT);
    const arm=motion.position-before;
    return arm+this.projectBodyDepth(delta-arm);
  }

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
        let floorVertices=this.#floorSamples(state).filter(p=>removed.includes(p.body));
        if(this.bodyDepth!==0||this.#armDepthMotion.position!==0)floorVertices=floorVertices.map(p=>
          ({...p,z:translatedDepth(p.z??0,this.#panelDepthOffset(p.body,p.body,this.bodyDepth,this.#armDepthMotion.position))}));
        const vertices=[...panels.flatMap(p=>p.key==='detached-shield'?p.vertices.flatMap(v=>[p.z-p.depth/2,p.z+p.depth/2].map(z=>({...v,z}))):p.vertices.map(v=>({...v,z:p.z}))),...floorVertices];
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

  #legDepthOffset(index,t=1){
    return this.#depthFeet?sampledDepth(this.#depthFeet[index],t)-sampledDepth(this.#bodyDepthMotion,t):0;
  }

  #pointDepthOffset(key,bodyDepth,armDepth){
    const leg=this.#depthFeet&&legPoints[key];
    if(leg)return bodyDepth+leg[1]*this.#legDepthOffset(leg[0]);
    if(armDepth===0)return bodyDepth;
    return bodyDepth+armDepth*(weaponPoints[key]??(this.twoHanded?supportPoints[key]:0)??0);
  }

  #panelDepthOffset(body,key,bodyDepth,armDepth,t=1){
    const leg=this.#depthFeet&&legPanels[body];
    if(leg)return bodyDepth+leg[1]*this.#legDepthOffset(leg[0],t);
    if(armDepth===0)return bodyDepth;
    return bodyDepth+armDepth*(body==='weapon'?1:weaponPanels[key]??(this.twoHanded?supportPanels[key]:0)??0);
  }

  #localDepth(key,value,bodyDepth,armDepth){
    const before=this.depth[key];
    if(!Number.isFinite(value))return before;
    const offset=this.#pointDepthOffset(key,bodyDepth,armDepth);
    if(offset===0)return value;
    return value===before+offset?before:value-offset;
  }

  #attachedPanels(panels,bodyDepth,armDepth,asSolids,t){
    const attached=this.detachedBodies.size?panels.filter(p=>this.isBodyAttached(p.body)):panels;
    if(bodyDepth!==0||armDepth!==0||this.#depthFeet)for(const panel of attached){
      const offset=this.#panelDepthOffset(panel.body,panel.key,bodyDepth,armDepth,t);
      const leg=this.#depthFeet&&legPanels[panel.body];
      const spread=leg?.[2]?Math.abs(this.#legDepthOffset(leg[0],t))*leg[2]:0;
      if(asSolids){panel.center.z=translatedDepth(panel.center.z,offset);panel.half[2]+=spread/2;}
      else {panel.z=translatedDepth(panel.z,offset);panel.depth+=spread;}
    }
    return attached;
  }

  projectContact({body='weapon',point,normal,penetration=0}={}){
    if(!point||!normal||![point.x,point.y,normal.x,normal.y,penetration].every(Number.isFinite)||penetration<=0)return false;
    const response=ArticulatedRig.#contactResponse(this,body,point,normal);if(!response||response.mass<1e-9)return false;
    const amount=Math.min(.035,penetration)/response.mass;let rate=1;
    for(let i=0;i<N;i++)rate=Math.min(rate,.035/Math.max(Math.abs(response.delta[i]*amount),1e-12));
    for(let i=0;i<N;i++)this.q[i]+=response.delta[i]*amount*rate;
    this.#projectPositions(this.#massFactor(this.#kinematics()));this.#limitNeck();return true;
  }

  #advanceApron(dt,state){
    const p={},bodyDepth=this.bodyDepth;
    for(const name of ['hip','mainShoulder','offShoulder','frontHip','backHip','kneeF','kneeB','ankleF','ankleB']){
      p[name]={x:state.points[name].x,y:state.points[name].y,z:translatedDepth(this.depth[name]??0,this.#pointDepthOffset(name,bodyDepth,0))};
    }
    p.clothLegs=Object.fromEntries(['frontThigh','frontShin','backThigh','backShin'].map(body=>[body,this.isBodyAttached(body)]));
    this.apron.advance(dt,{frame:apronParentFrame(p,this.dir,this.scale,this.apron.geometry),pose:p,passive:this.passive,gravity:this.gravity});
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
    add('frontShin',frontKnee,frontAngle+q[9],REFERENCE_STANCE.shin*s,[2,8,9],'ankleF');
    const backAngle=q[2]+q[10],backKnee=add('backThigh',backHip,backAngle,REFERENCE_STANCE.thigh*s,[2,10],'kneeB');
    add('backShin',backKnee,backAngle+q[11],REFERENCE_STANCE.shin*s,[2,10,11],'ankleB');
    const feet={};
    for(const [side,suffix,hipIndex,kneeIndex,index] of [['front','F',8,9,14],['back','B',10,11,15]]){
      const ankle=points['ankle'+suffix],angle=q[2]+q[hipIndex]+q[kneeIndex]+PI/2+q[index],rotations=[2,hipIndex,kneeIndex,index];
      const shape=FOOT_SHAPES[this.scale>1.1?'boss':'normal'][side],half=shape.halfWidth*s;
      const hull=shape.hull.map(([x,y])=>({...this.#offset(ankle,x*s,y*s,angle,rotations),localX:x,localY:y}));
      const sole=hull.filter(v=>Math.abs(v.localY-shape.soleY)<1e-7),heel=sole[0],toe=sole.at(-1);
      const center=this.#offset(ankle,0,shape.centerY*s,angle,rotations);
      const rear=this.#offset(ankle,-half,shape.centerY*s,angle,rotations),front=this.#offset(ankle,half,shape.centerY*s,angle,rotations);
      const support=hull.reduce((a,b)=>a.y<b.y?a:b);
      points['foot'+suffix]=center;feet[side]={ankle,center,heel,toe,rear,front,angle,shape,hull,support};
      if(derivatives){const name=side+'Foot',mass=masses[name]*this.massScale*s**3;
        bodies.push({name,mass,inertia:mass*((2*half)**2+(shape.height*s)**2)/12,center,rotations});angles[name]=this.dir===1?angle:PI-angle;
        const axis=this.#offset(ankle,half,0,angle,rotations);
        frames[name]={origin:{x:ankle.x,y:ankle.y},end:{x:axis.x,y:axis.y},center:{x:center.x,y:center.y},angle:angles[name]};
      }
    }
    if(derivatives&&this.waterLoad.mass>0){
      const center=this.#offset(head,this.waterLoad.offset.x,this.waterLoad.offset.y,neckAngle-PI/2,[2,3,12]);
      bodies.push({name:'water',mass:this.waterLoad.mass,inertia:this.waterLoad.inertia,center,rotations:[2,3,12]});
    }
    const state={points,feet,bodies:this.detachedBodies.size?bodies.filter(b=>this.isBodyAttached(b.name)):bodies,angles,frames,pelvisAngle:q[2],weaponCurve,weaponLength:swordLength,
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
    if(key==='frontFoot'||key==='backFoot')return this.#kinematics(q,swordLength,false,bend);
    if(key==='pelvis')return state;
    if(key==='frontThigh'||key==='frontShin'){
      p.frontHip=this.#geometryOffset(p.hip,REFERENCE_STANCE.hipSocket*s,0,q[2]);
      const angle=q[2]+q[8];p.kneeF=this.#geometryOffset(p.frontHip,REFERENCE_STANCE.thigh*s,0,angle);
      if(key==='frontShin')p.ankleF=this.#geometryOffset(p.kneeF,REFERENCE_STANCE.shin*s,0,angle+q[9]);
      return state;
    }
    if(key==='backThigh'||key==='backShin'){
      p.backHip=this.#geometryOffset(p.hip,-REFERENCE_STANCE.hipSocket*s,0,q[2]);
      const angle=q[2]+q[10];p.kneeB=this.#geometryOffset(p.backHip,REFERENCE_STANCE.thigh*s,0,angle);
      if(key==='backShin')p.ankleB=this.#geometryOffset(p.kneeB,REFERENCE_STANCE.shin*s,0,angle+q[11]);
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

  setIntent(pose,{baseX=this.intentBase,baseVX=0,waterLoad=null,bodyDepthTarget=0,depthFootwork=false}={}){
    this.intentBase=finite(baseX,this.intentBase);this.intentVX=clamp(finite(baseVX),-2,2);
    if(!this.passive){
      this.#bodyDepthTarget=clamp(finite(bodyDepthTarget),-BODY_DEPTH_LIMIT,BODY_DEPTH_LIMIT);
      if(depthFootwork&&this.contacts.length===2){
        if(Math.abs(this.#bodyDepthTarget)<=DEPTH_STEP_DEADZONE)this.#bodyDepthTarget=0;
        else if(!this.#depthFeet){
          const z=this.bodyDepth;
          this.#depthFeet=[{position:z,previous:z},{position:z,previous:z}];
          if(this.gait.swing)this.gait.swing.startZ=this.gait.swing.endZ=z;
        }
      }
    }
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
      const foot=p[key]||{x:t[0]+this.dir*(side>0?REFERENCE_STANCE.frontFoot:REFERENCE_STANCE.backFoot)*s,y:TABLE_TOP+.055*s};
      // Intents from buildPose before v4 use a .075-high proxy centre. Poses
      // emitted by this rig carry an explicit ankle and never use that fallback.
      const ankle=p[side>0?'ankleF':'ankleB']??{x:foot.x,y:p[key]?foot.y-.075+.115*s:foot.y+.06*s};
      const socketX=t[0]+this.dir*side*REFERENCE_STANCE.hipSocket*s;
      const x=this.dir*(ankle.x-socketX),y=Math.max(TABLE_TOP+.115*s,ankle.y)-t[1],l1=REFERENCE_STANCE.thigh*s,l2=REFERENCE_STANCE.shin*s,d=clamp(Math.hypot(x,y),.001,l1+l2-.001);
      const bend=-Math.acos(clamp((d*d-l1*l1-l2*l2)/(2*l1*l2),-1,1));
      t[hipIndex]=Math.atan2(y,x)-Math.atan2(l2*Math.sin(bend),l1+l2*Math.cos(bend));t[kneeIndex]=bend;
      t[side>0?14:15]=wrap((p.feet?.[side>0?'front':'back']?.angle??0)-t[hipIndex]-bend-PI/2);
    }
    t[12]=wrap(angle(p.shoulder,p.head,torso)-torso);
    this.neckLateral.target=clamp(finite(p.neckYawTarget),-NECK_CONE,NECK_CONE);
    for(let i=2;i<N;i++)t[i]=clamp(finite(t[i]),this.limits[i][0],this.limits[i][1]);
    if(p.mainHand&&p.tip){
      this.swordLength=clamp(distance(p.mainHand,p.tip),.45,2);
      t[13]=clamp(wrap(angle(p.mainHand,p.tip,0)-fore-this.wristRestAngle),this.limits[13][0],this.limits[13][1]);
    }
    this.defenseDepth.target=clamp(finite(p.defenseDepthTarget,-.08),-.08,.10);
    // Poses returned by this rig may be fed back as intents. Strip their world
    // translation before copying local layer depths to avoid applying it twice.
    const poseBodyDepth=finite(p.bodyDepth),poseArmDepth=finite(p.weaponDepthOffset,poseBodyDepth)-poseBodyDepth;
    const translatedPose=poseBodyDepth!==0||poseArmDepth!==0||!!(p.dynamic&&this.#depthFeet);
    for(const key of Object.keys(this.depth)){
      if(key==='head'&&Number.isFinite(p.neckYawTarget))continue;
      if(!this.twoHanded&&Number.isFinite(p.defenseDepthTarget)&&['offHand','offElbow'].includes(key))continue;
      this.depth[key]=translatedPose?this.#localDepth(key,p[key]?.z,poseBodyDepth,poseArmDepth):finite(p[key]?.z,this.depth[key]);
    }
    // Default lower legs remain planar, preserving the rigid knee/ankle
    // distance in 3D as well as XY. Explicit ankle-depth intentions still win.
    for(const suffix of ['F','B'])if(!Number.isFinite(p['ankle'+suffix]?.z))this.depth['ankle'+suffix]=this.depth['knee'+suffix];
    if(Number.isFinite(p.headBaseZ))this.depth.head=translatedPose?this.#localDepth('head',p.headBaseZ,poseBodyDepth,poseArmDepth):p.headBaseZ;
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
    const gait=this.gait,depth=this.#depthFeet;
    const forward=Math.abs(this.intentBase-gait.stanceBase)>.09;
    const target=this.#bodyDepthTarget,tolerance=target===0?.001:DEPTH_STEP_DEADZONE;
    if(!gait.swing){
      const frontGap=depth?target-depth[0].position:0,backGap=depth?target-depth[1].position:0;
      const largestGap=Math.max(Math.abs(frontGap),Math.abs(backGap)),sidestep=largestGap>tolerance;
      if(forward||sidestep){
        // Lead with the foot on the side of the move, then gather the other foot.
        let index=gait.next;
        if(sidestep&&!forward)index=Math.abs(frontGap)===Math.abs(backGap)?(frontGap>0?0:1):(Math.abs(frontGap)>Math.abs(backGap)?0:1);
        const c=this.contacts[index],endX=forward?clamp(this.intentBase+c.offset,c.x-.32*this.scale,c.x+.32*this.scale):c.x;
        const startZ=depth?.[index].position??0,endZ=sidestep?clamp(target,startZ-.28,startZ+.28):startZ;
        const timing=this.#gaitTiming;
        gait.swing={index,time:0,transfer:0,delay:sidestep?.08:(timing?.delay??.12),duration:timing?.duration??(this.scale>1.1?.34:.28),
          lift:(timing?.lift??.095)*this.scale,startX:c.x,endX,startZ,endZ};
      }
    }
    if(!gait.swing)return;
    const swing=gait.swing,c=this.contacts[swing.index],support=this.contacts[1-swing.index];
    // Follow a direction change while the foot is still lifting, before its Z
    // movement starts. Once it travels, finish the step on the same support.
    if(depth&&swing.time<=swing.duration*.18){
      const gap=target-swing.startZ;
      swing.endZ=Math.abs(gap)>tolerance?swing.startZ+clamp(gap,-BODY_DEPTH_LIMIT,BODY_DEPTH_LIMIT):swing.startZ;
      if(forward&&swing.time===0)swing.endX=clamp(this.intentBase+c.offset,swing.startX-.32*this.scale,swing.startX+.32*this.scale);
    }
    if(swing.startX!==swing.endX){
      const state=this.#kinematics(),mass=state.bodies.reduce((sum,b)=>sum+b.mass,0),com=state.bodies.reduce((sum,b)=>sum+b.mass*b.center.x,0)/mass;
      gait.balanceOffset=clamp(support.x-com,-.16*this.scale,.16*this.scale);
    }
    if(swing.transfer<swing.delay){swing.transfer+=h;return;}
    c.stance=false;swing.time=Math.min(swing.duration,swing.time+h);
    const t=swing.time/swing.duration,u=t*t*(3-2*t),du=6*t*(1-t)/swing.duration;
    c.x=swing.startX+(swing.endX-swing.startX)*u;c.y=c.floor+swing.lift*Math.sin(PI*t);
    c.vx=(swing.endX-swing.startX)*du;c.vy=swing.lift*PI*Math.cos(PI*t)/swing.duration;
    if(swing.startZ!==swing.endZ){
      // Finish lifting before moving across the table, and settle Z before landing.
      const across=clamp((t-.18)/.64,0,1);
      depth[swing.index].position=swing.startZ+(swing.endZ-swing.startZ)*across*across*(3-2*across);
    }
    if(t>=1){c.y=c.floor;c.stance=true;c.vx=0;c.vy=0;gait.next=1-swing.index;gait.swing=null;gait.balanceOffset=0;gait.stanceBase=this.contacts.reduce((sum,foot)=>sum+foot.x-foot.offset,0)/2;}
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

  #unilateralDelta(L,rows,values,inequalities,reactions=null,geometry=null){
    const baseResult=this.#constraintDelta(L,rows,values),base=baseResult.delta,delta=base.slice(),active=[],responses=geometry?.responses??[],constraintResponses=geometry?.constraintResponses??[],products=geometry?.products??[],baseValues=[];
    const response=index=>{
      if(!responses[index]){
        const free=solve(L,inequalities[index].row);
        if(rows.length){
          const reaction=this.#constraintDelta(L,rows,rows.map(r=>-dot(r,free)));
          constraintResponses[index]=reaction.lambda;
          for(let i=0;i<N;i++)free[i]+=reaction.delta[i];
        }else{
          // An unanchored solve adds zero to each coordinate in the reference
          // arithmetic, including its treatment of negative zero.
          for(let i=0;i<N;i++)free[i]+=0;
        }
        responses[index]=free;
      }
      return responses[index];
    };
    const product=(i,j)=>{
      const row=products[i]??(products[i]=[]);
      if(row[j]===undefined)row[j]=dot(inequalities[i].row,response(j));return row[j];
    };
    const baseValue=i=>{if(baseValues[i]===undefined)baseValues[i]=inequalities[i].value-dot(inequalities[i].row,base);return baseValues[i];};
    let finalLambda=[];
    const activeFactor=[];
    const selected=this.passive?new Uint8Array(inequalities.length):null;
    const envelope=this.passive&&!geometry?new Float64Array(N):null;
    if(envelope)for(const {row,rotations,stop} of inequalities){
      if(rotations){
        envelope[1]=Math.max(envelope[1],Math.abs(row[1]));
        for(const i of rotations)envelope[i]=Math.max(envelope[i],Math.abs(row[i]));
      }else if(stop)envelope[stop]=Math.max(envelope[stop],Math.abs(row[stop]));
      else for(let i=0;i<N;i++)envelope[i]=Math.max(envelope[i],Math.abs(row[i]));
    }
    const nearby=[];
    let covered=-1;
    const selectPassive=checkMass=>{
      let worst=-1,violation=1e-9,limit=Infinity;
      if(envelope){limit=0;for(let i=0;i<N;i++)limit+=envelope[i]*Math.abs(delta[i]);}
      // Keep the same index order. A wider bound refreshes this list only
      // when the current correction outgrows the previous coverage.
      const bounded=Number.isFinite(limit);
      if(bounded&&limit>covered){
        covered=limit*2+1e-9;
        nearby.length=0;
        for(let i=0;i<inequalities.length;i++)if(!(inequalities[i].value+covered<=1e-9))nearby.push(i);
      }
      const count=bounded?nearby.length:inequalities.length;
      for(let index=0;index<count;index++){
        const i=bounded?nearby[index]:index;
        if(selected[i])continue;
        const constraint=inequalities[i],value=constraint.value;
          // Sum the maximum absolute row coefficients in coordinate order.
          // No row can exceed this projection bound for the current delta.
          if(value+limit<=violation)continue;
          const {row,rotations,stop}=constraint;
          let projected=0;
          if(rotations){
            projected+=row[1]*delta[1];
            for(let j=0;j<rotations.length;j++){
              const k=rotations[j];projected+=row[k]*delta[k];
            }
          }else if(stop){projected+=row[stop]*delta[stop];}
          else projected=dot(row,delta);
          const error=value-projected;
          if(error>violation&&(!checkMass||product(i,i)>1e-9)){violation=error;worst=i;}
        }
      return {worst,violation};
    };
    for(let pass=0;pass<N*8;pass++){
      let worst=-1,violation=1e-9;
      if(this.passive&&delta.every(Number.isFinite)){
        // A maximum admissible raw error wins in the original row order.
        // Check its mass first, then use the original scan if it is singular.
        const first=selectPassive(!!geometry);
        ({worst,violation}=!geometry&&first.worst>=0&&!(product(first.worst,first.worst)>1e-9)?selectPassive(true):first);
      }else{
        for(let i=0;i<inequalities.length;i++)if(!active.includes(i)){
          const error=inequalities[i].value-dot(inequalities[i].row,delta);
          if(error>violation&&product(i,i)>1e-9){violation=error;worst=i;}
        }
      }
      if(worst<0)break;
      active.push(worst);if(selected)selected[worst]=1;
      while(active.length){
        // The factor only reads the lower triangle. Reuse its row storage
        // within this solve and preserve the original subtraction order.
        activeFactor.length=active.length;
        for(let i=0;i<active.length;i++){
          const row=activeFactor[i]??(activeFactor[i]=new Float64Array(i+1));
          for(let j=0;j<=i;j++){
            let value=product(active[i],active[j])+(i===j?1e-10:0);
            for(let k=0;k<j;k++)value-=row[k]*activeFactor[j][k];
            row[j]=i===j?Math.sqrt(Math.max(value,1e-10)):value/activeFactor[j][j];
          }
        }
        const lambda=solve(activeFactor,active.map(baseValue));
        let remove=-1,lowest=-1e-9;
        for(let i=0;i<lambda.length;i++)if(lambda[i]<lowest){lowest=lambda[i];remove=i;}
        if(remove>=0){if(selected)selected[active[remove]]=0;active.splice(remove,1);continue;}
        finalLambda=Array.from(lambda);delta.set(base);
        for(let j=0;j<active.length;j++)for(let i=0;i<N;i++)delta[i]+=response(active[j])[i]*Math.max(0,lambda[j]);
        break;
      }
      if(!active.length)delta.set(base);
    }
    if(reactions){
      reactions.constraints=Array.from(baseResult.lambda);
      if(reactions.captureActive)reactions.active=active.map((index,j)=>({index,lambda:Math.max(0,finalLambda[j]??0)}));
      for(let j=0;j<active.length;j++){
        const index=active[j],amount=Math.max(0,finalLambda[j]??0),key=inequalities[index].floorKey;
        if(key)reactions[key]=(reactions[key]??0)+amount;
        for(let i=0;i<rows.length;i++)reactions.constraints[i]+=(constraintResponses[index]?.[i]??0)*amount;
      }
    }
    return delta;
  }

  #floorInequalities(state,velocity=false,h=RIG_STEP){
    const result=this.#floorSamples(state).map(sample=>{
      const row=this.#floorRow(state,sample),depth=TABLE_TOP-sample.y;
      const value=velocity?Math.min(0,depth/h)-dot(row,this.velocity):depth+(depth>1e-9?1e-7:0);
      if(!this.passive)return {row,floorKey:sample.floorKey,value};
      // World Y depends on hip Y and the body's ordered ancestor rotations.
      // A shin's affine support uses the knee and ankle of the same chain.
      const rotations=!sample.knee||Number.isFinite(sample.gx)&&Number.isFinite(sample.gy)?this.#body(state,sample.body)?.rotations:null;
      return {row,floorKey:sample.floorKey,value,rotations,stop:0};
    });
    for(let i=1;i<N;i++)for(const sign of [-1,1]){
      const row=STOP_ROWS[i][sign===-1?0:1];
      const gap=sign===1?this.limits[i][0]-this.q[i]:this.q[i]-this.limits[i][1];
      const value=velocity?gap/h-sign*this.velocity[i]:gap;
      result.push(this.passive?{row,floorKey:undefined,value,rotations:null,stop:i}:{row,value});
    }
    return result;
  }

  #contactRows(state,velocity=false,h=RIG_STEP,includeFloor=true){
    const rows=[],values=[],footRows=[];
    for(const c of this.contacts){
      if(!c.stance)continue;
      const foot=state.feet[c.key==='footF'?'front':'back'];
      if(foot.support.y>TABLE_TOP+.002)continue;
      const p=foot.support,anchor=c.x+this.dir*p.localX*this.scale;footRows.push({key:c.key,index:rows.length});rows.push(p.jx);
      if(velocity)values.push(c.vx-.22*(p.x-anchor)/h-dot(p.jx,this.velocity));
      else values.push(anchor-p.x);
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
    return {rows,values,footRows};
  }

  #floorSamples(state,weaponOnly=false){
    const frontDepth=this.#legDepthOffset(0),backDepth=this.#legDepthOffset(1);
    const parameters=[this.scale,this.dir,this.equipment.weapon,this.depth.footF,this.depth.footB,this.depth.ankleF,this.depth.ankleB,this.depth.kneeF,this.depth.kneeB,this.topologyVersion,frontDepth,backDepth];
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
        const knee=p[shape.knee],foot=p[shape.foot],dx=foot.x-knee.x,dy=foot.y-knee.y;
        const legDepth=shape.body==='frontShin'?frontDepth:backDepth;
        const dz=(this.depth[shape.foot]??0)-(this.depth[shape.knee]??0)+(1-KNEE_DEPTH_SHARE)*legDepth,h=Math.hypot(dx,dy),length=Math.hypot(h,dz);
        if(h<1e-9)continue;
        // Same affine limb frame used by characterTransforms. Differentiate its
        // vertices through both endpoints; a rigid-body point Jacobian would be
        // wrong because the ankle frame stays attached to the supported foot.
        const bend=1/(h*h*h*length)+1/(h*length*length*length),measured=shinFloorSupport(this.scale>1.1?'boss':'normal',shape.body==='frontShin'?'front':'back',s,dz,REFERENCE_STANCE.shin*s);
        for(const [bx,by,bz] of measured.vertices){
          const x=knee.x+dy/h*bx*s+dx/measured.length*by-dx*dz/(h*length)*bz*s;
          const y=knee.y-dx/h*bx*s+dy/measured.length*by-dy*dz/(h*length)*bz*s;
          const gx=-dy*dy/(h*h*h)*bx*s+dy*dz*dx*bend*bz*s;
          const gy=dx*dy/(h*h*h)*bx*s+by/measured.length+(-dz/(h*length)+dy*dy*dz*bend)*bz*s;
          samples.push({body:shape.body,x,y,knee,foot,gx,gy});
        }
      }
      for(const side of ['front','back'])for(const v of state.feet[side].hull)samples.push({body:side+'Foot',floorKey:side==='front'?'footF':'footB',x:v.x,y:v.y,jy:v.jy});
    }
    const weapon=getWeapon(this.equipment),width=weapon.shaftWidth??.034;
    if(state.weaponCurve)for(let i=0;i<4;i++)appendFloorPanel(samples,'weapon',state.weaponCurve[i],state.weaponCurve[i+1],width);
    else appendFloorPanel(samples,'weapon',p.mainHand,p.tip,width);
    if(weapon.headLength){
      const ux=(p.tip.x-p.mainHand.x)/this.swordLength,uy=(p.tip.y-p.mainHand.y)/this.swordLength;
      const across=weapon.headAcross*equipmentAcrossSign(weapon.id,this.dir);
      const center={x:p.tip.x+uy*across,y:p.tip.y-ux*across};
      appendFloorPanel(samples,'weapon',{x:center.x-ux*weapon.headLength,y:center.y-uy*weapon.headLength},center,weapon.headWidth,'weapon-head');
    }
    const result=this.detachedBodies.size?samples.filter(p=>this.isBodyAttached(p.body)):samples;
    const next=cached&&parameters.every((v,i)=>v===cached.parameters[i])?cached:{parameters};next[cacheKey]=result;this.#floorCache.set(state,next);
    return result;
  }

  collapse(){
    if(this.passive)return false;
    this.passive=true;this.contacts=[];this.gait.swing=null;this.intentVX=0;
    this.#bodyDepthTarget=this.bodyDepth;
    this.#bodyDepthMotion.velocity=0;this.#armDepthMotion.velocity=0;
    // Passive joints retain physical stops, but release the upright balance
    // stops that deliberately held an intact puppet in its fencing stance.
    this.limits[1]=[TABLE_TOP-.25,1.95];this.limits[2]=[-Math.PI,Math.PI];this.limits[3]=[-2.8,2.8];this.limits[12]=[-1.3,1.3];
    return true;
  }

  #collisionPanels(state,external=false,onlyKey=null,asSolids=false,t=1){
    const p=state.points,weapon=!onlyKey||onlyKey==='weapon'||onlyKey.startsWith('weapon-flex-')||onlyKey==='weapon-head'?getWeapon(this.equipment):null;
    const panels=[],wants=key=>!onlyKey||onlyKey===key,createPanel=asSolids?collisionSolid:collisionPanel;
    // Self contacts share the body frame. Only the relative arm deflection
    // changes their layers. External samples also include body translation.
    const bodyDepth=external?sampledDepth(this.#bodyDepthMotion,t):0,armDepth=sampledDepth(this.#armDepthMotion,t);
    // The shoulder mount is an excluded .12-unit attachment band. These are
    // interior timber proxies, not bounding spheres around decorative hardware.
    if(wants('chest-front')||wants('chest-back')){
      const selected=chestTimber(p.hip.x,p.hip.y,p.shoulder.x,p.shoulder.y,onlyKey,createPanel,panels);
      if(selected)panels.push(selected);
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
    if(wants('frontShin'))panels.push(createPanel('frontShin',p.kneeF,p.ankleF,.18,.19,.18));
    if(wants('backThigh'))panels.push(createPanel('backThigh',p.backHip,p.kneeB,.20,-.17,.18));
    if(wants('backShin'))panels.push(createPanel('backShin',p.kneeB,p.ankleB,.17,-.17,.18));
    for(const side of ['front','back'])if(wants(side+'Foot')){
      const f=state.feet[side],z=this.depth[side==='front'?'ankleF':'ankleB']+this.dir*(f.shape.minZ+f.shape.maxZ)/2*this.scale;
      const panel=createPanel(side+'Foot',f.rear,f.front,f.shape.height*this.scale,z,(f.shape.maxZ-f.shape.minZ)*this.scale);
      if(!asSolids){panel.vertices=f.hull.map(v=>({x:v.x,y:v.y}));panel.axes.push(...f.hull.map((v,i)=>{const w=f.hull[(i+1)%f.hull.length],dx=w.x-v.x,dy=w.y-v.y,length=Math.hypot(dx,dy);return {x:-dy/length,y:dx/length};}));
        panel.minX=Math.min(...f.hull.map(v=>v.x));panel.maxX=Math.max(...f.hull.map(v=>v.x));panel.minY=Math.min(...f.hull.map(v=>v.y));panel.maxY=Math.max(...f.hull.map(v=>v.y));}
      else for(let i=0;i<2;i++){
        const axis=panel.axes[i];
        panel.half[i]=Math.max(...f.hull.map(v=>Math.abs((v.x-panel.center.x)*axis.x+(v.y-panel.center.y)*axis.y)));
      }
      panels.push(panel);
    }
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
      const across=weapon.headAcross*equipmentAcrossSign(weapon.id,this.dir);
      const center={x:p.tip.x+uy*across,y:p.tip.y-ux*across};
      panels.push(createPanel('weapon',{x:center.x-ux*weapon.headLength,y:center.y-uy*weapon.headLength},center,
        weapon.headWidth,.177,weapon.id==='maul'?.35:.06,'weapon-head'));
    }
    if(!external||onlyKey&&onlyKey!=='main-palm'&&onlyKey!=='off-palm')return this.#attachedPanels(panels,bodyDepth,armDepth,asSolids,t);
    // Measured rigid palm AABB in the delivered hand/grip frame (both variants
    // share these normalized dimensions). The palm follows the wrist/weapon
    // frame; it is timber, not another length of blade.
    const s=this.scale;
    if(wants('main-palm')){
      const ux=state.weaponCurve?state.weaponRootDirection.x:(p.tip.x-p.mainHand.x)/swordLength,uy=state.weaponCurve?state.weaponRootDirection.y:(p.tip.y-p.mainHand.y)/swordLength;
      const palm=along=>({x:p.mainHand.x+ux*along*s-uy*.002743*s,y:p.mainHand.y+uy*along*s+ux*.002743*s});
      const hand=createPanel('weapon',palm(-.073147),palm(.072433),.127148*s,this.depth.mainHand+.007362*s,.14271*s,'main-palm');hand.material='wood';panels.push(hand);
    }
    if(!wants('off-palm'))return this.#attachedPanels(panels,bodyDepth,armDepth,asSolids,t);
    const handDirection=this.defenseLength>0?knifeHandDirection({...p.offHand,z:this.depth.offHand},{...p.defenseTip,z:this.depth.defenseTip},this.equipment.knifeGrip):null;
    const offVector=this.twoHanded?{x:p.tip.x-p.mainHand.x,y:p.tip.y-p.mainHand.y,z:this.depth.tip-this.depth.mainHand}:handDirection?{x:handDirection.x-p.offHand.x,y:handDirection.y-p.offHand.y,z:handDirection.z-this.depth.offHand}:{x:p.offHand.x-p.offElbow.x,y:p.offHand.y-p.offElbow.y,z:this.depth.offHand-this.depth.offElbow};
    const offLength=Math.hypot(offVector.x,offVector.y)||1,ox=offVector.x/offLength,oy=offVector.y/offLength;
    const spatialLength=Math.hypot(offLength,offVector.z),c=offLength/spatialLength,uz=offVector.z/spatialLength;
    const alongMin=-.075001*c+Math.min(.042*uz,-.057617*uz),alongMax=.099982*c+Math.max(.042*uz,-.057617*uz);
    const depthMin=Math.min(-.075001*uz,.099982*uz)-.042*c,depthMax=Math.max(-.075001*uz,.099982*uz)+.057617*c;
    const offPalm=along=>({x:p.offHand.x+ox*along*s+oy*.001353*s,y:p.offHand.y+oy*along*s-ox*.001353*s});
    const other=createPanel('offForearm',offPalm(alongMin),offPalm(alongMax),.106707*s,this.depth.offHand+(depthMin+depthMax)/2*s,(depthMax-depthMin)*s,'off-palm');other.material='wood';panels.push(other);
    return this.#attachedPanels(panels,bodyDepth,armDepth,asSolids,t);
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
    const reactions={}, {rows,values,footRows}=this.#contactRows(state,true,h,false),delta=this.#unilateralDelta(L,rows,values,this.#floorInequalities(state,true,h),reactions);
    for(const c of this.contacts)c.groundReaction=(c.groundReaction??0)+(reactions[c.key]??0)/h;
    this.#recordTangentialReaction(footRows,reactions.constraints,h);
    for(let i=0;i<N;i++)this.velocity[i]+=delta[i];
  }

  #recordTangentialReaction(footRows,lambda,h=RIG_STEP){
    for(const row of footRows){const contact=this.contacts.find(c=>c.key===row.key);if(contact)contact.tangentReaction=(contact.tangentReaction??0)+(lambda[row.index]??0)/h;}
    this.lastReaction=['footF','footB'].flatMap(key=>{const contact=this.contacts.find(c=>c.key===key);return [contact?.tangentReaction??0,contact?.groundReaction??0];});
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
        const current=this.#kinematics();
        // Earlier constraints can move the pose. In the unchanged state the
        // initial narrow-phase result already describes this same pair.
        let c=previousContact;
        if(current!==state){
          const panels=this.#collisionPanels(current);
          const panelA=panels.find(p=>p.key===previousContact.keyA),panelB=panels.find(p=>p.key===previousContact.keyB);
          c=panelA&&panelB&&panelContact(panelA,panelB,this.dir);
        }
        if(!c||c.penetration<=1e-6)continue;
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
    for(const c of this.contacts){c.groundReaction=0;c.tangentReaction=0;}
    this.lastSelfContactImpulse=0;
    if(this.weaponFlex&&this.isBodyAttached('weapon'))this.weaponFlex.advance(h,{preservePrevious:true});
    this.#gaitStep(h);
    const bodyDepth=this.#bodyDepthMotion,armDepth=this.#armDepthMotion;
    let targetDepth=this.#bodyDepthTarget;
    if(this.#depthFeet&&this.contacts.length===2){
      const front=this.#depthFeet[0].position,back=this.#depthFeet[1].position,reach=.055*this.scale;
      targetDepth=clamp(targetDepth,Math.min(front,back)-reach,Math.max(front,back)+reach);
    }
    if(bodyDepth.position!==targetDepth||bodyDepth.velocity!==0)advanceDepth(bodyDepth,targetDepth,BODY_DEPTH_LIMIT,h,this.passive);
    if(armDepth.position!==0||armDepth.velocity!==0)advanceDepth(armDepth,0,ARM_DEPTH_LIMIT,h,this.passive);
    this.#advanceNeck(h);
    this.#advanceDefenseDepth(h);
    // Pelvis/torso are serial joints of an inverted pendulum. Their combined
    // stiffness must exceed the gravitational load gradient of the filled head;
    // independently soft springs otherwise settle against both angular stops.
    const state=this.#kinematics(),M=this.#matrix(state),K=[0,0,420,300,24,14,20,13,60,45,60,45,100,26,60,60];
    const motorTarget=this.target.slice();
    if(this.gait.swing&&this.gait.swing.startX!==this.gait.swing.endX){
      const progress=this.gait.swing.time/this.gait.swing.duration,start=this.gait.stanceBase+(this.gait.balanceOffset??0);
      motorTarget[0]=start+(this.target[0]-start)*progress;
    }
    for(const c of this.contacts)if(!c.stance){
      const front=c.key==='footF',hi=front?8:10,ki=hi+1,ai=front?14:15,hip=state.points[front?'frontHip':'backHip'];
      const goalHip=c.stance?{x:motorTarget[0]+this.dir*(front?1:-1)*REFERENCE_STANCE.hipSocket*this.scale,y:motorTarget[1]}:hip;
      const x=this.dir*(c.x-goalHip.x),y=c.y+.06*this.scale-goalHip.y,l1=REFERENCE_STANCE.thigh*this.scale,l2=REFERENCE_STANCE.shin*this.scale,d=clamp(Math.hypot(x,y),.001,l1+l2-.001);
      const knee=-Math.acos(clamp((d*d-l1*l1-l2*l2)/(2*l1*l2),-1,1)),leg=Math.atan2(y,x)-Math.atan2(l2*Math.sin(knee),l1+l2*Math.cos(knee));
      motorTarget[hi]=clamp(leg-this.q[2],...this.limits[hi]);motorTarget[ki]=clamp(knee,...this.limits[ki]);
      const t=this.gait.swing?this.gait.swing.time/this.gait.swing.duration:0,roll=c.stance?0:.20*Math.sin(2*PI*t);
      motorTarget[ai]=clamp(roll-leg-knee-PI/2,...this.limits[ai]);if(!c.stance){K[hi]=260;K[ki]=220;}
    }
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
      // Existing elastic coordinates ring briefly only when a physical impulse
      // excites them; no separate oscillator adds displacement or energy.
      const impactAge=Math.hypot(this.lastImpulse?.impulse.x??0,this.lastImpulse?.impulse.y??0)>1e-12?this.time-(this.lastImpulse.time??-Infinity):Infinity,dampingRatio=impactAge<.12&&[4,5,13].includes(i)?1.25:1.8;
      const damping=this.passive?PASSIVE_DRAG[i]*Math.sqrt(M[i][i]):dampingRatio*Math.sqrt(K[i]*M[i][i]),error=motorTarget[i]-this.q[i];
      const desiredVelocity=!this.passive&&i===0?this.intentVX:0;
      A[i][i]+=h*damping+h*h*K[i];
      rhs[i]=dot(M[i],this.velocity)+h*(K[i]*error+damping*desiredVelocity+gravity[i]-bias[i]+feedforward[i]);
      this.lastMotor[i]=this.passive?0:K[i]*error+damping*(desiredVelocity-this.velocity[i])+feedforward[i];
    }
    // Pelvis positioning is an internal hip-to-foot actuator. Its equal and
    // opposite endpoint forces leave the two free base coordinates unforced;
    // only a real floor contact can support or propel the whole body.
    const supports=this.contacts.filter(c=>c.stance&&state.feet[c.key==='footF'?'front':'back'].support.y<=TABLE_TOP+.002);
    if(!this.passive)for(const contact of supports)for(const axis of ['x','y']){
      const j=axis==='x'?'jx':'jy',foot=state.points[contact.key],hip=state.points.hip,row=Float64Array.from(hip[j],(v,i)=>v-foot[j][i]);
      const strength=(axis==='x'?500:1800)*this.scale**3/supports.length,damping=2*Math.sqrt(strength*state.bodies.reduce((sum,b)=>sum+b.mass,0)/supports.length);
      const desired=motorTarget[axis==='x'?0:1]-contact[axis],error=desired-(hip[axis]-foot[axis]),speed=axis==='x'?this.intentVX:0;
      const supportWeight=axis==='y'?-this.gravity*state.bodies.reduce((sum,b)=>sum+b.mass,0)/supports.length:0;
      for(let i=2;i<N;i++){
        rhs[i]+=h*row[i]*(strength*error+damping*speed+supportWeight);
        this.lastMotor[i]+=row[i]*(strength*error+damping*(speed-dot(row,this.velocity))+supportWeight);
        for(let k=2;k<N;k++)A[i][k]+=(h*damping+h*h*strength)*row[i]*row[k];
      }
    }
    const velocityFactor=factor(A);this.velocity=solve(velocityFactor,rhs);
    for(let i=0;i<N;i++){
      const speed=this.passive?(i<2?2:6):(i<2?4:14);this.velocity[i]=clamp(this.velocity[i],-speed,speed);
    }
    const massFactor=this.#massFactor(state),contacts=this.#contactRows(state,true,h,false);
    // Active angular stops participate in the same velocity constraint solve.
    for(let i=1;i<N;i++){
      const proposed=this.q[i]+h*this.velocity[i],bounded=clamp(proposed,this.limits[i][0],this.limits[i][1]);
      if(proposed!==bounded){const row=STOP_ROWS[i][1];contacts.rows.push(row);contacts.values.push((bounded-this.q[i])/h-this.velocity[i]);}
    }
    // The integrated constraints share the implicit motor/damping metric A.
    // A later instantaneous impulse and position repair still use physical M.
    const reaction=this.#constraintDelta(velocityFactor,contacts.rows,contacts.values);
    this.#recordTangentialReaction(contacts.footRows,reaction.lambda,h);
    for(let i=0;i<N;i++)this.velocity[i]+=reaction.delta[i];
    this.#projectFloorVelocity(velocityFactor,state,h);
    for(let i=0;i<N;i++)this.q[i]+=h*this.velocity[i];
    this.lastGravity.set(gravity);
    this.#projectPositions(massFactor);
    // Remove residual normal/tangential drift after nonlinear position repair.
    const after=this.#kinematics(),correction=this.#contactRows(after,true,h,false),settled=this.#constraintDelta(velocityFactor,correction.rows,correction.values);
    this.#recordTangentialReaction(correction.footRows,settled.lambda,h);
    for(let i=0;i<N;i++)this.velocity[i]+=settled.delta[i];
    this.#projectSelfVelocity(massFactor,after);
    this.#projectFloorVelocity(velocityFactor,after,h);
    this.#limitNeck();
    this.#advanceApron(h,this.#kinematics());
    this.time+=h;
  }

  step(dt){
    // A stalled frame does not ask the multibody to integrate a huge unstable step.
    // Up to .25 s is retained; excess is reported for the host's pause policy.
    const supplied=Math.max(0,finite(dt)),accepted=Math.min(.25,supplied);
    this.previousQ=this.q.slice();this.previousSwordLength=this.lastSwordLength??this.swordLength;this.lastSwordLength=this.swordLength;
    this.#bodyDepthMotion.previous=this.bodyDepth;this.#armDepthMotion.previous=this.#armDepthMotion.position;
    if(this.#depthFeet){
      if(!this.gait.swing&&this.#bodyDepthTarget===0&&this.bodyDepth===0&&this.#depthFeet.every(foot=>foot.position===0))this.#depthFeet=null;
      else for(const foot of this.#depthFeet)foot.previous=foot.position;
    }
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
    return this.#collisionPanels(this.#kinematics(q,(this.previousSwordLength??this.swordLength)*(1-t)+this.swordLength*t,true,bend),true,null,false,t);
  }

  collisionGeometryAt(t,onlyKey=null){
    t=clamp(finite(t,1),0,1);
    return this.#sampleCollisionPanels(t,onlyKey);
  }

  #sampleCollisionPanels(t,onlyKey=null){
    const q=new Array(N);for(let i=0;i<N;i++)q[i]=(this.previousQ?.[i]??this.q[i])*(1-t)+this.q[i]*t;
    const length=(this.previousSwordLength??this.swordLength)*(1-t)+this.swordLength*t;
    const bend=(this.weaponFlex?.previousOffset??0)*(1-t)+(this.weaponFlex?.offset??0)*t;
    return this.#collisionPanels(onlyKey?this.#geometryState(q,length,onlyKey,bend):this.#kinematics(q,length,false,bend),true,onlyKey,false,t);
  }

  // Native fluid queries only, with the same mechanical state throughout this step.
  static createNativeFluidChestSampler(rig){
    if(Object.getPrototypeOf(rig)!==ArticulatedRig.prototype||Object.hasOwn(rig,'collisionSolidsAt')||
      ArticulatedRig.prototype.collisionSolidsAt!==NATIVE_FLUID_COLLISION_SOLIDS_AT)return null;
    const data=name=>Object.getOwnPropertyDescriptor(rig,name)?.value;
    const q=data('q'),previousSlot=Object.getOwnPropertyDescriptor(rig,'previousQ'),before=previousSlot?.value??q;
    const dir=data('dir'),scale=data('scale'),detached=data('detachedBodies');
    if(!(q instanceof Float64Array)||!(before instanceof Float64Array)||q.length<N||before.length<N||
      previousSlot&&!Object.hasOwn(previousSlot,'value')||dir!==-1&&dir!==1||!Number.isFinite(scale)||!(detached instanceof Set)||detached.size)return null;
    const torsoLength=REFERENCE_STANCE.torso*scale;
    return (t,key)=>{
      t=clamp(finite(t,1),0,1);
      const rest=1-t;
      const x=before[0]*rest+q[0]*t,y=before[1]*rest+q[1]*t;
      const pelvis=before[2]*rest+q[2]*t,torso=before[3]*rest+q[3]*t;
      const angle=PI/2+pelvis+torso,c=Math.cos(angle),sn=Math.sin(angle);
      const sx=x+dir*(torsoLength*c-0*sn),sy=y+(torsoLength*sn+0*c);
      const solid=chestTimber(x,y,sx,sy,key,collisionSolid);
      const bodyDepth=sampledDepth(rig.#bodyDepthMotion,t),armDepth=sampledDepth(rig.#armDepthMotion,t);
      solid.center.z=translatedDepth(solid.center.z,rig.#panelDepthOffset('torso',key,bodyDepth,armDepth));
      return solid;
    };
  }

  collisionSolidsAt(t,onlyKey=null){
    t=clamp(finite(t,1),0,1);
    const q=new Array(N);for(let i=0;i<N;i++)q[i]=(this.previousQ?.[i]??this.q[i])*(1-t)+this.q[i]*t;
    const length=(this.previousSwordLength??this.swordLength)*(1-t)+this.swordLength*t;
    const bend=(this.weaponFlex?.previousOffset??0)*(1-t)+(this.weaponFlex?.offset??0)*t;
    return this.#collisionPanels(onlyKey?this.#geometryState(q,length,onlyKey,bend):this.#kinematics(q,length,false,bend),true,onlyKey,true,t);
  }

  #depthTravel(){
    const feet=this.#depthFeet;
    const stride=feet?Math.max(Math.abs(feet[0].position-feet[0].previous),Math.abs(feet[1].position-feet[1].previous)):0;
    return Math.abs(this.bodyDepth-this.previousBodyDepth)+Math.abs(this.#armDepthMotion.position-this.#armDepthMotion.previous)+stride;
  }

  #headDepth(){
    const local=this.depth.head+REFERENCE_STANCE.neck*this.scale*Math.sin(this.neckLateral.angle);
    return translatedDepth(local,this.bodyDepth);
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
        states.set(t,this.#collisionPanels(this.#kinematics(q,length),true,null,false,t));
      }return states.get(t);
    };
    let rotation=0;for(let i=2;i<N;i++)rotation+=Math.abs(this.q[i]-(this.previousQ?.[i]??this.q[i]));
    const steps=Math.max(1,Math.min(128,Math.ceil(rotation/.01+(Math.hypot(to.x-from.x,to.y-from.y,(to.z??0)-(from.z??0))+this.#depthTravel())/.025)));
    const position=t=>({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:(from.z??0)+((to.z??0)-(from.z??0))*t});
    const local=(p,panel)=>[...panel.axes.map(axis=>(p.x-panel.center.x)*axis.x+(p.y-panel.center.y)*axis.y),(p.z??0)-panel.z];
    const bounds=panel=>[...panel.axes.map(axis=>{const projected=panel.vertices.map(p=>(p.x-panel.center.x)*axis.x+(p.y-panel.center.y)*axis.y);return [Math.min(...projected),Math.max(...projected)];}),[-panel.depth/2,panel.depth/2]];
    for(let k=0;k<steps;k++){
      const t0=k/steps,t1=(k+1)/steps,A=at(t0),B=at(t1),p=position(t0),q=position(t1);let best=null;
      for(let index=0;index<A.length;index++){
        const a=A[index],b=B[index];if(a.body==='weapon'&&a.material!=='wood')continue;
        const x=local(p,a),y=local(q,b),ha=bounds(a),hb=bounds(b);let enter=0,exit=1,valid=true;
        for(let axis=0;axis<x.length;axis++){
          const min=Math.min(ha[axis][0],hb[axis][0]),max=Math.max(ha[axis][1],hb[axis][1]),speed=y[axis]-x[axis];
          if(Math.abs(speed)<1e-12){if(x[axis]<min-1e-10||x[axis]>max+1e-10){valid=false;break;}continue;}
          let lo=(min-x[axis])/speed,hi=(max-x[axis])/speed;if(lo>hi)[lo,hi]=[hi,lo];enter=Math.max(enter,lo);exit=Math.min(exit,hi);
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
    const anchor=(rig,state,body,key,p,t)=>{
      const offset=rig.#panelDepthOffset(body,key,sampledDepth(rig.#bodyDepthMotion,t),sampledDepth(rig.#armDepthMotion,t),t);
      const f=state.frames[body],dx=p.x-f.origin.x,dy=p.y-f.origin.y,c=Math.cos(f.angle),s=Math.sin(f.angle);
      if(body==='weapon'&&state.weaponCurve){
        let best=null;
        for(let i=0;i<4;i++){const a=state.weaponCurve[i],b=state.weaponCurve[i+1],x=b.x-a.x,y=b.y-a.y,length=Math.hypot(x,y),t=clamp(((p.x-a.x)*x+(p.y-a.y)*y)/(length*length),0,1),px=a.x+x*t,py=a.y+y*t,d=(p.x-px)**2+(p.y-py)**2;
          if(!best||d<best.distance)best={distance:d,arcFraction:(i+t)/4,across:(-(p.x-px)*y+(p.y-py)*x)/length,z:p.z};
        }
        if(offset!==0)best.depthOffset=offset;
        return best;
      }
      const local={x:dx*c+dy*s,y:-dx*s+dy*c,z:p.z,length:distance(f.origin,f.end)};
      if(offset!==0)local.depthOffset=offset;
      return local;
    };
    const located=(rig,state,body,key,p)=>{
      const offset=rig.#panelDepthOffset(body,key,rig.bodyDepth,rig.#armDepthMotion.position);
      const z=translatedDepth(p.z,offset-(p.depthOffset??0));
      if(body==='weapon'&&state.weaponCurve&&p.arcFraction!==undefined){
        const i=Math.min(3,Math.floor(p.arcFraction*4)),t=p.arcFraction*4-i,a=state.weaponCurve[i],b=state.weaponCurve[i+1],x=b.x-a.x,y=b.y-a.y,length=Math.hypot(x,y);
        return {x:a.x+x*t-y/length*p.across,y:a.y+y*t+x/length*p.across,z};
      }
      const f=state.frames[body],c=Math.cos(f.angle),s=Math.sin(f.angle),x=p.x*(body==='weapon'?distance(f.origin,f.end)/Math.max(p.length,1e-8):1);
      return {x:f.origin.x+x*c-p.y*s,y:f.origin.y+x*s+p.y*c,z};
    };
    const swept=[];
    if(a.previousQ&&b.previousQ){
      const p0=a.#sampleCollisionPanels(0),q0=b.#sampleCollisionPanels(0),p1=a.#sampleCollisionPanels(1),q1=b.#sampleCollisionPanels(1);
      let travel=Math.abs(a.swordLength-a.previousSwordLength)+Math.abs(b.swordLength-b.previousSwordLength);
      for(const r of [a,b])travel+=2*Math.abs((r.weaponFlex?.offset??0)-(r.weaponFlex?.previousOffset??0));
      for(const r of [a,b])for(let i=0;i<N;i++)travel+=Math.abs(r.q[i]-r.previousQ[i])*(i<2?1:3);
      travel+=a.#depthTravel()+b.#depthTravel();
      const steps=Math.max(1,Math.min(64,Math.ceil(travel/.035))),samples=new Map([[0,{ap:p0,bp:q0}],[steps,{ap:p1,bp:q1}]]),anchors=new Map();
      const sample=index=>{
        if(!samples.has(index)){
          const t=index/steps;
          samples.set(index,{ap:a.#sampleCollisionPanels(t),bp:b.#sampleCollisionPanels(t)});
        }
        return samples.get(index);
      };
      const broad=(p,old,q,prior)=>Math.min(p.minX,old.minX)<=Math.max(q.maxX,prior.maxX)+.035&&Math.max(p.maxX,old.maxX)>=Math.min(q.minX,prior.minX)-.035&&
        Math.min(p.minY,old.minY)<=Math.max(q.maxY,prior.maxY)+.035&&Math.max(p.maxY,old.maxY)>=Math.min(q.minY,prior.minY)-.035;
      for(let i=0;i<p1.length;i++)for(let j=0;j<q1.length;j++){
        if(!allowed(p1[i],q1[j])||!broad(p1[i],p0[i],q1[j],q0[j]))continue;
        for(let k=0;k<=steps;k++){
          const s=sample(k);
          let c=panelContact(s.ap[i],s.bp[j],a.dir,true),contactT=k/steps;if(!c)continue;
          if(k>0){
            let low=(k-1)/steps,high=k/steps;
            for(let n=0;n<14;n++){
              const t=(low+high)/2;
              const [pa]=a.#sampleCollisionPanels(t,p1[i].key),[pb]=b.#sampleCollisionPanels(t,q1[j].key);
              const contact=panelContact(pa,pb,a.dir,true);
              if(contact){high=t;c=contact;contactT=t;}else low=t;
            }
          }
          let states=anchors.get(contactT);
          if(!states){states=[interpolate(a,contactT),interpolate(b,contactT)];anchors.set(contactT,states);}
          swept.push({...c,anchorA:anchor(a,states[0],c.a,c.keyA,c.pointA,contactT),anchorB:anchor(b,states[1],c.b,c.keyB,c.pointB,contactT)});break;
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
        const pointA=located(a,as,c.a,c.keyA,c.anchorA),pointB=located(b,bs,c.b,c.keyB,c.anchorB),depth=-((pointB.x-pointA.x)*c.normal.x+(pointB.y-pointA.y)*c.normal.y);
        if(depth>1e-6){const index=out.findIndex(o=>o.keyA===c.keyA&&o.keyB===c.keyB),current={...c,pointA,pointB,penetration:depth};if(index>=0)out[index]=current;else out.push(current);}
      }
      if(headRadiiA&&headRadiiB){
        // Collision already owns both current kinematic states. A presentation
        // pose also copies cloth, damage and surface marks; none is needed here.
        const p={x:as.points.head.x,y:as.points.head.y,z:a.#headDepth()},
          q={x:bs.points.head.x,y:bs.points.head.y,z:b.#headDepth()},
          rx=headRadiiA.x+headRadiiB.x,ry=headRadiiA.y+headRadiiB.y,rz=headRadiiA.z+headRadiiB.z;
        const yz=((q.y-p.y)/ry)**2+((q.z-p.z)/rz)**2,required=rx*Math.sqrt(Math.max(0,1-yz)),dx=q.x-p.x;
        if(yz<1&&Math.abs(dx)<required)out.push({a:'neck',b:'neck',keyA:'head',keyB:'head',normal:{x:dx<0?-1:1,y:0},penetration:required-Math.abs(dx),pointA:p,pointB:q,head:true});
      }
      out.push(...external());return out;
    };
    const contactByKey=old=>{
      if(old.external)return external().find(c=>c.keyA===old.keyA&&c.keyB===old.keyB);
      if(old.head)return contacts().find(c=>c.head);
      const as=a.#kinematics(),bs=b.#kinematics(),[pa]=a.#collisionPanels(as,true,old.keyA),[pb]=b.#collisionPanels(bs,true,old.keyB);
      let c=pa&&pb&&panelContact(pa,pb,a.dir,true);if(c&&c.penetration<=1e-6)c=null;
      const sweep=swept.find(c=>c.keyA===old.keyA&&c.keyB===old.keyB);
      if(sweep&&sharesContactFace(pa,pb,sweep.normal)){
        const pointA=located(a,as,sweep.a,sweep.keyA,sweep.anchorA),pointB=located(b,bs,sweep.b,sweep.keyB,sweep.anchorB),depth=-((pointB.x-pointA.x)*sweep.normal.x+(pointB.y-pointA.y)*sweep.normal.y);
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

  effectiveInverseMass(options={}){return this.contactInertia(options)?.normal??0;}

  contactInertia({body='weapon',point,normal,impulse}={}){
    if(!normal||![normal.x,normal.y].every(Number.isFinite))return null;
    const length=Math.hypot(normal.x,normal.y);if(length<1e-8)return null;
    // Without a supplied total, this compatibility query asks for the local
    // directional response. A unit probe could reach a distant predictive stop
    // and report its inertia even in otherwise unconstrained free flight.
    const trial=this.trialContactImpulse({body,point,normal,impulse:impulse??{x:normal.x/length*1e-6,y:normal.y/length*1e-6},compact:true});
    return trial?{normal:trial.normal,tangent:trial.tangent,cross:trial.cross}:null;
  }

  // A signed TOTAL impulse chooses one unilateral active set. Trial and apply
  // share initial velocity, gap allowances and anchor stabilization. A query
  // never installs a trial velocity or changes public reaction telemetry.
  // A query owns one immutable mechanical snapshot. Its caches contain only
  // geometry responses; active sets, RHS and reactions belong to each trial.
  #prepareContactImpulseQuery({body='weapon',point:hit,normal={x:1,y:0}}={},reusable=false){
    const state=this.#kinematics(),jacobian=this.#pointJacobian(state,body,hit);
    if(!jacobian||!normal||![normal.x,normal.y].every(Number.isFinite))return null;
    const length=Math.hypot(normal.x,normal.y);if(length<1e-8||!Number.isFinite(length))return null;
    const {jx,jy}=jacobian,nx=normal.x/length,ny=normal.y/length,L=this.#massFactor(state),initial=reusable?this.velocity.slice():this.velocity;
    const live=this.#contactRows(state,true,RIG_STEP,false),contacts=reusable?{rows:live.rows.map(row=>row.slice()),values:live.values.slice(),footRows:live.footRows.map(r=>({...r}))}:live;
    const floor=this.#floorInequalities(state,true,RIG_STEP),inequalities=reusable?floor.map(c=>({...c,row:c.row.slice()})):floor;
    const footByRow=new Map(contacts.footRows.map(r=>[r.index,r.key]));
    const normalRow=Float64Array.from(jx,(value,i)=>value*nx+jy[i]*ny),tangentRow=Float64Array.from(jx,(value,i)=>-value*ny+jy[i]*nx);
    const M=this.#matrix(state),energy=v=>.5*v.reduce((sum,value,i)=>sum+value*dot(M[i],v),0);
    return {jx,jy,L,initial,contacts,inequalities,footByRow,normalRow,tangentRow,energy,energyBefore:energy(initial),
      pointVelocityBefore:{x:dot(jx,initial),y:dot(jy,initial)},layouts:reusable?new Map():null};
  }

  createContactImpulseQuery(options={}){
    const prepared=this.#prepareContactImpulseQuery(options,true);if(!prepared)return null;
    return Object.freeze({trial:options=>this.#trialPreparedContactImpulse(prepared,options)});
  }

  // Old aliased rig modules need no new named export to use weapon-bind.
  // Captured functions also reject instance or later prototype overrides.
  static createNativeContactQuery(rig,options={}){
    if(!(rig instanceof ArticulatedRig)||!Object.entries(NATIVE_CONTACT_QUERY_METHODS).every(([name,method])=>rig[name]===method))return null;
    return NATIVE_CONTACT_QUERY_METHODS.createContactImpulseQuery.call(rig,options);
  }

  trialContactImpulse({body='weapon',point,normal={x:1,y:0},impulse,compact=false}={}){
    return this.#trialPreparedContactImpulse(this.#prepareContactImpulseQuery({body,point,normal}),{impulse,compact});
  }

  #trialPreparedContactImpulse(prepared,{impulse,compact=false}={}){
    if(!prepared||!impulse||![impulse.x,impulse.y].every(Number.isFinite))return null;
    let px=clamp(impulse.x,-5,5),py=clamp(impulse.y,-5,5);
    const magnitude=Math.hypot(px,py);if(magnitude>5){px*=5/magnitude;py*=5/magnitude;}
    const {jx,jy,L,initial,contacts,footByRow,normalRow,tangentRow}=prepared;
    const generalized=Float64Array.from(jx,(value,i)=>value*px+jy[i]*py),free=solve(L,generalized);
    const unconstrained=Float64Array.from(initial,(value,i)=>value+free[i]);
    const inequalities=prepared.inequalities.map(c=>({...c,value:c.value-dot(c.row,free)}));
    const released=new Set();let rows,values,footRows,reactions,correction,layout;
    for(let pass=0;pass<=contacts.footRows.length;pass++){
      rows=[];values=[];footRows=[];
      for(let i=0;i<contacts.rows.length;i++){
        const key=footByRow.get(i);if(key&&released.has(key))continue;
        if(key)footRows.push({key,index:rows.length});rows.push(contacts.rows[i]);values.push(contacts.values[i]-dot(contacts.rows[i],free));
      }
      // Preserve insertion order rather than using an unordered set key.
      const key=[...released].join(',');layout=prepared.layouts?.get(key);
      if(prepared.layouts&&!layout){layout={responses:[],constraintResponses:[],products:[],metrics:new Map()};prepared.layouts.set(key,layout);}
      reactions={captureActive:true};correction=this.#unilateralDelta(L,rows,values,inequalities,reactions,layout);
      const unloaded=footRows.filter(r=>!(reactions[r.key]>1e-10));if(!unloaded.length)break;
      for(const r of unloaded)released.add(r.key);
    }
    const velocity=Float64Array.from(unconstrained,(value,i)=>value+correction[i]);
    const active=reactions.active??[],metricKey=active.map(a=>a.index).join(',');let metric=layout?.metrics.get(metricKey);
    if(!metric){
      const activeRows=active.map(a=>inequalities[a.index].row);
      const equalityResponse=row=>{
        const free=solve(L,row),reaction=this.#constraintDelta(L,rows,rows.map(r=>-dot(r,free)));
        return Float64Array.from(free,(value,i)=>value+reaction.delta[i]);
      };
      const activeResponses=activeRows.map(equalityResponse),activeFactor=active.length?factor(activeRows.map((row,i)=>Float64Array.from(activeRows,(_,j)=>dot(row,activeResponses[j])+(i===j?1e-10:0)))):null;
      const response=row=>{
        const result=equalityResponse(row);if(!activeFactor)return result;
        const lambda=solve(activeFactor,activeRows.map(r=>-dot(r,result)));
        for(let j=0;j<active.length;j++)for(let i=0;i<N;i++)result[i]+=activeResponses[j][i]*lambda[j];return result;
      };
      const normalDelta=response(normalRow),tangentDelta=response(tangentRow);
      metric={normal:dot(normalRow,normalDelta),tangent:dot(tangentRow,tangentDelta),cross:dot(normalRow,tangentDelta)};
      if(layout)layout.metrics.set(metricKey,metric);
    }
    const multipliers=new Map(active.map(a=>[a.index,a.lambda]));let diagnostics;
    if(compact){
      let minMultiplier=Infinity,minSlack=Infinity,maxComplementarity=0;
      for(let index=0;index<inequalities.length;index++){
        const c=inequalities[index],multiplier=multipliers.get(index)??0,slack=dot(c.row,correction)-c.value;
        minMultiplier=Math.min(minMultiplier,multiplier);minSlack=Math.min(minSlack,slack);
        maxComplementarity=Math.max(maxComplementarity,Math.abs(multiplier*slack));
      }
      diagnostics={constraintSummary:{minMultiplier,minSlack,maxComplementarity}};
    }else diagnostics={constraints:inequalities.map((c,index)=>({index,foot:c.floorKey??null,multiplier:multipliers.get(index)??0,
      slack:dot(c.row,correction)-c.value,row:Array.from(c.row),targetVelocity:c.value+dot(c.row,unconstrained)}))};
    return {velocity,deltaVelocity:Float64Array.from(velocity,(value,i)=>value-initial[i]),impulse:{x:px,y:py},generalized:Array.from(generalized),
      pointVelocityBefore:{...prepared.pointVelocityBefore},pointVelocityAfter:{x:dot(jx,velocity),y:dot(jy,velocity)},
      normal:metric.normal,tangent:metric.tangent,cross:metric.cross,
      energyBefore:prepared.energyBefore,energyAfter:prepared.energy(velocity),releasedFeet:[...released],footRows:footRows.map(r=>({...r})),constraintImpulses:reactions.constraints.slice(),
      groundImpulses:{footF:reactions.footF??0,footB:reactions.footB??0},activeSet:active.map(a=>a.index),...diagnostics};
  }

  reactImpulse({point:hit,impulse,body='weapon'}={}){
    const trial=this.trialContactImpulse({body,point:hit,impulse,compact:true});if(!trial)return false;
    this.velocity.set(trial.velocity);
    for(const c of this.contacts)c.groundReaction=(c.groundReaction??0)+(trial.groundImpulses[c.key]??0)/RIG_STEP;
    this.#recordTangentialReaction(trial.footRows,trial.constraintImpulses);
    this.lastImpulse={body,point:{x:hit.x,y:hit.y},impulse:{...trial.impulse},generalized:trial.generalized.slice(),time:this.time};
    return true;
  }

  pose(){
    const state=this.#kinematics(),pose={};
    for(const [key,p] of Object.entries(state.points))pose[key]={x:p.x,y:p.y,z:this.depth[key]??0};
    const bodyDepth=this.bodyDepth,armDepth=this.#armDepthMotion.position;
    if(bodyDepth!==0||armDepth!==0||this.#depthFeet)for(const [key,p] of Object.entries(pose)){
      p.z=translatedDepth(p.z,this.#pointDepthOffset(key,bodyDepth,armDepth));
    }
    pose.feet={};
    for(const [side,suffix] of [['front','F'],['back','B']]){
      const f=state.feet[side],a=f.angle,c=Math.cos(a),sn=Math.sin(a),key='ankle'+suffix,z=this.depth[key],s=this.scale;
      const offset=this.#pointDepthOffset(key,bodyDepth,armDepth);
      const position=p=>({x:p.x,y:p.y,z:translatedDepth(z+this.dir*(f.shape.minZ+f.shape.maxZ)/2*s,offset)});pose['foot'+suffix].z=position(f.center).z;
      const support=this.contacts.find(c=>c.key==='foot'+suffix);
      pose.feet[side]={matrix:new Float64Array([this.dir*c*s,sn*s,0,0,-this.dir*sn*s,c*s,0,0,0,0,this.dir*s,0,f.ankle.x,f.ankle.y,translatedDepth(z,offset),1]),
        heel:position(f.heel),toe:position(f.toe),center:position(f.center),support:position(f.support),hull:f.hull.map(position),depth:(f.shape.maxZ-f.shape.minZ)*s,height:f.shape.height*s,angle:a,stance:this.isBodyAttached(side+'Foot')&&f.support.y<=TABLE_TOP+.002,groundReaction:support?.groundReaction??0};
    }
    const headBaseZ=translatedDepth(this.depth.head,bodyDepth);
    pose.neckPivot={...pose.shoulder,z:headBaseZ};
    pose.head.z=this.#headDepth();
    pose.headBaseZ=headBaseZ;pose.neckYawTarget=this.neckLateral.target;pose.neckLateral={...this.neckLateral};
    pose.defenseDepth={...this.defenseDepth};pose.defenseDepthTarget=this.defenseDepth.target;
    const defense=getDefense(this.equipment);if(defense.kind==='shield'&&!this.twoHanded)pose.shieldDepth={min:pose.offHand.z+defense.guardDepthMin,max:pose.offHand.z+defense.guardDepthMax};
    pose.shieldRadius=this.shieldRadius;pose.shieldRadiusX=this.shieldRadiusX;pose.shieldRadiusY=this.shieldRadiusY;
    pose.equipment={...this.equipment};pose.twoHanded=this.twoHanded;pose.gripOffset=this.gripOffset;
    pose.angles={...state.angles};pose.bodyFrames=Object.fromEntries(Object.entries(state.frames).map(([name,f])=>[name,{...f,origin:{...f.origin},end:{...f.end},center:{...f.center}}]));
    pose.wristAngle=this.q[13];pose.dynamic=true;pose.passive=this.passive;pose.apron=this.apron?.snapshot();
    if(state.weaponCurve){const z=translatedDepth(this.depth.tip,this.weaponDepthOffset);pose.weaponCurve=state.weaponCurve.map(p=>({x:p.x,y:p.y,z}));pose.weaponCurve[0]={...pose.mainHand};pose.weaponFlex={offset:this.weaponFlex.offset,length:this.swordLength};pose.weaponRootDirection={...state.weaponRootDirection,z:0};}
    if(bodyDepth!==0)pose.bodyDepth=bodyDepth;
    if(armDepth!==0)pose.weaponDepthOffset=this.weaponDepthOffset;
    if(this.jointDamageVersion){pose.joints=Object.fromEntries(Object.entries(this.jointDamage).map(([name,record])=>[name,{damage:record.damage,detached:record.detached}]));pose.detached=this.fragments.map(f=>f.snapshot());}
    if(this.#surfaceSnapshot)pose.surface=this.#surfaceSnapshot(pose,this);
    return pose;
  }

  diagnostics(){
    const state=this.#kinematics(),M=this.#matrix(state);
    const selfContacts=this.#selfContacts(state).map(c=>({...c,normalVelocity:dot(this.#selfContactRow(state,c),this.velocity)}));
    return {passive:this.passive,neckLateral:{...this.neckLateral},minimumWeaponY:Math.min(...this.#floorSamples(state).filter(p=>p.body==='weapon').map(p=>p.y)),minimumGroundY:Math.min(...this.#floorSamples(state).map(p=>p.y)),coordinates:names.map((name,i)=>({name,position:this.q[i],velocity:this.velocity[i],target:this.target[i],min:this.limits[i][0],max:this.limits[i][1]})),
      bodies:state.bodies.map(b=>({name:b.name,mass:b.mass,inertia:b.inertia,center:{x:b.center.x,y:b.center.y}})),massMatrix:M.map(row=>Array.from(row)),
      contacts:this.contacts.map(c=>{const f=state.feet[c.key==='footF'?'front':'back'],p=f.support,anchor=c.x+this.dir*p.localX*this.scale;
        const grounded=p.y<=TABLE_TOP+.002;
        return {...c,support:{x:p.x,y:p.y},supportX:anchor,grounded,error:c.stance&&grounded?Math.abs(p.x-anchor):0,targetError:distance(c,state.points[c.key])};}),waterLoad:{...this.waterLoad,offset:{...this.waterLoad.offset}},time:this.time,
      kineticEnergy:.5*this.velocity.reduce((sum,v,i)=>sum+v*dot(M[i],this.velocity),0),gravityTorque:Array.from(this.lastGravity),motorTorque:Array.from(this.lastMotor),
      contactReaction:this.lastReaction.slice(),lastImpulse:this.lastImpulse,droppedTime:this.droppedTime||0,
      selfContacts,maxSelfPenetration:Math.max(0,...selfContacts.map(c=>c.penetration)),selfContactImpulse:this.lastSelfContactImpulse};
  }
}

const NATIVE_FLUID_COLLISION_SOLIDS_AT=ArticulatedRig.prototype.collisionSolidsAt;
const NATIVE_CONTACT_QUERY_METHODS=Object.freeze(Object.fromEntries(
  ['createContactImpulseQuery','trialContactImpulse','reactImpulse','pointVelocity'].map(name=>[name,ArticulatedRig.prototype[name]])));

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
