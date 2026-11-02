// These are bounded actuator intentions, never animation overrides or hit rules.
// The ordinary articulated solver still decides how far the weapon can move.
export const BOSS_SECOND_PHASE=Object.freeze([
  {id:'withdraw-high',windup:.82,height:.88,wrist:.55,recovery:1.32},
  {id:'draw-low',windup:.88,height:-.70,wrist:-.50,recovery:1.36},
  {id:'false-high',windup:.80,height:.78,wrist:.45,recovery:1.32,feint:.36},
  {id:'overhead',windup:.94,height:1,wrist:.65,recovery:1.48}
].map(Object.freeze));
const patterns=new Map(BOSS_SECOND_PHASE.map(pattern=>[pattern.id,pattern]));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function bossSecondPhasePattern(cycle=0){
  const index=Number.isInteger(cycle)&&cycle>=0?cycle%BOSS_SECOND_PHASE.length:0;
  return BOSS_SECOND_PHASE[index];
}
export function bossSecondPhaseControl({state,time,pattern,twoHanded=false}={}){
  const authored=patterns.get(pattern);
  if(!authored||!Number.isFinite(time)||time<0)return null;
  if(state==='windup'){
    const withdraw=twoHanded?.16:.14,signalEnd=twoHanded?.38:.34;
    if(time<withdraw)return {trackingAim:false,control:{mainX:-.65,mainY:-.28,wrist:-.38,lean:-.35}};
    if(time<signalEnd){
      const phase=clamp((time-withdraw)/(signalEnd-withdraw),0,1),lift=phase*phase*(3-2*phase);
      return {trackingAim:false,control:{mainX:-.25+.40*lift,mainY:-.28+(authored.height+.28)*lift,wrist:-.38+(authored.wrist+.38)*lift,lean:0}};
    }
  }else if(state==='feint'){
    const lift=clamp(time/.18,0,1);
    return {trackingAim:false,control:{mainX:-.25+.50*lift,mainY:.20+.58*lift,wrist:.25,lean:0}};
  }else if(state==='recover'){
    const collect=clamp(time/.28,0,1);
    return {trackingAim:false,control:{mainX:-.95+.35*collect,mainY:-.42+.12*collect,wrist:-.28*(1-collect),lean:1}};
  }
  // Leave the full final settling interval to the existing observed aim loop.
  return null;
}
