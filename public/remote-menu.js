/** Shared wire contract. Neither controller payloads nor the host's scene leak into menu DTOs. */
import {WEAPONS,DEFENSES,normalizeLoadout} from './equipment.js';

const oneOf=(value,values,fallback)=>values.includes(value)?value:fallback;
const finite=(value,min,max,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
const integer=(value,min,max,fallback=0)=>Math.round(finite(value,min,max,fallback));
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const positive=value=>Number.isSafeInteger(value)&&value>0;
const text=(value,max=160)=>typeof value==='string'?value
  .replace(/(?:https?:\/\/|file:\/\/\/)[^\s]+/gi,'[dirección omitida]')
  .replace(/\b[A-Za-z]:[\\/][^\s]+/g,'[ruta omitida]')
  .replace(/(?:^|\s)\/(?:Users|home|tmp|var)\/[^\s]+/g,' [ruta omitida]')
  .replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
// Asset loaders may report local paths or failing fetch URLs. Keep that detail
// in the PC console; the mobile receives bounded human-facing labels only.
const assetText=(value,max)=>text(value,2048)
  .replace(/\b(?:hostToken|token|key|authorization|clave)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi,'[credencial omitida]')
  .replace(/\b[a-f0-9]{32,128}\b/gi,'[credencial omitida]')
  .replace(/(?:^|\s)\S*[\\/]\S*(?=\s|$)/g,' [ruta omitida]')
  .trim().slice(0,max);
const assetLabels=(value,limit,length)=>Array.isArray(value)?value.filter(label=>typeof label==='string')
  .map(label=>assetText(label,length)).filter(Boolean).slice(0,limit):[];
const actions=new Set(['start','reset','replayToggle','replayClose','replayClear','nextEncounter','resetCampaign']);
const experiences=['duel','training','practice','precision','campaign','parry','moving','depth'];
const options={
  setMode:['solo','versus'],setExperience:experiences,
  setDifficulty:['rookie','normal','expert','boss'],setBestOf:[3,5],setArena:['atelier','dojo','midnight'],
  setQuality:['high','ultra','eco'],setPerformanceMode:['adaptive','fixed'],setCamera:['combat','detail'],setLighting:['cinematic','neutral'],
  setAudio:[true,false],replaySpeed:[.25,.5,1],
};

/** Validate types strictly; clock freshness and permissions belong to the authenticated relay. */
export function normalizeMenuCommand(message){
  const source=record(message);
  if(source.type!=='command'||!positive(source.requestId)||typeof source.sentAt!=='number'||!Number.isFinite(source.sentAt)||source.sentAt<0)return null;
  const command=source.command,value=source.value;
  if(typeof command!=='string')return null;
  const clean={requestId:source.requestId,sentAt:source.sentAt,command};
  if(actions.has(command))return value===undefined?clean:null;
  if(Object.hasOwn(options,command)){
    if(!options[command].includes(value))return null;
  }else if(command==='setVolume'){
    if(!Number.isInteger(value)||value<0||value>100)return null;
  }else if(command==='replayOpen'){
    if(!positive(value))return null;
  }else if(command==='replaySeek'){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)return null;
  }else if(command==='setLoadout'){
    const loadout=record(value);
    if(![1,2].includes(loadout.slot)||!Object.hasOwn(WEAPONS,loadout.weapon)||!Object.hasOwn(DEFENSES,loadout.defense))return null;
    return {...clean,value:{slot:loadout.slot,weapon:loadout.weapon,defense:loadout.defense}};
  }else return null;
  return {...clean,value};
}

/** Bounded, fresh, JSON-only copy. Deliberately excludes invitation keys, URLs, frames and scene internals. */
export function sanitizeMenuState(value){
  const state=record(value),replay=record(state.replay),objective=record(state.objective);
  const total=integer(objective.total,0,100);
  const fighters=Array.isArray(state.fighters)?state.fighters.slice(0,2):[];
  const clips=Array.isArray(replay.clips)?replay.clips.filter(clip=>positive(clip?.id)).slice(0,3):[];
  const hasAssets=state.assets&&typeof state.assets==='object'&&!Array.isArray(state.assets),assets=record(state.assets);
  const assetTotal=integer(assets.total,0,4096);
  return {
    phase:oneOf(state.phase,['ready','countdown','fight','burst','matchover'],'ready'),
    mode:oneOf(state.mode,['solo','versus'],'solo'),
    experience:oneOf(state.experience,experiences,'duel'),
    difficulty:oneOf(state.difficulty,['rookie','normal','expert','boss'],'normal'),
    bestOf:state.bestOf===5?5:3,arena:oneOf(state.arena,['atelier','dojo','midnight'],'atelier'),
    quality:oneOf(state.quality,['high','ultra','eco'],'high'),performanceMode:oneOf(state.performanceMode,['adaptive','fixed'],'fixed'),camera:oneOf(state.camera,['combat','detail'],'combat'),
    lighting:oneOf(state.lighting,['cinematic','neutral'],'cinematic'),audioOn:state.audioOn===true,
    volume:integer(state.volume,0,100,70),
    scores:[integer(state.scores?.[0],0,9999),integer(state.scores?.[1],0,9999)],round:integer(state.round,1,9999,1),
    clock:typeof state.clock==='string'&&/^\+?\d{2,3}:\d{2}$/.test(state.clock)?state.clock:'01:30',
    fighters:fighters.map((raw,index)=>{const fighter=record(raw);return {
      slot:index+1,name:text(fighter.name,64),equipment:normalizeLoadout(record(fighter.equipment)),
      balloonColor:oneOf(fighter.balloonColor,['mint','amber','cobalt','violet','crimson','gold','rose','coral'],index===0?'mint':'amber'),
      ...(fighter.emblem?{emblem:{glyph:text(record(fighter.emblem).glyph,3),name:text(record(fighter.emblem).name,48)}}:{}),
      guardPercent:integer(fighter.guardPercent,0,100),guardLabel:text(fighter.guardLabel,32),
      wins:Array.isArray(fighter.wins)?fighter.wins.slice(0,3).map(value=>value===true):[],
    };}),
    objective:state.objective==null?null:{
      kind:oneOf(objective.kind,experiences,'duel'),
      title:text(objective.title,96),instruction:text(objective.instruction,320),progress:integer(objective.progress,0,total),total,
      completed:objective.completed===true,nextAction:oneOf(objective.nextAction,['advance','retry','repeat'],null),
    },
    replay:{clips:clips.map(clip=>({id:clip.id,duration:finite(clip.duration,0,30),complete:clip.complete===true})),
      active:replay.active===true,paused:replay.paused===true,speed:oneOf(replay.speed,[.25,.5,1],1),position:finite(replay.position,0,1)},
    configurable:state.configurable===true,trainingEquipmentLocked:state.trainingEquipmentLocked===true,
    ...(state.trainingEquipmentLocked&&typeof state.trainingEquipmentReason==='string'?{trainingEquipmentReason:text(state.trainingEquipmentReason,160)}:{}),
    ...(hasAssets?{assets:{loading:assets.loading===true,ready:integer(assets.ready,0,assetTotal),total:assetTotal,
      names:assetLabels(assets.names,16,64),errors:assetLabels(assets.errors,12,160),
      gpuBytesApprox:integer(assets.gpuBytesApprox,0,16*1024**3)}}:{}),
    performance:state.performance?Object.fromEntries(['steady','clash','detach','burst'].map(kind=>{const m=record(state.performance[kind]);return [kind,m.samples?{samples:integer(m.samples,0,10000),fpsMean:finite(m.fpsMean,0,1000),frameP95Ms:finite(m.frameP95Ms,0,60000),frameMaxMs:finite(m.frameMaxMs,0,60000),sessionMaxMs:finite(m.sessionMaxMs,0,60000),simulationMeanMs:finite(m.simulationMeanMs,0,60000),renderCpuMeanMs:finite(m.renderCpuMeanMs,0,60000)}:null];})):null,
    message:text(state.message,240),...(typeof state.rendererError==='string'?{rendererError:text(state.rendererError,240)}:{}),
  };
}
