import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareWorkshopMotion,environmentPartMatrix} from '../public/rendering/workshop-motion.js';
const contract=JSON.parse(readFileSync(new URL('../public/assets/environment/workshop/asset-contract-v3.json',import.meta.url)));
const bytes=readFileSync(new URL('../public/assets/environment/workshop/workshop-runtime-v3.glb',import.meta.url));
const asset=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
test('El rotor es único, gira sobre su pivote y deja jaula/motor en sus matrices originales',()=>{
  const motion=prepareWorkshopMotion(contract,asset.primitives),parts=asset.primitives;
  const rotor=parts.find(p=>p.nodeName===motion.name),still=parts.find(p=>p.nodeName!==motion.name);
  assert.ok(rotor);assert.deepEqual(environmentPartMatrix(still,motion,10),still.worldMatrix);
  const zero=environmentPartMatrix(rotor,motion,0),quarter=environmentPartMatrix(rotor,motion,Math.PI/2/motion.angularSpeed);
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs(zero[12+axis]-quarter[12+axis])<1e-6);
  assert.ok(Math.abs(quarter[0])<1e-6&&Math.abs(quarter[1]-1)<1e-6);
  assert.equal(environmentPartMatrix(rotor,motion,3,{staticCapture:true}),null);
  assert.deepEqual(environmentPartMatrix(rotor,motion,2*Math.PI/motion.angularSpeed),zero);
});
