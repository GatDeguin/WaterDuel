/** The burst has a real-time timeline and a separate physical timeline.
 * All complete solver steps remain 1/120 physical seconds. The substep debt is
 * bounded by one step; slowing time changes how often a step is due, not the
 * numerical resolution of water, contact or the articulated body.
 */
const slowUntil=1.3,slowRate=.30;
export const burstPhysicalTime=realTime=>Math.min(Math.max(0,realTime),slowUntil)*slowRate+Math.max(0,realTime-slowUntil);
const burstRealTime=physicalTime=>physicalTime<=slowUntil*slowRate?physicalTime/slowRate:slowUntil+physicalTime-slowUntil*slowRate;

export class BurstStepClock{
  constructor(step=1/120){this.step=step;this.reset();}
  reset(){this.start=null;this.origin=null;this.steps=0;this.integrated=0;this.remainder=0;}
  advance(from,to,run,{flush=false}={}){
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return 0;
    if(this.start===null)this.start=burstPhysicalTime(from);
    const target=burstPhysicalTime(to)-this.start;let count=0;
    while((this.steps+1)*this.step<=target+1e-12){
      this.steps++;this.integrated=this.steps*this.step;
      run(this.step,burstRealTime(this.start+this.integrated));count++;
    }
    this.remainder=Math.max(0,target-this.integrated);
    if(flush&&this.remainder>1e-12){
      const rest=this.remainder;this.integrated=target;this.remainder=0;
      run(rest,to);count++;
    }
    return count;
  }
}
