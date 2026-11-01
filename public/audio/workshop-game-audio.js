import {RecordedGameAudio} from './recorded-game-audio.js';
import {StreamedMusic} from './streamed-music.js';
import {EffectsRack} from './effects-rack.js';
import {WorkshopAcoustics} from './spatial-audio.js';
import {AudioScene} from './scene-audio.js';
export const WORKSHOP_AUDIO_DEFAULTS=Object.freeze({music:.24,effects:1,distortion:.03,reverb:.08,reverbDecay:1.1});
const clamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
const PHASES=new Set(['ready','countdown','fight','burst','matchover']);
const ACTIVE_PHASES=new Set(['fight','burst']),JOINT_EVENTS=new Set(['joint-damage','joint-break']);
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
  constructor({mediaFactory,...options}={}){
    super(options);this.mediaFactory=mediaFactory;this.stream=null;this.fxRack=null;this.distortion=.03;this.reverb=.08;this.reverbDecay=1.1;this.lastMusicGain=null;this.musicPhase='ready';this.scene=new WorkshopMotionScene();
  }
  configure(enabled,volume,{music=this.musicVolume,effects=this.effectsVolume,distortion=this.distortion,reverb=this.reverb,reverbDecay=this.reverbDecay}={}){
    const oldMaster=this.master?.gain.value,oldEffects=this.effects?.gain.value;
    this.distortion=clamp(distortion,0,1,.03);this.reverb=clamp(reverb,0,1,.08);this.reverbDecay=clamp(reverbDecay,.2,2.4,1.1);
    super.configure(enabled,volume,{music,effects});
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
  play(name,options){
    // Removed by request, including composite damage plans and fallback audio.
    if(name==='wood-contact')return false;
    const played=super.play(name,options);if(played)this.fxRack?.markActive();return played;
  }
  stopEffects(){super.stopEffects();this.fxRack?.reset();}
  stopMusic(){this.stream?.pause();this.musicVoices=[];this.musicOrigin=null;this.musicMode=null;}
  retireMusic(voice){if(voice===this.stream?.voice)this.stopMusic();else super.retireMusic(voice);}
  releaseGraph(){
    this.stream?.dispose();this.stream=null;this.musicVoices=[];this.fxRack?.dispose();this.fxRack=null;this.lastMusicGain=null;super.releaseGraph();
  }
}
