import {DuelEngine,neutral} from './engine.js';
import {matchView} from './match-view.js';
import {ReplayRecorder,replayView} from './replay.js';
import {SinglePlayerSession} from './single-player.js';
import {SessionEquipment} from './session-equipment.js';
import {normalizeMenuCommand,sanitizeMenuState} from './remote-menu.js';

// Owns the match, independently of either display's DOM or transport.
export class HostSession{
  constructor({storage=null,onEvent=()=>{},onSettings=()=>{},onNeutralize=()=>{},opponentSeed,opponentRandom=null}={}){
    this.individual=new SinglePlayerSession({storage,seed:opponentSeed,random:opponentRandom});this.recorder=new ReplayRecorder();
    this.sessionEquipment=new SessionEquipment();this.playback=null;this.replaySpeed=.5;
    this.audioOn=false;this.volume=55;this.performanceMode='fixed';this.message='Elegí las opciones e iniciá desde el menú del móvil.';
    this.onSettings=onSettings;this.onNeutralize=onNeutralize;this.rendererError='';
    this.preferences={difficulty:'normal',bestOf:3,arena:'atelier'};
    this.game=new DuelEngine((name,data)=>{
      if(name==='reset'){this.recorder.newMatch();this.closeReplay();}
      this.recorder.event(name,data);this.individual.event(name,data,this.game);
      onEvent(name,data);
    });
    this.game.cameraMode='combat';this.game.lightingMode='cinematic';
    // Do not emit reset/settings callbacks during construction: the caller's
    // host binding is not assigned until this constructor returns.
    this.manualOpponentLoadout={...this.game.loadouts[1]};this.managedOpponent=true;
    const opponent=this.individual.configuration();this.game.setLoadout(2,opponent.opponentLoadout);
    this.game.setBalloonColor(2,opponent.opponentColor);this.game.opponentName=opponent.opponentName;
    this.game.matchApronToBalloon=true;this.game.fighters[1].matchApronToBalloon=true;
  }
  get configurable(){return !this.playback&&['ready','matchover'].includes(this.game.phase);}
  get presentationBlocked(){return this.assetStatus?.loading===true||!!this.rendererError;}
  neutralize(){for(const slot of [1,2])this.game.setControl(slot,neutral());this.onNeutralize();}
  closeReplay(){if(!this.playback)return;this.playback=null;this.neutralize();this.onSettings('replay');}
  configure(){
    const g=this.game,solo=g.mode==='solo',kind=this.individual.kind,config=this.individual.configuration();
    const special=solo&&kind!=='duel';
    g.matchApronToBalloon=solo&&kind==='duel';
    g.resetMatch();
    // AI/campaign preparation borrows slot 2; Versus retains its own selection.
    if(this.managedOpponent){g.setLoadout(2,this.manualOpponentLoadout);this.managedOpponent=false;}
    g.setBalloonColor(2,'amber');
    g.setScenario(special?config.scenario:'duel');g.aiEnabled=special?config.aiEnabled:true;
    this.sessionEquipment.sync(g,solo&&kind==='training');
    if(solo&&['duel','campaign'].includes(kind)){
      this.manualOpponentLoadout={...g.loadouts[1]};this.managedOpponent=true;
      g.setLoadout(2,config.opponentLoadout);g.setBalloonColor(2,config.opponentColor);
    }
    g.aiStyle=special?config.aiStyle:'balanced';g.opponentName=solo?config.opponentName:'';
    g.setDifficulty(special?config.difficulty:this.preferences.difficulty);
    g.setBestOf(special?config.bestOf:this.preferences.bestOf);
    g.setArena(solo&&kind==='campaign'?config.arena:this.preferences.arena);
    this.neutralize();
  }
  update(dt){if(this.presentationBlocked){this.neutralize();return;}if(this.playback)return;this.game.update(dt);this.individual.observe(this.game,dt);this.recorder.record(this.game,dt);}
  renderState(dt=0,realRemainder=0){
    if(!this.playback){this.game.precisionTarget=this.game.mode==='solo'?this.individual.view(this.game).target:null;return {scene:this.game.presentationState(this.presentationBlocked?0:realRemainder),time:this.game.clock};}
    const p=this.playback;
    if(!p.paused&&!this.presentationBlocked){p.time=Math.min(p.clip.duration,p.time+Math.max(0,Math.min(dt,.1))*this.replaySpeed);if(p.time>=p.clip.duration)p.paused=true;}
    const frames=p.clip.frames,at=p.clip.startTime+p.time;let index=0;
    while(index+1<frames.length&&frames[index+1].time<=at+1e-10)index++;
    if(index!==p.index){p.index=index;p.view=replayView(frames[index]);}
    // Inspection settings can change without modifying the stored frame.
    p.view.cameraMode=this.game.cameraMode;p.view.lightingMode=this.game.lightingMode;p.view.quality=this.game.quality;
    return {scene:p.view,time:frames[index].clock};
  }
  handleCommand(message){
    const c=normalizeMenuCommand(message);if(!c)return {ok:false,message:'Comando o valor inválido.'};
    const g=this.game,{command,value}=c;
    if(['start','nextEncounter'].includes(command)&&this.presentationBlocked)return {ok:false,message:this.assetStatus?.loading===true?
      'La arena sigue cargando el escenario y los modelos. Esperá a que termine para comenzar.':'La arena 3D no está disponible. Esperá a que se recupere para comenzar.'};
    const prep=new Set(['setMode','setExperience','setDifficulty','setBestOf','setArena','setLoadout','resetCampaign','nextEncounter']);
    // A finished training/precision exercise may be repeated while its free-practice round is running.
    const canNext=command==='nextEncounter'&&!this.playback&&g.mode==='solo'&&!!this.individual.view(g).nextAction;
    if(prep.has(command)&&!this.configurable&&!canNext)return {ok:false,message:'Esta opción está disponible antes o después de la partida.'};
    if(['setDifficulty','setBestOf'].includes(command)&&g.mode==='solo'&&this.individual.kind!=='duel')return {ok:false,message:'Esta experiencia establece su dificultad y formato.'};
    if(command==='setArena'&&g.mode==='solo'&&this.individual.kind==='campaign')return {ok:false,message:'El encuentro de campaña establece su escenario.'};
    if(command==='setExperience'&&g.mode!=='solo')return {ok:false,message:'Elegí primero el modo individual.'};
    if(command==='setCamera'&&!this.playback&&['fight','countdown'].includes(g.phase))return {ok:false,message:'La cámara se puede cambiar fuera del combate.'};
    switch(command){
      case 'start':
        if(!this.configurable)return {ok:false,message:'La partida ya está en curso o hay una repetición abierta.'};
        this.neutralize();g.start();break;
      case 'reset':this.closeReplay();g.resetMatch();this.neutralize();break;
      case 'setMode':g.setMode(value);this.configure();break;
      case 'setExperience':this.individual.select(value);this.configure();break;
      case 'setDifficulty':this.preferences.difficulty=value;this.configure();break;
      case 'setBestOf':this.preferences.bestOf=value;g.setBestOf(value);break;
      case 'setArena':this.preferences.arena=value;g.setArena(value);break;
      case 'setLoadout':
        if(this.sessionEquipment.locked)return {ok:false,message:this.sessionEquipment.reason};
        if(this.managedOpponent&&value.slot===2)return {ok:false,message:'El encuentro establece el equipo del rival. Podés elegirlo en Versus.'};
        if(!g.setLoadout(value.slot,value))return {ok:false,message:'El equipo no se puede cambiar ahora.'};
        this.neutralize();break;
      case 'setQuality':g.quality=value;this.onSettings('quality');break;
      case 'setPerformanceMode':this.performanceMode=value;this.onSettings('performance');break;
      case 'setCamera':g.cameraMode=value;break;
      case 'setLighting':g.lightingMode=value;break;
      case 'setAudio':this.audioOn=value;this.onSettings('audio');break;
      case 'setVolume':this.volume=value;this.onSettings('audio');break;
      case 'nextEncounter':
        if(g.mode!=='solo'||!this.individual.next())return {ok:false,message:'Todavía no hay un siguiente encuentro disponible.'};
        this.configure();g.start();break;
      case 'resetCampaign':this.individual.resetProgress();this.individual.select('campaign');this.configure();break;
      case 'replayOpen':{
        const clip=this.recorder.clips.find(clip=>clip.id===value);
        if(!['ready','burst','matchover'].includes(g.phase)||!clip?.frames.length)return {ok:false,message:'La repetición no está disponible durante el combate.'};
        this.neutralize();this.playback={clip,time:0,paused:false,index:-1,view:null};this.onSettings('replay');break;
      }
      case 'replaySeek':if(!this.playback)return {ok:false,message:'Abrí una repetición primero.'};this.playback.time=value*this.playback.clip.duration;this.playback.paused=true;break;
      case 'replayToggle':if(!this.playback)return {ok:false,message:'Abrí una repetición primero.'};this.playback.paused=!this.playback.paused;break;
      case 'replaySpeed':this.replaySpeed=value;break;
      case 'replayClose':this.closeReplay();break;
      case 'replayClear':this.closeReplay();this.recorder.clear();break;
    }
    this.message=command==='start'?'Prepará tu ataque.':command==='reset'?'Partida reiniciada.':command.startsWith('replay')?'Repetición actualizada.':'Opción aplicada.';
    return {ok:true,message:this.message};
  }
  menuState(){
    const g=this.game,view=matchView(g),p=this.playback;
    const matchMessage=p?'Repetición · partida en pausa.':g.phase==='countdown'?`Preparados · ${g.count||'¡Ya!'}`:
      g.phase==='fight'?(g.suddenDeath?'Tiempo extra · gana el próximo pinchazo.':'Combate en curso.'):
      g.phase==='burst'?view.burstSubtitle:g.phase==='matchover'?`${view.winnerName} gana la partida. Iniciá la revancha desde este menú.`:this.message;
    return sanitizeMenuState({phase:g.phase,mode:g.mode,experience:this.individual.kind,difficulty:g.difficulty,bestOf:g.bestOf,arena:g.arena,
      quality:g.quality,performanceMode:this.performanceMode,camera:g.cameraMode,lighting:g.lightingMode,audioOn:this.audioOn,volume:this.volume,
      scores:g.scores,round:g.round,clock:view.clock,
      fighters:view.fighters.map((f,index)=>({...f,slot:index+1,equipment:g.loadouts[index],balloonColor:g.fighters[index].balloonColor})),
      objective:g.mode==='solo'?this.individual.view(g):null,
      replay:{clips:this.recorder.clips.map(({id,duration,complete})=>({id,duration,complete})),active:!!p,paused:p?.paused??true,speed:this.replaySpeed,position:p?.clip.duration?p.time/p.clip.duration:0,clipId:p?.clip.id??null},
      configurable:this.configurable,trainingEquipmentLocked:this.sessionEquipment.locked,message:matchMessage,...(this.rendererError?{rendererError:this.rendererError}:{}),...(this.assetStatus?{assets:this.assetStatus}:{})});
  }
}
