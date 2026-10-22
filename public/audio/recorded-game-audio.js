import {GameAudio} from '../game-audio.js';
import {EFFECT_JOBS} from './effect-bank-preparation.js';
import {renderEffectRequest} from './effect-bank-worker.js';
import {RECORDED_CUES,startRecordedPreparation} from './recorded-effect-bank.js';
export {RECORDED_CUES} from './recorded-effect-bank.js';

/** A later, optional recording layer. Historical rendering, physical policies,
 * music, listener, voice cap and node cleanup remain owned by GameAudio. */
export class RecordedGameAudio extends GameAudio {
  constructor({recordedManifestURL=new URL('../assets/audio/recorded-foley-v1/manifest.json',import.meta.url),
    fetch=globalThis.fetch?.bind(globalThis),decode=(context,bytes)=>context.decodeAudioData(bytes),recordedTimeoutMs=20000,...options}={}){
    super(options);this.recordedManifestURL=new URL(recordedManifestURL,import.meta.url);this.recordedFetch=fetch;this.recordedDecode=decode;this.recordedTimeoutMs=recordedTimeoutMs;
    this.recordedState='idle';this.recordedError='';this.recordedProgress={ready:0,total:RECORDED_CUES.length*3};
    this.recordedBuffers=new Map();this.recordedVariants=new Map();this.recordedGeneration=0;this.recordedPreparation=null;this.loadingRecordings=null;this.fallbackPreparation=null;
  }
  get effectsAvailable(){return this.effectsReady&&(this.recordedState==='ready'||this.recordedState==='error');}
  unlock(options){const context=super.unlock(options);if(context&&this.effectsWanted)this.prepareRecordings();return context;}
  prepareEffects(){
    if(this.fallbackPreparation)return this.fallbackPreparation.promise;
    if(this.effectsReady)return Promise.resolve(true);
    const context=this.context,pending=super.prepareEffects(),generation=this.effectGeneration;this.prepareRecordings();
    return pending.then(()=>{
      if(this.effectGeneration!==generation||this.context!==context||!this.effectsWanted||context?.state==='closed')return false;
      if(this.effectsState==='legacy-fallback'||this.effectsState==='error')return this.prepareLegacyFallback(context);
      return this.effectsReady;
    });
  }
  prepareLegacyFallback(context){
    if(this.fallbackPreparation)return this.fallbackPreparation.promise;
    let settle,timer=null,cancelled=false,index=0;const entries=new Map(),promise=new Promise(resolve=>{settle=resolve;});
    const cancel=()=>{if(cancelled)return;cancelled=true;if(timer!==null)this.effectClock.clearTimeout(timer);entries.clear();this.fallbackPreparation=null;settle(false);};
    this.fallbackPreparation={promise,cancel};this.effectsState='preparing';
    const next=()=>{
      if(cancelled)return;if(this.context!==context||!this.effectsWanted||context.state==='closed'){cancel();return;}
      try{
        if(index===EFFECT_JOBS.length){for(const [key,buffer]of entries)this.buffers.set(key,buffer);this.effectsState='ready';this.fallbackPreparation=null;settle(true);return;}
        const job=EFFECT_JOBS[index++],samples=renderEffectRequest({type:'render',name:job.name,variant:job.variant}).samples;
        const buffer=context.createBuffer(1,job.frames,22050);buffer.getChannelData(0).set(new Float32Array(samples));entries.set(job.name+':'+job.variant,buffer);this.effectsProgress={ready:index,total:EFFECT_JOBS.length};
        timer=this.effectClock.setTimeout(next,0);
      }catch(error){cancel();this.effectsState='error';this.effectsError=String(error.message);}
    };
    timer=this.effectClock.setTimeout(next,0);return promise;
  }
  prepareRecordings(){
    if(!this.effectsWanted||!this.context||this.context.state==='closed')return Promise.resolve(false);
    if(this.loadingRecordings)return this.loadingRecordings;
    if(this.recordedState==='ready')return Promise.resolve(true);
    if(this.recordedState==='error')return Promise.resolve(false);
    const context=this.context,generation=++this.recordedGeneration;this.recordedState='preparing';this.recordedError='';this.recordedProgress={ready:0,total:RECORDED_CUES.length*3};
    const preparation=startRecordedPreparation({context,url:this.recordedManifestURL,fetch:this.recordedFetch,decode:this.recordedDecode,clock:this.effectClock,timeoutMs:this.recordedTimeoutMs,
      onProgress:progress=>{if(this.recordedGeneration===generation)this.recordedProgress=progress;}});
    this.recordedPreparation=preparation;
    const loading=preparation.promise.then(result=>{
      if(this.recordedGeneration!==generation||this.context!==context||!this.effectsWanted||context.state==='closed')return false;
      this.recordedState=result.state;this.recordedError=result.error;
      if(result.state==='ready'){this.recordedBuffers=result.entries;this.recordedVariants.clear();}
      return result.state==='ready';
    }).finally(()=>{if(this.recordedGeneration===generation){this.loadingRecordings=null;this.recordedPreparation=null;}});
    this.loadingRecordings=loading;return loading;
  }
  retryRecordings(){
    if(this.loadingRecordings)return this.loadingRecordings;
    if(this.recordedState==='ready')return Promise.resolve(true);
    this.recordedState='idle';this.recordedError='';return this.prepareRecordings();
  }
  effectBuffer(name){
    if(!this.effectsAvailable)return null;
    if(this.recordedState==='ready'&&RECORDED_CUES.includes(name)){
      const variant=this.recordedVariants.get(name)??0;this.recordedVariants.set(name,(variant+1)%3);return this.recordedBuffers.get(name+':'+variant)??null;
    }
    // Only a fully prepared base is available; no lazy synchronous synthesis.
    return super.effectBuffer(name);
  }
  cancelRecordings(){
    ++this.recordedGeneration;this.recordedPreparation?.cancel();this.recordedPreparation=null;this.loadingRecordings=null;
    this.recordedBuffers.clear();this.recordedVariants.clear();this.recordedState='idle';this.recordedError='';this.recordedProgress={ready:0,total:RECORDED_CUES.length*3};
  }
  cancelEffectsPreparation(){this.cancelRecordings();this.fallbackPreparation?.cancel();super.cancelEffectsPreparation();}
  releaseGraph(){this.cancelRecordings();super.releaseGraph();}
}
