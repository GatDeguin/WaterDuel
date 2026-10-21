// Independent cache-identity/allocation estimate for the seven workshop v2 GLBs.
// Usage: node scripts/inspect-equipment-texture-budget-v2.mjs [v2-directory]
// Isolated cache-fixture check: node scripts/inspect-equipment-texture-budget-v2.mjs --self-test
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseGLB} from '../public/rendering/glb.js';
import {SharedTextures} from '../public/rendering/shared-textures.js';
import {validateMaterialPair} from './validate-equipment-materials-v2.mjs';
import {materialSheen} from '../public/rendering/sheen.js';

const IDS=['sword','spear','axe','maul','short','long','knife'];
const DEFAULT_V2=fileURLToPath(new URL('../public/assets/equipment/workshop/v2/',import.meta.url));
const V1_CONTRACT_SHA256='e6b97b6f897ffd33222b36f9f74a7e92cd72b2614b7031d3d0acf139cdaad12a';
const PROTECTED_SECTIONS=['nodes','meshes','accessors','skins','animations','samplers','scenes','scene','extensionsUsed','extensionsRequired'];
const COLOR_SLOTS=new Set(['baseColorTexture','emissiveTexture','sheenColorTexture']);
const IMAGE_SLOTS=['baseColorTexture','normalTexture','metallicRoughnessTexture','occlusionTexture','emissiveTexture','sheenColorTexture','sheenRoughnessTexture'];
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const samplerSettings=s=>[s.wrapS??10497,s.wrapT??10497,s.magFilter??9729,s.minFilter??9987];
const identity=(source,settings,kind)=>JSON.stringify([sha(source.bytes),source.mimeType,...settings,kind]);
function fullMipBytes(width,height){
  let bytes=0;
  while(true){bytes+=width*height*4;if(width===1&&height===1)return bytes;width=Math.max(1,Math.floor(width/2));height=Math.max(1,Math.floor(height/2));}
}
function pngSize(source){
  const bytes=Buffer.from(source.bytes.buffer,source.bytes.byteOffset,source.bytes.byteLength);
  check(source.mimeType==='image/png'&&bytes.length>=24&&bytes.toString('ascii',12,16)==='IHDR','Expected a validated embedded PNG');
  return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}

function fakeGL(){
  const trace={created:0,deleted:0,live:new Set(),uploads:[],mipmapCalls:0,current:null};
  const gl={REPEAT:10497,LINEAR:9729,LINEAR_MIPMAP_LINEAR:9987,MAX_TEXTURE_SIZE:3379,TEXTURE0:33984,TEXTURE_2D:3553,
    UNPACK_FLIP_Y_WEBGL:37440,UNPACK_PREMULTIPLY_ALPHA_WEBGL:37441,SRGB8_ALPHA8:35907,RGBA8:32856,RGBA:6408,UNSIGNED_BYTE:5121,
    TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,TEXTURE_MAG_FILTER:10240,TEXTURE_MIN_FILTER:10241,
    getParameter:parameter=>{check(parameter===3379,'Unexpected GL parameter');return 4096;},
    createTexture:()=>{const texture={id:++trace.created};trace.live.add(texture);return texture;},
    deleteTexture:texture=>{check(trace.live.delete(texture),'Texture deleted twice');trace.deleted++;},
    activeTexture:()=>{},pixelStorei:()=>{},texParameteri:()=>{},
    bindTexture:(_target,texture)=>{trace.current=texture;},
    texImage2D:(target,level,internalFormat,format,type,bitmap)=>{
      check(trace.live.has(trace.current)&&target===3553&&level===0&&format===6408&&type===5121,'Unexpected simulated texture upload');
      check([35907,32856].includes(internalFormat),'Expected sRGB8-alpha8 or RGBA8 texture');
      trace.uploads.push({texture:trace.current.id,internalFormat,width:bitmap.width,height:bitmap.height});
    },
    generateMipmap:()=>{trace.mipmapCalls++;}
  };
  return {gl,trace};
}

/** Exercise the real cache, comparing its allocation accounting to SHA-based identities. */
export async function probeSharedTextures(usages,{sizeOf=pngSize}={}){
  const independent=new Map(),imageHashes=new Set();
  for(const usage of usages){
    const settings=samplerSettings(usage.sampler),key=identity(usage.source,settings,usage.kind),size=sizeOf(usage.source);
    check(['color','data'].includes(usage.kind)&&size.width>0&&size.height>0,'Invalid texture usage');
    imageHashes.add(sha(usage.source.bytes));
    let entry=independent.get(key);
    if(!entry){entry={sha256:sha(usage.source.bytes),mimeType:usage.source.mimeType,settings,kind:usage.kind,...size,
      rgba8BaseBytes:size.width*size.height*4,exactFullMipChainBytes:fullMipBytes(size.width,size.height),
      runtimeAccountedMipBytes:Math.ceil(size.width*size.height*4*4/3),references:0,assets:new Set(),imageNames:new Set()};independent.set(key,entry);}
    entry.references++;entry.assets.add(usage.asset);if(usage.source.name)entry.imageNames.add(usage.source.name);
  }
  const {gl,trace}=fakeGL();let decodeCalls=0,bitmapCloses=0;
  const cache=new SharedTextures(gl,async source=>{decodeCalls++;const size=sizeOf(source);return {...size,close:()=>{bitmapCloses++;}};}),acquisitions=[];
  let result;
  try{
    for(const usage of usages)acquisitions.push(cache.acquire(usage.source,usage.sampler,new Set([usage.kind])));
    await Promise.all(acquisitions.map(acquisition=>acquisition.ready));await Promise.resolve();
    const actual=new Set();let uniqueRecords=0;
    for(const bucket of cache.records.values())for(const record of bucket){
      uniqueRecords++;
      for(const [kind,entry]of record.variants){
        const key=identity(record.source,record.settings,kind);actual.add(key);
        check(independent.has(key)&&entry.refs===independent.get(key).references,'Runtime cache identity/refcount differs from independent SHA identity');
      }
    }
    check(actual.size===independent.size&&[...independent.keys()].every(key=>actual.has(key)),'Runtime cache merged or split an identity incorrectly');
    const identities=[...independent.values()].map(entry=>({...entry,assets:[...entry.assets],imageNames:[...entry.imageNames]}));
    const sum=field=>identities.reduce((total,entry)=>total+entry[field],0),expectedBytes=sum('runtimeAccountedMipBytes');
    check(cache.bytes===expectedBytes&&trace.created===actual.size&&trace.uploads.length===actual.size,'Runtime texture allocation/accounting mismatch');
    check(trace.mipmapCalls===actual.size&&trace.live.size===actual.size&&bitmapCloses===decodeCalls,'Runtime upload/decode lifetime mismatch');
    result={textureReferences:usages.length,uniquePngHashes:imageHashes.size,uniqueRecords,uniqueTextureVariants:actual.size,
      decodeCalls,bitmapCloses,rgba8BaseBytes:sum('rgba8BaseBytes'),exactFullMipChainBytes:sum('exactFullMipChainBytes'),runtimeAccountedMipBytes:cache.bytes,
      createdTextures:trace.created,uploadCalls:trace.uploads.length,identities};
  }finally{
    for(const acquisition of acquisitions)for(const reference of acquisition.references)cache.release(reference);
    await Promise.resolve();
    const cleanup={bytes:cache.bytes,liveTextures:trace.live.size,records:cache.records.size,deletedTextures:trace.deleted};
    check(cleanup.bytes===0&&cleanup.liveTextures===0&&cleanup.records===0,'Shared cache did not release all allocation estimates');
    if(result)result.cleanup=cleanup;cache.dispose();
  }
  return result;
}

function usagesFor(asset,id){
  const materials=asset.materials.map(material=>{const sheen=materialSheen(material);return {...material,sheenColorTexture:sheen.colorTexture,sheenRoughnessTexture:sheen.roughnessTexture};});
  const usages=[];
  for(const [index,texture]of asset.textures.entries()){
    const kinds=new Set();
    for(const material of materials)for(const slot of IMAGE_SLOTS)if(material[slot]?.index===index)kinds.add(COLOR_SLOTS.has(slot)?'color':'data');
    for(const kind of kinds)usages.push({asset:id,textureIndex:index,source:asset.images[texture.source],sampler:asset.samplers[texture.sampler]??{},kind});
  }
  return usages;
}

function parsedDocument(bytes){
  const asset=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));let bin;
  for(let offset=12;offset<bytes.length;){const length=bytes.readUInt32LE(offset);if(bytes.readUInt32LE(offset+4)===0x004e4942)bin=bytes.subarray(offset+8,offset+8+length);offset+=8+length;}
  check(bin,'Missing embedded binary data');return {asset,json:asset.json,bin};
}
function protectedDigest(source,candidate){
  const digest=createHash('sha256'),imageViews=new Set(source.json.images.map(image=>image.bufferView));
  for(const key of PROTECTED_SECTIONS)digest.update(JSON.stringify([key,candidate.json[key]??null]));
  source.json.bufferViews.forEach((view,index)=>{
    if(imageViews.has(index))return;const actual=candidate.json.bufferViews[index];
    digest.update(JSON.stringify([index,actual]));digest.update(candidate.bin.subarray(actual.byteOffset??0,(actual.byteOffset??0)+actual.byteLength));
  });
  return digest.digest('hex');
}

export async function inspectEquipmentTextureBudgetV2(v2Directory=DEFAULT_V2){
  const directory=path.resolve(v2Directory),v1=path.dirname(directory),assets=[],usages=[];
  const originalContractBytes=await readFile(path.join(v1,'asset-contract.json')),contractBytes=await readFile(path.join(directory,'asset-contract.json'));
  check(sha(originalContractBytes)===V1_CONTRACT_SHA256,'Frozen v1 contract changed');
  const originalContract=JSON.parse(originalContractBytes),contract=JSON.parse(contractBytes),revision=JSON.parse(await readFile(path.join(directory,'material-revision.json'),'utf8'));
  check(contract.base_contract_sha256===V1_CONTRACT_SHA256&&revision.baseContractSha256===V1_CONTRACT_SHA256,'V2 contract/revision does not identify frozen v1');
  for(const id of IDS){
    const sourceBytes=await readFile(path.join(v1,`${id}.glb`)),bytes=await readFile(path.join(directory,`${id}.glb`));
    const sourceClaim=originalContract.assets.find(asset=>asset.id===id),claim=contract.assets.find(asset=>asset.id===id),receipt=revision.assets.find(asset=>asset.id===id);
    check(sourceClaim?.sha256===sha(sourceBytes)&&sourceClaim.bytes===sourceBytes.length,`${id}: frozen v1 hash/bytes differ`);
    check(claim?.sha256===sha(bytes)&&claim.bytes===bytes.length&&claim.v1_sha256===sourceClaim.sha256,`${id}: latest GLB hash/bytes differ from v2 contract`);
    check(receipt?.v1Sha256===sha(sourceBytes)&&receipt.v2Sha256===sha(bytes),`${id}: material-revision hash differs`);
    const proof=validateMaterialPair(sourceBytes,bytes,id,{retarget:false}),source=parsedDocument(sourceBytes),candidate=parsedDocument(bytes);
    const before=protectedDigest(source,source),after=protectedDigest(source,candidate);
    check(before===after&&claim.geometry_sha256===before&&receipt.geometrySha256Before===before&&receipt.geometrySha256After===after,`${id}: protected geometry proof disagrees with receipt/contract`);
    check(proof.triangles===claim.triangles,`${id}: triangle count disagrees with contract`);
    const current=usagesFor(candidate.asset,id);usages.push(...current);
    const perAsset=new Map();for(const usage of current)perAsset.set(identity(usage.source,samplerSettings(usage.sampler),usage.kind),pngSize(usage.source));
    assets.push({id,sha256:sha(bytes),bytes:bytes.length,v1Sha256:sha(sourceBytes),geometrySha256:before,protectedViews:proof.protectedViewCount,
      geometryUnchanged:true,contractAndReceiptMatch:true,triangles:proof.triangles,textureReferences:current.length,
      rgba8BaseBytes:[...perAsset.values()].reduce((sum,size)=>sum+size.width*size.height*4,0),
      exactFullMipChainBytes:[...perAsset.values()].reduce((sum,size)=>sum+fullMipBytes(size.width,size.height),0),
      runtimeAccountedMipBytes:[...perAsset.values()].reduce((sum,size)=>sum+Math.ceil(size.width*size.height*4*4/3),0)});
  }
  const shared=await probeSharedTextures(usages),withoutSharing={textureVariants:assets.reduce((sum,asset)=>sum+asset.textureReferences,0),
    rgba8BaseBytes:assets.reduce((sum,asset)=>sum+asset.rgba8BaseBytes,0),exactFullMipChainBytes:assets.reduce((sum,asset)=>sum+asset.exactFullMipChainBytes,0),
    runtimeAccountedMipBytes:assets.reduce((sum,asset)=>sum+asset.runtimeAccountedMipBytes,0)};
  const report={ok:true,classification:'Allocation estimate; not measured GPU memory.',generatedAt:new Date().toISOString(),directory,
    method:'Actual parseGLB and SharedTextures code executed in native Node with a minimal fake GL and PNG-header decode fixture. Independent SHA-256 + MIME + normalized sampler + color/data identities must match cache allocations/refcounts.',
    scope:'All seven GLBs loaded simultaneously into one context-owned cache. Texture storage only; geometry buffers, driver alignment/overhead, transient decoded bitmaps, environment/character assets and render targets are excluded.',
    mipAccounting:'Exact complete mip-level sum and runtime ceil(baseBytes*4/3) estimates are both reported; the runtime formula overestimates a 512-square chain by 2 bytes per texture.',
    runtimeSharedTexturesSha256:sha(await readFile(new URL('../public/rendering/shared-textures.js',import.meta.url))),
    v1ContractSha256:sha(originalContractBytes),v2ContractSha256:sha(contractBytes),sourceFrozen:true,assets,
    withoutSharing,shared,savedRuntimeAccountedMipBytes:withoutSharing.runtimeAccountedMipBytes-shared.runtimeAccountedMipBytes,
    reductionPercent:100*(1-shared.runtimeAccountedMipBytes/withoutSharing.runtimeAccountedMipBytes)};
  await writeFile(path.join(directory,'texture-budget.json'),JSON.stringify(report,null,2)+'\n');return report;
}

async function selfTest(){
  assert.equal(typeof probeSharedTextures,'function','the actual shared-cache allocation probe must exist');
  const source=(bytes,mimeType='image/png')=>({bytes:Uint8Array.from(bytes),mimeType});
  const a=source([1,2,3]),b=source([1,2,3]);
  const usages=[
    {source:a,sampler:{},kind:'color',asset:'a'},
    {source:b,sampler:{wrapS:10497,wrapT:10497,magFilter:9729,minFilter:9987},kind:'color',asset:'b'},
    {source:a,sampler:{},kind:'data',asset:'a'},
    {source:a,sampler:{wrapS:33071},kind:'color',asset:'a'},
    {source:source([1,2,3],'image/jpeg'),sampler:{},kind:'color',asset:'a'},
    {source:source([4,2,3]),sampler:{},kind:'color',asset:'a'}
  ];
  const result=await probeSharedTextures(usages,{sizeOf:()=>({width:2,height:2})});
  assert.equal(result.uniqueRecords,4,'bytes + MIME + sampler must determine cache records');
  assert.equal(result.uniqueTextureVariants,5,'linear data and sRGB color must stay separate');
  assert.equal(result.textureReferences,6);assert.equal(result.decodeCalls,4);
  assert.equal(result.rgba8BaseBytes,80);assert.equal(result.exactFullMipChainBytes,100);
  assert.equal(result.runtimeAccountedMipBytes,110);assert.equal(result.cleanup.bytes,0);assert.equal(result.cleanup.liveTextures,0);
  console.log(JSON.stringify({ok:true,selfTestCases:8}));
}

if(path.resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else{
      const report=await inspectEquipmentTextureBudgetV2(process.argv[2]);
      console.log(JSON.stringify({ok:report.ok,report:path.join(report.directory,'texture-budget.json'),classification:report.classification,
        assets:report.assets.length,uniquePngs:report.shared.uniquePngHashes,cacheRecords:report.shared.uniqueRecords,textureVariants:report.shared.uniqueTextureVariants,
        sharedBaseMiB:report.shared.rgba8BaseBytes/1048576,sharedRuntimeMipMiB:report.shared.runtimeAccountedMipBytes/1048576,
        withoutSharingMipMiB:report.withoutSharing.runtimeAccountedMipBytes/1048576,reductionPercent:report.reductionPercent,cleanup:report.shared.cleanup},null,2));
    }
  }catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
