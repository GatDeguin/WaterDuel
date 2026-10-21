import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';
import {firstWeaponContact} from '../public/physics/weapon-bind.js';

const steel=rig=>rig.collisionPanels().filter(p=>p.body==='weapon'&&p.material!=='wood');
// Independent SAT check on the real collision surfaces, including the maul
// head's depth. Looking only at the reported contact would miss a lost pair.
function gap(a,b){
  let separation=-Infinity;
  for(const axis of [...a.axes,...b.axes]){
    const A=a.vertices.map(p=>p.x*axis.x+p.y*axis.y),B=b.vertices.map(p=>p.x*axis.x+p.y*axis.y);
    separation=Math.max(separation,Math.min(...A)-Math.max(...B),Math.min(...B)-Math.max(...A));
  }
  return Math.max(separation,Math.abs(a.z-b.z)-(a.depth+b.depth)/2);
}
const minimumGap=(a,b)=>Math.min(...steel(a).flatMap(p=>steel(b).map(q=>gap(p,q))));

for(const slot of [1,2])test(`J${slot}: recoger, bajar y extender libera la espada situada bajo un mazo real`,()=>{
  const g=new DuelEngine();g.setMode('versus');
  g.setLoadout(slot,{weapon:'sword',defense:'none'});g.setLoadout(3-slot,{weapon:'maul',defense:'none'});
  const sword=g.fighters[slot-1],maul=g.fighters[2-slot],dir=sword.dir;
  sword.baseX=-dir*1.35;maul.baseX=dir*2.1;
  sword.mainX=sword.mainY=sword.lunge=0;
  const maulControl={mainX:0,mainY:.65,wrist:-Math.atan2(.377,1.08)/(Math.PI/4)};
  sword.controller=weaponGesture({x:0,y:0});maul.mainX=0;maul.mainY=.65;maul.lunge=0;maul.controller=maulControl;
  for(const f of g.fighters)g.initializeRig(f);
  g.phase='fight';
  const initial=firstWeaponContact(sword.rig,maul.rig);
  assert.equal(initial?.keyA,'weapon');assert.equal(initial.keyB,'weapon-head');assert.ok(initial.normal.y>.99);
  assert.ok(Math.abs(minimumGap(sword.rig,maul.rig)+.0005)<1e-8,'La espada comienza realmente bajo la cabeza del mazo');
  const initialTip={...sword.pose.tip},initialHand={...sword.pose.mainHand};
  function move(gesture){
    for(let tick=0;tick<90;tick++){
      g.setControl(slot,weaponGesture(gesture));g.setControl(3-slot,maulControl);g.update(STEP);
      assert.ok(minimumGap(sword.rig,maul.rig)>-.001,'La salida no puede atravesar la cabeza ni el mango del mazo');
      for(const f of g.fighters){
        assert.ok([...f.rig.q,...f.rig.velocity].every(Number.isFinite));
        for(const support of f.rig.diagnostics().contacts)assert.ok(support.error<.0002,'Conserva los apoyos físicos');
      }
      assert.equal(g.phase,'fight');assert.ok(g.fighters.every(f=>f.globIntact));assert.deepEqual(g.scores,[0,0]);
    }
  }
  move({x:-1,y:0});
  assert.ok(dir*(sword.pose.mainHand.x-initialHand.x)<-.05,'Recoge la mano derecha');
  assert.ok(dir*(sword.pose.tip.x-initialTip.x)<-.05,'Recoger también retira la punta, en vez de extender la estocada bajo el mazo');
  assert.ok(sword.lunge<.01,'La intención hacia atrás no mantiene la extensión de ataque');
  move({x:-Math.SQRT1_2,y:-Math.SQRT1_2});
  assert.ok(minimumGap(sword.rig,maul.rig)>.05,'Bajar y recoger deja un paso real alrededor del mazo');
  const withdrawnTip={...sword.pose.tip};
  move({x:1,y:-.2});
  assert.ok(dir*(sword.pose.tip.x-withdrawnTip.x)>.25,'Puede volver a extender después de liberar la hoja');
});
