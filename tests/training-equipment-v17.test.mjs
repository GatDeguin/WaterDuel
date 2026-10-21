import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine} from '../public/engine.js';
import {SessionEquipment} from '../public/session-equipment.js';

test('profundidad presta espada sin escudo y restaura las selecciones originales',()=>{
  const g=new DuelEngine(),policy=new SessionEquipment();g.setLoadout(1,{weapon:'maul'});g.setLoadout(2,{weapon:'axe',defense:'knife'});
  const originals=structuredClone(g.loadouts);assert.equal(policy.sync(g,'depth'),true);assert.equal(policy.locked,true);
  assert.match(policy.reason,/sin escudo/i);assert.deepEqual(g.loadouts,[{weapon:'sword',defense:'none'},{weapon:'sword',defense:'none'}]);
  g.resetMatch();assert.equal(policy.sync(g,'depth'),true);assert.equal(policy.sync(g,'duel'),true);assert.deepEqual(g.loadouts,originals);assert.equal(policy.locked,false);
});

test('alternar escuelas conserva el primer equipo sin guardar el equipo prestado',()=>{
  const g=new DuelEngine(),policy=new SessionEquipment();g.setLoadout(1,{weapon:'spear',defense:'long'});g.setLoadout(2,{weapon:'axe',defense:'knife'});
  const originals=structuredClone(g.loadouts);
  policy.sync(g,true);assert.equal(policy.sync(g,'depth'),true);assert.equal(g.loadouts[0].defense,'none');
  assert.equal(policy.sync(g,'training'),true);assert.equal(g.loadouts[0].defense,'short');
  assert.equal(policy.sync(g,null),true);assert.deepEqual(g.loadouts,originals);
});

test('el cambio de escuela durante combate no modifica ni olvida el equipo prestado',()=>{
  const g=new DuelEngine(),policy=new SessionEquipment();g.setLoadout(1,{weapon:'axe',defense:'knife'});policy.sync(g,'training');g.phase='fight';
  assert.equal(policy.sync(g,'depth'),false);assert.equal(g.loadouts[0].defense,'short');assert.equal(policy.locked,true);
  g.phase='ready';policy.sync(g,'depth');policy.sync(g,false);assert.deepEqual(g.loadouts[0],{weapon:'axe',defense:'knife'});
});
