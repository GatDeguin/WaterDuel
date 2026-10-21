import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

function duel(slot=1){
  const g=new DuelEngine();g.setMode('versus');g.phase='fight';
  return {g,f:g.fighters[slot-1]};
}
const step=(g,f,n,control)=>{for(let i=0;i<n;i++){g.setControl(f.slot,control);g.updateFighter(f,STEP);}};

test('Abajo agacha pelvis y cabeza mediante articulaciones con pies apoyados, y soltar recupera',()=>{
  for(const slot of [1,2]){
    const {g,f}=duel(slot);step(g,f,90,{});
    const before=structuredClone(f.pose),volume=f.fluid.initialVolume;
    step(g,f,180,{bodyY:-1});
    assert.ok(f.pose.hip.y<before.hip.y-.20,`pelvis J${slot}`);
    assert.ok(f.pose.head.y<before.head.y-.20,`cabeza J${slot}`);
    for(const key of ['footF','footB']){
      assert.ok(Math.abs(f.pose[key].y-before[key].y)<.015,'no elevación de apoyos para fingir el gesto');
      assert.ok(f.pose[key].y>=TABLE_TOP,'pie sobre la tarima');
    }
    assert.ok(f.rig.diagnostics().minimumGroundY>=TABLE_TOP-.0003);
    assert.ok(Math.abs(f.fluid.retainedVolume+f.fluid.releasedVolume-volume)<1e-12);
    assert.deepEqual(f.membrane.support,f.pose.head,'el látex usa la misma cabeza');
    step(g,f,240,{});
    assert.ok(Math.abs(f.pose.hip.y-before.hip.y)<.02,'retorno físico al soltar');
  }
});

test('Arriba inicia una sola finta de profundidad y vuelve aunque se mantenga el gesto',()=>{
  for(const slot of [1,2]){
    const {g,f}=duel(slot);step(g,f,90,{});const before=structuredClone(f.pose);
    let min=Infinity;
    for(let i=0;i<180;i++){step(g,f,1,{bodyY:1});min=Math.min(min,f.pose.head.z);}
    assert.ok(min<before.head.z-.15,`finta hacia el fondo J${slot}: ${min}`);
    assert.ok(Math.abs(f.pose.head.z-before.head.z)<.035,'no conserva una esquiva inmóvil ni repite mientras se sostiene');
    assert.ok(Math.abs(f.pose.hip.x-before.hip.x)<.02,'no acerca al rival por un gesto vertical');
    step(g,f,40,{});let again=Infinity;
    for(let i=0;i<100;i++){step(g,f,1,{bodyY:1});again=Math.min(again,f.pose.head.z);}
    assert.ok(again<before.head.z-.15,'neutral rearma un nuevo gesto');
  }
});

test('Eje corporal se valida y nunca activa ataque ni defensa; reset borra su intención',()=>{
  const {g,f}=duel();g.setControl(1,{bodyY:Infinity});assert.equal(f.controller.bodyY,0);
  g.setControl(1,{bodyY:-5});assert.equal(f.controller.bodyY,-1);
  assert.equal(f.controller.thrust,false);assert.equal(f.controller.guard,false);
  step(g,f,60,{bodyY:-1});g.resetRound();
  assert.equal(g.fighters[0].controller.bodyY??0,0);
  assert.ok(g.fighters[0].pose.hip.y>TABLE_TOP+.9);
});
