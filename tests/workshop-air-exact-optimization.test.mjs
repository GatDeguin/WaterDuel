import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareWorkshopAir,sampleWorkshopAir} from '../public/workshop-air.js';
const baselineBytes=await readFile(new URL('./fixtures/workshop-air-pre-opt-1.7.2.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(baselineBytes).digest('hex'),'2048d0534ebf223822d26bd6575b326e0c7099a28891a1c33bcf33e315d56c76');
const before=await import('data:text/javascript;base64,'+baselineBytes.toString('base64'));
const compare=(air,p,time)=>{
  const expected=before.sampleWorkshopAir(air,p,time),actual=sampleWorkshopAir(air,p,time);
  for(const axis of ['x','y','z'])assert.ok(Object.is(actual[axis],expected[axis]),`${axis}: exact Float64 value`);
  assert.deepEqual(Object.keys(actual),Object.keys(expected));
};

test('air sampling preserves exact Float64 values across tilted jets, boundary points and time',()=>{
  let seed=173;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(const axis of [[0,0,1],[1,0,0],[-1,2,-3],[1e-7,-1,2e-7]]){
    const air=prepareWorkshopAir({pivot:[-2.3,1.6,-3],axis,radius:.37,angularSpeed:7});
    for(let i=0;i<2400;i++){
      const p={x:-4+random()*8,y:-2+random()*8,z:-6+random()*10};
      compare(air,p,(random()-.5)*1e4);
    }
    for(const distance of [-1,0,Number.MIN_VALUE,air.range/2,air.range-Number.EPSILON,air.range,air.range+1]){
      const p={x:air.pivot[0]+air.axis[0]*distance,y:air.pivot[1]+air.axis[1]*distance,z:air.pivot[2]+air.axis[2]*distance};
      for(const time of [0,-0,1,NaN,Infinity])compare(air,p,time);
    }
  }
});

test('air outputs stay owned, inputs remain unmodified, and mutable fan parameters are read on every call',()=>{
  const air=prepareWorkshopAir({pivot:[0,0,0],axis:[0,0,1],radius:.5,angularSpeed:8}),point=Object.freeze({x:.1,y:.1,z:1});
  const previous=structuredClone(air);const a=sampleWorkshopAir(air,point,1),b=sampleWorkshopAir(air,point,1);
  assert.notEqual(a,b);assert.deepEqual(a,b);assert.deepEqual(air,previous);a.z=999;assert.notEqual(b.z,999);
  for(const mutate of [()=>air.speed=.4,()=>air.axis[0]=.2,()=>air.pivot[1]=-.4,()=>air.spread=.3,()=>air.angularSpeed=-4]){mutate();compare(air,point,1);}
  for(const input of [null,undefined,{}, {x:NaN,y:0,z:0},{x:0,y:Infinity,z:1},{x:0,y:0,z:'1'},{x:-0,y:-0,z:-0}])compare(air,input,0);
  const x=sampleWorkshopAir(null,point),y=sampleWorkshopAir(null,point);assert.notEqual(x,y);assert.deepEqual(x,{x:0,y:0,z:0});
});
