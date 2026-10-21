import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DetachedCluster} from '../public/physics/detached-cluster.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

const temporary=new URL(`../public/physics/.detached-contact-before-${process.pid}.mjs`,import.meta.url);
const oracle=await fs.readFile(new URL('../audit/combat-1.7/baseline/detached-cluster-before-contact-memo.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(oracle).digest('hex'),'0410b66f8d4b295c24423ab09f5b748eb59353c38077dc2e9363af2ebb2a5a24');
await fs.writeFile(temporary,oracle);
const {DetachedCluster:Before}=await import(temporary.href);test.after(()=>fs.unlink(temporary));
function fixture(Type=DetachedCluster){
  return new Type({id:'memo',joint:'mainElbow',bodies:[{name:'mainForearm',mass:.25,inertia:.02,center:{x:0,y:1,jx:[1],jy:[0]},rotations:[0]}],
    panels:[],vertices:Array.from({length:48},(_,i)=>({x:(i%8)*.05,y:TABLE_TOP+.01+(i%3)*.035,z:Math.floor(i/8)*.04})),velocity:[.1],dir:1,sourcePose:{mainHand:{x:0,y:1,z:.17}},gravity:0});
}

test('El memo conserva exactamente el snapshot anterior en40 transformaciones y al modificar vértices públicos',()=>{
  const current=fixture(),before=fixture(Before);
  for(let i=0;i<40;i++){
    for(const cluster of [current,before]){cluster.x=Math.sin(i*.13)*.4;cluster.y=1+(i%5)*.03;cluster.angle=Math.sin(i*.17)*.3;}
    assert.deepEqual(current.snapshot(),before.snapshot());assert.deepEqual(current.snapshot(),before.snapshot());
  }
  const check=change=>{for(const cluster of [current,before])change(cluster);assert.deepEqual(current.snapshot(),before.snapshot());};
  check(c=>c.vertices[0].x+=.11);check(c=>c.vertices[1].y-=.08);check(c=>c.vertices[2].z+=.17);
  check(c=>c.vertices.push({x:.7,y:TABLE_TOP-c.y+.001,z:.6}));check(c=>c.vertices=c.vertices.slice(2));
  check(c=>{c.angle=0;c.y=2;});assert.equal(current.snapshot().contactVertices.length,0);
  check(c=>c.y=1);assert.ok(current.snapshot().contactVertices.length>0,'cruzar el umbral real del piso invalida la selección vacía');
});

test('Consultas repetidas evitan transformar/seleccionar otra vez y cada captura conserva su propiedad',()=>{
  const cluster=fixture(),map=Array.prototype.map;let worldBuilds=0;
  cluster.vertices.map=function(...args){worldBuilds++;return map.apply(this,args);};
  const first=cluster.snapshot(),replay=structuredClone(first);assert.ok(first.contactVertices.length>0);
  for(let i=0;i<40;i++)cluster.snapshot();assert.equal(worldBuilds,1,'un estado idéntico reutiliza los puntos seleccionados');
  first.contactVertices[0].x=999;first.contactVertices.push({x:999,y:999,z:999});first.transform[12]=999;first.contactTransform[12]=999;
  assert.deepEqual(cluster.snapshot(),replay,'arrays y puntos del consumidor no alcanzan el memo');
  cluster.vertices[0].y-=.02;cluster.snapshot();assert.equal(worldBuilds,2);
  cluster.y+=.03;cluster.snapshot();assert.equal(worldBuilds,3);
  assert.deepEqual(replay,structuredClone(fixture().snapshot()),'el registro anterior permanece aislado del movimiento posterior');
});
