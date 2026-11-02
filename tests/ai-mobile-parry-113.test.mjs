import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';

test('real mobile attackHeld and depth input meet an AI shield through physical contact without a legacy attack pulse',()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data,time:g.elapsed}));
  assert.equal(g.setLoadout(1,{weapon:'spear',defense:'short'}),true);assert.equal(g.setAIStyle('defender'),true);
  // Enter through the real countdown so the native articulated contacts settle
  // before the same 240 combat ticks and handset gesture begin.
  g.start();for(let i=0;i<81;i++)g.update(.04);assert.equal(g.phase,'fight');events.length=0;
  let responded=false,steps=0,peakLunge=0;
  for(let i=0;i<240&&g.phase==='fight';i++){
    const t=i*STEP;responded||=events.some(e=>e.name==='clang'&&e.data.defender===2);
    const withdraw=responded||t<.45,gesture=weaponGesture(withdraw?{x:-.8,y:.6}:{x:.8,y:.6});
    assert.equal(Object.hasOwn(gesture,'thrust'),false,'the handset movement must be the attack source');
    g.setControl(1,{...gesture,lean:withdraw?-1:1,headZ:-1});g.update(STEP);steps++;peakLunge=Math.max(peakLunge,g.fighters[0].lunge);
  }
  assert.ok(peakLunge>.9,'the real held gesture must extend the physical weapon');
  assert.equal(events.some(e=>e.name==='thrust'&&e.data.slot===1),false,'no legacy pulse manufactures the stroke');
  assert.ok(events.some(e=>e.name==='ai-state'&&e.data.state==='defend'));
  assert.ok(events.some(e=>e.name==='clang'&&e.data.defender===2&&e.data.impulse>0));
  assert.equal(responded,true);assert.equal(steps,240);assert.deepEqual(g.scores,[0,0]);assert.ok(g.fighters.every(f=>f.globIntact));
});
