import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {DEFENSES} from '../public/equipment.js';

test('La guardia lleva el montaje real del escudo hasta la profundidad de la hoja con aceleración y retorno',()=>{
  for(const defense of ['short','long'])for(const slot of [1,2]){
    const g=new DuelEngine();g.setMode('versus');g.setLoadout(slot,{defense});g.phase='fight';const f=g.fighters[slot-1];
    const start=f.pose.offHand.z;g.setControl(slot,{guard:true,offX:1,offY:.7});g.updateFighter(f,STEP);
    assert.ok(f.pose.offHand.z>start&&f.pose.offHand.z<start+.01,'a motor accelerates the actual hand mount');
    for(let i=0;i<90;i++)g.updateFighter(f,STEP);
    assert.ok(Math.abs(f.pose.offHand.z-.10)<.001);assert.ok(f.pose.offElbow.z>-.02);
    assert.equal(f.pose.shieldDepth.min,f.pose.offHand.z+DEFENSES[defense].guardDepthMin);
    assert.equal(f.pose.shieldDepth.max,f.pose.offHand.z+DEFENSES[defense].guardDepthMax);
    assert.ok(f.pose.shieldDepth.min<.17&&f.pose.shieldDepth.max>.17,'defensive solid depth includes the actual steel layer');
    g.setControl(slot,{});for(let i=0;i<150;i++)g.updateFighter(f,STEP);assert.ok(Math.abs(f.pose.offHand.z-start)<.0001);
    assert.ok(f.rig.diagnostics().contacts.every(c=>c.error<.0002));
  }
});

test('El montaje defensivo usa el reloj fijo y no separa el agarre de un arma a dos manos',()=>{
  const a=new ArticulatedRig(),b=new ArticulatedRig();for(const r of [a,b])r.setIntent({defenseDepthTarget:.10});
  for(let i=0;i<120;i++)a.step(STEP);for(let i=0;i<30;i++)b.step(1/30);
  assert.deepEqual(a.pose().defenseDepth,b.pose().defenseDepth);assert.equal(a.pose().offHand.z,b.pose().offHand.z);
  const g=new DuelEngine();g.setLoadout(1,{weapon:'maul'});g.phase='fight';g.setControl(1,{guard:true});const f=g.fighters[0];
  for(let i=0;i<90;i++)g.updateFighter(f,STEP);assert.equal(f.pose.offHand.z,.17);assert.equal(f.pose.shieldDepth,undefined);
  assert.ok(Math.hypot(f.pose.offHand.x-f.pose.offGrip.x,f.pose.offHand.y-f.pose.offGrip.y)<.0002);
});
