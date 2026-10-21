import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as current from '../public/physics/capillary-contact.js';

// The complete pre-optimization implementation is pinned, including its math,
// candidate order and tie rule. Only resolve its existing dimensions import.
const frozen=await readFile(new URL('./fixtures/capillary-contact-pre-opt-1.7.txt',import.meta.url));
assert.equal(createHash('sha256').update(frozen).digest('hex'),'eddaccc7ea20f7f8d40b8a12daffe0bda530ac16a1ce8687e331a159fe7f45e6');
const source=frozen.toString();assert.equal(source.split("'./dimensions.js'").length,2);
const oracle=await import('data:text/javascript;base64,'+Buffer.from(source.replace("'./dimensions.js'",JSON.stringify(new URL('../public/physics/dimensions.js',import.meta.url).href))).toString('base64'));
const node=(x,y,z,i=0)=>({x,y,z,vx:i*.0001,vy:-i*.0002,vz:i*.0003,mass:.01,addedMass:.002,pinned:i===0,ref:{y:-.5}});
function random(){let seed=0x17ca91;return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
function skin(){return {version:1,scale:1,nodes:[node(-1,0,-1),node(0,0,1,1),node(1,0,-1,2)],faces:[{a:0,b:1,c:2}]};}

test('Capillary closest is bit-exact to the frozen oracle across geometry, edges and AABB rejections',()=>{
 const rng=random(),m={version:1,scale:1,nodes:[],faces:[]};
 for(let i=0;i<120;i++)m.nodes.push(node(rng()*2-1,rng()*2-1,rng()*2-1,i));
 for(let i=0;i<40;i++)m.faces.push({a:i*3,b:i*3+1,c:i*3+2,fragment:i%11===0});
 const a=current.buildCapillarySurface(m),b=oracle.buildCapillarySurface(structuredClone(m));assert.equal(a.triangleCount,b.triangleCount);assert.ok(a.triangleCount>30);
 for(let i=0;i<1500;i++){
  const point=i<120?m.nodes[i]:{x:rng()*4-2,y:rng()*4-2,z:rng()*4-2},reach=[0,.00001,.01,.1,.5,2][i%6];
  assert.deepEqual(a.closest(point,reach),b.closest(point,reach),`query ${i}`);
 }
});

test('Capillary exact AABB boundaries and equal-distance triangles retain the first material face',()=>{
 const m=skin();m.nodes.push(...m.nodes.map(n=>structuredClone(n)));m.faces.push({a:3,b:4,c:5});
 const a=current.buildCapillarySurface(m),b=oracle.buildCapillarySurface(structuredClone(m));
 for(const point of [{x:0,y:.01,z:0},{x:1.01,y:0,z:-1},{x:-1.01,y:0,z:-1},{x:0,y:0,z:1.01},{x:0,y:-.01,z:0},{x:0,y:2,z:0}]){
  assert.deepEqual(a.closest(point,.01),b.closest(point,.01));
 }
 const hit=a.closest({x:0,y:.01,z:0},.02);assert.strictEqual(hit.points[0],m.nodes[0]);assert.deepEqual(hit.weights,[.25,.5,.25]);
});

test('Capillary impulse, finite energy ledger and node reactions remain bit-exact over repeated contact and release',()=>{
 const a=skin(),b=structuredClone(a),pa=Array.from({length:24},(_,i)=>({x:(i%6-2.5)*.12,y:i%3===0?.2:.0105,z:(Math.floor(i/6)-1.5)*.12,vx:i*.001,vy:.01-i*.001,vz:0,volume:1e-9})),pb=structuredClone(pa);
 for(let step=0;step<80;step++){
  a.version++;b.version++;for(let i=0;i<a.nodes.length;i++){const delta=Math.sin(step+i)*1e-5;a.nodes[i].y+=delta;b.nodes[i].y+=delta;}
  const sa=current.buildCapillarySurface(a),sb=oracle.buildCapillarySurface(b),dt=[1/60,1/120,1/240][step%3];
  for(let i=0;i<pa.length;i++)assert.deepEqual(current.applyCapillaryContact(pa[i],sa,dt,{radius:.01}),oracle.applyCapillaryContact(pb[i],sb,dt,{radius:.01}),`step ${step}, parcel ${i}`);
  assert.deepEqual(pa,pb);assert.deepEqual(a,b);
  if(step===40){for(const p of [...pa,...pb])p.y=.2;}if(step===45){for(const p of [...pa,...pb])p.y=.0105;}
 }
});
