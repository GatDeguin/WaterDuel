import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine} from '../public/engine.js';
import {getDefense} from '../public/equipment.js';

// Isolated contact-policy geometry, not an authored whole-body attack or a
// recorded playthrough. Real rig inverse masses/impulses still resolve contacts.
function guardContact(slot=1,energy=1){
  const events=[],game=new DuelEngine((name,data)=>events.push({name,data}));game.setMode('versus');game.phase='fight';
  const contact=placeContact(game,slot,energy);
  return {game,...contact,events};
}
function placeContact(game,slot,energy){
  const a=game.fighters[slot-1],b=game.fighters[2-slot],dir=a.dir;
  a.pose={...a.pose,mainHand:{x:-dir,y:0,z:.17},tip:{x:0,y:0,z:.17}};a.previousTip={...a.pose.tip};
  b.guard=true;b.guardBroken=false;b.guardEnergy=energy;
  b.pose={...b.pose,head:{x:dir*3,y:3,z:.025},offHand:{x:0,y:0,z:.10},shieldRadius:.3,shieldRadiusX:.3,shieldRadiusY:.3,shieldDepth:{min:.135,max:.225}};
  b.previousHead={...b.pose.head};
  return {a,b,dir};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} differs from ${b}`);

for(const slot of [1,2])test(`un contacto sostenido en reposo cobra un solo bloqueo a J${3-slot} y separarse lo rearma`,()=>{
  const {game,a,b,events,dir}=guardContact(slot),cost=getDefense(b).blockCost;
  game.detectHits();close(b.guardEnergy,1-cost);
  const first=events.find(e=>e.name==='clang'&&e.data.defender===b.slot);assert.ok(first);assert.equal(first.data.impulse,0);assert.equal(first.data.closingSpeed,0);
  for(let i=0;i<30;i++)game.detectHits();
  close(b.guardEnergy,1-cost);assert.equal(b.guard,true);assert.equal(b.guardBroken,false);assert.deepEqual(game.scores,[0,0]);
  assert.equal(events.filter(e=>e.name==='clang'&&e.data.defender===b.slot).length,31,'se sigue resolviendo la parada geométrica en cada paso');
  a.pose={...a.pose,mainHand:{x:-dir*3,y:0,z:.17},tip:{x:-dir*2,y:0,z:.17}};a.previousTip={...a.pose.tip};game.detectHits();
  a.pose={...a.pose,mainHand:{x:-dir,y:0,z:.17},tip:{x:0,y:0,z:.17}};a.previousTip={...a.pose.tip};game.detectHits();
  close(b.guardEnergy,1-2*cost);
});

test('bajar la guardia y reiniciar la ronda termina el episodio sin cambiar el coste del primer impacto',()=>{
  const {game,b}=guardContact();game.detectHits();close(b.guardEnergy,.7);
  b.guard=false;game.detectHits();b.guard=true;game.detectHits();close(b.guardEnergy,.4);
  game.resetRound();game.phase='fight';
  // Reuse the same isolated contact fixture on the actual new round fighters.
  placeContact(game,1,1);game.detectHits();close(game.fighters[1].guardEnergy,.7);
});

test('el último bloqueo conserva su coste y una punta que entra con la guardia agotada perfora',()=>{
  const {game,a,b,events,dir}=guardContact(1,.2);
  b.pose={...b.pose,head:{x:dir*.8,y:0,z:.025}};b.previousHead={...b.pose.head};
  a.pose={...a.pose,mainHand:{x:-dir*.7,y:0,z:.17},tip:{x:dir*.9,y:0,z:.17}};a.previousTip={x:-dir*.7,y:0,z:.17};
  game.detectHits();assert.equal(b.guardEnergy,0);assert.equal(b.guardBroken,true);assert.equal(b.guard,false);assert.equal(b.globIntact,true);
  game.detectHits();assert.equal(b.globIntact,false);assert.deepEqual(game.scores,[1,0]);
  const burst=events.find(e=>e.name==='burst');assert.equal(burst.data.contact,true);assert.equal(burst.data.demonstration,false);
});

test('una repetición de la misma geometría conserva recursos y contactos deterministas',()=>{
  const a=guardContact(2),b=guardContact(2);
  for(let i=0;i<20;i++){a.game.detectHits();b.game.detectHits();}
  assert.deepEqual(a.events,b.events);assert.equal(a.b.guardEnergy,b.b.guardEnergy);
  a.game.resetMatch();assert.equal(a.game.fighters[0].guardEnergy,1);
});
