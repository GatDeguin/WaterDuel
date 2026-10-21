import {renderSound} from './synthesis.js';
import {FOLEY_NAMES,renderFoley} from './foley-synthesis.js';
import {EFFECT_JOBS,EFFECT_SAMPLE_RATE} from './effect-bank-preparation.js';

/** The original renderers and arithmetic are unchanged; transferred samples
 * never pass through PCM16 encoding, decoding, resampling or normalization.
 */
export function renderEffectRequest(request){
  const job=EFFECT_JOBS.find(job=>job.name===request?.name&&job.variant===request?.variant);
  if(request?.type!=='render'||!job)throw new RangeError('Solicitud de efecto inválida.');
  const render=FOLEY_NAMES.includes(job.name)?renderFoley:renderSound;
  const samples=render(job.name,{sampleRate:EFFECT_SAMPLE_RATE,seed:job.seed});
  if(samples.length!==job.frames)throw new RangeError('Longitud de efecto inválida.');
  return {type:'sample',name:job.name,variant:job.variant,sampleRate:EFFECT_SAMPLE_RATE,samples:samples.buffer};
}

if(typeof globalThis.postMessage==='function'&&typeof globalThis.document==='undefined'){
  globalThis.addEventListener('message',event=>{
    try{const result=renderEffectRequest(event.data);globalThis.postMessage(result,[result.samples]);}
    catch(error){globalThis.postMessage({type:'error',message:String(error.message)});}
  });
}
