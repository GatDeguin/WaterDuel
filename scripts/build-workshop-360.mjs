// Rebuild: node scripts/build-workshop-360.mjs [--blender path/to/blender.exe]
// Packing preserves the exact v3 material definitions and PNG/JPEG bytes, so
// the native SharedTextures cache can reuse maps across the two GLB uploads.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseGLB} from '../public/rendering/glb.js';

const root=fileURLToPath(new URL('../',import.meta.url)),folder=path.join(root,'public/assets/environment/workshop');
const work=path.join(root,'.runtime/workshop-360-1.11');
const protectedSHA='1a947c7e2a5b2387e5a0db4cd55169445dad91d2a0fda59bac5c51c0751bb930';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function chunks(bytes){
 const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
 return {json,bin:bytes.subarray(28+length,28+length+bytes.readUInt32LE(20+length))};
}
const before=await readFile(path.join(folder,'workshop-runtime-v3.glb'));
if(sha(before)!==protectedSHA)throw Error('Protected workshop v3 SHA changed');
const at=process.argv.indexOf('--blender'),blender=at>=0?process.argv[at+1]:process.env.BLENDER_BIN??'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
function runBlender(args){
 const result=spawnSync(blender,['-b','--factory-startup','--python-exit-code','1',...args],{cwd:root,stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;if(result.status!==0)throw Error('Workshop360 Blender build failed: '+result.status);
}
if(!process.argv.includes('--pack-only')){
 runBlender(['--python',path.join(root,'blender/create_workshop_360.py')]);
}
const source=chunks(before),raw=chunks(await readFile(path.join(work,'workshop-360-geometry.glb'))),json=raw.json;
const buffers=[raw.bin];let offset=raw.bin.length;
const images=[],textures=[],samplers=[],imageMap=new Map(),textureMap=new Map(),samplerMap=new Map();
const clone=value=>JSON.parse(JSON.stringify(value));
const pad=bytes=>Buffer.concat([bytes,Buffer.alloc((4-bytes.length%4)%4)]);
function image(index){
 if(imageMap.has(index))return imageMap.get(index);
 const original=source.json.images[index],view=source.json.bufferViews[original.bufferView];
 const bytes=source.bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),chunk=pad(bytes),newIndex=images.length;
 const bufferView=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});offset+=chunk.length;buffers.push(chunk);
 images.push({...clone(original),bufferView});imageMap.set(index,newIndex);return newIndex;
}
function texture(index){
 if(textureMap.has(index))return textureMap.get(index);
 const original=source.json.textures[index],copy={...clone(original),source:image(original.source)},newIndex=textures.length;
 if(original.sampler!==undefined){
  if(!samplerMap.has(original.sampler)){samplerMap.set(original.sampler,samplers.length);samplers.push(clone(source.json.samplers[original.sampler]));}
  copy.sampler=samplerMap.get(original.sampler);
 }
 textures.push(copy);textureMap.set(index,newIndex);return newIndex;
}
function materialTextures(value){
 for(const [key,child]of Object.entries(value))if(child&&typeof child==='object'){
  if(key.endsWith('Texture')&&Number.isInteger(child.index))child.index=texture(child.index);
  else materialTextures(child);
 }
}
json.materials=json.materials.map(material=>{
 const historical=source.json.materials.find(m=>m.name===material.name);
 if(!historical)throw Error('Unknown extension material '+material.name);
 const result=clone(historical);materialTextures(result);return result;
});
json.images=images;json.textures=textures;json.samplers=samplers;
json.buffers=[{byteLength:offset}];
json.extensionsUsed=[...new Set([...(json.extensionsUsed??[]),...json.materials.flatMap(m=>Object.keys(m.extensions??{}))])];
json.asset.generator='WaterDuel 1.11 / Blender 5.2 material batches + exact v3 PBR packing';
const jsonChunk=pad(Buffer.from(JSON.stringify(json)));for(let i=Buffer.byteLength(JSON.stringify(json));i<jsonChunk.length;i++)jsonChunk[i]=32;
const bin=Buffer.concat(buffers),header=Buffer.alloc(20),binHeader=Buffer.alloc(8);
header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonChunk.length+bin.length,8);header.writeUInt32LE(jsonChunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
binHeader.writeUInt32LE(bin.length,0);binHeader.writeUInt32LE(0x004e4942,4);
const result=Buffer.concat([header,jsonChunk,binHeader,bin]),asset=parseGLB(result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength));
const triangles=asset.primitives.reduce((n,p)=>n+p.indices.length/3,0);
if(result.length>12*1024*1024||asset.primitives.length>18||triangles>50000)throw Error('Workshop360 exceeded shipping budget '+JSON.stringify({bytes:result.length,batches:asset.primitives.length,triangles}));
const authoring=JSON.parse(await readFile(path.join(work,'authoring.json'),'utf8'));
const hints=[-6.2,6.2].map((x,i)=>({name:'Workshop360 practical '+(i?'right':'left'),type:'POINT',position:[x,5.25,15.19],scaledWatts:105,colorLinear:[1,.58,.27]}));
const contract={schemaVersion:1,version:1,stable:true,release:'1.11',asset:'workshop-360.glb',sha256:sha(result),bytes:result.length,triangles,batches:asset.primitives.length,
 protectedV3:{asset:'workshop-runtime-v3.glb',sha256:protectedSHA,preserved:true},
 source:{python:'blender/create_workshop_360.py',packer:'scripts/build-workshop-360.mjs',editable:authoring.source,seed:authoring.seed},
 coordinates:{runtimeUp:'Y',runtimeFront:'+Z',units:'runtime metres',geometryTransformApplied:true,nodeMatrices:'identity'},
 bounds:asset.bounds,cameraInterior:{min:[-10.5,.7745,2.4],max:[10.5,6.9,14.3]},
 room:{innerMin:[-12,-.4186972789,-6.2],innerMax:[12,8.06,16],cameraClearance:'New props remain outside cameraInterior; portrait framing is adapted by Principal.'},
 historicalOpenings:[{id:'left-forward-side',plane:'x=-6.78',z:[-.26,6.139],closure:'left return at z=-.34 connects historic wall to outer nave at x=-12'},
 {id:'right-forward-side',plane:'x=6.78',z:[-.26,6.139],closure:'right return at z=-.34 connects historic wall to outer nave at x=12'},
 {id:'front',plane:'open +Z',closure:'solid front wall z=16, reclaimed service door and storage'},
 {id:'ceiling',plane:'above historic joists y~6.88',closure:'closed plank roof underside8.06, new beams underside7.57'}],
 elements:[{id:'front-wall',bounds:{min:[-12,-.425,16],max:[12,8.125,16.28]}},
 {id:'left-wall',bounds:{min:[-12.28,-.425,-6.2],max:[-12,8.125,16]}},
 {id:'right-wall',bounds:{min:[12,-.425,-6.2],max:[12.28,8.125,16]}},
 {id:'ceiling',bounds:{min:[-12,7.3,-6.2],max:[12,8.24,16]}},
 {id:'floor-extension',regions:regionsForContract()},
 {id:'left-return',bounds:{min:[-12,-.45,-.46],max:[-6.8,6.55,-.22]}},
 {id:'right-return',bounds:{min:[6.8,-.45,-.46],max:[12,6.55,-.22]}},
 {id:'storage-and-tools',detailCounts:authoring.counts}],
 materialReuse:{source:'protected v3',exactEmbeddedImageBytes:true,newTextures:0,materialFactorsPreserved:true,atlasPatches:authoring.atlasPatches,materials:asset.materials.map(m=>m.name)},
 lighting:{hints},lightDirections:{lights:hints.map(h=>({name:h.name,type:h.type,position:h.position,direction:[0,0,0],radiusRuntime:.23}))},
 integration:{separateGPU:true,worldMatrix:'identity',staticBatching:true,includeIn:'arena color, shadow, transmission and environment-probe draws',physics:'visual architecture only; gameplay and collisions unchanged'}};
function regionsForContract(){return [{min:[-12,-.58,-6.2],max:[-7.7542601,-.4077,16]},{min:[7.7542601,-.58,-6.2],max:[12,-.4077,16]},{min:[-7.7542601,-.58,6.1385475],max:[7.7542601,-.4077,16]}];}
await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'workshop-360.glb'),result);await writeFile(path.join(folder,'workshop-360.json'),JSON.stringify(contract,null,2)+'\n');
if(sha(await readFile(path.join(folder,'workshop-runtime-v3.glb')))!==protectedSHA)throw Error('Protected v3 changed during build');
console.log(JSON.stringify({asset:contract.asset,bytes:result.length,triangles,batches:asset.primitives.length,images:images.length,bounds:asset.bounds}));
