import {contactMaterialPair} from './physics/contact-materials.js';

const MATERIALS=new Set(['steel','brass','metal','metal_mixed','wood','wood_metal_mixed','composite','leather','unknown']);
const INVALID=Symbol('invalid impact field');
const ownValue=(value,key)=>{
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor)return undefined;
  return Object.hasOwn(descriptor,'value')?descriptor.value:INVALID;
};
const participant=value=>value===undefined?0:typeof value==='number'&&[0,1,2].includes(value)?value:INVALID;
const mergeParticipant=(primary,alias)=>primary===INVALID||alias===INVALID||primary&&alias&&primary!==alias?INVALID:primary||alias;
const material=value=>typeof value==='string'&&value.length<=32&&MATERIALS.has(value)?value:'unknown';

/**
 * Pure relay boundary for an already observed physical item contact.
 * Returns null or this fixed, fresh JSON-only schema:
 * {impulse:(0,4], closingSpeed:[0,20], materialA, materialB,
 *  attacker:0|1|2, defender:0|1|2, slot:0|1|2}.
 * At least one participant is 1/2. Zero means unspecified, never broadcast.
 * Current weapon-bind slotA/slotB aliases become attacker/defender; a conflicting
 * nonzero alias is rejected. Missing speed is 0; explicit invalid speed is rejected.
 * Material labels use the current contact-material allowlist; others become unknown.
 * Unknown fields are never traversed/copied, and accessors are never executed.
 * This validates measurements; event provenance/authentication stays with the caller.
 */
export function sanitizeItemImpact(data){
  try{
    if(!data||typeof data!=='object'||Array.isArray(data))return null;
    const prototype=Object.getPrototypeOf(data);if(prototype!==Object.prototype&&prototype!==null)return null;
    const impulse=ownValue(data,'impulse'),rawSpeed=ownValue(data,'closingSpeed'),closingSpeed=rawSpeed===undefined?0:rawSpeed;
    if(typeof impulse!=='number'||!Number.isFinite(impulse)||impulse<=0||
      typeof closingSpeed!=='number'||!Number.isFinite(closingSpeed)||closingSpeed<0)return null;
    const attacker=mergeParticipant(participant(ownValue(data,'attacker')),participant(ownValue(data,'slotA'))),
      defender=mergeParticipant(participant(ownValue(data,'defender')),participant(ownValue(data,'slotB'))),slot=participant(ownValue(data,'slot'));
    if(attacker===INVALID||defender===INVALID||slot===INVALID||!(attacker||defender||slot))return null;
    const materialA=ownValue(data,'materialA'),materialB=ownValue(data,'materialB');
    if(materialA===INVALID||materialB===INVALID)return null;
    // Clamp before normalization/arithmetic, including finite Number.MAX_VALUE.
    return {impulse:Math.min(impulse,4),closingSpeed:Math.min(closingSpeed,20),
      materialA:material(materialA),materialB:material(materialB),attacker,defender,slot};
  }catch{return null;} // Revoked/proxied records cannot abort the transport consumer.
}

/**
 * Stateless policy shared by LAN and local mobile-session adapters.
 * Returns null or {pattern:number[], priority:0}. Durations are milliseconds;
 * gaps count toward the total. Current templates total at most 86 ms (budget 120).
 * Measured impulse/speed vary duration continuously, with integer-ms quantization;
 * no device-amplitude claim is made. Priority 0 preserves current damage priorities.
 * Rest pressure/noise is silent below impulse .001 or closing speed .06.
 * Caller owns device/consent/focus gating, delivery, deduplication and rumble clocks.
 */
export function contactHaptic(data,localSlot){
  if(localSlot!==1&&localSlot!==2)return null;
  const impact=sanitizeItemImpact(data);
  if(!impact||![impact.attacker,impact.defender,impact.slot].includes(localSlot))return null;
  if(impact.impulse<.001||impact.closingSpeed<.06)return null;
  const drive=.8*Math.min(impact.impulse/.45,1)+.2*Math.min(impact.closingSpeed/4,1);
  const pulse=Math.round(12+68*drive),pair=contactMaterialPair(impact.materialA,impact.materialB);
  let pattern;
  if(pair==='metal'){
    const first=Math.round(pulse*.62);pattern=[first,6,pulse-first];
  }else if(pair==='wood')pattern=[pulse+2];
  else if(pair==='composite')pattern=[pulse+4];
  else if(pair==='leather')pattern=[Math.max(8,pulse-4)];
  else pattern=[pulse];
  return {pattern,priority:0};
}
