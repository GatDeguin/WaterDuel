import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {SinglePlayerSession} from '../public/single-player.js';
import {SessionEquipment} from '../public/session-equipment.js';

test('Escuela presta espada/escudo corto y restaura ambas selecciones propias al salir',()=>{
 const g=new DuelEngine(),policy=new SessionEquipment();g.setLoadout(1,{weapon:'maul'});g.setLoadout(2,{weapon:'axe',defense:'knife'});
 const selected=structuredClone(g.loadouts);assert.equal(policy.sync(g,true),true);assert.equal(policy.locked,true);
 assert.deepEqual(g.loadouts,[{weapon:'sword',defense:'short'},{weapon:'sword',defense:'short'}]);
 g.resetMatch();policy.sync(g,true);assert.equal(policy.sync(g,false),true);assert.deepEqual(g.loadouts,selected);assert.equal(policy.locked,false);
});
test('El equipo formativo permite combinar movimiento y ataque aunque el usuario entró con mazo o sin escudo',()=>{
 for(const loadout of [{weapon:'maul'},{weapon:'sword',defense:'none'}]){
  const g=new DuelEngine(),s=new SinglePlayerSession(),policy=new SessionEquipment();g.setLoadout(1,loadout);s.select('training');policy.sync(g,true);g.aiEnabled=false;g.phase='fight';s.objectiveIndex=4;
  for(let i=0;i<180;i++){g.setControl(1,{lean:1,mainY:1});g.update(STEP);s.observe(g,STEP);}
  assert.equal(s.view(g).progress,5);
 }
});
test('Cambiar la política durante una ronda activa no modifica equipo ni pierde la selección guardada',()=>{
 const g=new DuelEngine(),policy=new SessionEquipment();g.setLoadout(1,{weapon:'spear',defense:'long'});g.phase='fight';
 assert.equal(policy.sync(g,true),false);assert.equal(policy.locked,false);assert.equal(g.loadouts[0].weapon,'spear');
 g.phase='ready';policy.sync(g,true);g.phase='fight';assert.equal(policy.sync(g,false),false);assert.equal(policy.locked,true);assert.equal(g.loadouts[0].weapon,'sword');
 g.phase='ready';policy.sync(g,false);assert.equal(g.loadouts[0].weapon,'spear');
});
