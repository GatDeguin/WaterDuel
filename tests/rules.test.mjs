import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../public/engine.js';

const {DuelEngine,STEP}=engine;
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ≠ ${expected}`);
function game(){
  const events=[];
  const g=new DuelEngine((name,data)=>events.push({name,data}));
  g.setMode('versus');
  return {g,events};
}
function advanceUntil(g,phase){
  for(let i=0;i<110&&g.phase!==phase;i++)g.update(.04);
  assert.equal(g.phase,phase);
}
function exerciseFighter(g,slot,seconds,control){
  g.setControl(slot,control);
  for(let remaining=seconds;remaining>1e-10;remaining-=STEP){
    g.updateFighter(g.fighters[slot-1],Math.min(STEP,remaining));
  }
}
function aimAtHead(attacker,defender,lunge=.8){
  const h=defender.pose.head;
  attacker.previousTip={x:h.x-attacker.dir*.6,y:h.y};
  attacker.pose={...attacker.pose,tip:{x:h.x+attacker.dir*.1,y:h.y,z:.17}};
  attacker.lunge=lunge;
}
function prepareGuardedContact(g,lunge,energy=1,attackerSlot=1){
  const attacker=g.fighters[attackerSlot-1],defender=g.fighters[2-attackerSlot];
  aimAtHead(attacker,defender,lunge);
  defender.previousTip={...defender.pose.tip};
  defender.guard=true;
  defender.guardEnergy=energy;
  defender.guardBroken=false;
  defender.pose={...defender.pose,offHand:{x:defender.pose.head.x-attacker.dir*.5,y:defender.pose.head.y,z:.10},shieldDepth:{min:.135,max:.225},shieldRadius:.3};
  return {attacker,defender};
}

test('El contrato de reglas expone dos rondas para ganar y 90 segundos reglamentarios',()=>{
  assert.deepEqual(engine.RULES,{roundsToWin:2,regulationSeconds:90});
});

test('La guardia sostenida consume energía y se recupera al bajarla, sin superar uno',()=>{
  const {g}=game();g.phase='fight';
  const f=g.fighters[0];
  exerciseFighter(g,1,1,{guard:true});
  close(f.guardEnergy,.72);assert.equal(f.guard,true);
  exerciseFighter(g,1,1,{guard:false});
  close(f.guardEnergy,.96);assert.equal(f.guard,false);
  exerciseFighter(g,1,1,{guard:false});
  assert.equal(f.guardEnergy,1);
});

test('La guardia agotada exige soltar el botón y recuperar al menos .35 antes de defender',()=>{
  const {g}=game();g.phase='fight';
  const f=g.fighters[0];
  exerciseFighter(g,1,4,{guard:true});
  assert.equal(f.guardEnergy,0);assert.equal(f.guardBroken,true);assert.equal(f.guard,false);
  exerciseFighter(g,1,1,{guard:true});
  assert.equal(f.guardEnergy,0);assert.equal(f.guardBroken,true);
  exerciseFighter(g,1,1,{guard:false});
  close(f.guardEnergy,.24);assert.equal(f.guardBroken,true);
  exerciseFighter(g,1,.5,{guard:false});
  close(f.guardEnergy,.36);assert.equal(f.guardBroken,false);
  exerciseFighter(g,1,.1,{guard:true});
  assert.equal(f.guard,true);close(f.guardEnergy,.332);
});

test('Defender impide iniciar una estocada y cancela una que ya estaba activa',()=>{
  const {g,events}=game();g.phase='fight';
  const f=g.fighters[0];
  g.setControl(1,{guard:true,thrust:true});g.updateFighter(f,STEP);
  assert.equal(f.guard,true);assert.equal(f.lunge,0);
  assert.equal(events.filter(e=>e.name==='thrust').length,0);
  f.lunge=.8;g.updateFighter(f,STEP);
  assert.equal(f.lunge,0);
});

for(const slot of [1,2])for(const lunge of [.2100001,.25,.8])test(`La defensa de P${3-slot} bloquea a P${slot} con energía ${lunge} y consume .30`,()=>{
  const {g,events}=game();g.phase='fight';
  const {attacker,defender}=prepareGuardedContact(g,lunge,.55,slot);
  g.detectHits();
  assert.equal(g.phase,'fight');assert.deepEqual(g.scores,[0,0]);
  assert.equal(defender.globIntact,true);assert.equal(attacker.lunge,0);
  close(defender.guardEnergy,.25);
  assert.equal(events.filter(e=>e.name==='clang'&&e.data.defender===3-slot).length,1);
});

test('El último bloqueo agota la guardia y después queda expuesta la cabeza',()=>{
  const {g}=game();g.phase='fight';
  const {attacker,defender}=prepareGuardedContact(g,.8,.2);
  g.detectHits();
  assert.equal(defender.globIntact,true);assert.equal(defender.guardEnergy,0);
  assert.equal(defender.guardBroken,true);assert.equal(defender.guard,false);
  aimAtHead(attacker,defender);g.detectHits();
  assert.equal(defender.globIntact,false);assert.deepEqual(g.scores,[1,0]);
});

for(const lunge of [0,.21])test(`La punta que atraviesa látex pincha sin depender de estocada (${lunge})`,()=>{
  const {g,events}=game();g.phase='fight';
  const [a,b]=g.fighters;aimAtHead(a,b,lunge);b.previousTip={...b.pose.tip};
  g.detectHits();
  assert.equal(g.phase,'burst');assert.equal(b.globIntact,false);
  assert.deepEqual(g.scores,[1,0]);assert.equal(events.filter(e=>e.name==='burst').length,1);
});

for(const slot of [1,2])test(`Un pinchazo individual de P${slot} supera el umbral y adjudica un único punto`,()=>{
  const {g,events}=game();g.phase='fight';
  const attacker=g.fighters[slot-1],defender=g.fighters[2-slot];
  aimAtHead(attacker,defender,.2100001);
  g.detectHits();g.detectHits();
  assert.equal(g.phase,'burst');assert.equal(g.winner,slot);assert.equal(defender.globIntact,false);
  assert.deepEqual(g.scores,slot===1?[1,0]:[0,1]);
  const bursts=events.filter(e=>e.name==='burst');assert.equal(bursts.length,1);
  assert.equal(bursts[0].data.winner,slot);assert.equal(bursts[0].data.draw,false);
});

for(const reverse of [false,true])test(`El doble pinchazo rompe ambos globos y repite la misma ronda sin puntos (orden inverso: ${reverse})`,()=>{
  const {g,events}=game();g.phase='fight';g.round=3;g.scores=[1,1];
  const [a,b]=g.fighters;aimAtHead(a,b);aimAtHead(b,a);
  if(reverse)g.fighters.reverse();
  g.detectHits();
  assert.equal(g.phase,'burst');assert.equal(g.winner,0);assert.deepEqual(g.scores,[1,1]);
  assert.equal(a.globIntact,false);assert.equal(b.globIntact,false);
  assert.equal(a.fluid.released,true);assert.equal(b.fluid.released,true);
  const bursts=events.filter(e=>e.name==='burst');assert.equal(bursts.length,1);
  assert.equal(bursts[0].data.draw,true);assert.equal(bursts[0].data.winner,0);
  assert.equal(bursts[0].data.loser,0);assert.deepEqual(bursts[0].data.score,[1,1]);
  advanceUntil(g,'countdown');
  assert.equal(g.round,3);assert.equal(g.winner,0);assert.deepEqual(g.scores,[1,1]);
  assert.ok(g.fighters.every(f=>f.globIntact&&f.guardEnergy===1&&!f.guardBroken));
});

for(const {wins,score,winner} of [
  {wins:[1,1],score:[2,0],winner:1},
  {wins:[2,2],score:[0,2],winner:2},
  {wins:[1,2,1],score:[2,1],winner:1},
  {wins:[2,1,2],score:[1,2],winner:2}
])test(`La ruta ${score.join('-')} termina al llegar a dos victorias`,()=>{
  const {g,events}=game();g.start();
  wins.forEach((slot,index)=>{
    advanceUntil(g,'fight');assert.equal(g.round,index+1);
    const attacker=g.fighters[slot-1],defender=g.fighters[2-slot];
    g.burst(defender,attacker,attacker.pose.tip);
    g.burst(defender,attacker,attacker.pose.tip);
    advanceUntil(g,index===wins.length-1?'matchover':'countdown');
  });
  assert.deepEqual(g.scores,score);assert.equal(g.winner,winner);assert.equal(g.round,wins.length);
  for(let i=0;i<30;i++)g.update(.04);
  const completed=events.filter(e=>e.name==='matchover');assert.equal(completed.length,1);
  assert.equal(completed[0].data.winner,winner);
  assert.equal(events.filter(e=>e.name==='burst').length,wins.length);
});

for(const score of [[0,0],[1,0]])test(`Start durante el estallido respeta la resolución con marcador previo ${score.join('-')}`,()=>{
  const {g}=game();g.phase='fight';g.scores=score.slice();
  const [a,b]=g.fighters;g.burst(b,a,a.pose.tip);
  g.start();assert.equal(g.phase,'burst');assert.equal(b.globIntact,false);
  assert.deepEqual(g.scores,[score[0]+1,score[1]]);
  advanceUntil(g,score[0]===1?'matchover':'countdown');
});

test('El reset borra resultado, mensaje, cuenta, enfriamiento visual y guardia dañada',()=>{
  const {g}=game();g.phase='burst';g.scores=[2,1];g.round=3;g.winner=1;
  g.count=0;g.lastMessage='MUERTE SÚBITA';g.nextClang=99;g.elapsed=91;g.suddenDeath=true;
  g.fighters[0].guardEnergy=0;g.fighters[0].guardBroken=true;
  g.resetMatch();
  assert.equal(g.phase,'ready');assert.deepEqual(g.scores,[0,0]);assert.equal(g.round,1);
  assert.equal(g.winner,0);assert.equal(g.count,3);assert.equal(g.lastMessage,'Prepará tu arma');
  assert.equal(g.nextClang,0);assert.equal(g.elapsed,0);assert.equal(g.suddenDeath,false);
  assert.ok(g.fighters.every(f=>f.globIntact&&f.guardEnergy===1&&!f.guardBroken));
});

test('Iniciar tras el fin de partida prepara una partida nueva al mejor de tres',()=>{
  const {g}=game();g.phase='matchover';g.scores=[0,2];g.round=3;g.winner=2;
  g.start();
  assert.equal(g.phase,'countdown');assert.deepEqual(g.scores,[0,0]);assert.equal(g.round,1);
  assert.equal(g.winner,0);assert.equal(g.count,3);
});

test('El reloj solo consume tiempo de combate y el siguiente pinchazo resuelve la muerte súbita',()=>{
  const {g,events}=game();
  for(const phase of ['ready','countdown','burst','matchover']){
    g.phase=phase;g.phaseClock=0;g.elapsed=7;g.update(STEP);assert.equal(g.elapsed,7);
  }
  g.phase='fight';g.elapsed=89.995;g.update(STEP);g.update(STEP);
  assert.equal(g.suddenDeath,true);assert.deepEqual(g.scores,[0,0]);
  assert.equal(events.filter(e=>e.name==='overtime').length,1);
  const [a,b]=g.fighters;g.burst(a,b,b.pose.tip);
  assert.deepEqual(g.scores,[0,1]);assert.equal(g.winner,2);assert.equal(g.phase,'burst');
});

test('La muñeca rota realmente ±45 grados desde la orientación base sin cambiar la longitud del arma',()=>{
  for(const slot of [1,2])for(const mainY of [-1,0,1])for(const lunge of [0,1]){
    const {g}=game(),f=g.fighters[slot-1];f.mainY=mainY;f.mainX=1;f.lunge=lunge;
    g.setControl(slot,{wrist:0});g.buildPose(f);
    const base=Math.atan2(f.pose.tip.y-f.pose.mainHand.y,f.dir*(f.pose.tip.x-f.pose.mainHand.x));
    const length=Math.hypot(f.pose.tip.x-f.pose.mainHand.x,f.pose.tip.y-f.pose.mainHand.y);
    for(const wrist of [-1,0,1]){
      g.setControl(slot,{wrist});g.buildPose(f);
      const angle=Math.atan2(f.pose.tip.y-f.pose.mainHand.y,f.dir*(f.pose.tip.x-f.pose.mainHand.x));
      close(angle-base,wrist*Math.PI/4);
      close(Math.hypot(f.pose.tip.x-f.pose.mainHand.x,f.pose.tip.y-f.pose.mainHand.y),length);
    }
  }
});

test('La cabeza admite el golpe de borde visible de C10 tanto en tamaño normal como de jefe',()=>{
  for(const boss of [false,true]){
    const {g}=game();if(boss){g.mode='solo';g.setDifficulty('boss');}g.phase='fight';
    const [a,b]=g.fighters,h=b.pose.head,scale=b.balloonSize;
    const section=Math.sqrt(1-((.17-h.z)/(.403*scale))**2);
    a.lunge=.8;a.previousTip={x:h.x-.6*scale,y:h.y+.48*scale*section,z:.17};
    a.pose={...a.pose,tip:{x:h.x+.6*scale,y:h.y+.48*scale*section,z:.17}};
    g.detectHits();assert.equal(b.globIntact,false);assert.deepEqual(g.scores,[1,0]);
  }
});

test('El collider sigue la silueta nominal con una tolerancia pequeña en múltiples ángulos y escalas',()=>{
  for(const boss of [false,true])for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI,Math.PI*1.5])for(const inside of [true,false]){
    const {g}=game();if(boss){g.mode='solo';g.setDifficulty('boss');}g.phase='fight';
    const [a,b]=g.fighters,h=b.pose.head,scale=b.balloonSize;
    const radius=inside?.995:1.03;
    const tip={x:h.x+Math.cos(angle)*.422*scale*radius,y:h.y+Math.sin(angle)*.506*scale*radius,z:h.z};
    a.previousTip={...tip};a.pose={...a.pose,tip};a.lunge=.8;
    g.detectHits();assert.equal(b.globIntact,!inside,`boss=${boss}, ángulo=${angle}, interior=${inside}`);
  }
});
