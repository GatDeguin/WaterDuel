import {SOUND_NAMES} from './synthesis.js';
import {FOLEY_NAMES} from './foley-synthesis.js';

export const EFFECT_SAMPLE_RATE=22050;
const DURATIONS={wood:.2,joint:.26,metal:.55,ring:1.25,whoosh:.4,slosh:.68,tension:.55,puncture:.35,
  tear:.72,jet:.85,drip:.28,splash:1,countdown:.18,go:.45,victory:1.6,defeat:1.5,draw:1.1,ui:.1,
  'blade-beat':.52,'blade-slide':.74,'shield-metal':.92,'shield-wood':.42,'wood-contact':.4,
  'latex-rub':.72,'footstep-dry':.34,'footstep-wet':.48,'water-burst':1.2,'blade-swish':.42};
export const EFFECT_JOBS=Object.freeze([...SOUND_NAMES,...FOLEY_NAMES].flatMap(name=>
  [0,1,2].map(variant=>Object.freeze({name,variant,seed:31+variant*79,
    frames:Math.round(DURATIONS[name]*EFFECT_SAMPLE_RATE)}))));
export const EFFECT_CLOCK=Object.freeze({now:()=>performance.now(),
  setTimeout:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:id=>globalThis.clearTimeout(id)});
export const localEffectWorker=()=>typeof globalThis.Worker==='function'?
  new Worker(new URL('./effect-bank-worker.js',import.meta.url),{type:'module'}):null;

/** One outstanding render and one AudioBuffer copy per yielded task. No voices.
 * The complete bank remains private until success. Cancellation settles false
 * upstream and releases partial banks, pending copy tasks and worker handlers.
 */
export function startEffectPreparation({context,workerFactory=localEffectWorker,clock=EFFECT_CLOCK,
  timeoutMs=10000,onProgress=()=>{}}){
  let resolve,result=null,worker=null,deadline=null,copyTask=null,settled=false,waiting=false,index=0,maxCopyMs=0,bytes=0;
  const entries=new Map(),startedAt=clock.now();
  const promise=new Promise(done=>{resolve=done;});
  const finish=(state,error='')=>{
    if(settled)return;settled=true;
    if(deadline!==null)clock.clearTimeout(deadline);
    if(copyTask!==null)clock.clearTimeout(copyTask);
    if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;try{worker.terminate();}catch{}}
    if(state!=='ready')entries.clear();
    result={state,error,entries,metrics:{elapsedMs:Math.max(0,clock.now()-startedAt),maxCopyMs,bytes,buffers:index}};
    resolve(result);
  };
  const requestNext=()=>{
    if(settled)return;
    if(context.state==='closed'){finish('cancelled','AudioContext cerrado.');return;}
    if(index===EFFECT_JOBS.length){finish('ready');return;}
    const job=EFFECT_JOBS[index];waiting=true;
    try{worker.postMessage({type:'render',name:job.name,variant:job.variant});}
    catch(error){finish('error',String(error.message));}
  };
  try{worker=workerFactory();}catch(error){finish('error',String(error.message));}
  if(!settled&&!worker)finish('legacy-fallback','Worker no disponible: síntesis síncrona heredada.');
  if(!settled){
    worker.onerror=event=>{event.preventDefault?.();finish('error',String(event.message||'Falló el Worker de efectos.'));};
    worker.onmessageerror=()=>finish('error','Mensaje de efectos no decodificable.');
    worker.onmessage=event=>{
      if(settled)return;
      const data=event.data,job=EFFECT_JOBS[index];
      if(data?.type==='error'){finish('error',String(data.message||'Falló la síntesis de efectos.'));return;}
      if(!waiting||!job||data?.type!=='sample'||data.name!==job.name||data.variant!==job.variant||
        data.sampleRate!==EFFECT_SAMPLE_RATE||!(data.samples instanceof ArrayBuffer)||data.samples.byteLength!==job.frames*4){
        finish('error','Respuesta de efectos inválida.');return;
      }
      waiting=false;
      copyTask=clock.setTimeout(()=>{
        copyTask=null;if(settled)return;
        if(context.state==='closed'){finish('cancelled','AudioContext cerrado.');return;}
        try{
          const copyStart=clock.now(),samples=new Float32Array(data.samples);
          const buffer=context.createBuffer(1,job.frames,EFFECT_SAMPLE_RATE);
          buffer.getChannelData(0).set(samples);
          maxCopyMs=Math.max(maxCopyMs,clock.now()-copyStart);bytes+=samples.byteLength;
          entries.set(job.name+':'+job.variant,buffer);index++;
          onProgress({ready:index,total:EFFECT_JOBS.length});requestNext();
        }catch(error){finish('error',String(error.message));}
      },0);
    };
    const duration=Number.isFinite(timeoutMs)?Math.max(1,Math.min(30000,timeoutMs)):10000;
    deadline=clock.setTimeout(()=>finish('error','Se agotó el plazo de preparación de efectos (timeout).'),duration);
    requestNext();
  }
  return {promise,initialState:result?.state??'preparing',initialError:result?.error??'',
    cancel:()=>finish('cancelled','Preparación cancelada.')};
}
