/** Idle motor intentions only. The articulated solver must consume these
 * before stepping: never apply them to rendered bones or water after physics.
 * Feet/base/attack/guard stay untouched; any human intent wins immediately.
 */
const axes=['mainX','mainY','offX','offY','lean','wrist','headX','headZ','bodyY'];
const neutral=()=>({mainX:0,mainY:0,offX:0,offY:0,lean:0,wrist:0,headX:0,headZ:0,thrust:false,guard:false,attackHeld:false});
const time=value=>Number.isFinite(value)?Math.max(0,value):0;
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*t*(t*(t*6-15)+10);};
const bump=value=>{const t=Math.max(0,Math.min(1,value));return 64*t*t*t*(1-t)*(1-t)*(1-t);};

export function standbyTargets({phase='ready',clock=0,phaseClock=0,round=1,slot=1,controller={},globIntact=true,passive=false,reducedMotion=false}={}){
  if(!['ready','countdown'].includes(phase)||!globIntact||passive||reducedMotion)return null;
  if(controller?.thrust||controller?.guard||controller?.attackHeld||axes.some(axis=>Number.isFinite(controller?.[axis])&&Math.abs(controller[axis])>1e-4))return null;
  clock=time(clock);phaseClock=time(phaseClock);
  const amplitude=smooth(clock/2)*(phase==='countdown'?(round>1?bump(phaseClock/2.4):1-smooth(phaseClock/2.4)):1);
  if(amplitude===0)return neutral();
  const t=clock,offset=slot===2?1.9:0,wave=(magnitude,frequency,phase=0)=>magnitude*amplitude*Math.sin(t*frequency+offset+phase);
  return {mainX:wave(.012,.83),mainY:wave(.022,1.13),offX:wave(.008,.71,.9),offY:wave(.018,1.13,.7),
    lean:0,wrist:wave(.012,.67),headX:wave(.012,.59),headZ:wave(.008,.47,.4),thrust:false,guard:false,attackHeld:false};
}
