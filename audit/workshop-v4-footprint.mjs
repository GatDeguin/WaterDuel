import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseGLB} from '../public/rendering/glb.js';
import {batchStaticAsset} from '../public/rendering/static-batches.js';
import {prepareWorkshopMotion,splitWorkshopMotionAsset} from '../public/rendering/workshop-motion.js';
const root=new URL('../public/assets/environment/workshop/',import.meta.url);
const json=async name=>JSON.parse(await fs.readFile(new URL(name,root),'utf8'));
const bytes=async name=>fs.readFile(new URL(name,root));
const hash=data=>createHash('sha256').update(data).digest('hex');
function textureFootprint(asset,combined){
 const refs=new Map();
 for(const raw of asset.materials){
  const p=raw.pbrMetallicRoughness??{},s=raw.extensions?.KHR_materials_sheen??{};
  for(const [info,kind]of [[p.baseColorTexture??raw.baseColorTexture,'color'],[p.metallicRoughnessTexture??raw.metallicRoughnessTexture,'data'],[raw.normalTexture,'data'],[raw.occlusionTexture,'data'],[raw.emissiveTexture,'color'],[s.sheenColorTexture,'color'],[s.sheenRoughnessTexture,'data']]){
   if(info?.index===undefined)continue;
   if(!refs.has(info.index))refs.set(info.index,new Set());refs.get(info.index).add(kind);
  }
 }
 const local=new Map();
 for(const [index,kinds]of refs){
  const texture=asset.textures[index],source=asset.images[texture.source],sampler=asset.samplers?.[texture.sampler]??{},b=source.bytes;
  if(source.mimeType!=='image/png'||b[0]!==137||b[1]!==80)throw Error('Only measured PNG assets are supported');
  const view=new DataView(b.buffer,b.byteOffset,b.byteLength),width=view.getUint32(16,false),height=view.getUint32(20,false),size=Math.ceil(width*height*4*4/3);
  for(const kind of kinds){
   const key=JSON.stringify([source.mimeType,hash(b),sampler.wrapS??10497,sampler.wrapT??10497,sampler.magFilter??9729,sampler.minFilter??9987,kind]);
   local.set(key,size);combined.set(key,size);
  }
 }
 return {textures:local.size,rgba8MipBytes:[...local.values()].reduce((a,b)=>a+b,0)};
}
async function metrics(main,contractName,surround){
 const combined=new Map(),models=[];
 for(const [file,isMain]of [[main,true],[surround,false]]){
  const encoded=await bytes(file),asset=parseGLB(encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.byteLength));
  let upload=asset;
  if(isMain){
   const contract=await json(contractName),motion=prepareWorkshopMotion(contract,asset.primitives),dynamicNames=new Set([motion?.name,...(motion?.dynamicNames??[]),...(contract.geometryCorrection?.transforms??[]).filter(group=>/^apron-/.test(group.id)).flatMap(group=>group.sourceObjects)]);
   upload=batchStaticAsset(splitWorkshopMotionAsset(asset,motion),{dynamicNames});
  }else upload=batchStaticAsset(asset);
  const gpuBufferBytes=upload.primitives.reduce((sum,p)=>sum+p.positions.byteLength+(p.normals?.byteLength??p.positions.byteLength)+(p.uv?.byteLength??p.positions.length/3*2*4)+(p.uv1?.byteLength??0)+(p.colors?.byteLength??0)+p.indices.byteLength,0);
  models.push({file,sha256:hash(encoded),fileBytes:encoded.byteLength,triangles:upload.primitives.reduce((sum,p)=>sum+p.indices.length/3,0),sourceGroups:asset.primitives.length,drawGroups:upload.primitives.length,gpuBufferBytes,textures:textureFootprint(asset,combined)});
 }
 const totals={fileBytes:models.reduce((s,m)=>s+m.fileBytes,0),triangles:models.reduce((s,m)=>s+m.triangles,0),drawGroups:models.reduce((s,m)=>s+m.drawGroups,0),gpuBufferBytes:models.reduce((s,m)=>s+m.gpuBufferBytes,0),sharedTextureObjects:combined.size,sharedRgba8MipBytes:[...combined.values()].reduce((a,b)=>a+b,0)};
 totals.gpuAssetBytesEstimate=totals.gpuBufferBytes+totals.sharedRgba8MipBytes;
 return {models,totals};
}
const before=await metrics('workshop-runtime-v3.glb','asset-contract-v3.json','workshop-360.glb'),after=await metrics('workshop-runtime-v4.glb','asset-contract-v4.json','workshop-360-v4.glb');
const delta=Object.fromEntries(Object.keys(before.totals).map(key=>[key,{absolute:after.totals[key]-before.totals[key],percent:(after.totals[key]/before.totals[key]-1)*100}]));
const receipt={scope:'Environment main + 360 only. Real parse, motion split and batching; same sampler/colorspace/content identities as SharedTextures. RGBA8+mips CPU estimate; not measured VRAM, process memory, FPS or GPU render time.',before,after,delta};
await fs.writeFile(new URL('./workshop-v4-footprint.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({before:before.totals,after:after.totals,delta},null,2));
