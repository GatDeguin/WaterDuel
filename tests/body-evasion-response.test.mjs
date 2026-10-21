import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceBodyEvasion,CROUCH_DEPTH,FEINT_DURATION} from '../public/physics/body-evasion.js';
test('crouch starts promptly but rises gently, keeping the same maximum depth and continuous state',()=>{
  const f={};advanceBodyEvasion(f,-1,.1,true);assert.ok(f.evasion.crouch>.69&&f.evasion.crouch<.71,'onset reaches approximately70% in100ms');
  advanceBodyEvasion(f,-1,1,true);const before=f.evasion.crouch;advanceBodyEvasion(f,0,.1,true);
  assert.ok(f.evasion.crouch>.43&&f.evasion.crouch<.47,'release takes a gentler recovery path');assert.ok(f.evasion.crouch<before);
  assert.equal(CROUCH_DEPTH,.29);assert.ok(f.evasion.crouch>=0&&f.evasion.crouch<=1);
});
test('depth feint reaches its unchanged maximum earlier and returns with zero-slope endpoints in the same duration',()=>{
  const f={};advanceBodyEvasion(f,1,0,true);const peak=FEINT_DURATION*.38;
  advanceBodyEvasion(f,1,peak,true);assert.ok(f.evasion.feint>.999999,'earlier peak at38% of unchanged duration');
  advanceBodyEvasion(f,1,FEINT_DURATION-peak,true);assert.equal(f.evasion.feint,0);assert.equal(f.evasion.age,-1);assert.equal(FEINT_DURATION,.85);
});
test('holding cannot repeat, neutral rearms, cooldown still blocks an early retry and disabled state cannot keep a feint',()=>{
  const f={};advanceBodyEvasion(f,1,0,true);advanceBodyEvasion(f,1,.85,true);assert.equal(f.evasion.feint,0);
  advanceBodyEvasion(f,0,.01,true);advanceBodyEvasion(f,1,.01,true);assert.equal(f.evasion.age,-1,'cooldown blocks an early new gesture');
  advanceBodyEvasion(f,1,.3,true);assert.equal(f.evasion.age,-1,'holding during cooldown does not auto-repeat');
  advanceBodyEvasion(f,0,.01,true);advanceBodyEvasion(f,1,.01,true);assert.ok(f.evasion.age>=0,'neutral then a new gesture rearms');
  advanceBodyEvasion(f,1,.01,false);assert.equal(f.evasion.age,-1);assert.equal(f.evasion.feint,0);
  advanceBodyEvasion(f,0,2,false);advanceBodyEvasion(f,0,.01,true);assert.equal(f.evasion.feint,0,'neutral re-entry does not manufacture a dodge');
  advanceBodyEvasion(f,1,.01,true);assert.ok(f.evasion.age>=0);
});
test('time partitions preserve crouch/feint response and every value stays bounded for invalid inputs',()=>{
  const results=[];for(const hz of [30,60,120]){const f={};advanceBodyEvasion(f,1,0,true);for(let i=0;i<hz*.6;i++)advanceBodyEvasion(f,1,1/hz,true);results.push(f.evasion.feint);}
  assert.ok(Math.abs(results[0]-results[1])<1e-12&&Math.abs(results[1]-results[2])<1e-12);
  const f={};for(const input of [NaN,Infinity,-Infinity,0,-1,1])for(const dt of [NaN,Infinity,-1,0,1/120]){const e=advanceBodyEvasion(f,input,dt,true);assert.ok(Number.isFinite(e.crouch)&&e.crouch>=0&&e.crouch<=1);assert.ok(Number.isFinite(e.feint)&&e.feint>=0&&e.feint<=1);}
});
