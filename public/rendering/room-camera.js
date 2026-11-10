import {cinematicCamera} from './cinematic-camera.js';
import {ARMORY_RACK} from './armory-display.js';
export {burstCameraFocus} from './cinematic-camera.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const validRoom=room=>Array.isArray(room?.min)&&Array.isArray(room.max)&&room.min.length===3&&room.max.length===3&&room.min.every((v,i)=>Number.isFinite(v)&&Number.isFinite(room.max[i])&&v<room.max[i]);

/** Preserve the authored shot whenever it fits. Narrow screens may need a
 * wider lens instead of moving the camera through a completed workshop wall. */
function duelRoomCamera(options){
  const base=cinematicCamera(options),room=options.roomInterior;
  if(!validRoom(room)||base.eye.every((v,i)=>v>=room.min[i]&&v<=room.max[i]))return base;
  const offset=base.eye.map((v,i)=>v-base.target[i]);let entry=0,exit=1;
  for(let i=0;i<3;i++){
    if(Math.abs(offset[i])<1e-12){if(base.target[i]<room.min[i]||base.target[i]>room.max[i])entry=2;continue;}
    const a=(room.min[i]-base.target[i])/offset[i],b=(room.max[i]-base.target[i])/offset[i];entry=Math.max(entry,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
  }
  const eye=entry<=exit&&exit>=0?base.target.map((v,i)=>clamp(v+offset[i]*exit,room.min[i],room.max[i])):base.eye.map((v,i)=>clamp(v,room.min[i],room.max[i]));
  const direction=base.target.map((v,i)=>v-eye[i]),length=Math.hypot(...direction);if(length<1e-8)return base;
  for(let i=0;i<3;i++)direction[i]/=length;
  const horizontal=Math.hypot(direction[0],direction[2]);if(horizontal<1e-8)return base;
  const right=[-direction[2]/horizontal,0,direction[0]/horizontal],up=[right[1]*direction[2]-right[2]*direction[1],right[2]*direction[0]-right[0]*direction[2],right[0]*direction[1]-right[1]*direction[0]];
  const aspect=Number.isFinite(options.aspect)&&options.aspect>0?clamp(options.aspect,.05,20):16/9;
  const close=options.phase==='burst'&&options.phaseClock>.06&&options.phaseClock<2.6&&!options.reducedMotion&&options.cameraMode!=='detail'&&options.burstFocus?.impactCount!==2?base.motionWeight:0;
  const recorded=options.burstFocus,focus=recorded&&[recorded.x,recorded.y,recorded.z??0].every(Number.isFinite)?[clamp(recorded.x,-3.7,3.7),clamp(recorded.y,.3245,3.8),clamp(recorded.z??0,-.6,.6)]:[0,2.65,0];
  let tangent=Math.tan(base.fov/2);
  for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6]){
    const p=[x+(focus[0]+Math.sign(x)*1.15-x)*close,y+(focus[1]+(y>.4?1.1:-1.1)-y)*close,z+(focus[2]+Math.sign(z)*.7-z)*close].map((v,i)=>v-eye[i]);
    const depth=p[0]*direction[0]+p[1]*direction[1]+p[2]*direction[2];
    if(depth>1e-8)tangent=Math.max(tangent,Math.abs(p[0]*right[0]+p[1]*right[1]+p[2]*right[2])/(depth*aspect*.93),Math.abs(p[0]*up[0]+p[1]*up[1]+p[2]*up[2])/(depth*.85));
  }
  return {...base,eye,fov:2*Math.atan(tangent),roomConstrained:true};
}

/** Rotate the interior camera toward the physical equipment bay. The renderer
 * supplies presentation progress so a paused simulation can still pan. */
export function roomCamera(options={}){
  const duel=duelRoomCamera(options);
  const progress=Number.isFinite(options.armoryProgress)?clamp(options.armoryProgress,0,1):0;
  const phase=options.phase??'ready';
  if(!progress||options.replay||phase!=='ready'&&phase!=='matchover')return duel;
  const rack=ARMORY_RACK,room=options.roomInterior;
  const target=[rack.x-.11,rack.y,rack.z];
  const eye=[rack.eyeX,rack.y,rack.z];
  if(validRoom(room))for(let i=0;i<3;i++)eye[i]=clamp(eye[i],room.min[i],room.max[i]);
  const aspect=Number.isFinite(options.aspect)&&options.aspect>0?clamp(options.aspect,.05,20):16/9;
  const right=Number.isFinite(options.armoryInset?.right)?clamp(options.armoryInset.right,0,.65):0;
  const bottom=Number.isFinite(options.armoryInset?.bottom)?clamp(options.armoryInset.bottom,0,.65):0;
  const depth=Math.max(.1,rack.nearX-eye[0]);
  const tangent=Math.max(Math.tan(21*Math.PI/180),rack.width/(2*depth*aspect*.85*(1-right)),rack.height/(2*depth*.85*(1-bottom)));
  const mix=(from,to)=>from+(to-from)*progress;
  return {...duel,eye:eye.map((v,i)=>mix(duel.eye[i],v)),target:target.map((v,i)=>mix(duel.target[i],v)),
    fov:mix(duel.fov,2*Math.atan(tangent)),armoryProgress:progress,
    ...(right||bottom?{shiftX:-right*progress,shiftY:bottom*progress}:{})};
}
