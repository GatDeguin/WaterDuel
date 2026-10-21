/** Scalar motor intention only. Arena limits, separation and physical support
 * remain with the caller and articulated rig. No position is written here. */
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function advanceLocomotion(velocity,input,dt,{dir=1,strength=1,enabled=true,maxSpeed=.65,acceleration=3}={}){
  let h=Number.isFinite(dt)?Math.max(0,dt):0;
  const health=Number.isFinite(strength)?clamp(strength,0,1):0;
  const limit=(Number.isFinite(maxSpeed)?Math.max(0,maxSpeed):.65)*health,rate=Number.isFinite(acceleration)?Math.max(0,acceleration):3;
  if(!enabled||limit===0)return 0;
  const axis=Number.isFinite(input)?clamp(input,-1,1):0;
  const target=axis*(dir<0?-1:1)*limit;
  let speed=clamp(Number.isFinite(velocity)?velocity:0,-limit,limit);
  if(h===0||rate===0)return speed;
  // Consume the braking portion before accelerating in the opposite direction.
  // Carrying the remaining time makes a held gesture independent of partitions.
  if(speed*target<0){
    const reversalBrake=rate*2.2,timeToStop=Math.abs(speed)/reversalBrake;
    if(h<timeToStop)return speed-Math.sign(speed)*reversalBrake*h;
    h-=timeToStop;speed=0;
  }
  const delta=target-speed,stepRate=Math.abs(target)<Math.abs(speed)?rate*1.8:rate;
  const change=Math.min(Math.abs(delta),stepRate*h);
  if(change>=Math.abs(delta))return target===0?0:target;
  return clamp(speed+Math.sign(delta)*change,-limit,limit);
}
