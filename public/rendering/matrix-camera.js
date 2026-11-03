import {duelCamera} from './duel-camera.js';
import {TABLE_TOP} from '../physics/dimensions.js';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const smooth=v=>{const t=clamp(v,0,1);return t*t*t*(t*(t*6-15)+10);};
const envelope=[];
for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6])envelope.push([x,y,z]);

/** Start at the rupture, then follow its recorded water volume as it falls.
 * Replay snapshots carry the same parcels; no empty head or history is used. */
export function burstCameraFocus(game){
  if(game?.phase!=='burst')return null;
  const time=Number.isFinite(game.phaseClock)?game.phaseClock:0,follow=smooth((time-.25)/1.05);
  let x=0,y=0,z=0,count=0;
  for(const fighter of game.fighters??[]){
    const impact=fighter.fluid?.impact;
    if(fighter.globIntact!==false||!impact||![impact.x,impact.y,impact.z??0].every(Number.isFinite))continue;
    const ix=clamp(impact.x,-8,8),iy=clamp(impact.y,-2,8),iz=clamp(impact.z??0,-8,8);
    let wx=0,wy=0,wz=0,volume=0;
    if(follow>0)for(const parcel of fighter.fluid.particles??[]){
      const mass=parcel.volume,pz=parcel.z??0;
      if(!Number.isFinite(mass)||mass<=0||!Number.isFinite(parcel.x)||!Number.isFinite(parcel.y)||!Number.isFinite(pz))continue;
      wx+=parcel.x*mass;wy+=parcel.y*mass;wz+=pz*mass;volume+=mass;
    }
    const water=volume>0&&Number.isFinite(volume)&&Number.isFinite(wx)&&Number.isFinite(wy)&&Number.isFinite(wz);
    x+=water?ix+(clamp(wx/volume,-8,8)-ix)*follow:ix;
    y+=water?iy+(clamp(wy/volume,-2,8)-iy)*follow:iy;
    z+=water?iz+(clamp(wz/volume,-8,8)-iz)*follow:iz;count++;
  }
  return count?{x:x/count,y:y/count,z:z/count}:null;
}

/** Impact detail and a progressive orbit over the real-time rupture clock.
 * Only framing changes: the solver, particles and round clock stay untouched. */
export function matrixCamera(options={}){
  const phaseClock=Number.isFinite(options.phaseClock)?Math.max(0,options.phaseClock):0;
  if(options.phase!=='burst'||phaseClock<=.06||phaseClock>=2.6||options.reducedMotion||options.cameraMode==='detail')return duelCamera(options);
  const base=duelCamera({...options,phase:'fight',cameraMode:'combat'}),target=base.target.slice();
  const weight=smooth((phaseClock-.06)/.64)*(1-smooth((phaseClock-1.55)/1.05)),travel=smooth((phaseClock-.35)/1.25);
  const recorded=options.burstFocus,valid=recorded&&[recorded.x,recorded.y,recorded.z??0].every(Number.isFinite);
  const focus=valid?[clamp(recorded.x,-3.7,3.7),clamp(recorded.y,.3245,3.8),clamp(recorded.z??0,-.6,.6)]:[0,2.65,0];
  for(let i=0;i<3;i++)target[i]+=(focus[i]-target[i])*.92*weight;
  const offset=base.eye.map((v,i)=>v-base.target[i]),radius=Math.hypot(...offset),side=Number.isFinite(options.round)&&Math.floor(options.round)%2===0?-1:1;
  const angle=side*(25+37*travel)*Math.PI/180*weight,c=Math.cos(angle),s=Math.sin(angle);
  // Rise over the impact, then descend around its flank rather than holding a
  // static three-quarter shot while the physical explosion unfolds.
  const lift=(.28*Math.cos(Math.PI*travel)-.025)*weight;
  const direction=[(offset[0]*c+offset[2]*s)/radius,offset[1]/radius+lift,(offset[2]*c-offset[0]*s)/radius],length=Math.hypot(...direction);
  for(let i=0;i<3;i++)direction[i]/=length;
  const forward=direction.map(v=>-v),rightLength=Math.hypot(direction[0],direction[2]),right=[direction[2]/rightLength,0,-direction[0]/rightLength];
  const up=[right[1]*forward[2]-right[2]*forward[1],right[2]*forward[0]-right[0]*forward[2],right[0]*forward[1]-right[1]*forward[0]];
  const aspect=Number.isFinite(options.aspect)&&options.aspect>0?clamp(options.aspect,.05,20):16/9;
  const fov=base.fov+8*Math.PI/180*weight,tangent=Math.tan(fov/2);
  let distance=radius*(1-.50*weight);
  for(const point of envelope){
    // Morph the full duel into a padded impact volume. Close-ups deliberately
    // crop the bodies; the water/latex origin stays framed even in portrait.
    // The same continuous weight restores the full envelope before 2.6 s.
    const detailX=focus[0]+Math.sign(point[0])*1.15,detailY=focus[1]+(point[1]>.4?1.1:-1.1),detailZ=focus[2]+Math.sign(point[2])*.7;
    const x=point[0]+(detailX-point[0])*weight-target[0],y=point[1]+(detailY-point[1])*weight-target[1],z=point[2]+(detailZ-point[2])*weight-target[2],depth=x*forward[0]+y*forward[1]+z*forward[2];
    distance=Math.max(distance,Math.abs(x*right[0]+y*right[1]+z*right[2])/(tangent*aspect*.93)-depth,Math.abs(x*up[0]+y*up[1]+z*up[2])/(tangent*.85)-depth);
  }
  const eye=target.map((v,i)=>v+direction[i]*distance);
  // A fixed angular descent grows with portrait's much longer dolly radius.
  // Bound its resulting pitch by the actual focus height and tabletop. Blend
  // from the exact combat elevation, then end the dramatic descent above the
  // action instead of under the opaque stage or looking up at the ceiling.
  eye[1]=Math.max(eye[1],TABLE_TOP+.45,base.eye[1]+(target[1]+.18-base.eye[1])*weight);
  return {...base,eye,target,fov,far:Math.max(base.far,distance+32),motionWeight:weight};
}
