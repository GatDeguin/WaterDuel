import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const wristGain=weaponGesture({x:0,y:1}).wrist*Math.PI/4;

function aimAtRaisedShield(attacker,defender){
  const {offHand:shield,shieldDepth}=defender.pose;
  if(!defender.guard||!shieldDepth)return {y:.25,headZ:0};
  const {mainHand:hand,tip}=attacker.pose;
  const length=Math.hypot(tip.x-hand.x,tip.y-hand.y)||1;
  const elevation=Math.atan2(shield.y-hand.y,Math.max(.35,attacker.dir*(shield.x-hand.x)));
  const y=clamp(elevation/(.58/length+wristGain),-.6,.6);
  const centerZ=(shieldDepth.min+shieldDepth.max)/2,bladeLayer=tip.z-attacker.rig.bodyDepth;
  return {y,headZ:clamp((centerZ-bladeLayer)/.28,-1,1)};
}

test('real mobile attackHeld and depth input meet an AI shield through physical contact without a legacy attack pulse',()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data,time:g.elapsed}));
  assert.equal(g.setLoadout(1,{weapon:'spear',defense:'short'}),true);assert.equal(g.setAIStyle('defender'),true);
  // Enter through the real countdown so the native articulated contacts settle
  // before the same 240 combat ticks and handset gesture begin.
  g.start();for(let i=0;i<81;i++)g.update(.04);assert.equal(g.phase,'fight');events.length=0;
  let responded=false,steps=0,peakLunge=0,retreatDepth=0;
  for(let i=0;i<240&&g.phase==='fight';i++){
    const t=i*STEP;responded||=events.some(e=>e.name==='clang'&&e.data.defender===2);
    const withdraw=responded||t<.45;
    // Retreat out of the weapon plane. Approach with the spear at a moderate
    // height, then aim and step into the shield's layer when it comes up.
    const {y,headZ}=withdraw?{y:.6,headZ:-1}:aimAtRaisedShield(...g.fighters);
    const gesture=weaponGesture({x:withdraw?-.8:.8,y});
    assert.equal(Object.hasOwn(gesture,'thrust'),false,'the handset movement must be the attack source');
    g.setControl(1,{...gesture,lean:withdraw?-1:1,headZ});g.update(STEP);steps++;peakLunge=Math.max(peakLunge,g.fighters[0].lunge);
    if(t<.45)retreatDepth=Math.min(retreatDepth,g.fighters[0].rig.bodyDepth);
  }
  assert.ok(retreatDepth<-.2,'the held handset tilt must move the armed body during withdrawal');
  assert.ok(peakLunge>.9,'the real held gesture must extend the physical weapon');
  assert.equal(events.some(e=>e.name==='thrust'&&e.data.slot===1),false,'no legacy pulse manufactures the stroke');
  assert.ok(events.some(e=>e.name==='ai-state'&&e.data.state==='defend'));
  assert.ok(events.some(e=>e.name==='clang'&&e.data.defender===2&&e.data.impulse>0));
  const {data:{normal,velocityBefore,velocityAfter,keyB}}=events.find(e=>e.name==='clang'&&e.data.defender===2&&e.data.impulse>0);
  assert.equal(keyB,'guard');
  const deflection=(velocityAfter.x-velocityBefore.x)*normal.x+(velocityAfter.y-velocityBefore.y)*normal.y;
  assert.ok(deflection>1e-5,'the shield must deflect the real spear velocity away from its surface');
  assert.equal(responded,true);assert.equal(steps,240);assert.deepEqual(g.scores,[0,0]);assert.ok(g.fighters.every(f=>f.globIntact));
});
