// These are bounded actuator intentions, never animation overrides or hit rules.
// The ordinary articulated solver still decides how far the weapon can move.
export const BOSS_SECOND_PHASE=Object.freeze([
  {id:'withdraw-high',windup:.82,height:.88,wrist:.55,recovery:1.32},
  {id:'draw-low',windup:.88,height:-.70,wrist:-.50,recovery:1.36},
  {id:'false-high',windup:.80,height:.78,wrist:.45,recovery:1.32,feint:.36},
  {id:'overhead',windup:.94,height:1,wrist:.65,recovery:1.48}
].map(Object.freeze));
const RIVAL_MOTIONS=Object.freeze({
  sword:{
    gait:{duration:.24,delay:.075,lift:.110},
    ready:{mainX:-.11,mainY:.24,wrist:.16,lean:-.04,offX:-.12,offY:.09},
    opening:{mainX:-.29,mainY:.16,wrist:.08},
    offHand:{offX:.18,offY:.28}
  },
  spear:{
    gait:{duration:.40,delay:.10,lift:.068},
    ready:{mainX:.18,mainY:-.07,wrist:-.10,lean:.08,offX:.16,offY:.03},
    opening:{mainX:-.17,mainY:-.13,wrist:-.09},
    offHand:{offX:.32,offY:.32}
  },
  axe:{
    gait:{duration:.39,delay:.15,lift:.100},
    ready:{mainX:-.24,mainY:.34,wrist:.22,lean:-.11,offX:.24,offY:.12},
    opening:{mainX:-.49,mainY:.30,wrist:.21},
    offHand:{offX:.41,offY:.18}
  }
});
export const bossRivalMotion=style=>Object.hasOwn(RIVAL_MOTIONS,style)?RIVAL_MOTIONS[style]:null;

const WEAPON_PATTERNS=Object.freeze({
  sword:[
    {id:'sword-disengage',windup:.64,height:.28,wrist:.38,recovery:1.28,withdraw:.11,signalEnd:.30,withdrawY:-.18,recoverLean:.65},
    {id:'sword-false-edge',windup:.73,height:.68,wrist:-.38,recovery:1.33,feint:.25,withdraw:.10,signalEnd:.30,recoverLean:.5}
  ],
  spear:[
    {id:'spear-pressure-line',windup:.80,height:.04,wrist:.12,recovery:1.34,withdraw:.24,signalEnd:.40,withdrawY:.16,recoverLean:-.30},
    {id:'spear-low-line',windup:.88,height:-.58,wrist:-.52,recovery:1.39,withdraw:.20,signalEnd:.42,withdrawY:.22,recoverLean:-.22}
  ],
  axe:[
    {id:'axe-crown',windup:.92,height:1,wrist:.62,recovery:1.46,withdraw:.15,signalEnd:.46,withdrawY:.28,recoverLean:.75},
    {id:'axe-low-draw',windup:1.02,height:-.75,wrist:-.62,recovery:1.52,withdraw:.19,signalEnd:.50,withdrawY:.48,recoverLean:.55}
  ]
});
const patterns=new Map([...BOSS_SECOND_PHASE,...Object.values(WEAPON_PATTERNS).flat()].map(pattern=>[pattern.id,Object.freeze(pattern)]));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function bossWeaponPattern(archetype,cycle){
  const sequence=Object.hasOwn(WEAPON_PATTERNS,archetype)?WEAPON_PATTERNS[archetype]:null;
  return sequence?.[Number.isInteger(cycle)&&cycle>=0?cycle%sequence.length:0]??null;
}
export function bossSecondPhasePattern(cycle=0){
  const index=Number.isInteger(cycle)&&cycle>=0?cycle%BOSS_SECOND_PHASE.length:0;
  return BOSS_SECOND_PHASE[index];
}
export function bossSecondPhaseControl({state,time,pattern,twoHanded=false}={}){
  const authored=patterns.get(pattern);
  if(!authored||!Number.isFinite(time)||time<0)return null;
  if(state==='windup'){
    const withdraw=authored.withdraw??(twoHanded?.16:.14),signalEnd=authored.signalEnd??(twoHanded?.38:.34),withdrawY=authored.withdrawY??-.28;
    if(time<withdraw)return {trackingAim:false,control:{mainX:-.65,mainY:withdrawY,wrist:-.38,lean:-.35}};
    if(time<signalEnd){
      const phase=clamp((time-withdraw)/(signalEnd-withdraw),0,1),lift=phase*phase*(3-2*phase);
      return {trackingAim:false,control:{mainX:-.25+.40*lift,mainY:withdrawY+(authored.height-withdrawY)*lift,wrist:-.38+(authored.wrist+.38)*lift,lean:0}};
    }
  }else if(state==='feint'){
    const lift=clamp(time/.18,0,1);
    return {trackingAim:false,control:{mainX:-.25+.50*lift,mainY:.20+.58*lift,wrist:.25,lean:0}};
  }else if(state==='recover'){
    const collect=clamp(time/.28,0,1);
    return {trackingAim:false,control:{mainX:-.95+.35*collect,mainY:-.42+.12*collect,wrist:-.28*(1-collect),lean:authored.recoverLean??1}};
  }
  // Leave the full final settling interval to the existing observed aim loop.
  return null;
}
