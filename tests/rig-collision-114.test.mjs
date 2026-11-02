import test from 'node:test';
import assert from 'node:assert/strict';
import {collisionModules,collisionPair,resolveCollisionPair,rigState,invalidateCollisionInputs} from './fixtures/rig-collision-reference-114.mjs';

const {reference,candidate}=await collisionModules();
const label=spec=>JSON.stringify(spec);

test('1.13 exact collision oracle: both mirrors/sizes, four weapons, both knife grips, flex and severed arms/legs',()=>{
  let cases=0,events=0;
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const weapon of ['sword','spear','axe','maul'])for(const grip of ['normal','reverse']){
    const damage=['none','partial','arm','leg'][Math.floor(cases/3)%4],spec={dir,scale,weapon,grip,damage,flex:cases%3!==0,sweep:cases%5!==0,mixed:cases%7===0};
    const a=collisionPair(reference,spec),b=collisionPair(candidate,spec);
    assert.deepEqual(b.map(rigState),a.map(rigState),'same native initial state '+label(spec));
    // Every named panel family is checked, including ones that cannot touch
    // this rival at the normal lateral spacing (feet/back chest/palms).
    for(let side=0;side<2;side++)for(const time of [0,.125,.5,.875,1]){
      const full=a[side].collisionPanelsAt(time);
      for(const panel of full)assert.deepEqual(b[side].collisionGeometryAt(time,panel.key),[panel],`selected ${panel.key}@${time} `+label(spec));
    }
    const old=resolveCollisionPair(reference,a),now=resolveCollisionPair(candidate,b);
    assert.deepEqual(now,old,'full contact/orientation/state oracle '+label(spec));events+=old.result.events.length;cases++;
  }
  assert.equal(cases,32);assert.ok(events>0,'corpus must produce actual mechanical contacts');
});

test('query-local geometry remains exact after warm q/length/depth/grip/velocity/support/limits/water/flex/topology changes',()=>{
  let cases=0;
  for(const dir of [-1,1])for(const weapon of ['sword','spear','axe','maul']){
    const spec={dir,scale:cases%2?1.18:1,weapon,grip:'reverse',flex:true};
    const a=collisionPair(reference,spec),b=collisionPair(candidate,spec);
    assert.deepEqual(resolveCollisionPair(candidate,b),resolveCollisionPair(reference,a),label(spec));
    const snapshot=structuredClone(b.map(rigState)),panels=b.map(r=>r.collisionPanels()),savedPanels=structuredClone(panels);
    invalidateCollisionInputs(a);invalidateCollisionInputs(b);
    assert.deepEqual(resolveCollisionPair(candidate,b),resolveCollisionPair(reference,a),'fresh mutable input '+label(spec));
    assert.notDeepEqual(b.map(rigState),snapshot,'new state differs from the owned old snapshot');
    assert.deepEqual(panels,savedPanels,'public panel snapshots survive future solves unchanged');
    panels[0][0].vertices[0].x+=123;
    assert.notEqual(b[0].collisionPanels()[0].vertices[0].x,panels[0][0].vertices[0].x,'caller mutations never corrupt private geometry');cases++;
  }
  assert.equal(cases,8);
});

test('deep self-contact still consumes the original alternative axes and preserves every integration bit',t=>{
  let alternatives=0,choices=0;
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const x=new reference.ArticulatedRig({dir,scale,gravity:0}),y=new candidate.ArticulatedRig({dir,scale,gravity:0});
    for(const r of [x,y]){r.q[4]=1.15;r.q[5]=2.7;r.q[13]=Math.PI/4;r.target.set(r.q);}
    reference.reset();candidate.reset();
    for(let tick=0;tick<6;tick++){x.step(1/120);y.step(1/120);assert.deepEqual(rigState(y),rigState(x),`${dir}/${scale}/${tick}`);}
    assert.equal(candidate.__collisionAudit.deepAlternativeReads,reference.__collisionAudit.deepAlternativeReads,'deep branch sees the same ordered alternatives');
    alternatives+=reference.__collisionAudit.deepAlternativeReads;
    assert.equal(candidate.__collisionAudit.deepAlternativeChoices,reference.__collisionAudit.deepAlternativeChoices);choices+=reference.__collisionAudit.deepAlternativeChoices;
  }
  assert.ok(alternatives>0,'the deep fixture must actually read fallback axes');
  assert.ok(choices>0,'the deep fixture must actually select a different separating axis');
  t.diagnostic(JSON.stringify({deepAlternativeReads:alternatives,deepAlternativeChoices:choices}));
});
