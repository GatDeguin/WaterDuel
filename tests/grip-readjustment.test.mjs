import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';
import {firstWeaponContact} from '../public/physics/weapon-bind.js';

function loaded(slot){
  const g=new DuelEngine();g.setMode('versus');g.setLoadout(slot,{weapon:'sword',defense:'none'});g.setLoadout(3-slot,{weapon:'maul',defense:'none'});
  const sword=g.fighters[slot-1],maul=g.fighters[2-slot],dir=sword.dir;
  sword.baseX=-dir*1.35;maul.baseX=dir*2.1;sword.mainX=sword.mainY=sword.lunge=0;
  const other={mainX:0,mainY:.65,wrist:-Math.atan2(.377,1.08)/(Math.PI/4)};
  maul.mainX=0;maul.mainY=.65;maul.lunge=0;maul.controller=other;
  sword.controller=weaponGesture({x:0,y:0});for(const f of g.fighters)g.initializeRig(f);g.phase='fight';
  assert.ok(firstWeaponContact(sword.rig,maul.rig),'acero realmente trabado');return {g,sword,other};
}
for(const slot of [1,2])test(`J${slot}: recoger bajo carga reajusta físicamente la mano sin accionar ni mover al rival por bandera`,()=>{
  const {g,sword,other}=loaded(slot),before=sword.pose.mainHand,oldTargets=g.fighters[2-slot].rig.target.slice();
  g.resolveWeaponContacts(STEP,{project:false});g.setControl(slot,weaponGesture({x:-1,y:0}));g.setControl(3-slot,other);
  let max=0;for(let i=0;i<70;i++){g.update(STEP);max=Math.max(max,sword.gripAdjustment??0);}
  assert.ok(max>.005,'un contacto real y retirada cargan el reajuste');
  assert.ok(sword.dir*(sword.pose.mainHand.x-before.x)<-.02,'la mano se recoge mediante sus motores');
  assert.ok(sword.rig.q.every(Number.isFinite));assert.ok(sword.rig.velocity.every(Number.isFinite));
  assert.deepEqual(g.scores,[0,0]);assert.ok(g.fighters.every(f=>f.globIntact));
  g.setControl(slot,weaponGesture({x:0,y:0}));for(let i=0;i<160;i++)g.updateFighter(sword,STEP,{deferSupport:true});
  assert.ok(sword.gripAdjustment<.001,'soltar devuelve el agarre, sin quedarse en modo escape');
  assert.ok(oldTargets.every(Number.isFinite));
});
test('El gesto en el aire, la IA legacy y un arma perdida no fabrican un reajuste bajo carga',()=>{
  const g=new DuelEngine();g.setMode('versus');g.phase='fight';const f=g.fighters[0];
  g.setControl(1,weaponGesture({x:-1,y:0}));for(let i=0;i<30;i++)g.updateFighter(f,STEP,{deferSupport:true});
  assert.equal(f.gripAdjustment??0,0);
  f.rig.damageJoint('wrist',1);g.updateFighter(f,STEP,{deferSupport:true});assert.equal(f.gripAdjustment??0,0);
  const loadedLegacy=loaded(1);loadedLegacy.g.resolveWeaponContacts(STEP,{project:false});
  loadedLegacy.g.setControl(1,{mainX:-1,mainY:0,wrist:0});loadedLegacy.g.updateFighter(loadedLegacy.sword,STEP,{deferSupport:true});
  assert.equal(loadedLegacy.sword.gripAdjustment,0,'el mismo acero cargado con piloto legacy no activa el reajuste móvil');
});
