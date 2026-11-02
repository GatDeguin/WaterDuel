import {matrixCamera,burstCameraFocus as waterFocus} from './matrix-camera.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=v=>{const t=clamp(v,0,1);return t*t*t*(t*(t*6-15)+10);};
const finitePoint=p=>p&&[p.x,p.y,p.z??0].every(Number.isFinite);
const envelope=[];
for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6])envelope.push([x,y,z]);

/** The centroid may flow across the stage. The rupture origins retain the
 * camera's side and distinguish a pair of bursts from a single close-up. */
export function directedBurstFocus(game){
  const focus=waterFocus(game);if(!focus)return null;
  const origins=[];let firstSlot=0;
  for(const fighter of game.fighters??[]){
    const p=fighter.fluid?.impact;if(fighter.globIntact!==false||!finitePoint(p))continue;
    if(!origins.length)firstSlot=fighter.slot;
    origins.push({x:clamp(p.x,-8,8),y:clamp(p.y,-2,8),z:clamp(p.z??0,-8,8)});
  }
  if(!origins.length||origins.length>2)return focus;
  const shotSide=origins.length===2?1:origins[0].x<-.15?-1:origins[0].x>.15?1:firstSlot===1?-1:1;
  return {...focus,origins,impactCount:origins.length,shotSide};
}

const directed=focus=>finitePoint(focus)&&[1,2].includes(focus.impactCount)&&[-1,1].includes(focus.shotSide)&&
  Array.isArray(focus.origins)&&focus.origins.length===focus.impactCount&&focus.origins.every(finitePoint);

function pairCamera(options,time){
  const base=matrixCamera({...options,phase:'fight'}),focus=options.burstFocus;
  const weight=smooth((time-.06)/.64)*(1-smooth((time-1.55)/1.05)),travel=smooth((time-.35)/1.25);
  const target=base.target.map((v,i)=>v+(clamp([focus.x,focus.y,focus.z??0][i],[-3.7,.3245,-.6][i],[3.7,3.8,.6][i])-v)*[.12,.18,.12][i]*weight);
  const offset=base.eye.map((v,i)=>v-base.target[i]),radius=Math.hypot(...offset),angle=(26+16*travel)*Math.PI/180*weight,c=Math.cos(angle),s=Math.sin(angle);
  const direction=[(offset[0]*c+offset[2]*s)/radius,offset[1]/radius+.13*Math.cos(Math.PI*.5*travel)*weight,(offset[2]*c-offset[0]*s)/radius];
  const length=Math.hypot(...direction);for(let i=0;i<3;i++)direction[i]/=length;
  const forward=direction.map(v=>-v),rightLength=Math.hypot(direction[0],direction[2]),right=[direction[2]/rightLength,0,-direction[0]/rightLength];
  const up=[right[1]*forward[2]-right[2]*forward[1],right[2]*forward[0]-right[0]*forward[2],right[0]*forward[1]-right[1]*forward[0]];
  const aspect=Number.isFinite(options.aspect)&&options.aspect>0?clamp(options.aspect,.05,20):16/9;
  const fov=base.fov+5*Math.PI/180*weight,tangent=Math.tan(fov/2);
  let distance=radius*(1-.12*weight);
  // A simultaneous pair must retain the whole duel rather than zoom into an
  // empty average between two heads. Fit real origins as well as the bodies.
  const fit=point=>{
    const p=point.map((v,i)=>v-target[i]),depth=p[0]*forward[0]+p[1]*forward[1]+p[2]*forward[2];
    distance=Math.max(distance,Math.abs(p[0]*right[0]+p[1]*right[1]+p[2]*right[2])/(tangent*aspect*.93)-depth,Math.abs(p[0]*up[0]+p[1]*up[1]+p[2]*up[2])/(tangent*.85)-depth);
  };
  for(const point of envelope)fit(point);
  for(const origin of focus.origins)fit([origin.x,origin.y,origin.z??0]);
  return {...base,eye:target.map((v,i)=>v+direction[i]*distance),target,fov,far:Math.max(base.far,distance+32),motionWeight:weight};
}

export function directedBurstCamera(options={}){
  const time=Number.isFinite(options.phaseClock)?Math.max(0,options.phaseClock):0;
  if(options.phase!=='burst'||time<=.06||time>=2.6||options.reducedMotion||options.cameraMode==='detail'||!directed(options.burstFocus))return matrixCamera(options);
  return options.burstFocus.impactCount===2?pairCamera(options,time):matrixCamera({...options,round:options.burstFocus.shotSide===1?1:2});
}

/** A real campaign finale resolves into an authored, stationary full-stage
 * portrait. The trophy is physical scenery; the camera adds no screen UI. */
export function ceremonyCamera(camera,options={}){
  const ceremony=options.ceremony;
  if(options.phase!=='matchover'||options.demonstration||options.replay||options.reducedMotion||options.cameraMode==='detail'||
    !ceremony||!Number.isFinite(ceremony.age)||ceremony.age<0||
    !(ceremony.tier==='normal'&&ceremony.trophy==='champion'||ceremony.tier==='advanced'&&ceremony.trophy==='master'))return camera;
  const weight=smooth(ceremony.age/1.6);if(weight===0)return camera;
  const aspect=Number.isFinite(options.aspect)&&options.aspect>0?clamp(options.aspect,.05,20):16/9,heroFov=32*Math.PI/180;
  const heroTarget=[0,1.8,.04],heroDistance=Math.max(10.4,3.7/(Math.tan(heroFov/2)*aspect*.88)),unit=Math.hypot(.1,1);
  const heroEye=[0,heroTarget[1]+.1/unit*heroDistance,heroTarget[2]+heroDistance/unit];
  const target=weight===1?heroTarget:camera.target.map((v,i)=>v+(heroTarget[i]-v)*weight);
  const startEye=weight===1?heroEye:camera.eye.map((v,i)=>v+(heroEye[i]-v)*weight),offset=startEye.map((v,i)=>v-target[i]);
  let distance=Math.hypot(...offset);const direction=offset.map(v=>v/distance),forward=direction.map(v=>-v),rightLength=Math.hypot(direction[0],direction[2]);
  const right=[direction[2]/rightLength,0,-direction[0]/rightLength],up=[right[1]*forward[2]-right[2]*forward[1],right[2]*forward[0]-right[0]*forward[2],right[0]*forward[1]-right[1]*forward[0]];
  const fov=weight===1?heroFov:camera.fov+(heroFov-camera.fov)*weight,tangent=Math.tan(fov/2);
  for(const point of envelope){
    const p=point.map((v,i)=>v-target[i]),depth=p[0]*forward[0]+p[1]*forward[1]+p[2]*forward[2];
    distance=Math.max(distance,Math.abs(p[0]*right[0]+p[1]*right[1]+p[2]*right[2])/(tangent*aspect*.93)-depth,Math.abs(p[0]*up[0]+p[1]*up[1]+p[2]*up[2])/(tangent*.85)-depth);
  }
  return {...camera,eye:target.map((v,i)=>v+direction[i]*distance),target,fov,far:Math.max(camera.far,distance+32),motionWeight:camera.motionWeight*(1-weight)};
}
