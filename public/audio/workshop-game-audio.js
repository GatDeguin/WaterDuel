import {RecordedGameAudio} from './recorded-game-audio.js';
import {StreamedMusic} from './streamed-music.js';
import {EffectsRack} from './effects-rack.js';
import {WorkshopAcoustics} from './spatial-audio.js';
import {AudioScene} from './scene-audio.js';
import {ALL_EFFECTS_MASK,validEffectMask,effectEnabled} from './effect-controls.js';
import {SOUND_DEFAULTS} from './sound-settings.js';
import {sampleWeather} from '../weather.js';
export const WORKSHOP_AUDIO_DEFAULTS=Object.freeze({music:.24,effects:1,distortion:.03,reverb:.08,reverbDecay:1.1});
const clamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
const PHASES=new Set(['ready','countdown','fight','burst','matchover']);
const ACTIVE_PHASES=new Set(['fight','burst']),JOINT_EVENTS=new Set(['joint-damage','joint-break']);
const THUNDER_URL=new URL('../assets/audio/weather/thunder.wav',import.meta.url);
const DEFAULT_THUNDER_VOLUME=SOUND_DEFAULTS.thunderVolume/100;
// HRTF/listener behavior stays inherited; this mix has one adjustable room.
// Suppressing the old send makes the reverb control's zero genuinely dry.
class DirectSpatialAcoustics extends WorkshopAcoustics{ensureRoom(){}}
class WorkshopMotionScene extends AudioScene{
  update(game,dt){
    const cues=super.update(game,dt);
    if(!ACTIVE_PHASES.has(game?.phase))for(const cue of cues)if(cue.name==='wood'||cue.name==='joint')cue.intensity*=.15;
    return cues;
  }
}

/** Recorded physical effects and the supplied music share the existing mixer.
 * The protected historical soundtrack remains available only in its old class. */
export class WorkshopGameAudio extends RecordedGameAudio{
  #thunderLoad=null;
  #thunderBuffer=null;
  #stormOrigin=null;
  #lastThunder=null;
  #thunderVolume=DEFAULT_THUNDER_VOLUME;
  constructor({mediaFactory,...options}={}){
    super(options);this.mediaFactory=mediaFactory;this.stream=null;this.fxRack=null;this.distortion=.03;this.reverb=.08;this.reverbDecay=1.1;this.effectMask=ALL_EFFECTS_MASK;this.lastMusicGain=null;this.musicPhase='ready';this.scene=new WorkshopMotionScene();
  }
  configure(enabled,volume,{music=this.musicVolume,effects=this.effectsVolume,thunder=this.#thunderVolume,distortion=this.distortion,reverb=this.reverb,reverbDecay=this.reverbDecay,effectMask=this.effectMask}={}){
    const oldMaster=this.master?.gain.value,oldEffects=this.effects?.gain.value;
    if(validEffectMask(effectMask)&&effectMask!==this.effectMask){
      this.effectMask=effectMask;
      // Stop active and scheduled sources individually. Shared room tails from
      // earlier cues decay naturally without cutting other effects or music.
      for(const voice of this.voices)if(!this.effectSelected(voice.name))this.retire(voice);
    }
    this.distortion=clamp(distortion,0,1,.03);this.reverb=clamp(reverb,0,1,.08);this.reverbDecay=clamp(reverbDecay,.2,2.4,1.1);
    super.configure(enabled,volume,{music,effects});
    const thunderVolume=clamp(thunder,0,1,DEFAULT_THUNDER_VOLUME);
    if(thunderVolume!==this.#thunderVolume){
      this.#thunderVolume=thunderVolume;
      for(const voice of this.voices)if(voice.name==='thunder'){
        const gain=voice.gain.gain;
        this.rampMix(gain,gain.value,voice.strikeGain*thunderVolume);
      }
    }
    if(this.audible&&oldMaster!==undefined&&oldMaster!==this.volume)this.rampMix(this.master.gain,oldMaster,this.volume);
    if(this.effectsVolume>0&&oldEffects!==undefined&&oldEffects!==this.effectsVolume)this.rampMix(this.effects.gain,oldEffects,this.effectsVolume);
    this.fxRack?.configure(this);this.lastMusicGain=null;this.syncMusic(false);
  }
  rampMix(param,from,to){const now=this.context.currentTime;param.cancelScheduledValues?.(now);param.setValueAtTime(from,now);param.setTargetAtTime(to,now,.025);}
  unlock(options={}){
    const context=super.unlock(options);if(!context)return null;
    if(!(this.acoustics instanceof DirectSpatialAcoustics)){this.acoustics?.dispose();this.acoustics=new DirectSpatialAcoustics(context,this.effects);}
    if(!this.fxRack)this.fxRack=new EffectsRack(context,this.effects,this.master,this);
    if(!this.stream&&this.musicVolume>0&&typeof context.createMediaElementSource==='function'){
      try{this.stream=new StreamedMusic(context,this.music,{mediaFactory:this.mediaFactory,onState:()=>this.syncMusicVoice()});}catch(error){this.musicError=String(error.message);}
    }
    this.syncMusic(options.gesture!==false);return context;
  }
  syncMusic(gesture){
    if(!this.stream)return;
    if(!this.audible||!this.musicVolume||!PHASES.has(this.musicPhase)||this.context?.state!=='running'){this.stream.pause();return;}
    this.stream.phase(this.musicPhase);this.stream.resume(gesture);this.musicError=this.stream.error;this.updateMusicGain();
  }
  syncMusicVoice(){
    const stream=this.stream;if(!stream)return;
    const active=stream.wanted&&['starting','playing'].includes(stream.state)&&this.audible&&this.musicVolume>0;
    if(active&&!this.musicVoices.includes(stream.voice)){this.reserve(1);this.musicVoices=[stream.voice];}
    else if(!active)this.musicVoices=[];
    this.musicError=stream.error;
  }
  updateMusicGain(){
    if(!this.music||!this.context)return;const now=this.context.currentTime,target=this.musicVolume*(now<this.duckUntil?.24:1);
    if(target!==this.lastMusicGain){this.music.gain.setTargetAtTime(target,now,.08);this.lastMusicGain=target;}
  }
  setMusicPhase(phase){
    this.musicPhase=PHASES.has(phase)?phase:null;
    if(!this.musicPhase||!this.audible||!this.musicVolume){this.stopMusic();return;}
    const context=this.unlock({gesture:false});if(!context||context.state!=='running')return;this.syncMusic(false);
  }
  // The inherited update routes all score decisions through setMusicPhase.
  // Neither the historical stem loader nor synthesis is reached by this class.
  prepareMusic(){return true;}
  startMode(){return false;}
  duck(seconds){super.duck(seconds);if(this.context)this.lastMusicGain=this.musicVolume*.24;}
  handleEvent(name,data={},game=null){
    // Resting rigs can repeatedly press an arm against another weapon. Those
    // support contacts are not attacks; damage and active impacts remain heard.
    if(name==='material-contact'&&game&&!ACTIVE_PHASES.has(game.phase)&&!JOINT_EVENTS.has(data?.jointEvent))return false;
    return super.handleEvent(name,data,game);
  }
  effectSelected(name){return effectEnabled(this.effectMask,name);}
  #playThunder(storm){
    const context=this.context,buffer=this.#thunderBuffer;
    if(!buffer||!this.acoustics)return false;
    this.prune();this.reserve(1);
    if(this.voices.size+this.musicVoices.length>=this.maxVoices)return false;
    const source=context.createBufferSource(),gain=context.createGain();
    const {pan,send,spatial,at}=this.acoustics.source({x:storm.thunderX,y:5,z:-13},'thunder');
    source.buffer=buffer;
    const strikeGain=.6*storm.thunderStrength;
    gain.gain.value=strikeGain*this.#thunderVolume;
    source.connect(gain).connect(pan);
    const start=context.currentTime,ends=start+buffer.duration+.01;
    const voice={name:'thunder',source,gain,pan,send,spatial,at,start,ends,priority:3,strikeGain};
    this.voices.add(voice);
    source.onended=()=>this.retire(voice);
    source.start(start);source.stop(ends);
    this.fxRack?.markActive();
    return true;
  }
  update(game,options){
    const cues=super.update(game,options);
    const origin=game?.weather==='storm'?(Number.isFinite(game.weatherStart)?game.weatherStart:0):null;
    if(origin!==this.#stormOrigin){
      for(const voice of this.voices)if(voice.name==='thunder')this.retire(voice);
      this.#stormOrigin=origin;this.#lastThunder=null;
    }
    if(origin===null)return cues;
    const context=this.context;
    if(!this.audible||!this.effectsWanted||!this.#thunderVolume||!this.effectSelected('thunder')||context?.state!=='running')return cues;
    if(!this.#thunderLoad&&this.recordedFetch){
      const load=Promise.resolve().then(async()=>{
        const response=await this.recordedFetch(THUNDER_URL,{signal:AbortSignal.timeout(8000)});
        if(!response.ok)return;
        const buffer=await this.recordedDecode(context,await response.arrayBuffer());
        if(this.context===context&&this.#thunderLoad===load)this.#thunderBuffer=buffer;
      }).catch(()=>{});
      this.#thunderLoad=load;
    }
    const elapsed=game.clock-origin,storm=sampleWeather('storm',elapsed);
    if(storm.thunderAt===null||storm.thunderAt===this.#lastThunder)return cues;
    if(elapsed-storm.thunderAt>.35){this.#lastThunder=storm.thunderAt;return cues;}
    if(!this.#playThunder(storm))return cues;
    this.#lastThunder=storm.thunderAt;
    return cues+1;
  }
  play(name,options){
    // Reject before inherited option parsing, buffer lookup or context creation.
    // The catalogue permanently excludes the removed wood-contact cue.
    if(!this.effectSelected(name))return false;
    const played=super.play(name,options);if(played)this.fxRack?.markActive();return played;
  }
  stopEffects(){super.stopEffects();this.fxRack?.reset();}
  stopMusic(){this.stream?.pause();this.musicVoices=[];this.musicOrigin=null;this.musicMode=null;}
  retireMusic(voice){if(voice===this.stream?.voice)this.stopMusic();else super.retireMusic(voice);}
  releaseGraph(){
    this.#thunderLoad=null;this.#thunderBuffer=null;this.#stormOrigin=null;this.#lastThunder=null;
    this.stream?.dispose();this.stream=null;this.musicVoices=[];this.fxRack?.dispose();this.fxRack=null;this.lastMusicGain=null;super.releaseGraph();
  }
}
