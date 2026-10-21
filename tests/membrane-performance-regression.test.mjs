import test from 'node:test';
import assert from 'node:assert/strict';
import {BalloonMembrane} from '../public/physics/membrane.js';
import {loadPriorMembrane,intactTrace,realContactTrace} from '../benchmarks/membrane-oracle.mjs';
const {BalloonMembrane:PriorMembrane}=await loadPriorMembrane();
const fields=['support','targetSupport','attached','accumulator','steps','version','punctured','fractureEvents','brokenEdges','fractureOrigins','volumeLambda','referenceVolume','targetVolume','addedMass','contactFloor','contactBounds','contactDepth','localImpact','releaseOrigin','pressureAtPuncture'];
function physical(m){const result={nodes:m.nodes,faces:m.faces,edges:m.edges,boundaryNodes:[...m.boundaryNodes],volumeGrad:m.volumeGrad};for(const key of fields)result[key]=m[key];return result;}
function compare(trace){
  const prior=new PriorMembrane(trace.configuration),current=new BalloonMembrane(trace.configuration);prior.attach(trace.head);current.attach(trace.head);
  for(let i=0;i<trace.calls.length;i++){
    const {method,args}=trace.calls[i];prior[method](...args);current[method](...args);
    assert.deepEqual(physical(current),physical(prior),`${trace.name}: estado físico exacto, llamada ${i}`);
    if(i%15===0||method==='puncture')for(const smooth of [0,1])for(const includeFragments of [false,true]){
      assert.deepEqual(current.mesh({smooth,includeFragments}),prior.mesh({smooth,includeFragments}),`${trace.name}: p/n/espesor/topología exactos`);
    }
  }
  assert.deepEqual(current.stats(),prior.stats());return {prior,current};
}
test('XPBD retenida conserva todos los estados y meshes del baseline a ambas resoluciones y escala de jefe',()=>{
  for(const subdivisions of [2,3])for(const scale of [1,1.16])compare(intactTrace({subdivisions,scale,steps:36}));
});
test('El contacto real, fractura y desplome conservan estados, masas, gradientes, topología y óptica bit a bit',()=>{
  const trace=realContactTrace({afterBurst:300});assert.equal(trace.receipt.contact.contact,true);assert.equal(trace.receipt.passive,true);
  assert.ok(trace.receipt.fractures>0);assert.ok(Math.abs(trace.receipt.water.initial-trace.receipt.water.retained-trace.receipt.water.released)<1e-12);
  compare(trace);
});
test('Meshes publicados no se reciclan entre versiones y una vista de presentación no altera el cache del solver',()=>{
  const m=new BalloonMembrane();m.attach({x:0,y:2.4,z:.025});const first=m.mesh(),saved=structuredClone(first);
  assert.equal(m.mesh(),first);m.advance(1/120,{head:{x:.1,y:2.4,z:.025},waterVolume:.1});assert.notEqual(m.mesh(),first);assert.deepEqual(first,saved);
  const view=Object.create(BalloonMembrane.prototype);Object.assign(view,{nodes:m.nodes.map(p=>({x:p.x,y:p.y,z:p.z,ref:p.ref})),faces:m.faces.map(f=>({a:f.a,b:f.b,c:f.c,restArea:f.restArea,fragment:f.fragment})),version:123,subdivisions:2,contactFloor:m.contactFloor,contactBounds:m.contactBounds,contactDepth:m.contactDepth});
  const cache=m.meshCache;assert.deepEqual(view.mesh(),m.mesh());assert.equal(m.meshCache,cache);assert.notEqual(view.meshCache,cache);
});
