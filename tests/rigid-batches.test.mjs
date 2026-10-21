import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {batchRigidCharacter} from '../public/rendering/rigid-batches.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms,detachedCharacterTransforms} from '../public/rendering/asset-rig.js';
import {DuelEngine} from '../public/engine.js';
const identity=()=>new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const part=(name,x=0,extra={})=>({nodeName:name,nodeIndex:x,boneName:'forearm.R',boneIndex:3,material:0,
 positions:Float32Array.from([x,0,0,x+1,0,0,x,1,0]),normals:Float32Array.from([0,0,1,0,0,1,0,0,1]),
 uv:Float32Array.from([0,0,1,0,0,1]),indices:Uint32Array.from([0,1,2]),targetStart:'mainElbow',targetEnd:'mainHand',anchorStart:[0,0,0],anchorEnd:[0,1,0],...extra});
const prepared=parts=>({parts,bones:new Map(),source:{},asset:{materials:[{}]},triangleCount:parts.reduce((s,p)=>s+p.indices.length/3,0)});
const attrs=[['positions',3],['normals',3],['uv',2],['uv1',2],['colors',4]];
function exactCoverage(before,after){
 const seen=new Uint8Array(before.parts.length);
 for(const output of after.parts){
  let vertex=0,index=0;
  for(const n of output.sourcePartIndices){
   const source=before.parts[n];seen[n]++;
   for(const [field,width]of attrs)if(source[field])assert.deepEqual(output[field].subarray(vertex*width,vertex*width+source[field].length),source[field],field);
   for(let i=0;i<source.indices.length;i++)assert.equal(output.indices[index+i],vertex+source.indices[i]);
   vertex+=source.positions.length/3;index+=source.indices.length;
  }
  assert.equal(index,output.indices.length);assert.equal(vertex,output.positions.length/3);
 }
 assert.ok(seen.every(n=>n===1),'every input part contributes exactly once');
 assert.equal(after.parts.reduce((s,p)=>s+p.indices.length,0),before.parts.reduce((s,p)=>s+p.indices.length,0));
}

test('Partes rígidas compatibles se concatenan en coordenadas del hueso y conservan metadata/bounds',()=>{
 const a=part('First timber',0),b=part('Second timber',2),input=prepared([a,b]),snapshot=structuredClone(input.parts);
 const output=batchRigidCharacter(input,input.asset.materials);assert.equal(output.parts.length,1);assert.equal(output.parts[0].nodeName,a.nodeName);
 assert.deepEqual(output.parts[0].sourceNames,[a.nodeName,b.nodeName]);assert.deepEqual(output.parts[0].bounds,{min:[0,0,0],max:[3,1,0],space:'bone-local'});
 assert.equal(output.bones,input.bones);assert.equal(output.source,input.source);assert.equal(output.asset,input.asset);
 exactCoverage(input,output);assert.deepEqual(input.parts,snapshot);assert.equal(output.rigidBatchStats.before,2);assert.equal(output.rigidBatchStats.after,1);
});

test('Huesos, materiales, accesorios, anchors, sockets y apronFromBone incompatibles nunca se mezclan',()=>{
 const base=part('Base'),variants=[{boneName:'upper_arm.R'},{boneIndex:4},{material:1},{accessory:'apron'},{anchorEnd:[0,1.000000001,0]},
  {socket:'Socket_MainHand'},{apronFromBone:identity()},{targetStart:'hip'},{uv1:new Float32Array(6)}];
 const input=prepared([base,...variants.map((v,i)=>part(`Separate ${i}`,i+1,v))]),output=batchRigidCharacter(input,[{},{}]);
 assert.equal(output.parts.length,input.parts.length);exactCoverage(input,output);
});

test('Woven y materiales BLEND/transmission conservan piezas separadas',()=>{
 const materials=[{}, {alphaMode:'BLEND'}, {extensions:{KHR_materials_transmission:{transmissionFactor:.3}}}, {transmission:.2}];
 const input=prepared([part('Woven sash'),part('Woven sash trim',2),part('Transparent1',3,{material:1}),part('Transparent2',4,{material:1}),
  part('Glass1',5,{material:2}),part('Glass2',6,{material:2}),part('Normalized glass1',7,{material:3}),part('Normalized glass2',8,{material:3})]);
 const output=batchRigidCharacter(input,materials);assert.equal(output.parts.length,input.parts.length);exactCoverage(input,output);
});

test('Layout/tipo de atributos son compatibles y el índice concatenado no desborda16bits',()=>{
 const a=part('Large'),count=65535;a.positions=new Float32Array(count*3);a.normals=new Float32Array(count*3);a.uv=new Float32Array(count*2);a.indices=Uint16Array.from([65532,65533,65534]);
 const b=part('Small',2),input=prepared([a,b]),output=batchRigidCharacter(input,[{}]);
 assert.equal(output.parts.length,1);assert.ok(output.parts[0].indices instanceof Uint32Array);assert.equal(output.parts[0].indices.at(-1),65537);exactCoverage(input,output);
 const typed=prepared([part('F32'),part('F64',1,{positions:Float64Array.from([1,0,0,2,0,0,1,1,0])})]);assert.equal(batchRigidCharacter(typed,[{}]).parts.length,2);
 const malformed=prepared([part('Bad',0,{indices:Uint32Array.from([0,1,9])})]);assert.throws(()=>batchRigidCharacter(malformed,[{}]),/index|índice/i);
});

const files=['water-mannequin.glb','water-mannequin-amber.glb','water-mannequin-boss.glb'];
for(const file of files)test(`GLB ${file}: ya agrupado61→61, conserva triángulos/atributos y transformaciones live/detached`,async()=>{
 const bytes=await readFile(new URL(`../public/assets/characters/water-mannequin/v3/${file}`,import.meta.url));
 const parsed=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),input=prepareCharacter(parsed),output=batchRigidCharacter(input,parsed.materials);
 // The shipped GLB already has one part for every bone/material/accessory.
 // Positive savings are proved above on real duplicate groups, never invented
 // here by relaxing material or bone ownership to obtain a lower draw count.
 assert.equal(input.parts.length,61);assert.equal(output.parts.length,61);assert.equal(output.rigidBatchStats.removedDrawsPerPass,0);
 assert.equal(output.triangleCount,input.triangleCount);exactCoverage(input,output);
 const game=new DuelEngine(),fighter=game.fighters[0];fighter.boss=file.includes('boss');
 const a=characterTransforms(input,fighter),b=characterTransforms(output,fighter),fragment={bodies:['mainForearm','weapon'],transform:identity(),sourcePose:fighter.pose};fragment.transform[12]=.2;
 const da=detachedCharacterTransforms(input,fighter,fragment),db=detachedCharacterTransforms(output,fighter,fragment);
 for(let i=0;i<output.parts.length;i++)for(const source of output.parts[i].sourcePartIndices){assert.deepEqual(b[i],a[source]);assert.deepEqual(db[i],da[source]);}
 console.log(JSON.stringify({asset:file,...output.rigidBatchStats}));
});
