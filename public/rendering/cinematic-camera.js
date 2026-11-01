import {matrixCamera} from './matrix-camera.js';
export {burstCameraFocus} from './matrix-camera.js';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const smooth=v=>{const t=clamp(v,0,1);return t*t*t*(t*(t*6-15)+10);};
const envelope=[];
for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6])envelope.push([x,y,z]);

/** The entry crane and round bridge share the same staging pose at a given
 * simulation clock. No render history or extra simulation is required. */
export function cinematicCamera(options={}){
  const base=matrixCamera(options);
  if(options.reducedMotion||options.cameraMode==='detail'||options.phase==='fight')return base;
  const time=Number.isFinite(options.phaseClock)?Math.max(0,options.phaseClock):0;
  const clock=Number.isFinite(options.clock)?Math.max(0,options.clock):0;
  let staging=0,arc=0;
  if(options.phase==='ready'||options.phase==='matchover')staging=1;
  else if(options.phase==='countdown'){
    const progress=clamp(time/2.4,0,1);staging=1-smooth(progress);arc=progress>0&&progress<1?Math.sin(Math.PI*progress)**2:0;
  }else if(options.phase==='burst'&&time>2.6)staging=smooth((time-2.6)/.65);
  if(staging===0&&arc===0)return base;
  const side=Number.isFinite(options.round)&&Math.floor(options.round)%2===0?-1:1;
  // The resting pose must survive the round increment at the bridge boundary.
  // Only the middle of the entry arc alternates sides between rounds.
  const angle=((6+14*Math.sin(clock*.18))*staging+side*22*arc)*Math.PI/180;
  const target=base.target.slice(),offset=base.eye.map((v,i)=>v-base.target[i]),radius=Math.hypot(...offset);
  target[1]+=.05*staging;
  const c=Math.cos(angle),s=Math.sin(angle);
  const direction=[(offset[0]*c+offset[2]*s)/radius,offset[1]/radius+(.65*staging+.45*arc)/radius,(offset[2]*c-offset[0]*s)/radius];
  const length=Math.hypot(...direction);for(let i=0;i<3;i++)direction[i]/=length;
  const forward=direction.map(v=>-v),rightLength=Math.hypot(direction[0],direction[2]),right=[direction[2]/rightLength,0,-direction[0]/rightLength];
  const up=[right[1]*forward[2]-right[2]*forward[1],right[2]*forward[0]-right[0]*forward[2],right[0]*forward[1]-right[1]*forward[0]];
  const aspect=Number.isFinite(options.aspect)&&options.aspect>0?clamp(options.aspect,.05,20):16/9;
  const fov=base.fov+(6*staging+2*arc)*Math.PI/180,tangent=Math.tan(fov/2);
  let distance=radius*(1+.04*staging-.18*arc);
  for(const point of envelope){
    const x=point[0]-target[0],y=point[1]-target[1],z=point[2]-target[2],depth=x*forward[0]+y*forward[1]+z*forward[2];
    distance=Math.max(distance,Math.abs(x*right[0]+y*right[1]+z*right[2])/(tangent*aspect*.93)-depth,Math.abs(x*up[0]+y*up[1]+z*up[2])/(tangent*.85)-depth);
  }
  return {...base,eye:target.map((v,i)=>v+direction[i]*distance),target,fov,far:Math.max(base.far,distance+32),motionWeight:Math.max(staging,arc)};
}
