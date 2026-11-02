import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compileFunction} from 'node:vm';

// Diagnostic only: every scenario starts a normal Versus round and changes
// only equipment and public controller input. No pose/q/radius/contact/score
// mutation is used to create a parry. Abort if any engine dependency changes.
const root=new URL('../',import.meta.url),engineURL=new URL('public/engine.js',root);
const sources=new Map();
async function dependencies(url){
  if(sources.has(url.href))return;
  const source=await fs.readFile(url),text=source.toString('utf8');
  sources.set(url.href,createHash('sha256').update(source).digest('hex'));
  for(const match of text.matchAll(/(?:from\s*|import\s*)(['"])(\.[^'"\n]+)\1/g)){
    const dependency=new URL(match[2],url);if(dependency.pathname.endsWith('.js'))await dependencies(dependency);
  }
}
await dependencies(engineURL);
for(const [file,pin] of Object.entries({
  'public/engine.js':'61612011274272dd45911724952333d7f3572db08f16aad41f3c67538a463f16',
  'public/physics/articulated-rig.js':'98a049f8b2aec9f11d2a54e5d959d0cafa40810c5e064e7bd9b4937be4a46a45',
  'public/physics/limb-state.js':'34f450f643d527b2e6f56bc94b21be3807f391b572fc78d50f49b50b92f56d73',
  'public/physics/character-intent.js':'ba5fdcb48dabeece52ee8e81d0ccafaa30bb13f24754a6ab5e6c33a99995b121',
}))assert.equal(sources.get(new URL(file,root).href),pin,'requested frozen source '+file);
async function assertStable(){
  for(const [url,hash] of sources)assert.equal(createHash('sha256').update(await fs.readFile(new URL(url))).digest('hex'),hash,'source changed: '+url);
}
const {DuelEngine,STEP}=await import(engineURL.href);await assertStable();
const receiptURL=new URL('audit/knife-n16-root-results-113-ba5f.json',root);
const sourceHashes=Object.fromEntries([...sources].map(([url,hash])=>[new URL(url).pathname.slice(root.pathname.length),hash]));
let receipt={schema:1,description:'Diagnostic recipes; normal-countdown runs qualify separately from unchanged historical fixture isolation.',sourceHashes,runs:[]};
try{const previous=JSON.parse(await fs.readFile(receiptURL,'utf8'));assert.deepEqual(previous.sourceHashes,sourceHashes,'previous receipt belongs to this exact dependency closure');receipt=previous;}catch(error){if(error.code!=='ENOENT')throw error;}
async function record(result){
  await assertStable();receipt.runs.push({...result,probeHash:createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex'),verifiedAt:new Date().toISOString()});
  await fs.writeFile(receiptURL,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(result));
}
function pointSegment(p,a,b){
  const d={x:b.x-a.x,y:b.y-a.y,z:(b.z??0)-(a.z??0)},v={x:p.x-a.x,y:p.y-a.y,z:(p.z??0)-(a.z??0)};
  const t=Math.max(0,Math.min(1,(v.x*d.x+v.y*d.y+v.z*d.z)/(d.x*d.x+d.y*d.y+d.z*d.z)));
  return Math.hypot(v.x-d.x*t,v.y-d.y*t,v.z-d.z*t);
}
async function run(recipe){
  await assertStable();let game,tick=-1;const clang=[],bursts=[],materials=[];let closest={distance:Infinity};
  game=new DuelEngine((name,data)=>{
    if(name==='clang'&&data.defender===recipe.slot)clang.push({tick,...data,score:game.scores.slice(),attackerImpulse:structuredClone(game.fighters[2-recipe.slot].rig.lastImpulse),defenderImpulse:structuredClone(game.fighters[recipe.slot-1].rig.lastImpulse)});
    if(name==='burst')bursts.push({tick,winner:data.winner,loser:data.loser,contact:data.contact});
    if(name==='material-contact')materials.push({tick,bodyA:data.bodyA,bodyB:data.bodyB,impulse:data.impulse});
  });
  game.setMode('versus');game.setLoadout(recipe.slot,{weapon:'sword',defense:'knife',...(recipe.grip==='reverse'?{knifeGrip:'reverse'}:{})});
  game.setLoadout(3-recipe.slot,{weapon:recipe.weapon??'sword',defense:'none'});game.start();
  for(let i=0;i<100&&game.phase==='countdown';i++)game.update(.04);
  assert.equal(game.phase,'fight','normal countdown completed');
  for(tick=0;tick<(recipe.ticks??420)&&game.phase==='fight'&&!clang.some(c=>c.impulse>1e-5);tick++){
    const prep=tick<(recipe.prep??75),cycle=(tick-(recipe.prep??75))%(recipe.cycle??240);
    const active=!prep&&(!recipe.sweep||cycle<120),aim=recipe.sweep?recipe.aim+(recipe.endAim-recipe.aim)*Math.min(1,Math.max(0,cycle)/90):recipe.aim;
    game.setControl(recipe.slot,{guard:recipe.manualGuard!==false,offX:.85,offY:recipe.offY??1,mainX:-1,mainY:recipe.defMainY??(recipe.slot===1?-1:1),wrist:recipe.defWrist??(recipe.slot===1?-1:1),lean:prep?(recipe.defPrepLean??0):(recipe.defLean??0)});
    game.setControl(3-recipe.slot,active?{mainX:1,mainY:aim,wrist:recipe.wrist,lean:recipe.atkLean??1,...(recipe.held?{attackHeld:true}:{}),thrust:tick===(recipe.thrust??145)}:{mainX:-1,mainY:recipe.prepAim??-1,wrist:recipe.prepWrist??-1,lean:prep?(recipe.atkPrepLean??-1):-1});
    game.update(STEP);
    const d=game.fighters[recipe.slot-1],a=game.fighters[2-recipe.slot];
    const distance=pointSegment(a.pose.tip,d.pose.offHand,d.pose.defenseTip);
    if(distance<closest.distance)closest={tick,distance,tip:{...a.pose.tip},hand:{...d.pose.offHand},dagger:{...d.pose.defenseTip},head:{...d.pose.head},bases:game.fighters.map(f=>({intended:f.baseX,achieved:f.rig.pose().hip.x}))};
  }
  await assertStable();
  const event=clang.find(c=>c.impulse>1e-5)??null;
  const checks=event?{offWeapon:event.bodyB==='offWeapon',zeroScore:event.score.every(s=>s===0),friction:Math.abs(event.frictionImpulse??0)>1e-6,
    oppositeImpulses:Math.hypot(event.attackerImpulse.impulse.x+event.defenderImpulse.impulse.x,event.attackerImpulse.impulse.y+event.defenderImpulse.impulse.y)<1e-7,
    beforeBurst:bursts.length===0,positiveImpulse:event.impulse>1e-5}:null;
  const result={startup:'normal-countdown',recipe,ticks:tick,phase:game.phase,clangCount:clang.length,impulsive:clang.filter(c=>c.impulse>1e-5).length,burst:bursts,closest,materialCount:materials.length,checks,qualified:!!checks&&Object.values(checks).every(Boolean),clang:event??clang[0]??null};
  if(result.qualified&&recipe.grip==='reverse'){
    const fighter=game.fighters[recipe.slot-1],before=clang.length,score=game.scores.slice();
    assert.equal(fighter.guard,true,'the successful parry is active before real damage');
    assert.equal(fighter.rig.damageJoint('offElbow',1).detached,true,'ordinary damage API severs the defense');
    game.detectHits();game.updateFighter(fighter,STEP);
    result.afterDetachment={attached:fighter.rig.isBodyAttached('offWeapon'),parentBody:fighter.rig.diagnostics().bodies.some(b=>b.name==='offWeapon'),additionalClangs:clang.length-before,guard:fighter.guard,score:game.scores.slice()};
    assert.deepEqual(result.afterDetachment,{attached:false,parentBody:false,additionalClangs:0,guard:false,score},'the actual just-parried sweep cannot hit a phantom blade');
  }
  await record(result);return result;
}
async function diagnoseHistoricalReverse(){
  // Run the exact unchanged helper to identify which pre-N16 recipe is stale.
  // Its historical direct-phase setup is NOT qualified as a new gameplay recipe.
  const url=new URL('tests/knife-defense-integration.test.mjs',root),text=await fs.readFile(url,'utf8');
  const start=text.indexOf('function realParry('),end=text.indexOf('function guardPose(',start);
  assert.ok(start>=0&&end>start);const realParry=compileFunction(text.slice(start,end)+'\nreturn realParry;',['DuelEngine','STEP'])(DuelEngine,STEP);
  for(const recipe of presets.filter(p=>p.id.startsWith('baseline-')&&p.grip==='reverse')){
    await assertStable();const original={slot:recipe.slot,grip:recipe.grip,aim:recipe.aim,wrist:recipe.wrist,attackerWeapon:recipe.weapon,offMainY:recipe.defMainY,offWrist:recipe.defWrist,requireImpulse:false};
    const {game,observed,contacts}=realParry(original);
    const result={startup:'unchanged-historical-direct-phase-fixture',fixtureHash:createHash('sha256').update(text).digest('hex'),recipe:original,phase:game.phase,score:game.scores.slice(),observed:!!observed,clang:observed?.event??null,contactCount:contacts.length};
    if(observed){const fighter=game.fighters[recipe.slot-1],before=contacts.length;fighter.rig.damageJoint('offElbow',1);game.detectHits();game.updateFighter(fighter,STEP);result.afterDetachment={attached: fighter.rig.isBodyAttached('offWeapon'),additionalClangs:contacts.length-before,guard:fighter.guard};}
    await record(result);
  }
}
const presets=[
  {id:'baseline-J1-normal',slot:1,grip:'normal',aim:.2,wrist:.35},
  {id:'baseline-J1-reverse',slot:1,grip:'reverse',aim:-.7,wrist:.2},
  {id:'baseline-J2-normal',slot:2,grip:'normal',aim:.5,wrist:-.35},
  {id:'baseline-J2-reverse',slot:2,grip:'reverse',aim:-.4,wrist:-.4,weapon:'axe',defMainY:-1,defWrist:-1},
  {id:'J1-close-normal',slot:1,grip:'normal',aim:.2,wrist:.35,defPrepLean:1,atkPrepLean:0},
  {id:'J1-close-normal-low',slot:1,grip:'normal',aim:-.5,wrist:.15,defPrepLean:1,atkPrepLean:0},
  {id:'J1-close-normal-high',slot:1,grip:'normal',aim:.8,wrist:-.15,defPrepLean:1,atkPrepLean:0},
  {id:'J1-close-normal-axe',slot:1,grip:'normal',aim:.2,wrist:.35,weapon:'axe',defPrepLean:1,atkPrepLean:0},
  {id:'J1-advance-normal',slot:1,grip:'normal',aim:.2,wrist:.35,defLean:1,atkPrepLean:0},
  {id:'J1-normal-sweep',slot:1,grip:'normal',aim:1,endAim:-1,wrist:.1,sweep:true,defPrepLean:1,atkPrepLean:0},
  {id:'J1-normal-sweep-up',slot:1,grip:'normal',aim:-1,endAim:1,wrist:-.1,sweep:true,defPrepLean:1,atkPrepLean:0},
  {id:'J1-normal-spear',slot:1,grip:'normal',aim:.3,wrist:.2,weapon:'spear',defPrepLean:1,atkPrepLean:0},
  ...[.5,.25,0,-.25,-.5].map(offY=>({id:'J1-height-'+offY,slot:1,grip:'normal',aim:.2,wrist:.35,offY,defPrepLean:1,atkPrepLean:0})),
  {id:'R1-close-old',slot:1,grip:'reverse',aim:-.7,wrist:.2,defPrepLean:1,atkPrepLean:0,thrust:-1},
  {id:'R2-close-old',slot:2,grip:'reverse',aim:-.4,wrist:-.4,weapon:'axe',defMainY:-1,defWrist:-1,defPrepLean:1,atkPrepLean:0,thrust:-1},
  ...[1,2].map(slot=>({id:'R'+slot+'-close-mid',slot,grip:'reverse',aim:.2,wrist:.35,defMainY:-1,defWrist:-1,defPrepLean:1,atkPrepLean:0,thrust:-1})),
  ...[1,2].map(slot=>({id:'R'+slot+'-descending',slot,grip:'reverse',aim:-.2,wrist:0,defMainY:-1,defWrist:-1,defPrepLean:1,atkPrepLean:0,prep:150,prepAim:1,prepWrist:1,thrust:-1})),
  ...[1,2].map(slot=>({id:'R'+slot+'-descending-low',slot,grip:'reverse',aim:-.7,wrist:.2,defMainY:-1,defWrist:-1,defPrepLean:1,atkPrepLean:0,prep:150,prepAim:1,prepWrist:1,thrust:-1})),
  ...[1,2].flatMap(slot=>[-.25,.25,.5].map(defLean=>({id:'T'+slot+'-mid-lean-'+defLean,slot,grip:'reverse',aim:.2,wrist:.35,defMainY:-1,defWrist:-1,defPrepLean:1,atkPrepLean:0,thrust:-1,defLean}))),
  ...[-1,0].map(offY=>({id:'T2-descending-height-'+offY,slot:2,grip:'reverse',aim:-.2,wrist:0,offY,defMainY:-1,defWrist:-1,defPrepLean:1,atkPrepLean:0,prep:150,prepAim:1,prepWrist:1,thrust:-1})),
];
const selected=process.argv[2]==='legacy-reverse'?[]:process.argv[2]==='final-reverse'?presets.filter(p=>p.id==='T1-mid-lean-0.25'||p.id==='T2-mid-lean-0.25'):process.argv[2]==='reverse-tune'?presets.filter(p=>p.id.startsWith('T')):process.argv[2]==='reverse'?presets.filter(p=>p.id.startsWith('R')):process.argv[2]==='reconfirm'?presets.filter(p=>p.id==='J1-height--0.25'):process.argv[2]==='heights'?presets.filter(p=>p.id.startsWith('J1-height-')):process.argv[2]?presets.filter(p=>p.id===process.argv[2]):presets;
if(['legacy-reverse','reconfirm'].includes(process.argv[2]))await diagnoseHistoricalReverse();
if(process.argv[2]!=='legacy-reverse'){
assert.ok(selected.length,'known diagnostic preset required');
for(const preset of selected)await run(preset);
}
console.log(JSON.stringify({frozen:true,dependencies:sources.size,engine:sources.get(engineURL.href),rig:sources.get(new URL('public/physics/articulated-rig.js',root).href)}));
