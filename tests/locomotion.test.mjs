import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceLocomotion} from '../public/physics/locomotion.js';
const almost=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-12,`${message}: ${a} / ${b}`);
test('analog movement preserves proportional near-neutral travel, full speed and left/right symmetry',()=>{
  const samples=Array.from({length:11},(_,i)=>advanceLocomotion(0,i/10,1));
  assert.equal(samples[0],0);almost(samples.at(-1),.65,'same maximum speed');
  for(let i=1;i<samples.length;i++)assert.ok(samples[i]>samples[i-1]);
  almost(advanceLocomotion(0,.25,1),.65*.25,'quarter travel retains its original proportional target');
  for(const input of [.1,.25,.35,.5,.75])almost(advanceLocomotion(0,input,1),.65*input,'every partial input stays proportional');
  for(const input of [-1,-.35,0,.35,1])almost(advanceLocomotion(0,input,.1,{dir:-1}),-advanceLocomotion(0,input,.1,{dir:1}),'mirrored controls');
});
test('release brakes promptly and direction changes decelerate through zero before accelerating back',()=>{
  const released=advanceLocomotion(.65,0,.1);assert.ok(released>=0&&released<.15,`neutral brake: ${released}`);
  assert.ok(advanceLocomotion(.65,-1,.05)>0,'a short reversal cannot teleport velocity to the other side');
  assert.ok(advanceLocomotion(.65,-1,.11)<0,'reversal clears the old direction promptly');
  let v=.65;for(let i=0;i<60;i++){const next=advanceLocomotion(v,-1,1/120);assert.ok(Math.abs(next-v)<=6.6/120+1e-12,'bounded motor acceleration');assert.ok(Math.abs(next)<=.65);v=next;}
  almost(v,-.65,'eventual reversed full speed');
});
test('constant-input response has the same final velocity under 30/60/120Hz partitions, including reversal',()=>{
  for(const [initial,input,duration]of [[0,1,.3],[.65,-1,.3],[.65,0,.3],[-.65,.3,.3]]){
    const values=[];for(const hz of [30,60,120]){let v=initial;for(let i=0;i<duration*hz;i++)v=advanceLocomotion(v,input,1/hz);values.push(v);}
    almost(values[0],values[1],'30/60 final intention');almost(values[1],values[2],'60/120 final intention');
  }
});
test('damaged legs, disabled/passive control, stale neutral and re-entry cannot retain an old motor intention',()=>{
  assert.equal(advanceLocomotion(.65,1,1/120,{strength:0}),0);
  assert.equal(advanceLocomotion(.65,1,1/120,{enabled:false}),0);
  for(const strength of [.1,.35,.7,1])assert.ok(Math.abs(advanceLocomotion(.65,1,.1,{strength}))<=.65*strength+1e-12);
  let v=.65;for(let i=0;i<24;i++)v=advanceLocomotion(v,0,1/120);assert.equal(v,0,'expired controls supplied as neutral settle completely');
  const reentered=advanceLocomotion(v,1,1/120);assert.ok(reentered>0&&reentered<=3/120,'re-entry starts from stopped state');
  for(const [speed,input,dt]of [[NaN,NaN,.1],[Infinity,Infinity,.1],[.2,NaN,.1],[.2,1,NaN],[.2,1,-1]]){const next=advanceLocomotion(speed,input,dt);assert.ok(Number.isFinite(next)&&Math.abs(next)<=.65);}
});
