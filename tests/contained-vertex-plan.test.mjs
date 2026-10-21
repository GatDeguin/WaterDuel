import test from 'node:test';
import assert from 'node:assert/strict';
import {loadContained,meshHash,containedCases} from '../benchmarks/contained-vertex-plan-corpus-1.5.mjs';
import {assertNumericF64Equal} from './helpers/numeric-f64.mjs';
const baselinePath='../audit/water-axis-distance-1.5/surfaces-baseline.js';
const baseline=await loadContained(baselinePath,{label:'contained-baseline'}),current=await loadContained('../public/physics/surfaces.js',{label:'contained-current'});
function exact(item){
  const a=baseline.module.containedWaterMesh(item.head,item.options),b=current.module.containedWaterMesh(item.head,item.options);
  assert.deepEqual(Object.keys(b),Object.keys(a),item.name+' public output fields unchanged');
  for(const key of ['body','surface','meniscus']){
    assert.deepEqual(Object.keys(b[key]),Object.keys(a[key]),item.name+' '+key+' public output fields unchanged');
    for(const field of ['p','n'])assertNumericF64Equal(b[key][field],a[key][field],`${item.name} ${key}.${field}`);
  }
  assertNumericF64Equal(b.p,a.p,item.name+' combined p');assertNumericF64Equal(b.n,a.n,item.name+' combined n');
  return b;
}
test('contained mesh normalizes each unique template tuple instead of every repeated triangle vertex',async()=>{
  const a=await loadContained(baselinePath,{label:'contained-before-count',instrument:true}),b=await loadContained('../public/physics/surfaces.js',{label:'contained-after-count',instrument:true});
  const item=containedCases().find(v=>v.name==='motion-7-high');
  a.module.containedWaterMesh(item.head,item.options);b.module.containedWaterMesh(item.head,item.options);
  globalThis.__containedNormCounts['contained-before-count']=0;globalThis.__containedNormCounts['contained-after-count']=0;
  const before=a.module.containedWaterMesh(item.head,item.options),after=b.module.containedWaterMesh(item.head,item.options);
  assert.equal(meshHash(after.p),meshHash(before.p));assert.equal(meshHash(after.n),meshHash(before.n));
  const counts=globalThis.__containedNormCounts;
  assert.ok(counts['contained-after-count']<counts['contained-before-count']*.3,`${counts['contained-after-count']} versus ${counts['contained-before-count']} normalizations; remove at least 70% repeated work`);
});
test('106 contained poses, scales, rotations, fill heights and profiles preserve non-NaN Float64 bits and NaN positions',()=>{
  const cases=containedCases();assert.equal(cases.length,106);
  for(const item of cases)exact(item);
});
test('fresh arrays and prior-frame ownership survive reuse, mutations, quality/fill changes and reverse time',()=>{
  const cases=containedCases(),first=exact(cases[6]),p=meshHash(first.p),n=meshHash(first.n),body=meshHash(first.body.p);
  for(const item of cases.toReversed())exact(item);
  assert.equal(meshHash(first.p),p);assert.equal(meshHash(first.n),n);assert.equal(meshHash(first.body.p),body);
  const item=cases[6],a=current.module.containedWaterMesh(item.head,item.options);a.body.p[0]=12345;a.n[0]=9876;
  const b=exact(item);assert.notEqual(a.body.p,b.body.p);assert.notEqual(a.n,b.n);
  assert.notEqual(b.body.p[0],12345);assert.notEqual(b.n[0],9876);
});
test('dynamic accessors and inherited pose data retain original reads and geometry through the compatibility path',()=>{
  const factories=[
    ()=>{let reads=0;return {head:{get x(){return .1+reads++*1e-8;},y:2.4,z:0},options:{quality:'eco'},reads:()=>reads};},
    ()=>{let reads=0;const head=Object.create({get x(){return -.1+reads++*1e-8;}});head.y=2.4;head.z=0;return {head,options:{quality:'eco'},reads:()=>reads};},
    ()=>{let reads=0;const rotation=[1,0,0,0,1,0,0,0,1];Object.defineProperty(rotation,'0',{get(){return 1+reads++*1e-8;}});return {head:{x:0,y:2.4,z:0},options:{quality:'eco',frame:{height:.2,rotation}},reads:()=>reads};},
    ()=>{let reads=0;const rotation={get 0(){return 1+reads++*1e-8;},1:0,2:0,3:0,4:1,5:0,6:0,7:0,8:1};return {head:{x:0,y:2.4,z:0},options:{quality:'eco',frame:{height:.2,rotation}},reads:()=>reads};},
  ];
  for(const factory of factories){
    const before=factory(),after=factory(),a=baseline.module.containedWaterMesh(before.head,before.options),b=current.module.containedWaterMesh(after.head,after.options);
    assert.equal(before.reads(),after.reads(),'exact getter read count');assert.ok(after.reads()>0,'the test exercises observable accessors');
    for(const field of ['p','n'])assert.equal(meshHash(a[field]),meshHash(b[field]),'exact dynamic getter geometry and normals');
  }
});
