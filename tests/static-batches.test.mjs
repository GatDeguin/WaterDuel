import test from 'node:test';import assert from 'node:assert/strict';
import {batchStaticAsset} from '../public/rendering/static-batches.js';
const I=()=>Float32Array.from([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function part(name,x=0,material=0){const matrix=I();matrix[12]=x;return {nodeName:name,material,worldMatrix:matrix,positions:Float32Array.from([0,0,0,1,0,0,0,1,0]),normals:Float32Array.from([0,0,1,0,0,1,0,0,1]),uv:Float32Array.from([0,0,1,0,0,1]),indices:Uint32Array.from([0,1,2])};}
test('Agrupar geometría estática conserva cada triángulo, normal, UV y material',()=>{
 const a=part('a',2),b=part('b',-2),asset={materials:[{}],primitives:[a,b]},result=batchStaticAsset(asset);
 assert.equal(result.primitives.length,1);const p=result.primitives[0];
 assert.deepEqual(Array.from(p.indices),[0,1,2,3,4,5]);assert.equal(p.positions.length,a.positions.length+b.positions.length);
 assert.deepEqual(Array.from(p.positions),[2,0,0,3,0,0,2,1,0,-2,0,0,-1,0,0,-2,1,0]);
 assert.deepEqual(Array.from(p.normals),[...a.normals,...b.normals]);assert.deepEqual(Array.from(p.uv),[...a.uv,...b.uv]);
 assert.deepEqual(Array.from(a.positions),[0,0,0,1,0,0,0,1,0]);assert.equal(p.material,0);
});
test('Rotor, banderines, superficies transparentes y transformaciones reflejadas conservan piezas independientes',()=>{
 const fan=part('fan'),cloth=part('cloth'),glass=part('glass',0,1),mirror=part('mirror');mirror.worldMatrix[0]=-1;
 const asset={materials:[{}, {alphaMode:'BLEND'}],primitives:[part('a'),part('b'),fan,cloth,glass,mirror]};
 const out=batchStaticAsset(asset,{dynamicNames:new Set(['fan','cloth'])});
 assert.equal(out.primitives.length,5);for(const p of [fan,cloth,glass,mirror])assert.ok(out.primitives.includes(p));
 assert.equal(out.primitives.reduce((s,p)=>s+p.indices.length,0),18);
});
