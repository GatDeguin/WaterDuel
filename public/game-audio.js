// Local worker preparation preserves original audio samples and playback variants.
import {SOUND_NAMES,MUSIC_STEMS,renderSound} from './audio/synthesis.js';
import {renderPuppetRodaMusic as renderMusic} from './audio/roda-synthesis.js';
import {AudioScene} from './audio/scene-audio.js';
import {musicDecision} from './audio/music-state.js';
import {FOLEY_NAMES,renderFoley} from './audio/foley-synthesis.js';
import {contactAudio} from './audio/contact-audio.js';
import {EFFECT_JOBS,EFFECT_CLOCK,localEffectWorker,startEffectPreparation} from './audio/effect-bank-preparation.js';
import {WorkshopAcoustics} from './audio/spatial-audio.js';
import {musicStemLevels} from './audio/music-dynamics.js';

const bounded=(v,lo,hi,fallback=0)=>Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):fallback;
const PHASES=new Set(['ready','countdown','fight','burst','matchover']);
const MODES=new Set(['lydian','dorian','aeolian','phrygian']);
const LEVELS={ready:[.35,.5,.3],countdown:[.45,.3,.35],fight:[.7,.38,.5],burst:[.2,.15,.25],matchover:[.3,.5,.3]};
const LEGACY={pop:'burst',clang:'clang',thrust:'thrust',go:'fight',tap:'countdown'};
const SAMPLE_RATE=22050,BAR_SECONDS=2.5,LOOP_SECONDS=20;
const SOFT_LIMIT=Float32Array.from({length:4097},(_,i)=>.9*Math.tanh((i/2048-1)*1.4)/Math.tanh(1.4));

/** Procedural offline audio; x is world position. The legacy configure/unlock/tone
 * interface remains supported. handleEvent/update add physical foley and score.
 * A transition has at most six music sources; all sources share a 24 voice cap.
 */
export class GameAudio {
  constructor({contextFactory,random=Math.random,maxVoices=24,workerFactory=localEffectWorker,
    clock=EFFECT_CLOCK,effectsTimeoutMs=10000}={}){
    this.contextFactory=contextFactory??(()=>{
      const Audio=globalThis.AudioContext??globalThis.window?.AudioContext??globalThis.window?.webkitAudioContext;
      return Audio?new Audio():null;
    });
    this.random=random;this.maxVoices=Math.round(bounded(maxVoices,8,32,24));
    this.enabled=false;this.volume=.55;this.musicVolume=.24;this.effectsVolume=1;
    this.context=null;this.master=null;this.effects=null;this.music=null;this.limiter=null;this.saturator=null;this.acoustics=null;
    this.paused=false;this.musicPhase=null;this.musicMode=null;this.musicOrigin=null;this.duckUntil=0;this.resuming=false;
    this.dynamicPhase=null;this.dynamicLevels=null;
    this.voices=new Set();this.musicVoices=[];this.buffers=new Map();this.serial=0;this.scene=new AudioScene();
    this.contactTimes=new Map();
    this.musicReady=false;this.loadingMusic=null;this.musicLoadAbort=null;this.musicError='';this.retryMusicAt=0;
    this.workerFactory=workerFactory;this.effectClock=clock;this.effectsTimeoutMs=effectsTimeoutMs;
    this.effectsState='idle';this.effectsError='';this.effectsProgress={ready:0,total:EFFECT_JOBS.length};
    this.effectsPreparationMetrics=null;this.loadingEffects=null;this.effectPreparation=null;this.effectGeneration=0;
  }
  get audible(){return this.enabled&&this.volume>0&&!this.paused;}
  get effectsReady(){return this.effectsState==='ready';}
  get effectsAvailable(){return this.effectsReady||this.effectsState==='legacy-fallback';}
  get effectsWanted(){return this.enabled&&this.volume>0&&this.effectsVolume>0;}
  prepareEffects(){
    if(!this.effectsWanted||!this.context||this.context.state==='closed')return Promise.resolve(false);
    if(this.loadingEffects)return this.loadingEffects;
    if(this.effectsAvailable)return Promise.resolve(true);
    if(this.effectsState==='error')return Promise.resolve(false);
    const context=this.context,generation=++this.effectGeneration;
    this.effectsState='preparing';this.effectsError='';this.effectsProgress={ready:0,total:EFFECT_JOBS.length};
    const preparation=startEffectPreparation({context,workerFactory:this.workerFactory,clock:this.effectClock,
      timeoutMs:this.effectsTimeoutMs,onProgress:progress=>{
        if(this.effectGeneration===generation&&this.context===context)this.effectsProgress=progress;
      }});
    this.effectPreparation=preparation;
    // No Worker is known synchronously. Keep the legacy first-play contract;
    // this only selects the fallback and never synthesizes during preparation.
    if(preparation.initialState==='legacy-fallback'){
      this.effectsState='legacy-fallback';this.effectsError=preparation.initialError;
    }
    const loading=preparation.promise.then(result=>{
      if(this.effectGeneration!==generation||this.context!==context||!this.effectsWanted)return false;
      if(context.state==='closed'){this.cancelEffectsPreparation();return false;}
      this.effectsState=result.state;this.effectsError=result.error;this.effectsPreparationMetrics=result.metrics;
      if(result.state==='ready')for(const [key,buffer]of result.entries)this.buffers.set(key,buffer);
      // Immediate legacy playback may already have established real contacts.
      // Its resolved promise must not erase their cooldowns or scene history.
      if(result.state!=='legacy-fallback'){this.scene.reset();this.contactTimes.clear();}
      return this.effectsAvailable;
    }).finally(()=>{if(this.effectGeneration===generation){this.loadingEffects=null;this.effectPreparation=null;}});
    this.loadingEffects=loading;return loading;
  }
  cancelEffectsPreparation(){
    ++this.effectGeneration;this.effectPreparation?.cancel();this.effectPreparation=null;this.loadingEffects=null;
    this.effectsState='idle';this.effectsError='';this.effectsProgress={ready:0,total:EFFECT_JOBS.length};this.effectsPreparationMetrics=null;
    for(const key of this.buffers.keys())if(!key.startsWith('music:'))this.buffers.delete(key);
  }
  configure(enabled,volume,{music=this.musicVolume,effects=this.effectsVolume}={}){
    this.enabled=enabled===true;this.volume=bounded(volume,0,100,55)/100;
    this.musicVolume=bounded(music,0,1,.24);this.effectsVolume=bounded(effects,0,1,1);
    if(this.master)this.master.gain.setValueAtTime(this.audible?this.volume:0,this.context.currentTime);
    if(this.effects)this.effects.gain.setValueAtTime(this.effectsVolume,this.context.currentTime);
    if(!this.audible){this.stopEffects();this.stopMusic();this.scene.reset();}
    else if(!this.musicVolume)this.stopMusic();
    if(!this.effectsWanted){this.stopEffects();this.cancelEffectsPreparation();}
    else if(this.context&&this.effectsState==='idle')this.prepareEffects();
  }
  unlock({gesture=true}={}){
    if(!this.audible)return null;
    try{
      if(this.context?.state==='closed')this.releaseGraph();
      if(!this.context){
        this.context=this.contextFactory();if(!this.context)return null;
        const ctx=this.context;
        this.master=ctx.createGain();this.master.gain.value=this.volume;
        this.effects=ctx.createGain();this.effects.gain.value=this.effectsVolume;this.effects.connect(this.master);
        this.acoustics=new WorkshopAcoustics(ctx,this.effects);
        this.music=ctx.createGain();this.music.gain.value=this.musicVolume;this.music.connect(this.master);
        this.limiter=ctx.createDynamicsCompressor();
        for(const [key,value]of Object.entries({threshold:-12,knee:12,ratio:8,attack:.003,release:.18}))this.limiter[key].value=value;
        this.saturator=ctx.createWaveShaper();this.saturator.curve=SOFT_LIMIT;
        this.master.connect(this.limiter).connect(this.saturator).connect(ctx.destination);
        this.onContextState=()=>{
          if(this.context!==ctx)return;
          if(ctx.state==='closed'){this.releaseGraph();return;}
          if(ctx.state!=='running'){this.stopEffects();this.stopMusic();this.scene.reset();}
        };
        ctx.addEventListener?.('statechange',this.onContextState);
      }
      const ctx=this.context;
      if(this.effectsWanted&&this.effectsState==='idle')this.prepareEffects();
      if(ctx.state!=='running'){this.stopEffects();this.stopMusic();this.scene.reset();}
      if(ctx.state!=='running'&&(gesture||!this.resuming)){
        // An automatic resume may stay pending under autoplay policy. A real
        // local gesture must call resume again; only the automatic promise owns
        // its guard so a rejected gesture cannot open a per-frame retry storm.
        const automatic=!gesture;if(automatic)this.resuming=true;
        Promise.resolve(ctx.resume()).catch(()=>{}).finally(()=>{if(automatic&&this.context===ctx)this.resuming=false;});
      }
      return ctx;
    }catch{this.releaseGraph();return null;}
  }
  effectBuffer(name){
    if(!this.effectsAvailable)return null;
    const variant=this.serial++%3,key=name+':'+variant;
    if(this.effectsReady)return this.buffers.get(key)??null;
    if(!this.buffers.has(key)){
      const render=FOLEY_NAMES.includes(name)?renderFoley:renderSound;
      const samples=render(name,{sampleRate:SAMPLE_RATE,seed:31+variant*79});
      const buffer=this.context.createBuffer(1,samples.length,SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);this.buffers.set(key,buffer);
    }
    return this.buffers.get(key);
  }
  retire(voice){
    if(!this.voices.delete(voice))return;voice.source.onended=null;
    try{voice.source.stop();}catch{}
    for(const node of [voice.source,voice.gain,voice.pan,voice.send])try{node?.disconnect();}catch{}
  }
  retireMusic(voice){
    const index=this.musicVoices.indexOf(voice);if(index<0)return;this.musicVoices.splice(index,1);
    voice.source.onended=null;try{voice.source.stop();}catch{}
    try{voice.source.disconnect();voice.gain.disconnect();}catch{}
  }
  prune(){
    const now=this.context.currentTime;
    for(const voice of this.voices)if(voice.ends<=now)this.retire(voice);
    for(const voice of [...this.musicVoices])if(voice.retireAt&&voice.retireAt<=now)this.retireMusic(voice);
  }
  reserve(count){
    while(this.voices.size+this.musicVoices.length+count>this.maxVoices){
      const oldest=[...this.voices].sort((a,b)=>a.priority-b.priority||a.start-b.start)[0];
      if(!oldest)break;this.retire(oldest);
    }
  }
  play(name,{x=0,y=1.8,z=0,intensity=1,delay=0,priority=1,rate=1}={}){
    if(!this.audible||!this.effectsVolume||!SOUND_NAMES.includes(name)&&!FOLEY_NAMES.includes(name))return false;
    intensity=bounded(intensity,0,1,0);if(!intensity)return false;
    const ctx=this.unlock({gesture:false});if(!ctx||ctx.state!=='running')return false;
    if(!this.effectsAvailable)return false;
    this.prune();priority=bounded(priority,0,3,1);
    if(this.voices.size+this.musicVoices.length>=this.maxVoices){
      const oldest=[...this.voices].sort((a,b)=>a.priority-b.priority||a.start-b.start)[0];
      if(!oldest||oldest.priority>priority)return false;this.retire(oldest);
    }
    const buffer=this.effectBuffer(name);if(!buffer)return false;
    const source=ctx.createBufferSource(),gain=ctx.createGain(),position=this.acoustics.source({x,y,z},name),{pan,send}=position;
    source.buffer=buffer;
    const speed=bounded(rate,.7,1.4,1)*(.97+bounded(this.random(),0,1,.5)*.06);
    source.playbackRate.value=speed;gain.gain.value=.6*intensity;
    source.connect(gain).connect(pan);
    const start=ctx.currentTime+bounded(delay,0,1,0),ends=start+source.buffer.duration/speed+.01;
    const voice={name,source,gain,pan,send,spatial:position.spatial,at:position.at,start,ends,priority};this.voices.add(voice);
    source.onended=()=>this.retire(voice);source.start(start);source.stop(ends);return true;
  }
  tone(type='tap',data={}){
    if(type==='thrust')return this.play('whoosh',{x:data.at?.x??0,intensity:.45});
    return this.handleEvent(LEGACY[type]??type,data);
  }
  playContact(name,data,game){
    if(!this.audible)return false;
    const plan=contactAudio(name,data,game);if(!plan.cues.length)return false;
    const ctx=this.unlock({gesture:false});if(!ctx||ctx.state!=='running')return false;
    if(!this.effectsAvailable)return false;
    const now=ctx.currentTime;
    if(now-(this.contactTimes.get(plan.key)??-Infinity)<plan.cooldown)return false;
    if(!this.contactTimes.has(plan.key)&&this.contactTimes.size>=64)this.contactTimes.delete(this.contactTimes.keys().next().value);
    this.contactTimes.set(plan.key,now);let played=false;
    for(const {name,...options}of plan.cues)played=this.play(name,options)||played;
    return played;
  }
  handleEvent(name,data={},game=null){
    if(name==='reset'||name==='start'){
      this.stopEffects();this.scene.reset();this.setMusicPhase(name==='start'?'countdown':'ready','lydian');
      if(name==='start')this.play('countdown',{priority:3});return true;
    }
    if(name==='countdown')return this.play('countdown',{priority:3,rate:1+(3-bounded(data.count,1,3,3))*.06});
    if(name==='fight'){this.setMusicPhase('fight',game?musicDecision(game).mode:'dorian');return this.play('go',{priority:3});}
    // Both AI and continuous joystick motion are heard from actual blade motion,
    // so the legacy attack pulse cannot double-trigger an independent whoosh.
    if(name==='thrust')return false;
    if(name==='clang'||name==='material-contact'){
      const played=this.playContact(name,data,game);if(played)this.duck(.22);return played;
    }
    if(name==='burst'){
      const played=this.playContact(name,data,game);
      if(data.draw&&played)this.play('draw',{intensity:.55,delay:.32,priority:3});
      this.setMusicPhase('burst',game?musicDecision(game).mode:'aeolian');if(played)this.duck(.7);return played;
    }
    if(name==='matchover'){
      const defeat=game?.mode==='solo'&&data.winner===2;
      this.setMusicPhase('matchover',game?musicDecision(game).mode:data.demonstration?'lydian':defeat?'aeolian':'lydian');
      if(data.demonstration)return false;
      return this.play(defeat?'defeat':'victory',{x:data.winner===1?-1.5:1.5,intensity:.75,priority:3});
    }
    if(name==='overtime'){this.duck(.35);return this.play('tension',{intensity:.5,priority:2});}
    return false;
  }
  duck(seconds){
    if(!this.context||!this.music)return;
    this.duckUntil=Math.max(this.duckUntil,this.context.currentTime+seconds);
    this.music.gain.setTargetAtTime(this.musicVolume*.24,this.context.currentTime,.018);
  }
  prepareMusic(ctx){
    // Browser playback decodes shipped local files asynchronously. Synthesizing
    // a score in the render loop would stall combat for hundreds of ms.
    if(typeof ctx.decodeAudioData!=='function'||this.musicReady)return true;
    if(this.loadingMusic||ctx.currentTime<this.retryMusicAt)return false;
    const controller=new AbortController();this.musicLoadAbort=controller;const signal=controller.signal;
    const timeout=setTimeout(()=>controller.abort(),8000);
    this.loadingMusic=Promise.all([...MODES].flatMap(mode=>MUSIC_STEMS.map(async stem=>{
      const url=new URL('./assets/audio/workshop-roda-v4/music-'+mode+'-'+stem+'.wav',import.meta.url);
      const response=await fetch(url,{signal});if(!response.ok)throw new Error('No se pudo cargar '+url.pathname);
      const buffer=await ctx.decodeAudioData(await response.arrayBuffer());
      if(buffer.numberOfChannels!==2||Math.abs(buffer.duration-LOOP_SECONDS)>.001)throw new Error('Duración de música inválida');
      return ['music:'+mode+':'+stem,buffer];
    }))).then(entries=>{
      if(this.context!==ctx)return;
      for(const [key,buffer]of entries)this.buffers.set(key,buffer);
      this.musicReady=true;this.musicError='';
    }).catch(error=>{
      controller.abort();
      if(this.context!==ctx)return;this.musicError=String(error.message);this.retryMusicAt=ctx.currentTime+10;
    }).finally(()=>{clearTimeout(timeout);if(this.context===ctx){this.loadingMusic=null;this.musicLoadAbort=null;}});
    return false;
  }
  startMode(mode,start){
    const ctx=this.context,levels=this.phaseLevels(),offset=((start-this.musicOrigin)%LOOP_SECONDS+LOOP_SECONDS)%LOOP_SECONDS;
    this.reserve(MUSIC_STEMS.length);
    MUSIC_STEMS.forEach((stem,index)=>{
      const key='music:'+mode+':'+stem;
      if(!this.buffers.has(key)){
        const track=renderMusic({sampleRate:SAMPLE_RATE,stem,mode});
        const buffer=ctx.createBuffer(2,track.channels[0].length,track.sampleRate);
        track.channels.forEach((channel,i)=>buffer.getChannelData(i).set(channel));this.buffers.set(key,buffer);
      }
      const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=this.buffers.get(key);source.loop=true;
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(levels[index],start+.12);
      source.connect(gain).connect(this.music);
      const voice={source,gain,mode,index,start,retireAt:null};this.musicVoices.push(voice);
      source.onended=()=>this.retireMusic(voice);source.start(start,offset);
    });
    this.musicMode=mode;
  }
  phaseLevels(){return this.dynamicPhase===this.musicPhase&&this.dynamicLevels?this.dynamicLevels:LEVELS[this.musicPhase];}
  setMusicPhase(phase,mode=phase==='fight'?'dorian':'lydian'){
    this.musicPhase=PHASES.has(phase)?phase:null;mode=MODES.has(mode)?mode:'lydian';
    if(!this.musicPhase||!this.audible||!this.musicVolume){this.stopMusic();return;}
    const ctx=this.unlock({gesture:false});if(!ctx||ctx.state!=='running')return;this.prune();if(!this.prepareMusic(ctx))return;
    const arriving=this.musicVoices.filter(voice=>voice.start>ctx.currentTime);
    if(mode!==this.musicMode&&arriving.length&&this.musicVoices.some(voice=>voice.retireAt)){
      // Only unstarted arrivals can be replaced. Outgoing loops have not been
      // stopped yet, so cancelling their future gain ramp safely restores them.
      for(const voice of arriving)this.retireMusic(voice);
      for(const voice of this.musicVoices){
        voice.retireAt=null;voice.gain.gain.cancelScheduledValues(ctx.currentTime);
        voice.gain.gain.setTargetAtTime(this.phaseLevels()[voice.index],ctx.currentTime,.03);
      }
      this.musicMode=this.musicVoices[0]?.mode??null;
    }
    if(!this.musicVoices.length){this.musicOrigin=ctx.currentTime+.02;this.startMode(mode,this.musicOrigin);}
    else if(mode!==this.musicMode&&this.musicVoices.length===MUSIC_STEMS.length){
      const boundary=this.musicOrigin+Math.ceil((ctx.currentTime-this.musicOrigin+.04)/BAR_SECONDS)*BAR_SECONDS;
      for(const voice of this.musicVoices){
        voice.retireAt=boundary+.18;voice.gain.gain.setTargetAtTime(0,boundary,.025);
      }
      this.startMode(mode,boundary);
    }
    for(const voice of this.musicVoices)if(!voice.retireAt&&ctx.currentTime>voice.start+.13)
      voice.gain.gain.setTargetAtTime(this.phaseLevels()[voice.index],ctx.currentTime,.3);
    this.music.gain.setTargetAtTime(this.musicVolume*(ctx.currentTime<this.duckUntil?.24:1),ctx.currentTime,.15);
  }
  update(game,{paused=false,dt=1/60,camera=null}={}){
    this.setPaused(paused);if(!this.audible){this.scene.reset();return 0;}
    const ctx=this.unlock({gesture:false});if(!ctx||ctx.state!=='running'){this.scene.reset();return 0;}
    this.acoustics?.setListener(camera);
    this.dynamicPhase=game?.phase;this.dynamicLevels=musicStemLevels(game,LEVELS[game?.phase]??LEVELS.ready);
    this.prune();this.setMusicPhase(game?.phase,musicDecision(game).mode);
    if(!this.effectsAvailable){this.scene.reset();return 0;}
    const cues=this.scene.update(game,dt);
    for(const cue of cues)this.play(cue.name,{x:cue.x,y:cue.y,z:cue.z,intensity:cue.intensity,rate:cue.rate??1,priority:bounded((cue.priority??1)-1,0,2)});
    return cues.length;
  }
  setPaused(paused){
    paused=!!paused;if(this.paused===paused)return;this.paused=paused;this.scene.reset();
    if(this.master)this.master.gain.setValueAtTime(this.audible?this.volume:0,this.context.currentTime);
    if(paused){this.stopEffects();this.stopMusic();}
  }
  stopEffects(){for(const voice of this.voices)this.retire(voice);this.contactTimes.clear();this.acoustics?.resetRoom();}
  stopMusic(){
    for(const voice of [...this.musicVoices])this.retireMusic(voice);
    this.musicOrigin=null;this.musicMode=null;
  }
  releaseGraph(){
    this.cancelEffectsPreparation();
    this.context?.removeEventListener?.('statechange',this.onContextState);this.onContextState=null;
    this.musicLoadAbort?.abort();this.musicLoadAbort=null;this.loadingMusic=null;this.musicReady=false;this.musicError='';this.retryMusicAt=0;
    this.stopEffects();this.stopMusic();this.scene.reset();
    this.acoustics?.dispose();this.acoustics=null;
    for(const node of [this.master,this.effects,this.music,this.limiter,this.saturator])try{node?.disconnect();}catch{}
    this.master=null;this.effects=null;this.music=null;this.limiter=null;this.saturator=null;this.context=null;
    this.resuming=false;this.duckUntil=0;this.buffers.clear();
  }
  dispose(){const ctx=this.context;this.releaseGraph();if(ctx&&ctx.state!=='closed')Promise.resolve(ctx.close()).catch(()=>{});}
}


