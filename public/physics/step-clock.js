/** Rupture runs at normal speed, using the same real and physical timeline.
 * All complete solver steps remain 1/120 seconds. The substep debt is bounded
 * by one step; presentation may interpolate it without advancing the solvers.
 */
export const burstPhysicalTime=realTime=>Math.max(0,realTime);

export class BurstStepClock{
  constructor(step=1/120){this.step=step;this.reset();}
  reset(){this.start=null;this.origin=null;this.steps=0;this.integrated=0;this.remainder=0;}
  advance(from,to,run,{flush=false}={}){
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return 0;
    if(this.start===null)this.start=burstPhysicalTime(from);
    const target=burstPhysicalTime(to)-this.start;let count=0;
    while((this.steps+1)*this.step<=target+1e-12){
      this.steps++;this.integrated=this.steps*this.step;
      run(this.step,this.start+this.integrated);count++;
    }
    this.remainder=Math.max(0,target-this.integrated);
    if(flush&&this.remainder>1e-12){
      const rest=this.remainder;this.integrated=target;this.remainder=0;
      run(rest,to);count++;
    }
    return count;
  }
}
