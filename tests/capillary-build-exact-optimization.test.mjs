import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as current from '../public/physics/capillary-contact.js';
import {BalloonMembrane} from '../public/physics/membrane.js';

const frozen=await readFile(new URL('./fixtures/capillary-contact-pre-build-opt-1.7.3.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(frozen).digest('hex'),'8e16d1a4cee255e65f364128d39d06271800a548d938e54f0f5304b7f191478f','The entire 1.7.3 source is pinned, including prior closest/contact optimizations.');
const source=frozen.toString('utf8').replace("'./dimensions.js'",JSON.stringify(new URL('../public/physics/dimensions.js',import.meta.url).href));
const oracle=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const random=()=>{let state=0x174ca91;return ()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);};
const node=(x,y,z,refY=-.5)=>({x,y,z,ref:{y:refY},mass:.01,addedMass:.002,vx:0,vy:0,vz:0});
const fold=()=>({version:1,scale:1,nodes:[node(-1,1,0,.5),node(0,0,-1,.5),node(0,0,1,.5),node(1,1,0,.5)],faces:[{a:0,b:2,c:1},{a:3,b:1,c:2}]});
function assertSurface(a,b,ma,mb,point,reach){
 assert.deepEqual(Object.keys(a),Object.keys(b));assert.equal(a.version,b.version);assert.equal(a.triangleCount,b.triangleCount);
 assert.strictEqual(a.membrane,ma);assert.strictEqual(b.membrane,mb);
 const x=a.closest(point,reach),y=b.closest(point,reach);assert.deepEqual(x,y);
 if(x){
  assert.deepEqual(Object.keys(x),Object.keys(y));
  for(const key of ['normal','center','min','max'])assert.deepEqual(Object.keys(x[key]),Object.keys(y[key]));
  for(let i=0;i<3;i++){assert.strictEqual(x.points[i],ma.nodes[x.ids[i]]);assert.strictEqual(y.points[i],mb.nodes[y.ids[i]]);}
 }
 return x;
}

test('Capillary surface rebuilding preserves exact neck/fold classification, face order and every closest result',()=>{
 const rng=random(),skins=[fold()];
 for(let sample=0;sample<48;sample++){
  const m={version:sample,scale:[.6,1,1.18,2][sample%4],nodes:[],faces:[]};
  for(let i=0;i<42;i++)m.nodes.push(node(rng()*2-1,rng()*2-1,rng()*2-1,i%3===0?.5:-.5));
  for(let i=0;i<36;i++)m.faces.push({a:i,b:(i+1)%42,c:(i+2)%42,fragment:i%13===0});
  m.faces.push({a:0,b:0,c:0},{a:100,b:1,c:2});
  if(sample%6===0)m.nodes[7].z=NaN;
  if(sample%7===0)m.nodes[12].y=Infinity;
  skins.push(m);
 }
 for(const subdivisions of [2,3]){
  const real=new BalloonMembrane({subdivisions,fractureModel:'energy'});real.attach({x:.3,y:3,z:.025});
  const m={version:real.version,scale:real.scale,nodes:real.nodes,faces:real.faces};skins.push(structuredClone(m));
  real.puncture({point:{x:.72,y:3,z:.025},incoming:{x:-1,y:.2,z:.1},impulse:.75});m.version=real.version;skins.push(structuredClone(m));
 }
 let hits=0,folds=0,necks=0;
 for(const ma of skins){
  const mb=structuredClone(ma),a=current.buildCapillarySurface(ma),b=oracle.buildCapillarySurface(mb);
  const queries=[...ma.nodes.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z)),...Array.from({length:40},()=>({x:rng()*4-2,y:rng()*5-1,z:rng()*4-2}))];
  for(let i=0;i<queries.length;i++){
   const hit=assertSurface(a,b,ma,mb,queries[i],[0,.0001,.025,.2,1,3][i%6]);
   if(hit){hits++;if(hit.zone==='neck')necks++;if(hit.zone==='fold')folds++;}
  }
  assert.strictEqual(current.buildCapillarySurface(ma),a);assert.strictEqual(oracle.buildCapillarySurface(mb),b);
 }
 assert.ok(hits>100);assert.ok(necks>0);assert.ok(folds>0);
});

test('Capillary rebuild keeps live-node aliases, per-version caching, fresh query values and public object key order',()=>{
 const ma=fold(),mb=structuredClone(ma),a=current.buildCapillarySurface(ma),b=oracle.buildCapillarySurface(mb),point={x:-1/3,y:1/3,z:0};
 const x=assertSurface(a,b,ma,mb,point,.5),y=b.closest(point,.5);assert.ok(x);assert.ok(y);
 const x2=a.closest(point,.5);assert.notStrictEqual(x,x2);assert.notStrictEqual(x.weights,x2.weights);assert.notStrictEqual(x.point,x2.point);assert.strictEqual(x.normal,x2.normal);assert.strictEqual(x.points,x2.points);
 ma.nodes[0].x+=.02;mb.nodes[0].x+=.02;assertSurface(a,b,ma,mb,point,.5);
 const saved={x:{...x.point},weights:[...x.weights]};a.closest({x:1,y:1,z:.1},.5);assert.deepEqual(x.point,saved.x);assert.deepEqual(x.weights,saved.weights);
 ma.version++;mb.version++;const nextA=current.buildCapillarySurface(ma),nextB=oracle.buildCapillarySurface(mb);
 assert.notStrictEqual(nextA,a);assert.notStrictEqual(nextB,b);assertSurface(nextA,nextB,ma,mb,point,.5);
 assert.equal(current.buildCapillarySurface(null),oracle.buildCapillarySurface(null));
});

test('Capillary rebuild retains finite contact energy, node reaction and parcel state bit for bit through repeated rebuilds',()=>{
 const ma={version:1,scale:1,nodes:[node(-1,0,-1),node(0,0,1),node(1,0,-1)],faces:[{a:0,b:1,c:2}]},mb=structuredClone(ma);
 const pa=Array.from({length:12},(_,i)=>({x:(i%4-1.5)*.1,y:.0105,z:(Math.floor(i/4)-1)*.1,vx:i*.001,vy:.01-i*.001,vz:0,volume:1e-9})),pb=structuredClone(pa);
 for(let step=0;step<40;step++){
  ma.version++;mb.version++;for(let i=0;i<3;i++){const delta=Math.sin(step+i)*1e-5;ma.nodes[i].y+=delta;mb.nodes[i].y+=delta;}
  const a=current.buildCapillarySurface(ma),b=oracle.buildCapillarySurface(mb),dt=[1/60,1/120,1/240][step%3];
  for(let i=0;i<pa.length;i++)assert.deepEqual(current.applyCapillaryContact(pa[i],a,dt,{radius:.01}),oracle.applyCapillaryContact(pb[i],b,dt,{radius:.01}));
  assert.deepEqual(pa,pb);assert.deepEqual(ma,mb);
 }
});
