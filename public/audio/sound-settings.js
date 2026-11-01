// Scalar preferences shared by the host and its validated mobile protocol.
import {ALL_EFFECTS_MASK,validEffectMask} from './effect-controls.js';
export const SOUND_DEFAULTS=Object.freeze({audioOn:false,volume:55,musicVolume:24,effectsVolume:100,distortion:3,reverb:8,reverbDecay:1100,effectMask:ALL_EFFECTS_MASK});
export const SOUND_COMMANDS=Object.freeze({setVolume:'volume',setMusicVolume:'musicVolume',setEffectsVolume:'effectsVolume',setDistortion:'distortion',setReverb:'reverb',setReverbDecay:'reverbDecay',setEffectMask:'effectMask'});
const limits=field=>field==='reverbDecay'?[200,2400]:[0,100];
export function validSoundValue(field,value){if(field==='effectMask')return validEffectMask(value);const [min,max]=limits(field);return Number.isInteger(value)&&value>=min&&value<=max;}
export function soundPreferences(value={}){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const out={audioOn:source.audioOn===true};
  for(const field of Object.keys(SOUND_DEFAULTS))if(field!=='audioOn'){
    if(field==='effectMask'){out.effectMask=validEffectMask(source.effectMask)?source.effectMask:ALL_EFFECTS_MASK;continue;}
    const [min,max]=limits(field),raw=source[field];out[field]=typeof raw==='number'&&Number.isFinite(raw)?Math.round(Math.max(min,Math.min(max,raw))):SOUND_DEFAULTS[field];
  }
  return out;
}
export function loadSoundPreferences(storage){try{return soundPreferences(JSON.parse(storage?.getItem('waterduel.audio.v1')??'null'));}catch{return soundPreferences();}}
export function saveSoundPreferences(storage,value){try{storage?.setItem('waterduel.audio.v1',JSON.stringify(soundPreferences(value)));}catch{}}
