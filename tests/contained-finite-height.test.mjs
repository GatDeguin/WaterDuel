import test from 'node:test';
import assert from 'node:assert/strict';
import {loadContained} from '../benchmarks/contained-vertex-plan-corpus-1.5.mjs';
test('nonfinite cap height retains the original per-vertex path without rereading an accessor',async()=>{
  const baseline=await loadContained('../audit/water-axis-distance-1.5/surfaces-baseline.js',{label:'finite-height-before',instrument:true});
  const current=await loadContained('../public/physics/surfaces.js',{label:'finite-height-after',instrument:true});
  const make=()=>{let reads=0;return {frame:{get height(){reads++;return NaN;},rotation:[1,0,0,0,1,0,0,0,1]},reads:()=>reads};};
  const before=make(),after=make(),head={x:0,y:2.4,z:0};
  const a=baseline.module.containedWaterMesh(head,{quality:'eco',frame:before.frame}),b=current.module.containedWaterMesh(head,{quality:'eco',frame:after.frame});
  assert.equal(before.reads(),1);assert.equal(after.reads(),1,'eligibility cannot consume an extra observable height read');
  assert.equal(globalThis.__containedNormCounts['finite-height-after'],globalThis.__containedNormCounts['finite-height-before'],'invalid height retains the original normal evaluations rather than the cached Float64 transform');
  assert.equal(a.p.length,b.p.length);assert.equal(a.n.length,b.n.length);
});
