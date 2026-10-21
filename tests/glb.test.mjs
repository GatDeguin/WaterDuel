import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseGLB as parse,loadGLB} from '../public/rendering/glb.js';

function glb(json,bin=new Uint8Array()){
  const text=new TextEncoder().encode(JSON.stringify(json)),jl=(text.length+3)&~3,bl=(bin.byteLength+3)&~3;
  const out=new ArrayBuffer(28+jl+bl),v=new DataView(out),u=new Uint8Array(out);
  v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.byteLength,true);
  v.setUint32(12,jl,true);v.setUint32(16,0x4e4f534a,true);u.fill(32,20,20+jl);u.set(text,20);
  v.setUint32(20+jl,bl,true);v.setUint32(24+jl,0x004e4942,true);u.set(new Uint8Array(bin.buffer??bin,bin.byteOffset??0,bin.byteLength),28+jl);
  return out;
}
function triangle(){
  const bin=new Uint8Array(102),v=new DataView(bin.buffer);
  [0,0,0,1,0,0,0,1,0,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1].forEach((n,i)=>v.setFloat32(i*4,n,true));
  [0,1,2].forEach((n,i)=>v.setUint16(96+i*2,n,true));
  const json={asset:{version:'2.0'},buffers:[{byteLength:102}],bufferViews:[
    {buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36},
    {buffer:0,byteOffset:72,byteLength:24},{buffer:0,byteOffset:96,byteLength:6}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},
      {bufferView:1,componentType:5126,count:3,type:'VEC3'},
      {bufferView:2,componentType:5126,count:3,type:'VEC2'},
      {bufferView:3,componentType:5123,count:3,type:'SCALAR'}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3}]}],
    nodes:[{name:'Triangle',mesh:0}],scenes:[{nodes:[0]}],scene:0};
  return {json,bin,v};
}

test('GLB devuelve datos propios, materiales por defecto e índices Uint32',()=>{
  const {json,bin}=triangle(),input=glb(json,bin),r=parse(input),p=r.primitives[0];
  assert.ok(p.positions instanceof Float32Array);assert.ok(p.indices instanceof Uint32Array);
  assert.deepEqual([...p.positions],[0,0,0,1,0,0,0,1,0]);assert.deepEqual([...p.indices],[0,1,2]);
  assert.deepEqual([...p.uv],[0,0,1,0,0,1]);assert.equal(p.nodeName,'Triangle');assert.equal(p.nodeIndex,0);
  assert.equal(p.skinIndex,null);assert.equal(p.joints,null);assert.equal(p.weights,null);
  assert.equal(p.material,-1);assert.equal(r.defaultMaterial.metallicFactor,1);assert.equal(r.defaultMaterial.roughnessFactor,1);
  new Uint8Array(input).fill(0);assert.equal(p.positions[3],1,'el resultado no retiene una vista mutable de entrada');
  assert.deepEqual(r.bounds,{min:[0,0,0],max:[1,1,0]});
});

test('GLB compone TRS column-major de padre e hijo y conserva nodos socket',()=>{
  const {json,bin}=triangle();json.nodes=[{name:'Parent',translation:[2,3,4],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2],scale:[2,2,2],children:[1]},
    {name:'Socket_Grip_Main',translation:[1,0,0],mesh:0}];json.scenes[0].nodes=[0];
  const r=parse(glb(json,bin)),m=r.primitives[0].worldMatrix;
  assert.ok(Math.abs(m[12]-2)<1e-6);assert.ok(Math.abs(m[13]-5)<1e-6);assert.equal(m[14],4);
  assert.equal(r.nodes[1].parentIndex,0);assert.equal(r.nodes[1].name,'Socket_Grip_Main');
  assert.equal(r.worldMatrices[1],r.nodes[1].worldMatrix);
});

test('GLB lee stride interleaved, normalización signed/unsigned y JOINTS sin normalizar',()=>{
  const bin=new Uint8Array(108),v=new DataView(bin.buffer);
  for(let i=0;i<3;i++){
    [i===1?1:0,i===2?1:0,0].forEach((x,k)=>v.setFloat32(i*20+k*4,x,true));
    v.setUint16(i*20+12,i===1?65535:0,true);v.setUint16(i*20+14,i===2?65535:0,true);
    v.setInt8(60+i*4+2,127);v.setUint8(72+i*4,1);v.setUint8(84+i*4,255);v.setUint32(96+i*4,i,true);
  }
  const json={asset:{version:'2.0'},buffers:[{byteLength:108}],bufferViews:[
    {buffer:0,byteLength:60,byteStride:20},{buffer:0,byteOffset:60,byteLength:12,byteStride:4},
    {buffer:0,byteOffset:72,byteLength:12},{buffer:0,byteOffset:84,byteLength:12},{buffer:0,byteOffset:96,byteLength:12}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},
      {bufferView:1,componentType:5120,count:3,type:'VEC3',normalized:true},
      {bufferView:0,byteOffset:12,componentType:5123,count:3,type:'VEC2',normalized:true},
      {bufferView:2,componentType:5121,count:3,type:'VEC4'},
      {bufferView:3,componentType:5121,count:3,type:'VEC4',normalized:true},
      {bufferView:4,componentType:5125,count:3,type:'SCALAR'}],
    nodes:[{mesh:0,skin:0},{name:'Joint0'},{name:'Joint1'}],skins:[{joints:[1,2]}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2,JOINTS_0:3,WEIGHTS_0:4},indices:5}]}]};
  const r=parse(glb(json,bin)),p=r.primitives[0];
  assert.deepEqual([...p.uv],[0,0,1,0,0,1]);assert.deepEqual([...p.normals],[0,0,1,0,0,1,0,0,1]);
  assert.ok(p.joints instanceof Uint16Array);assert.deepEqual([...p.joints],[1,0,0,0,1,0,0,0,1,0,0,0]);
  assert.deepEqual([...p.weights],[1,0,0,0,1,0,0,0,1,0,0,0]);
  assert.equal(r.skins[0].inverseBindMatrices.length,32);assert.equal(r.skins[0].inverseBindMatrices[0],1);
});

test('GLB normaliza PBR sin transformar factores lineales y comparte índices de imágenes',()=>{
  const {json,bin}=triangle();json.images=[{bufferView:3,mimeType:'image/png',name:'embedded'}];
  json.samplers=[{minFilter:9987,magFilter:9729}];json.textures=[{source:0,sampler:0},{source:0,sampler:0}];
  json.materials=[{name:'Metal',pbrMetallicRoughness:{baseColorFactor:[.25,.5,.75,1],baseColorTexture:{index:0},metallicRoughnessTexture:{index:1}},normalTexture:{index:0,scale:.4},doubleSided:true}];
  json.meshes[0].primitives[0].material=0;
  const r=parse(glb(json,bin)),m=r.materials[0];
  assert.deepEqual(m.baseColorFactor,[.25,.5,.75,1]);assert.equal(m.metallicFactor,1);assert.equal(m.roughnessFactor,1);
  assert.equal(m.normalTexture.scale,.4);assert.equal(m.baseColorTexture.index,0);assert.equal(m.metallicRoughnessTexture.index,1);
  assert.equal(r.textures[0].source,r.textures[1].source);assert.equal(r.samplers[0].wrapS,10497);
  assert.ok(r.images[0].bytes instanceof Uint8Array);assert.equal(r.images[0].mimeType,'image/png');
});

test('GLB rechaza truncado, magic/version/longitud incorrectos y JSON sin asset',()=>{
  const {json,bin}=triangle(),good=glb(json,bin);
  assert.throws(()=>parse(good.slice(0,-1)),/GLB/);
  for(const [offset,value] of [[0,0],[4,1],[8,28]]){const x=good.slice(0);new DataView(x).setUint32(offset,value,true);assert.throws(()=>parse(x),/GLB/);}
  assert.throws(()=>parse(glb({})),/asset|version/);
});

test('GLB valida conteos, offset, strides y límites antes de reservar memoria',()=>{
  for(const mutate of [j=>j.accessors[0].count=2**40,j=>j.accessors[0].byteOffset=-1,
    j=>j.bufferViews[0].byteLength=2**40,j=>j.bufferViews[0].byteStride=8,
    j=>j.accessors[0].bufferView=99,j=>j.buffers[0].byteLength=2**40]){
    const {json,bin}=triangle();mutate(json);assert.throws(()=>parse(glb(json,bin)),/GLB/);
  }
});

test('GLB rechaza índices fuera de rango, atributos desparejos y valores no finitos',()=>{
  {const {json,bin,v}=triangle();v.setUint16(100,5,true);assert.throws(()=>parse(glb(json,bin)),/index|índice/i);}
  {const {json,bin}=triangle();json.accessors[1].count=2;assert.throws(()=>parse(glb(json,bin)),/count|cantidad/i);}
  {const {json,bin,v}=triangle();v.setFloat32(0,NaN,true);assert.throws(()=>parse(glb(json,bin)),/finite|finito/i);}
});

test('GLB rechaza sparse, compresión requerida y recursos URI externos explícitamente',()=>{
  for(const mutate of [j=>j.accessors[0].sparse={count:1},j=>j.extensionsRequired=['KHR_draco_mesh_compression'],
    j=>j.buffers[0].uri='https://example.com/data.bin',j=>j.images=[{uri:'data:image/png;base64,AA=='}]]){
    const {json,bin}=triangle();mutate(json);assert.throws(()=>parse(glb(json,bin)),/sparse|extension|URI/i);
  }
});

test('GLB rechaza jerarquías cíclicas, padres múltiples y transformaciones inválidas',()=>{
  for(const nodes of [[{children:[1]},{children:[0],mesh:0}],
    [{children:[2]},{children:[2]},{mesh:0}],
    [{mesh:0,matrix:Array(16).fill(null)}],
    [{mesh:0,rotation:[0,0,0,0]}]]){
    const {json,bin}=triangle();json.nodes=nodes;assert.throws(()=>parse(glb(json,bin)),/cycle|ciclo|parent|padre|matrix|matriz|rotation|rotación/i);
  }
});

test('GLB sólo instancia escena activa; no elimina Preview, agua o nodos transparentes en silencio',()=>{
  const {json,bin}=triangle();json.nodes=[{name:'Preview_Rapier_X',mesh:0},{name:'Water_Contained',mesh:0},{name:'Inactive',mesh:0}];
  json.scenes=[{nodes:[0,1]},{nodes:[2]}];
  const r=parse(glb(json,bin));assert.deepEqual(r.primitives.map(p=>p.nodeName),['Preview_Rapier_X','Water_Contained']);
});

test('loadGLB transporta respuesta local, valida error HTTP y no depende de DOM/GPU',async()=>{
  const {json,bin}=triangle(),buffer=glb(json,bin);let seen;
  const r=await loadGLB('/assets/sword.glb',{fetchImpl:async url=>{seen=url;return {ok:true,arrayBuffer:async()=>buffer};}});
  assert.equal(seen,'/assets/sword.glb');assert.equal(r.primitives.length,1);
  await assert.rejects(()=>loadGLB('/missing.glb',{fetchImpl:async()=>({ok:false,status:404})}),/404/);
});

for(const [file,triangles] of [['equipment/workshop/sword.glb',12566],['equipment/workshop/maul.glb',17308],
  ['equipment/workshop/spear.glb',10190],['equipment/workshop/axe.glb',9270],['equipment/workshop/short.glb',19932],
  ['equipment/workshop/long.glb',23380],['equipment/workshop/knife.glb',6790],
  ['characters/water-mannequin/v2/water-mannequin.glb',57014],['characters/water-mannequin/v2/water-mannequin-boss.glb',78482],
  ['characters/water-mannequin/v2/water-mannequin-amber.glb',57014],['characters/water-mannequin/v2/water-mannequin-burst.glb',86064]]){
  test(`GLB real ${file} conserva geometría, texturas y sockets sin filtro`,async()=>{
    const bytes=await readFile(new URL(`../public/assets/${file}`,import.meta.url));
    const r=parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    assert.equal(r.primitives.reduce((n,p)=>n+p.indices.length/3,0),triangles);
    assert.ok(r.images.length>=3);assert.ok(r.images.every(i=>i.mimeType==='image/png'&&i.bytes.byteLength>100));
    assert.ok(r.nodes.some(n=>n.name.startsWith('Socket_')));
    for(const p of r.primitives){assert.equal(p.normals.length,p.positions.length);assert.ok([...p.positions].every(Number.isFinite));}
    if(file.includes('mannequin')){
      assert.equal(r.skins[0].joints.length,18);assert.equal(r.skins[0].inverseBindMatrices.length,18*16);
      assert.ok(r.primitives.some(p=>p.nodeName.startsWith('Preview_Rapier_')));
      for(const p of r.primitives)assert.equal(p.weights.length,p.positions.length/3*4);
    }
  });
}

test('GLB rechaza bounds invertidos y la skin IBM que no sea FLOAT MAT4 afín',()=>{
  {const {json,bin}=triangle();json.accessors[0].min=[2,0,0];assert.throws(()=>parse(glb(json,bin)),/bounds|min|max/);}
  {const {json,bin}=triangle();json.nodes.push({name:'joint'});json.skins=[{joints:[1],inverseBindMatrices:0}];assert.throws(()=>parse(glb(json,bin)),/MAT4/);}
  const bin=new Uint8Array(64),v=new DataView(bin.buffer);[0,5,10,15].forEach(i=>v.setFloat32(i*4,1,true));v.setFloat32(12,1,true);
  const json={asset:{version:'2.0'},buffers:[{byteLength:64}],bufferViews:[{buffer:0,byteLength:64}],
    accessors:[{bufferView:0,componentType:5126,count:1,type:'MAT4'}],nodes:[{}],skins:[{joints:[0],inverseBindMatrices:0}]};
  assert.throws(()=>parse(glb(json,bin)),/affine|afín|row/);
});

test('GLB acepta IBM adicionales permitidos por glTF y expone sólo matrices de joints',()=>{
  const bin=new Uint8Array(128),v=new DataView(bin.buffer);for(const base of [0,64])for(const i of [0,5,10,15])v.setFloat32(base+i*4,1,true);
  const json={asset:{version:'2.0'},buffers:[{byteLength:128}],bufferViews:[{buffer:0,byteLength:128}],
    accessors:[{bufferView:0,componentType:5126,count:2,type:'MAT4'}],nodes:[{}],skins:[{joints:[0],inverseBindMatrices:0}]};
  assert.equal(parse(glb(json,bin)).skins[0].inverseBindMatrices.length,16);
});

test('GLB genera índices para triángulos no indexados sin inventar UV ni normales',()=>{
  const {json,bin}=triangle();delete json.meshes[0].primitives[0].indices;delete json.meshes[0].primitives[0].attributes.NORMAL;
  delete json.meshes[0].primitives[0].attributes.TEXCOORD_0;
  const p=parse(glb(json,bin)).primitives[0];assert.deepEqual([...p.indices],[0,1,2]);assert.equal(p.normals,null);assert.equal(p.uv,null);
});

test('GLB mantiene signed normalized -128 como -1 y no convierte JOINTS a fracciones',()=>{
  const {json,bin,v}=triangle();json.accessors[1]={bufferView:1,componentType:5120,count:3,type:'VEC3',normalized:true};
  for(let i=36;i<45;i++)v.setInt8(i,i===36?-128:127);
  const p=parse(glb(json,bin)).primitives[0];assert.equal(p.normals[0],-1);assert.equal(p.normals[1],1);
});

test('GLB rechaza stride de atributo no múltiplo de cuatro y entradas JSON no estructuradas',()=>{
  {const {json,bin}=triangle();json.bufferViews[1].byteStride=6;json.accessors[1].componentType=5120;assert.throws(()=>parse(glb(json,bin)),/stride/i);}
  for(const key of ['nodes','accessors','materials','bufferViews']){
    const {json,bin}=triangle();json[key]=[null];assert.throws(()=>parse(glb(json,bin)),/GLB/);
  }
});

test('GLB conserva COLOR_0 linear y expande VEC3 a RGBA con alpha uno',()=>{
  const {json,bin}=triangle();json.meshes[0].primitives[0].attributes.COLOR_0=1;
  const p=parse(glb(json,bin)).primitives[0];assert.ok(p.colors instanceof Float32Array);
  assert.deepEqual([...p.colors],[0,0,1,1,0,0,1,1,0,0,1,1]);
});

test('GLB COLOR_0 normalizado VEC4 conserva alpha, valida cuenta y acota rango finito',()=>{
  const {json,bin,v}=triangle();json.meshes[0].primitives[0].attributes.COLOR_0=1;
  delete json.meshes[0].primitives[0].attributes.NORMAL;
  json.accessors[1]={bufferView:1,componentType:5121,count:3,type:'VEC4',normalized:true};
  [255,128,0,64,0,255,0,255,0,0,255,0].forEach((n,i)=>v.setUint8(36+i,n));
  const p=parse(glb(json,bin)).primitives[0];assert.equal(p.colors[0],1);assert.ok(Math.abs(p.colors[1]-128/255)<1e-7);
  assert.ok(Math.abs(p.colors[3]-64/255)<1e-7);assert.equal(p.colors[11],0);
  json.accessors[1].count=2;assert.throws(()=>parse(glb(json,bin)),/count/);
  const f=triangle();f.json.meshes[0].primitives[0].attributes.COLOR_0=1;f.v.setFloat32(36,1.1,true);
  assert.equal(parse(glb(f.json,f.bin)).primitives[0].colors[0],1);
});
