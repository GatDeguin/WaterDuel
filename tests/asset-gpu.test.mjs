import test from 'node:test';
import assert from 'node:assert/strict';
import {AssetGPU} from '../public/rendering/asset-gpu.js';
function fixture(){
  const trace={buffers:new Set(),textures:new Set(),vaos:new Set(),draws:[],uniforms:{},uploads:[],frontFaces:[]};let serial=0;
  const gl=new Proxy({trace,createBuffer(){const b={id:++serial};trace.buffers.add(b);return b;},deleteBuffer:b=>trace.buffers.delete(b),
    createTexture(){const t={id:++serial};trace.textures.add(t);return t;},deleteTexture:t=>trace.textures.delete(t),createVertexArray(){const v={id:++serial};trace.vaos.add(v);return v;},deleteVertexArray:v=>trace.vaos.delete(v),
    bufferData:(_kind,data)=>trace.uploads.push(data),drawElements:(...args)=>trace.draws.push(args),frontFace:value=>trace.frontFaces.push(value),
    uniform1i:(key,v)=>trace.uniforms[key]=v,uniform1f:(key,v)=>trace.uniforms[key]=v,uniform2iv:(key,v)=>trace.uniforms[key]=Array.from(v),uniform3fv:(key,v)=>trace.uniforms[key]=Array.from(v),uniform4fv:(key,v)=>trace.uniforms[key]=Array.from(v),uniform4iv:(key,v)=>trace.uniforms[key]=Array.from(v),uniformMatrix4fv:(key,_t,v)=>trace.uniforms[key]=Array.from(v),uniformMatrix3fv:(key,_t,v)=>trace.uniforms[key]=Array.from(v),
    getParameter:()=>16}, {get:(o,k)=>k in o?o[k]:typeof k==='string'&&/^[A-Z0-9_]+$/.test(k)?k:()=>{}});
  const primitive={positions:new Float32Array([0,0,0,1,0,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),uv:new Float32Array([0,0,1,0,0,1]),indices:new Uint32Array([0,1,2]),material:0};
  const asset={primitives:[primitive],materials:[{pbrMetallicRoughness:{baseColorFactor:[.2,.3,.4,1],roughnessFactor:.3,metallicFactor:.7,baseColorTexture:{index:0}},normalTexture:{index:0,scale:.6}}],textures:[{source:0}],images:[{bytes:new Uint8Array([1]),mimeType:'image/png'}],samplers:[]};
  const U=new Proxy({},{get:(_o,key)=>key});return {gl,trace,asset,U};
}
test('recursos GPU separan color sRGB de datos lineales y conservan índices32/UV; dispose libera todo',async()=>{
  const {gl,trace,asset}=fixture();let closed=0;
  const gpu=new AssetGPU(gl,{decodeImage:async()=>({width:2,height:2,close(){closed++;}})});
  const model=await gpu.upload(asset);
  assert.equal(trace.textures.size,2);assert.equal(closed,1);assert.ok(trace.uploads.some(data=>data instanceof Uint32Array));assert.ok(model.parts[0].count===3);
  gpu.dispose();assert.equal(trace.buffers.size,0);assert.equal(trace.textures.size,0);assert.equal(trace.vaos.size,0);
});
test('una primitiva sin NORMAL genera caras planas conservando UV sin mutar el GLB',async()=>{
  const {gl,trace,asset}=fixture();asset.primitives[0].normals=null;const gpu=new AssetGPU(gl,{decodeImage:async()=>({width:2,height:2,close(){}})});
  const model=await gpu.upload(asset);assert.equal(model.parts[0].count,3);assert.equal(asset.primitives[0].normals,null);
  assert.ok(trace.uploads.some(data=>data instanceof Float32Array&&data.length===9&&Array.from(data).every((n,i)=>n===(i%3===2?1:0))));gpu.dispose();
});
test('dibujar usa factores glTF lineales y banda de extensión sin modificar geometría',async()=>{
  const {gl,trace,asset,U}=fixture(),gpu=new AssetGPU(gl,{decodeImage:async()=>({width:2,height:2,close(){}})}),model=await gpu.upload(asset);
  const before=[...asset.primitives[0].positions],matrix=Float32Array.from([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  gpu.draw(model,model.parts[0],matrix,U,{deformStart:.18,deformEnd:.725,extension:.3});
  assert.equal(trace.uniforms.uAssetEnabled,1);assert.deepEqual(trace.uniforms.uAssetColor,[.2,.3,.4,1]);assert.deepEqual(trace.uniforms.uAssetDeform,[.18,.725,.3]);
  assert.deepEqual([...asset.primitives[0].positions],before);assert.equal(trace.draws.length,1);gpu.dispose();
});
test('fallar decodificación limpia recursos parciales y no deja modelo a medias',async()=>{
  const {gl,trace,asset}=fixture(),gpu=new AssetGPU(gl,{decodeImage:async()=>{throw Error('png roto');}});
  await assert.rejects(gpu.upload(asset),/png roto/);assert.equal(trace.buffers.size,0);assert.equal(trace.textures.size,0);assert.equal(trace.vaos.size,0);gpu.dispose();
});
test('un nodo reflejado conserva caras exteriores y restaura el winding para las primitivas siguientes',async()=>{
  const {gl,trace,asset,U}=fixture(),gpu=new AssetGPU(gl,{decodeImage:async()=>({width:2,height:2,close(){}})}),model=await gpu.upload(asset);
  const reflected=Float32Array.from([-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  gpu.draw(model,model.parts[0],reflected,U);
  assert.deepEqual(trace.frontFaces,['CW','CCW']);
  trace.frontFaces=[];reflected[0]=1;gpu.draw(model,model.parts[0],reflected,U);
  assert.deepEqual(trace.frontFaces,['CCW','CCW']);gpu.dispose();
});
test('dos cargas concurrentes comparten mapas idénticos y conservan sRGB, datos y referencias hasta el último release',async()=>{
  const {gl,trace,asset}=fixture();let decoded=0,closed=0;
  let finish;const wait=new Promise(resolve=>{finish=resolve;});
  const gpu=new AssetGPU(gl,{decodeImage:async()=>{decoded++;await wait;return {width:2,height:2,close(){closed++;}};}});
  const first=gpu.upload(asset),second=gpu.upload(structuredClone(asset));finish();
  const [a,b]=await Promise.all([first,second]);
  assert.equal(decoded,1,'no se debe volver a decodificar el mismo PNG concurrentemente');
  assert.equal(closed,1);assert.equal(trace.textures.size,2,'un color sRGB y un mapa lineal, compartidos');
  assert.equal(a.textures[0].color,b.textures[0].color);assert.equal(a.textures[0].data,b.textures[0].data);
  const before=gpu.bytes;gpu.release(a);assert.equal(trace.textures.size,2);assert.ok(gpu.bytes<before);
  gpu.draw(b,b.parts[0],b.parts[0].worldMatrix,new Proxy({},{get:(_o,k)=>k}));assert.equal(trace.draws.length,1);
  gpu.release(b);assert.equal(trace.textures.size,0);assert.equal(gpu.bytes,0);gpu.dispose();
});
test('el caché distingue bytes, MIME y samplers sin fusionar imágenes de interpretación diferente',async()=>{
  const {gl,trace,asset}=fixture(),gpu=new AssetGPU(gl,{decodeImage:async()=>({width:2,height:2,close(){}})});
  const a=await gpu.upload(asset),sampler=structuredClone(asset),bytes=structuredClone(asset),mime=structuredClone(asset);
  sampler.samplers=[{wrapS:gl.CLAMP_TO_EDGE}];sampler.textures[0].sampler=0;
  bytes.images[0].bytes[0]=2;mime.images[0].mimeType='image/jpeg';
  const models=await Promise.all([gpu.upload(sampler),gpu.upload(bytes),gpu.upload(mime)]);
  assert.equal(trace.textures.size,8);for(const b of models)assert.notEqual(a.textures[0].color,b.textures[0].color);
  gpu.dispose();assert.equal(gpu.bytes,0);assert.equal(trace.textures.size,0);
});
test('un fallo concurrente de imagen no deja entradas envenenadas ni impide reintentar',async()=>{
  const {gl,trace,asset}=fixture();let decodeCount=0;
  const gpu=new AssetGPU(gl,{decodeImage:async()=>{if(++decodeCount===1)throw Error('PNG interrumpido');return {width:2,height:2,close(){}};}});
  const results=await Promise.allSettled([gpu.upload(asset),gpu.upload(structuredClone(asset))]);
  assert.ok(results.every(result=>result.status==='rejected'));assert.equal(decodeCount,1);
  assert.equal(trace.textures.size,0);assert.equal(gpu.bytes,0);
  const model=await gpu.upload(asset);assert.equal(decodeCount,2);assert.equal(model.parts.length,1);
  gpu.dispose();assert.equal(trace.textures.size,0);assert.equal(gpu.bytes,0);
});
test('dispose durante una decodificación pendiente cancela ambas cargas y cierra el bitmap una sola vez',async()=>{
  const {gl,trace,asset}=fixture();let finish,closed=0;const wait=new Promise(resolve=>{finish=resolve;});
  const gpu=new AssetGPU(gl,{decodeImage:async()=>{await wait;return {width:2,height:2,close(){closed++;}};}});
  const uploads=[gpu.upload(asset),gpu.upload(structuredClone(asset))];gpu.dispose();finish();
  const results=await Promise.allSettled(uploads);assert.ok(results.every(result=>result.status==='rejected'));
  assert.equal(closed,1);assert.equal(trace.textures.size,0);assert.equal(trace.buffers.size,0);assert.equal(gpu.bytes,0);
});
test('fallar la geometría de un segundo modelo no borra texturas compartidas por un modelo válido',async()=>{
  const {gl,trace,asset,U}=fixture(),gpu=new AssetGPU(gl,{decodeImage:async()=>({width:2,height:2,close(){}})});
  const first=await gpu.upload(asset),bytes=gpu.bytes,create=gl.createBuffer;let attempt=0;
  gl.createBuffer=()=>++attempt===2?null:create();
  await assert.rejects(gpu.upload(structuredClone(asset)),/reservar buffer/);
  assert.equal(trace.textures.size,2);assert.equal(gpu.bytes,bytes);assert.equal(trace.vaos.size,1);
  gpu.draw(first,first.parts[0],first.parts[0].worldMatrix,U);assert.equal(trace.draws.length,1);
  gpu.dispose();assert.equal(trace.buffers.size,0);assert.equal(trace.textures.size,0);assert.equal(gpu.bytes,0);
});
test('dibujos consecutivos conservan UV por mapa, tint, shear y normales traspuestas inversas sin contaminar el siguiente modelo',async()=>{
  const {gl,trace,asset,U}=fixture();asset.materials[0].normalTexture.texCoord=1;
  asset.materials[0].extensions={KHR_materials_sheen:{sheenColorFactor:[.2,.3,.4],sheenRoughnessFactor:.7,sheenColorTexture:{index:0,texCoord:1}}};
  const gpu=new AssetGPU(gl,{decodeImage:async()=>({width:2,height:2,close(){}})}),model=await gpu.upload(asset);
  const shear=Float32Array.from([2,0,.3,0,.4,3,.6,0,.2,.1,4,0,1,2,3,1]);
  gpu.draw(model,model.parts[0],shear,U,{tint:[.5,.25,.75],extension:.2});
  assert.deepEqual(trace.uniforms.uAssetColor,[.1,.075,.30000000000000004,1]);
  assert.deepEqual(trace.uniforms.uAssetTexCoords,[0,1,0,0]);assert.deepEqual(trace.uniforms.uAssetSheenUV,[1,0]);
  assert.ok(trace.uniforms.uAssetSheen.every((value,index)=>Math.abs(value-[.2,.3,.4,.7][index])<1e-7));assert.equal(trace.uniforms.uAssetMaps,35);
  const normal=trace.uniforms.uNormal.slice(6,9);
  for(const tangent of [[shear[0],shear[1],shear[2]],[shear[4],shear[5],shear[6]]])assert.ok(Math.abs(normal.reduce((sum,n,index)=>sum+n*tangent[index],0))<1e-7);
  gpu.draw(model,model.parts[0],model.parts[0].worldMatrix,U);
  assert.deepEqual(trace.uniforms.uAssetColor,[.2,.3,.4,1]);assert.deepEqual(trace.uniforms.uAssetDeform,[0,1,0]);
  assert.deepEqual(trace.uniforms.uNormal,[1,0,0,0,1,0,0,0,1]);gpu.dispose();
});
test('una colisión de hash de bytes se separa por comparación completa y el sampler explícito por defecto sí comparte',async()=>{
  const {gl,trace,asset}=fixture(),gpu=new AssetGPU(gl,{decodeImage:async()=>({width:2,height:2,close(){}})});
  // Both equal-length payloads have FNV-1a32 = 1491293048.
  asset.images[0].bytes=Uint8Array.from([178,125,226,77,236,123,116,240]);
  const different=structuredClone(asset);different.images[0].bytes=Uint8Array.from([237,135,113,210,125,61,118,202]);
  const explicit=structuredClone(asset);explicit.samplers=[{wrapS:gl.REPEAT,wrapT:gl.REPEAT,magFilter:gl.LINEAR,minFilter:gl.LINEAR_MIPMAP_LINEAR}];explicit.textures[0].sampler=0;
  const [a,b,c]=await Promise.all([gpu.upload(asset),gpu.upload(different),gpu.upload(explicit)]);
  assert.notEqual(a.textures[0].color,b.textures[0].color);assert.equal(a.textures[0].color,c.textures[0].color);assert.equal(trace.textures.size,4);
  gpu.dispose();assert.equal(gpu.bytes,0);assert.equal(trace.textures.size,0);
});
