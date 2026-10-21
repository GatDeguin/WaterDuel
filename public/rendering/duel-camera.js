/** Deterministic presentation camera. All time comes from the simulation
 * snapshot, so seeking a replay never depends on render history or wall time.
 * The overview preserves the authored workshop lens and axis. Countdown
 * dollies into a stable, closer combat composition; rounds bridge back out.
 */
const FOV=.473115634607783;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const time=value=>Number.isFinite(value)?Math.max(0,value):0;
const smooth=value=>{const t=clamp(value,0,1);return t*t*t*(t*(t*6-15)+10);};
const ENVELOPE=[];
for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6])ENVELOPE.push([x,y,z]);

function burstOrbit(eye,baseTarget,fov,aspect,phaseClock,side,focus){
  if(phaseClock<=.4||phaseClock>=2.35)return null;
  const weight=smooth((phaseClock-.4)/.65)*(1-smooth((phaseClock-1.7)/.65));
  if(weight<=0)return null;
  const target=baseTarget.slice();
  if(focus&&Number.isFinite(focus.x)&&Number.isFinite(focus.y)&&Number.isFinite(focus.z??0)){
    target[0]+=clamp((clamp(focus.x,-3.7,3.7)-target[0])*.10,-.18,.18)*weight;
    target[1]+=clamp((clamp(focus.y,.3245,3.8)-target[1])*.15,-.18,.18)*weight;
    target[2]+=clamp(((focus.z??0)-target[2])*.20,-.1,.1)*weight;
  }
  const offset=eye.map((value,index)=>value-baseTarget[index]),radius=Math.hypot(...offset),angle=side*(8*Math.PI/180)*weight,
    c=Math.cos(angle),s=Math.sin(angle),direction=[(offset[0]*c+offset[2]*s)/radius,offset[1]/radius+.025*weight,(offset[2]*c-offset[0]*s)/radius],
    length=Math.hypot(...direction);
  for(let i=0;i<3;i++)direction[i]/=length;
  const forward=direction.map(value=>-value),rightLength=Math.hypot(direction[0],direction[2]),right=[direction[2]/rightLength,0,-direction[0]/rightLength],
    up=[right[1]*forward[2]-right[2]*forward[1],right[2]*forward[0]-right[0]*forward[2],right[0]*forward[1]-right[1]*forward[0]],
    orbitFov=fov+2*Math.PI/180*weight,tangent=Math.tan(orbitFov/2);
  let distance=radius*(1-.11*weight);
  // The orbit changes depth at the far shoulder. Fit the same full envelope
  // used by the static camera, rather than cropping the other duelist to zoom.
  for(const point of ENVELOPE){
    const x=point[0]-target[0],y=point[1]-target[1],z=point[2]-target[2],depth=x*forward[0]+y*forward[1]+z*forward[2];
    distance=Math.max(distance,Math.abs(x*right[0]+y*right[1]+z*right[2])/(tangent*aspect*.93)-depth,
      Math.abs(x*up[0]+y*up[1]+z*up[2])/(tangent*.85)-depth);
  }
  return {eye:target.map((value,index)=>value+direction[index]*distance),target,fov:orbitFov,weight,distance};
}

function readyMotion(clock){
  const weight=smooth(clock/2);
  return {x:.16*Math.sin(clock*.26)*weight,y:.035*Math.sin(clock*.19)*weight,
    z:.24*(.5-.5*Math.cos(clock*.23))*weight,weight};
}

export function duelCamera({phase='ready',phaseClock=0,clock=0,round=1,replay=false,cameraMode='combat',aspect=16/9,reducedMotion=false,burstFocus=null}={}){
  aspect=Number.isFinite(aspect)&&aspect>0?clamp(aspect,.05,20):16/9;
  clock=time(clock);phaseClock=time(phaseClock);
  const detail=cameraMode==='detail'&&(replay||phase!=='fight'&&phase!=='countdown');
  let fov=detail?38*Math.PI/180:FOV;
  const burstBridge=phaseClock>=3.25?1:phaseClock<=2.6?0:smooth((phaseClock-2.6)/.65);
  const close=reducedMotion||phase==='fight'?1:phase==='countdown'?smooth(phaseClock/2.4):phase==='burst'?1-burstBridge:0;
  const stagingDistance=11.503400802612305+(10.4-11.503400802612305)*close;
  const distance=detail?Math.max(4.8,2.5/(Math.tan(fov/2)*aspect*.88)):Math.max(stagingDistance,3.7/(Math.tan(fov/2)*aspect*.88));
  let target=detail?[0,2.3,0]:[.01055110991,1.937289834+(1.9-1.937289834)*close,-.07254123688];
  let eye=detail?[0,target[1]+distance*.14,distance]:[.09693878144,target[1]-.025031*(distance+.07254123688),distance];
  let motionWeight=0;
  if(!detail&&!reducedMotion&&phase!=='fight'){
    let motion={x:0,y:0,z:0,weight:0};
    const side=Number.isFinite(round)&&Math.floor(round)%2===0?-1:1;
    if(phase==='ready'||phase==='matchover')motion=readyMotion(clock);
    else if(phase==='countdown'){
      const fade=1-smooth(phaseClock/2.4),ready=readyMotion(clock);
      motion={x:ready.x*fade,y:ready.y*fade,z:ready.z*fade,weight:ready.weight*fade};
    }else if(phase==='burst'){
      // Recover the original combat composition at 2.35 s, then preserve the
      // existing staging/countdown boundary after the brief settled view.
      const ready=readyMotion(clock);
      motion={x:ready.x*burstBridge,y:ready.y*burstBridge,z:ready.z*burstBridge,weight:ready.weight*burstBridge};
    }
    eye[0]+=motion.x;eye[1]+=motion.y;eye[2]+=motion.z;motionWeight=motion.weight;
    if(phase==='burst'){
      const orbit=burstOrbit(eye,target,fov,aspect,phaseClock,side,burstFocus);
      if(orbit){eye=orbit.eye;target=orbit.target;fov=orbit.fov;motionWeight=orbit.weight;}
    }
  }
  return {eye,target,fov,near:.1,far:Math.max(64,distance+32),detail,motionWeight};
}
