// Material-only revision: preserve every geometry view/index/UV/node byte and
// reuse obsolete image holes, rather than accumulating unused embedded images.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const V1=path.join(ROOT,'public/assets/equipment/workshop');
const OUT=path.join(V1,'v2');
const SOURCE=path.join(ROOT,'docs/assets/equipment/v2');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const align=n=>(n+3)&~3;
const SECTIONS=['nodes','meshes','accessors','skins','animations','samplers','scenes','scene','extensionsUsed','extensionsRequired'];
function parse(bytes){
  if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw new Error('Invalid source GLB');
  let json,bin;
  for(let offset=12;offset<bytes.length;){
    const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4),data=bytes.subarray(offset+8,offset+8+length);offset+=8+length;
    if(type===0x4e4f534a)json=JSON.parse(data.toString());
    else if(type===0x004e4942)bin=data;
    else throw new Error('Unexpected GLB chunk');
  }
  if(!json||!bin)throw new Error('Source GLB needs JSON and BIN');return {json,bin};
}
function pack(json,bin){
  const raw=Buffer.from(JSON.stringify(json)),j=Buffer.alloc(align(raw.length),32);raw.copy(j);
  const b=Buffer.alloc(align(bin.length));bin.copy(b);
  const out=Buffer.alloc(28+j.length+b.length);out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(j.length,12);out.writeUInt32LE(0x4e4f534a,16);j.copy(out,20);
  out.writeUInt32LE(b.length,20+j.length);out.writeUInt32LE(0x004e4942,24+j.length);b.copy(out,28+j.length);return out;
}
function protectedHash(source,candidate,bin){
  const hash=createHash('sha256'),imageViews=new Set(source.json.images.map(image=>image.bufferView));
  for(const key of SECTIONS)hash.update(JSON.stringify([key,candidate[key]??null]));
  source.json.bufferViews.forEach((view,index)=>{
    if(imageViews.has(index))return;
    const actual=candidate.bufferViews[index];hash.update(JSON.stringify([index,actual]));
    hash.update(bin.subarray(actual.byteOffset??0,(actual.byteOffset??0)+actual.byteLength));
  });return hash.digest('hex');
}

await mkdir(OUT,{recursive:true});await mkdir(SOURCE,{recursive:true});
const sourceContractBytes=await readFile(path.join(V1,'asset-contract.json'));
const contract=JSON.parse(sourceContractBytes),textures=JSON.parse(await readFile(path.join(SOURCE,'texture-manifest.json'),'utf8'));
if(!textures.materials)throw new Error('Missing per-material texture manifest');
const receipts=[],nextAssets=[];
for(const asset of contract.assets){
  const originalBytes=await readFile(path.join(V1,asset.file));
  if(sha(originalBytes)!==asset.sha256)throw new Error(`Frozen v1 changed: ${asset.id}`);
  const original=parse(originalBytes),json=structuredClone(original.json),oldImageViews=new Set(json.images.map(image=>image.bufferView));
  const holes=[...oldImageViews].map(index=>{const view=json.bufferViews[index];return {start:view.byteOffset??0,end:(view.byteOffset??0)+view.byteLength};});
  for(const [index,view]of json.bufferViews.entries())if(!oldImageViews.has(index))for(const hole of holes){
    const a=view.byteOffset??0,b=a+view.byteLength;if(a<hole.end&&hole.start<b)throw new Error(`${asset.id}: geometry overlaps image hole`);
  }
  const images=[],newTextures=[],allocations=[],byHash=new Map(),reusableViews=[...oldImageViews];let end=original.bin.length;
  async function texture(file){
    const bytes=await readFile(file),hash=sha(bytes);if(byHash.has(hash))return byHash.get(hash);
    if(bytes.toString('hex',0,8)!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==512||bytes.readUInt32BE(20)!==512)throw new Error('Expected 512px core PNG');
    const fit=holes.filter(h=>align(h.start)+bytes.length<=h.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
    let offset;if(fit){offset=align(fit.start);fit.start=align(offset+bytes.length);}else{offset=align(end);end=offset+bytes.length;}
    const view={buffer:0,byteOffset:offset,byteLength:bytes.length},viewIndex=reusableViews.length?reusableViews.shift():json.bufferViews.length;
    json.bufferViews[viewIndex]=view;const image=images.length;images.push({bufferView:viewIndex,mimeType:'image/png',name:path.basename(file,'.png')});
    const index=newTextures.length;newTextures.push({sampler:0,source:image});byHash.set(hash,index);allocations.push({offset,bytes,hash,file:path.basename(file)});return index;
  }
  for(const material of json.materials){
    const spec=textures.materials[material.name];if(!spec)throw new Error(`Unknown material ${material.name}`);
    const base=await texture(spec.baseColor),normal=await texture(spec.normal),orm=await texture(spec.orm);
    material.pbrMetallicRoughness={...material.pbrMetallicRoughness,
      baseColorTexture:{index:base,texCoord:material.pbrMetallicRoughness?.baseColorTexture?.texCoord??0},
      metallicRoughnessTexture:{index:orm},roughnessFactor:spec.roughnessFactor??1,metallicFactor:spec.metallicFactor??1};
    material.normalTexture={index:normal,scale:spec.normalScale};
    material.occlusionTexture={index:orm,strength:1};
  }
  json.images=images;json.textures=newTextures;
  const bin=Buffer.alloc(align(end));original.bin.copy(bin);
  for(const index of oldImageViews){const view=original.json.bufferViews[index];bin.fill(0,view.byteOffset??0,(view.byteOffset??0)+view.byteLength);}
  for(const allocation of allocations)allocation.bytes.copy(bin,allocation.offset);
  json.buffers[0].byteLength=bin.length;
  const before=protectedHash(original,original.json,original.bin),after=protectedHash(original,json,bin);
  if(before!==after)throw new Error(`Material patch changed protected geometry: ${asset.id}`);
  const bytes=pack(json,bin);await writeFile(path.join(OUT,asset.file),bytes);
  const compressed=allocations.reduce((sum,a)=>sum+a.bytes.length,0),decoded=images.length*512*512*4;
  receipts.push({id:asset.id,v1Sha256:sha(originalBytes),v2Sha256:sha(bytes),geometrySha256Before:before,geometrySha256After:after,
    bytesV1:originalBytes.length,bytesV2:bytes.length,growthPercent:(bytes.length/originalBytes.length-1)*100,
    compressedTextureBytes:compressed,uniqueImages:images.length,decodedRgba8Bytes:decoded,mipmappedRgba8Bytes:Math.ceil(decoded*4/3),
    obsoleteImageCopiesRetained:false,textureFiles:allocations.map(({hash,file,bytes})=>({file,sha256:hash,bytes:bytes.length}))});
  nextAssets.push({...asset,bytes:bytes.length,sha256:sha(bytes),geometry_sha256:before,v1_sha256:sha(originalBytes)});
}
const next={...contract,version:2,date:'2026-10-18',asset_set:'WaterDuel · Piezas del taller · desgaste material v2',
  source:'docs/assets/equipment/v2/workshop-arsenal-materials-v2.blend',author_script:'scripts/create-equipment-materials-v2.mjs',
  base_contract_sha256:sha(sourceContractBytes),base_contract:'../asset-contract.json',runtime_integrated:false,assets:nextAssets,
  revision_scope:'Material and embedded image data only; geometry/index/UV/node/skin/sampler data and names remain exact.',
  rendering:{...contract.rendering,textures:'512×512 core PNG; tangent normals and shared family ORM with per-material baseline factors; obsolete image slots reused; no baked shadows or new extensions.'}};
await writeFile(path.join(OUT,'asset-contract.json'),JSON.stringify(next,null,2)+'\n');
await writeFile(path.join(OUT,'material-revision.json'),JSON.stringify({version:2,ok:true,baseContractSha256:sha(sourceContractBytes),assets:receipts},null,2)+'\n');
console.log(JSON.stringify({ok:true,assets:receipts.map(({id,bytesV1,bytesV2,uniqueImages,growthPercent})=>({id,bytesV1,bytesV2,uniqueImages,growthPercent}))},null,2));
