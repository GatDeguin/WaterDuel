// Scalar preferences shared by the host and its validated mobile protocol.
import {ALL_EFFECTS_MASK,setEffectEnabled,validEffectMask} from './effect-controls.js';
const EFFECT_MASK_VERSION=2,LEGACY_EFFECTS_MASK=setEffectEnabled(0,'thunder',true)-1;
export const SOUND_SLIDERS=Object.freeze([
  ['volume',55],['musicVolume',24],['effectsVolume',100],['thunderVolume',100],
  ['distortion',3],['reverb',8],['reverbDecay',1100,200,2400]
].map(([field,fallback,min=0,max=100])=>{
  const suffix=field[0].toUpperCase()+field.slice(1);
  return Object.freeze({field,fallback,min,max,id:'menu'+suffix,command:'set'+suffix});
}));
const soundFields=new Map(SOUND_SLIDERS.map(control=>[control.field,control]));
export const SOUND_DEFAULTS=Object.freeze({audioOn:false,...Object.fromEntries(SOUND_SLIDERS.map(({field,fallback})=>[field,fallback])),effectMask:ALL_EFFECTS_MASK});
export const SOUND_COMMANDS=Object.freeze({...Object.fromEntries(SOUND_SLIDERS.map(({command,field})=>[command,field])),setEffectMask:'effectMask'});
export function validSoundValue(field,value){
  if(field==='effectMask')return validEffectMask(value);
  const control=soundFields.get(field);
  return !!control&&Number.isInteger(value)&&value>=control.min&&value<=control.max;
}
export function soundPreferences(value={}){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const out={audioOn:source.audioOn===true,effectMask:validEffectMask(source.effectMask)?source.effectMask:ALL_EFFECTS_MASK};
  for(const {field,min,max,fallback} of SOUND_SLIDERS){
    const raw=source[field];out[field]=Number.isFinite(raw)?Math.round(Math.max(min,Math.min(max,raw))):fallback;
  }
  return out;
}
export function loadSoundPreferences(storage){
  try{
    const saved=JSON.parse(storage?.getItem('waterduel.audio.v1')??'null'),prefs=soundPreferences(saved);
    // Older masks let thunder play whenever any effect was selected.
    if((saved?.effectMaskVersion??1)===1&&prefs.effectMask>0&&prefs.effectMask<=LEGACY_EFFECTS_MASK){
      prefs.effectMask=setEffectEnabled(prefs.effectMask,'thunder',true);
    }
    return prefs;
  }catch{return soundPreferences();}
}
export function saveSoundPreferences(storage,value){
  try{storage?.setItem('waterduel.audio.v1',JSON.stringify({...soundPreferences(value),effectMaskVersion:EFFECT_MASK_VERSION}));}catch{}
}
