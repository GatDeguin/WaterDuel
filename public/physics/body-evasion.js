/** Left-stick posture intentions. The rig solves the resulting hip/neck goals;
 * this module never rewrites a rendered pose or grants collision immunity.
 */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const CROUCH_DEPTH=.29;
export const FEINT_DURATION=.85;
export const FEINT_PEAK_FRACTION=.38;
export function advanceBodyEvasion(f,input,dt,enabled){
  const e=f.evasion??={crouch:0,feint:0,age:-1,latched:false,cooldown:0};
  const y=enabled&&Number.isFinite(input)?clamp(input,-1,1):0;
  const h=Number.isFinite(dt)?Math.max(0,dt):0;
  // Preserve an existing semantic state when the physical motor is first added.
  if(!Number.isFinite(e.motorCrouch))e.motorCrouch=clamp(Number.isFinite(e.crouch)?e.crouch:0,0,1);
  if(!Number.isFinite(e.motorCrouchVelocity))e.motorCrouchVelocity=0;
  const crouchTarget=Math.max(0,-y),crouchRate=crouchTarget>e.crouch?12:8;
  e.crouch+=(crouchTarget-e.crouch)*(1-Math.exp(-crouchRate*h));
  if(e.crouch<1e-12)e.crouch=0;
  // Intent remains fast; only the physical hip target has world-space limits.
  const scale=f.boss?1.18:1,depth=CROUCH_DEPTH*scale;
  const desiredV=clamp((crouchTarget-e.motorCrouch)*crouchRate,-.8/depth,.8/depth);
  if(h>0){
    const acceleration=5/depth,dh=acceleration*h,maxSpeed=.8/depth;
    const nextVelocity=e.motorCrouchVelocity+clamp(desiredV-e.motorCrouchVelocity,-dh,dh);
    // Brake for the material bounds, without snapping to an interior target.
    const safeSpeed=distance=>Math.max(0,Math.sqrt(dh*dh+2*acceleration*distance)-dh);
    e.motorCrouchVelocity=clamp(nextVelocity,-Math.min(maxSpeed,safeSpeed(e.motorCrouch)),Math.min(maxSpeed,safeSpeed(1-e.motorCrouch)));
    e.motorCrouch=clamp(e.motorCrouch+e.motorCrouchVelocity*h,0,1);
  }
  e.cooldown=Math.max(0,e.cooldown-h);
  if(y<.20)e.latched=false;
  if(enabled&&y>.55&&!e.latched){
    e.latched=true;
    if(e.age<0&&e.cooldown===0){e.age=0;e.cooldown=1.05;}
  }
  if(!enabled)e.age=-1;
  if(e.age>=0){e.age+=h;if(e.age>=FEINT_DURATION-Number.EPSILON*FEINT_DURATION)e.age=-1;}
  if(e.age<0)e.feint=0;
  else{
    const peak=FEINT_DURATION*FEINT_PEAK_FRACTION,t=e.age<=peak?e.age/peak:(e.age-peak)/(FEINT_DURATION-peak);
    const smooth=t*t*(3-2*t);
    e.feint=e.age<=peak?smooth:1-smooth;
  }
  return e;
}
