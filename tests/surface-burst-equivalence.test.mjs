import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildFluidSurface} from '../public/physics/surfaces.js';
const source=readFileSync(new URL('../benchmarks/baselines/surfaces-pre-burst-1.4.mjs',import.meta.url),'utf8');
const baseline=await import('data:text/javascript;base64,'+Buffer.from(source
  .replace("'./dimensions.js'",JSON.stringify(new URL('../public/physics/dimensions.js',import.meta.url).href))
  .replace("'./membrane.js'",JSON.stringify(new URL('../public/physics/membrane.js',import.meta.url).href))).toString('base64'));
const fixture=JSON.parse(readFileSync(new URL('../benchmarks/results/burst-clouds-runtime-records-1.4.json',import.meta.url)));
const hash=values=>createHash('sha256').update(Buffer.from(new Float64Array(values).buffer)).digest('hex');
function compare(cloud,options){
  const before=baseline.buildFluidSurface(cloud,options),after=buildFluidSurface(cloud,options);
  assert.equal(hash(after.p),hash(before.p),'every vertex and triangle order remains bit-identical');
  assert.equal(hash(after.n),hash(before.n),'all normals remain bit-identical');assert.deepEqual(after.stats,before.stats);
  return after;
}
test('cada instantánea de un pinchazo físico mantiene geometría y volumen exactos en los tres perfiles',()=>{
  for(const snapshot of fixture.snapshots)for(const quality of ['eco','high','ultra'])compare(snapshot.particles,{quality,domain:fixture.domain});
});
test('uniones sobre aristas y esquinas del dominio, kernel ampliado y presupuestos mantienen todas las caras',()=>{
  const volume=fixture.snapshots[0].particles[0].volume,domain=fixture.domain;
  const corners=Array.from({length:12},(_,i)=>({x:domain.bounds-.003*(i%3),y:domain.floor+.012*(1+i%4),z:domain.depth-.004*(i%2),volume}));
  const pile=Array.from({length:64},()=>({x:-domain.bounds+.02,y:domain.floor+.02,z:-domain.depth+.02,volume}));
  for(const quality of ['eco','high','ultra']){
    compare(corners,{quality,domain});compare(corners,{quality,domain,maxTriangles:117});compare(pile,{quality,domain});
  }
});
test('distribuciones irregulares deterministas y cambios de calidad conservan orden, datos y salidas anteriores',()=>{
  let seed=127;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const first=compare(fixture.snapshots[2].particles,{quality:'high',domain:fixture.domain}),firstP=hash(first.p),firstN=hash(first.n);
  for(let sample=0;sample<16;sample++){
    const cloud=Array.from({length:5+sample%9},()=>({x:(random()-.5)*.9,y:fixture.domain.floor+random()*.6,z:(random()-.5)*.9,
      volume:fixture.snapshots[0].particles[0].volume*(.25+random()*2)}));
    for(const quality of ['eco','high','ultra'])compare(cloud,{quality,domain:sample%2?fixture.domain:null,...(sample%5===0?{maxTriangles:13}:{})});
  }
  assert.equal(hash(first.p),firstP);assert.equal(hash(first.n),firstN);
});
