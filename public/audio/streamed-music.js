const track=file=>Object.freeze({file,url:new URL('../music/'+file,import.meta.url)});
export const WORKSHOP_MUSIC_TRACKS=Object.freeze({intro:track('intro.mp3'),battle:Object.freeze(['batalla.mp3','batalla2.mp3','batalla3.mp3'].map(track))});

/** One browser-decoded stream, connected once to its owning AudioContext.
 * Music stays compressed/streamed instead of expanding minutes of MP3 to PCM. */
export class StreamedMusic{
  constructor(context,destination,{mediaFactory=()=>new Audio(),onState=()=>{}}={}){
    this.context=context;this.onState=onState;this.media=mediaFactory();this.media.preload='auto';this.media.playsInline=true;
    this.source=context.createMediaElementSource(this.media);this.gain=context.createGain();this.gain.gain.value=1;this.source.connect(this.gain).connect(destination);
    this.voice={source:this.source,gain:this.gain,streamed:true};this.group=null;this.battleStarted=false;this.battleIndex=-1;this.selected=null;
    this.state='paused';this.error='';this.blocked=false;this.pending=null;this.generation=0;this.wanted=false;this.disposed=false;
    this.onEnded=()=>{if(this.disposed||!this.wanted||this.group!=='battle')return;this.battleIndex=(this.battleIndex+1)%WORKSHOP_MUSIC_TRACKS.battle.length;this.select(WORKSHOP_MUSIC_TRACKS.battle[this.battleIndex]);this.play(false);};
    this.onError=()=>{this.error='No se pudo reproducir la música: '+(this.selected?.file??'');this.blocked=true;this.state='blocked';this.media.pause();this.onState();};
    this.media.addEventListener('ended',this.onEnded);this.media.addEventListener('error',this.onError);
  }
  phase(phase){
    if(phase==='ready'||phase==='matchover'){this.battleStarted=false;this.group='intro';}
    else if(phase==='fight'||phase==='burst'){if(!this.battleStarted){this.battleStarted=true;this.battleIndex=(this.battleIndex+1)%WORKSHOP_MUSIC_TRACKS.battle.length;}this.group='battle';}
    else if(phase==='countdown')this.group=this.battleStarted?'battle':'intro';
    else return;
    this.select(this.group==='intro'?WORKSHOP_MUSIC_TRACKS.intro:WORKSHOP_MUSIC_TRACKS.battle[this.battleIndex]);
  }
  select(selected){
    if(this.disposed||this.selected===selected)return;
    ++this.generation;this.pending=null;this.media.pause();this.selected=selected;this.blocked=false;this.error='';this.state='paused';
    this.media.src=selected.url.href;this.media.loop=this.group==='intro';this.media.currentTime=0;this.media.load?.();this.onState();
  }
  play(gesture=false){
    if(this.disposed||!this.wanted||!this.selected||this.context.state!=='running')return false;
    if(this.blocked&&!gesture)return false;if(this.pending)return false;
    if(!this.media.paused&&this.state==='playing')return true;
    this.blocked=false;const generation=this.generation;this.state='starting';this.onState();
    let result;try{result=this.media.play();}catch(error){result=Promise.reject(error);}
    const pending=Promise.resolve(result).then(()=>{
      if(this.disposed||!this.wanted||this.context.state!=='running'){this.media.pause();return false;}
      if(this.generation!==generation)return false;
      this.state='playing';this.error='';this.onState();return true;
    }).catch(error=>{
      if(this.disposed||this.generation!==generation)return false;
      this.media.pause();this.state='blocked';this.blocked=true;this.error=String(error?.message??error);this.onState();return false;
    }).finally(()=>{if(this.pending===pending)this.pending=null;});
    this.pending=pending;return false;
  }
  resume(gesture=false){this.wanted=true;return this.play(gesture);}
  pause(){if(this.disposed||!this.wanted&&this.state==='paused'&&this.media.paused)return;++this.generation;this.pending=null;this.wanted=false;this.media.pause();this.state='paused';this.onState();}
  dispose(){
    if(this.disposed)return;this.pause();this.disposed=true;this.media.removeEventListener('ended',this.onEnded);this.media.removeEventListener('error',this.onError);
    this.media.removeAttribute('src');this.media.load?.();try{this.source.disconnect();this.gain.disconnect();}catch{}
  }
}
