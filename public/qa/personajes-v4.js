import {DuelEngine,STEP} from '../engine.js';
import {Renderer3D} from '../render3d.js';
import {characterTransforms,equipmentTransform} from '../rendering/asset-rig.js';
import {jointDamageTraces} from '../rendering/joint-damage.js';
import {resultIntent} from '../physics/character-intent.js';

const $=id=>document.getElementById(id),canvas=$('canvas');
const presets={guardia:'Guardia',marcha:'Marcha',esquiva:'Esquiva',pano:'Paño',dano:'Daño explícito QA',celebracion:'Resultado explícito QA',jefe:'Jefe real · solo'};
const neutral={mainX:0,mainY:0,offX:0,offY:0,lean:0,wrist:0,headX:0,headZ:0,bodyY:0,guard:false,thrust:false,attackHeld:false};
let renderer=null,game=null,preset='guardia',ready=false,paused=false,closed=false,error=null;
let ticks=0,damageStage=0,previous=performance.now(),accumulator=0,raf=0,lastReport=0;
const events=[];
const finiteMatrix=m=>!!m&&m.length===16&&Array.from(m).every(Number.isFinite);
function fighterReport(f){
  const entry=renderer?.assetScene.characters[f.boss?'boss':f.slot===1?'mint':'amber'];
  const matrices=entry?characterTransforms(entry.prepared,f):[];
  const cloth=f.pose.apron?.cloth,traces=jointDamageTraces(f.pose);
  return {slot:f.slot,boss:f.boss,scale:f.rig.scale,equipment:f.equipment,controller:f.controller,
    character:{loaded:!!entry,revision:entry?.prepared.asset.json?.materials?.some(m=>m.extras?.v4_atlas_uv===1)?4:null,
      matrices:matrices.length,matricesFinite:matrices.length>0&&matrices.every(finiteMatrix)},
    equipmentMatrices:Object.fromEntries([f.equipment.weapon,f.equipment.defense].filter(key=>key!=='none').map(key=>{
      const transform=equipmentTransform(f,key);return [key,{loaded:!!renderer?.assetScene.equipment[key],finite:finiteMatrix(transform?.matrix)}];
    })),
    feet:Object.fromEntries(Object.entries(f.pose.feet??{}).map(([side,foot])=>[side,{angle:foot.angle,matrixFinite:finiteMatrix(foot.matrix),
      center:foot.center,support:foot.support,stance:foot.stance,groundReaction:foot.groundReaction,hullMinimumY:Math.min(...foot.hull.map(p=>p.y))}])),
    apron:{revision:cloth?.revision??null,clothPositions:cloth?.positions??[],positionsFinite:!!cloth?.positions?.length&&cloth.positions.every(p=>p.every(Number.isFinite)),contact:f.pose.apron?.contact??null,wetness:f.pose.apron?.wetness??null},
    damage:{joints:f.pose.joints??{},markStages:[...new Set(traces.map(mark=>mark.stage))],traceCount:traces.length,
      surfaceMarks:f.pose.surface?.marks?.length??0,fragments:(f.pose.detached??[]).map(part=>({id:part.id,joint:part.joint,bodies:part.bodies,matrixFinite:finiteMatrix(part.transform)}))},
    result:{intact:f.globIntact,passive:f.rig.passive,gesture:resultIntent(f,{phase:game.phase,phaseClock:game.phase==='burst'&&Number.isFinite(game.burstStepClock.origin)?game.clock-game.burstStepClock.origin:game.phaseClock,clock:game.clock,winner:game.winner,reducedMotion:game.reducedMotion})}};
}
function report(){
  const data={fixture:'personajes-v4',scope:'Public local QA: legal setControl + STEP; damageJoint/burst are explicit demonstrations.',
    ready,preset,paused,ticks,time:game?.clock??0,step:STEP,phase:game?.phase??null,phaseTime:game?.phaseClock??0,
    assets:renderer?.assetStatus??null,environmentRevision:renderer?.assetScene.environment?.revision??null,
    fighters:game?game.fighters.map(fighterReport):[],result:game?{winner:game.winner,scores:game.scores,demonstration:game.demonstration}:null,
    draws:renderer?.stats.draws??0,triangles:renderer?.stats.triangles??0,events:events.slice(),error};
  $('result').textContent=JSON.stringify(data,null,2);return data;
}
function fail(cause){error=cause instanceof Error?cause.message:String(cause);paused=true;$('status').textContent=`Error: ${error}`;syncPause();report();}
function syncPause(){$('pause').textContent=paused?'Continuar':'Pausar';$('pause').setAttribute('aria-pressed',String(paused));}
function pause(value=!paused){paused=!!value;accumulator=0;previous=performance.now();syncPause();return report();}
function controls(){
  const age=ticks*STEP,cycle=age%4;
  for(const f of game.fighters){
    let input={...neutral,mainX:-1,mainY:-1,wrist:-.7};
    if(preset==='guardia')input={...neutral,guard:true,offX:.55,offY:.55,mainX:-.3,mainY:.2};
    if(preset==='marcha')input.lean=cycle<2?.75:-.75;
    if(preset==='esquiva')Object.assign(input,{lean:-.2,bodyY:cycle<1?-1:cycle<2?0:cycle<2.8?1:0,headZ:f.dir*.65});
    if(preset==='pano')Object.assign(input,{lean:.55*Math.sin(age*2),bodyY:cycle<1.2?-.6:0,headZ:.4*Math.sin(age*1.5)});
    if(preset==='celebracion')input={...neutral};
    if(preset==='jefe'&&f.slot===1)input.lean=-.35;
    game.setControl(f.slot,input);
  }
}
function applyDamage(){
  if(preset!=='dano'||game.phase!=='fight')return;
  const milestones=[{at:0,amount:.25},{at:1.3,amount:.35},{at:2.6,amount:.30},{at:4,amount:.11}];
  while(damageStage<milestones.length&&ticks*STEP>=milestones[damageStage].at){
    const f=game.fighters[0],action=milestones[damageStage++],change=f.rig.damageJoint('mainElbow',action.amount);
    game.refreshRigPose(f,STEP);events.push({name:'explicit-QA-damageJoint',at:ticks*STEP,joint:'mainElbow',...change});
  }
}
function advance(){controls();applyDamage();game.update(STEP);ticks++;}
function draw(){if(game&&renderer)renderer.render(game.presentationState(0),game.clock);}
function step(count=1){
  if(!ready||closed)throw new Error('La fixture todavía no está disponible.');
  if(!Number.isInteger(count)||count<0||count>1200)throw new RangeError('step requiere un entero entre 0 y 1200.');
  try{for(let i=0;i<count;i++)advance();accumulator=0;previous=performance.now();draw();return report();}catch(cause){fail(cause);throw cause;}
}
function select(next){
  if(!Object.hasOwn(presets,next))throw new RangeError(`Preset desconocido: ${next}`);
  if(!ready||closed)throw new Error('La fixture todavía no está disponible.');
  preset=next;ticks=0;damageStage=0;error=null;events.length=0;accumulator=0;previous=performance.now();
  game=new DuelEngine((name,data)=>{if(['burst','joint-break','matchover'].includes(name)){events.push({name,...data});if(events.length>16)events.shift();}});
  game.setMode(next==='jefe'?'solo':'versus');if(next==='jefe')game.setDifficulty('boss');
  game.setLoadout(1,{weapon:'sword',defense:next==='guardia'?'short':'none'});
  game.setLoadout(2,{weapon:next==='jefe'?'maul':'sword',defense:next==='guardia'?'long':'none'});
  game.aiEnabled=next==='jefe';game.quality='high';game.cameraMode='combat';game.start();
  // Countdown uses the same fixed step as every preset; never assign phase/q/pose.
  for(let i=0;game.phase==='countdown'&&i<400;i++)game.update(STEP);
  if(game.phase!=='fight')throw new Error('El countdown no alcanzó fight.');
  renderer.waterSurfaces.clear();
  if(next==='celebracion'){
    for(const f of game.fighters)game.setControl(f.slot,{...neutral});
    const [winner,loser]=game.fighters,h=loser.pose.head;
    game.burst(loser,winner,{x:h.x-.40*loser.balloonSize,y:h.y,z:h.z,incoming:{x:1,y:0,z:0}},false,{demonstration:true});
    events.push({name:'explicit-QA-burst',note:'Resultado de demostración, no perforación adjudicada por contacto.'});
  }
  applyDamage();
  for(const button of document.querySelectorAll('[data-preset]'))button.setAttribute('aria-pressed',String(button.dataset.preset===preset));
  $('status').textContent=`${presets[preset]} · ${next==='dano'?'damageJoint .25 → .60 → .90 → separación.':next==='celebracion'?'burst de demostración; gesto por intención del motor.':'Mandos y evolución física reales.'}`;
  draw();return report();
}
function frame(now){
  if(closed)return;
  try{
    const elapsed=Math.max(0,Math.min(.05,(now-previous)/1000));previous=now;
    if(game&&!paused&&!document.hidden){accumulator+=elapsed;let steps=0;while(accumulator>=STEP&&steps++<6){advance();accumulator-=STEP;}}
    draw();if(now-lastReport>250){lastReport=now;report();}
  }catch(cause){fail(cause);}
  raf=requestAnimationFrame(frame);
}
window.personajesV4QA=Object.freeze({select,step,report,pause});
for(const button of document.querySelectorAll('[data-preset]'))button.addEventListener('click',()=>{try{select(button.dataset.preset);}catch(cause){fail(cause);}});
$('pause').addEventListener('click',()=>pause());$('reset').addEventListener('click',()=>{try{select(preset);}catch(cause){fail(cause);}});
$('step-second').addEventListener('click',()=>{try{step(120);}catch(cause){fail(cause);}});
document.addEventListener('visibilitychange',()=>{previous=performance.now();accumulator=0;});
window.addEventListener('pagehide',()=>{closed=true;ready=false;cancelAnimationFrame(raf);renderer?.dispose();},{once:true});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();closed=true;ready=false;cancelAnimationFrame(raf);fail(new Error('Contexto WebGL perdido; recargá la fixture.'));});
try{
  renderer=new Renderer3D(canvas);renderer.quality=1;
  await renderer.loadAssets(status=>{$('status').textContent=`Assets locales ${status.ready}/${status.total}${status.loading?' · cargando…':status.errors.length?' · revisar errores del informe.':' · cargados.'}`;});
  if(!closed){ready=true;for(const button of document.querySelectorAll('button'))button.disabled=false;select('guardia');raf=requestAnimationFrame(frame);}
}catch(cause){fail(cause);renderer?.dispose();}
