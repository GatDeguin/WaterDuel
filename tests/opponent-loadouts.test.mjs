import test from 'node:test';
import assert from 'node:assert/strict';
import {BALLOON_COLORS,balloonPalette,randomOpponent,seededOpponentRandom} from '../public/opponent-loadouts.js';
import {CAMPAIGN,SinglePlayerSession} from '../public/single-player.js';
import {HostSession} from '../public/host-session.js';
import {captureReplayState,replayView} from '../public/replay.js';
import {WEAPONS,DEFENSES} from '../public/equipment.js';
import {Renderer3D} from '../public/render3d.js';

let request=0;
const command=(h,command,value)=>h.handleCommand({type:'command',requestId:++request,sentAt:Date.now(),command,...(value===undefined?{}:{value})});
const opponent=h=>({equipment:{...h.game.fighters[1].equipment},color:h.game.fighters[1].balloonColor});
function finish(h,winner){
  // Match-management contract fixture. Physical collision/scoring has its own tests.
  h.game.phase='matchover';h.game.winner=winner;h.game.onEvent('matchover',{winner});
}

test('los siete rivales de campaña tienen equipos distintos, legales y estables',()=>{
  assert.equal(new Set(CAMPAIGN.map(x=>JSON.stringify(x.opponentLoadout))).size,7);
  const s=new SinglePlayerSession({seed:42});s.select('campaign');
  for(let stage=0;stage<7;stage++){
    const a=s.configuration(),loadout=a.opponentLoadout;
    assert.ok(WEAPONS[loadout.weapon]);assert.ok(DEFENSES[loadout.defense]);
    if(WEAPONS[loadout.weapon].twoHanded)assert.equal(loadout.defense,'none');
    assert.ok(BALLOON_COLORS.includes(a.opponentColor));
    loadout.weapon='unknown';assert.notEqual(s.configuration().opponentLoadout.weapon,'unknown');
    if(stage<6){s.event('matchover',{winner:1},{mode:'solo'});assert.equal(s.next(),true);}
  }
});

test('sorteo sembrado cubre todas las armas, defensas y colores sin mazo con escudo',()=>{
  const a=seededOpponentRandom(0x93c),b=seededOpponentRandom(0x93c),weapons=new Set(),defenses=new Set(),colors=new Set();
  for(let i=0;i<200;i++){
    const x=randomOpponent(a),y=randomOpponent(b);assert.deepEqual(x,y);
    weapons.add(x.opponentLoadout.weapon);defenses.add(x.opponentLoadout.defense);colors.add(x.opponentColor);
    assert.notEqual(x.opponentColor,'mint');
    if(x.opponentLoadout.weapon==='maul')assert.equal(x.opponentLoadout.defense,'none');
  }
  assert.equal(weapons.size,4);assert.equal(defenses.size,4);assert.equal(colors.size,BALLOON_COLORS.length-1);
});

test('Duelo IA conserva rival entre rounds, opciones, revancha y derrota; victoria sortea otro',()=>{
  const h=new HostSession({opponentSeed:93}),first=opponent(h);
  assert.deepEqual(first,opponent(new HostSession({opponentSeed:93})));
  command(h,'setDifficulty','expert');assert.deepEqual(opponent(h),first);
  command(h,'setArena','dojo');assert.deepEqual(opponent(h),first);
  assert.equal(command(h,'start').ok,true);assert.deepEqual(opponent(h),first);
  h.game.resetRound();assert.deepEqual(opponent(h),first);
  finish(h,2);assert.equal(h.individual.view(h.game).nextAction,'retry');
  assert.equal(command(h,'nextEncounter').ok,true);assert.deepEqual(opponent(h),first);
  finish(h,1);assert.equal(h.individual.view(h.game).nextAction,'advance');
  assert.equal(command(h,'nextEncounter').ok,true);assert.notDeepEqual(opponent(h),first);
  const second=opponent(h);finish(h,2);assert.equal(command(h,'start').ok,true);assert.deepEqual(opponent(h),second);
});

test('campaña asigna equipo por encuentro y restaura elecciones de Versus al salir',()=>{
  const h=new HostSession({opponentSeed:9});command(h,'setMode','versus');
  command(h,'setLoadout',{slot:2,weapon:'axe',defense:'knife'});
  command(h,'setMode','solo');command(h,'setExperience','campaign');
  assert.deepEqual(h.game.loadouts[1],CAMPAIGN[0].opponentLoadout);
  finish(h,1);command(h,'nextEncounter');assert.deepEqual(h.game.loadouts[1],CAMPAIGN[1].opponentLoadout);
  finish(h,2);command(h,'nextEncounter');assert.deepEqual(h.game.loadouts[1],CAMPAIGN[1].opponentLoadout);
  h.game.resetMatch();command(h,'setMode','versus');assert.deepEqual(h.game.loadouts[1],{weapon:'axe',defense:'knife'});
  command(h,'setMode','solo');command(h,'setExperience','training');
  assert.deepEqual(h.game.loadouts,[{weapon:'sword',defense:'short'},{weapon:'sword',defense:'short'}]);
  command(h,'setMode','versus');assert.deepEqual(h.game.loadouts[1],{weapon:'axe',defense:'knife'});
});

test('replay conserva color y no sortea ni modifica datos guardados',()=>{
  const h=new HostSession({opponentSeed:24}),first=opponent(h);
  const frame=captureReplayState(h.game),saved=structuredClone(frame),view=replayView(frame);
  assert.equal(view.fighters[1].balloonColor,first.color);
  view.fighters[1].balloonColor='mint';assert.deepEqual(frame,saved);assert.deepEqual(opponent(h),first);
});

test('construir la sesión no emite callbacks antes de que el consumidor tenga su binding',()=>{
  const calls=[];const h=new HostSession({opponentSeed:1,onEvent:(...v)=>calls.push(v),onNeutralize:()=>calls.push('neutral')});
  assert.equal(calls.length,0);assert.ok(h.game.fighters[1].balloonColor);
});

test('práctica y precisión no sortean equipo de rival ni cambian el color durante una pelea',()=>{
  const h=new HostSession({opponentSeed:8});
  for(const kind of ['practice','precision']){
    command(h,'setExperience',kind);assert.deepEqual(h.game.loadouts[1],{weapon:'sword',defense:'short'});
    assert.equal(h.game.fighters[1].balloonColor,'amber');assert.equal(h.game.aiEnabled,false);
  }
  command(h,'start');assert.equal(h.game.setBalloonColor(2,'cobalt'),false);assert.equal(h.game.fighters[1].balloonColor,'amber');
});

test('el dibujado real usa el tinte de globo y látex sin alterar los materiales del cuerpo',()=>{
  const h=new HostSession({opponentSeed:2}),f=h.game.fighters[1];f.balloonColor='cobalt';
  const calls=[],renderer=Object.assign(Object.create(Renderer3D.prototype),{
    depthOnly:false,detailedPuppet:()=>true,detailedEquipment:()=>true,
    sphere(){},draw(){},dynamicDraw(mesh,color,material){calls.push({color,material});}});
  Renderer3D.prototype.drawPuppet.call(renderer,f,0,h.game);
  assert.equal(calls.find(x=>x.material===2)?.color,balloonPalette(f).balloon);
  assert.notEqual(balloonPalette(f).balloon,balloonPalette({slot:2,balloonColor:'amber'}).balloon);
  assert.equal(balloonPalette({slot:1,balloonColor:'invalid'}).balloon,balloonPalette({slot:1}).balloon);
});

test('agua liberada, gotas, ondas y fragmentos de látex siguen el color guardado del rival',()=>{
  const palette=balloonPalette({slot:2,balloonColor:'violet'}),pending=[],spheres=[],shards=[];
  const renderer={disableWaterMesh:true,waterSurfaces:new Map(),pending,sphere(...args){spheres.push(args);},draw(...args){shards.push(args);}};
  const game={quality:'high',fighters:[{slot:2,balloonColor:'violet',fluid:{released:true,releasedParticles:[{x:0,y:1,z:0,volume:.01}]}}],
    particles:[{color:2,x:0,y:1,z:0}],rings:[{color:2,x:0,z:0,r:.2,age:0,ttl:1}],
    shards:[{slot:2,x:0,y:1,z:0,rz:0,rx:0,size:.1}],spark:[]};
  Renderer3D.prototype.renderLiquid.call(renderer,game,0);
  assert.equal(pending[0].color,palette.drop);assert.equal(pending[1].color,palette.mist);
  assert.equal(spheres[0][6],palette.ring);assert.equal(shards[0][2],palette.balloon);
});
