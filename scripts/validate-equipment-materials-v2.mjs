// Material-only v2 QA. V1 is a frozen input; this script writes only v2/validation.json.
// Usage: node scripts/validate-equipment-materials-v2.mjs [v1-directory] [v2-directory]
// Isolated parser regressions: node scripts/validate-equipment-materials-v2.mjs --self-test
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareEquipment,equipmentTransform,deformEquipmentPoint} from '../public/rendering/asset-rig.js';
import {DuelEngine,STEP} from '../public/engine.js';
import {WEAPONS} from '../public/equipment.js';

const IDS=['sword','spear','axe','maul','short','long','knife'];
const DEFAULT_V1=fileURLToPath(new URL('../public/assets/equipment/workshop/',import.meta.url));
const V1_MANIFEST_SHA256='e6b97b6f897ffd33222b36f9f74a7e92cd72b2614b7031d3d0acf139cdaad12a';
const V1_SHA256={
  sword:'bd0b1d3e4d88abe297d47d9d6c004c436b7a5a530234654887c4e7808ff83ec7',
  spear:'888454bf0c5b8b39e05d26c615d00ad3e84db86a0818bc2ab8f9641ed1286246',
  axe:'f13a68cb96ce09af4949e0c02180308e1073ca25d9ea95d96fbef42a5e50a388',
  maul:'b2c04159e2c44977e28ec9724e5c135cca4d8a6bc6ecfcb2dc86731d2cd4ad7f',
  short:'6e33a1b0bc96a0fb590ca665deee7278e677dc4a730aafc26ae935f1be1e32ef',
  long:'5f4fb363f5dff00cb55b98da5e4c9a5cccede09f3e628ff4b082dff127785acc',
  knife:'fd5d5bf2ffbbbd9e54b68ae18a7d3790e5c544568580d1d4a89eb4254ed12f24'
};
const BUDGETS={maxTextureDimension:512,maxUniqueUsedImageRgbaBytes:16*1024*1024,targetFileGrowth:.25};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const sameJSON=(a,b,label)=>check(JSON.stringify(a)===JSON.stringify(b),`${label} changed`);
const typedBytes=value=>value===null||value===undefined?null:Buffer.from(value.buffer,value.byteOffset,value.byteLength);
function sameArray(a,b,label){
  if(a===null||a===undefined||b===null||b===undefined)check(a===b,`${label} changed`);
  else check(a.constructor===b.constructor&&typedBytes(a).equals(typedBytes(b)),`${label} changed`);
}
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const xyz=p=>[p.x,p.y,p.z??0];
const distance=(a,b)=>Math.hypot(...a.map((value,i)=>value-b[i]));

function document(bytes){
  const asset=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  let bin=null;const chunks=[];
  for(let offset=12;offset<bytes.length;){
    const length=bytes.readUInt32LE(offset),kind=bytes.readUInt32LE(offset+4);
    chunks.push(kind);if(kind===0x004e4942)bin=bytes.subarray(offset+8,offset+8+length);offset+=8+length;
  }
  check(chunks.length===2&&chunks[0]===0x4e4f534a&&chunks[1]===0x004e4942,'GLB: expected only JSON then BIN chunks');
  check(bin,'GLB: embedded BIN chunk missing');return {asset,json:asset.json,bin,bytes};
}

function extensionNames(value,names=new Set()){
  if(!value||typeof value!=='object')return names;
  for(const [key,child]of Object.entries(value)){
    if(key==='extensions')for(const name of Object.keys(child??{}))names.add(name);
    extensionNames(child,names);
  }
  return names;
}

function pngInfo(bytes,label){
  check(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR',`${label}: invalid PNG header`);
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),bitDepth=bytes[24],colorType=bytes[25],channels={0:1,2:3,3:1,4:2,6:4}[colorType];
  check(width>0&&height>0&&width<=BUDGETS.maxTextureDimension&&height<=BUDGETS.maxTextureDimension,`${label}: dimensions exceed 512`);
  check(bytes.readUInt32BE(8)===13&&bitDepth===8&&[2,6].includes(colorType)&&bytes[26]===0&&bytes[27]===0&&bytes[28]===0,`${label}: expected noninterlaced 8-bit RGB/RGBA PNG format`);
  const crc=data=>{let value=0xffffffff;for(const byte of data){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
  const compressed=[];let ended=false,idatClosed=false,paletteSeen=false;
  for(let offset=8;offset<bytes.length;){
    check(offset+12<=bytes.length,`${label}: truncated PNG chunk`);const length=bytes.readUInt32BE(offset),end=offset+12+length,kind=bytes.toString('ascii',offset+4,offset+8);
    check(end<=bytes.length,`${label}: PNG chunk exceeds image bytes`);
    check(/^[A-Za-z]{4}$/.test(kind)&&kind[2]===kind[2].toUpperCase(),`${label}: invalid PNG chunk type`);
    check(crc(bytes.subarray(offset+4,end-4))===bytes.readUInt32BE(end-4),`${label}: PNG CRC mismatch`);
    if(kind==='IHDR')check(offset===8&&length===13,`${label}: duplicate or misplaced PNG IHDR`);
    else if(kind[0]===kind[0].toUpperCase())check(['PLTE','IDAT','IEND'].includes(kind),`${label}: unknown critical PNG chunk`);
    if(kind==='PLTE'){check(!paletteSeen&&!compressed.length&&length>=3&&length<=768&&length%3===0,`${label}: invalid PNG PLTE order/size`);paletteSeen=true;}
    if(kind==='tRNS')check(colorType===2&&length===6&&!compressed.length,`${label}: invalid PNG transparency chunk`);
    if(kind==='IDAT'){check(!idatClosed,`${label}: PNG IDAT order is not contiguous`);compressed.push(bytes.subarray(offset+8,end-4));}
    else if(compressed.length)idatClosed=true;
    if(kind==='IEND'){check(length===0&&end===bytes.length,`${label}: data after PNG IEND`);ended=true;break;}offset=end;
  }
  check(ended&&compressed.length,`${label}: PNG IDAT/IEND missing`);
  const rowBytes=Math.ceil(width*channels*bitDepth/8),expected=(rowBytes+1)*height;
  const pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});check(pixels.length===expected,`${label}: PNG decoded byte count does not match dimensions`);
  for(let row=0;row<height;row++)check(pixels[row*(rowBytes+1)]<=4,`${label}: invalid PNG scanline filter`);
  return {width,height,bitDepth,colorType};
}

function imageBudgets(asset){
  const images=asset.images.map((image,index)=>{
    const bytes=typedBytes(image.bytes);
    check(image.mimeType==='image/png',`Image ${index}: expected embedded PNG`);
    const info=pngInfo(bytes,`Image ${index}`);
    return {index,name:image.name,sha256:hash(bytes),...info,compressedBytes:bytes.length,rgbaBytes:info.width*info.height*4};
  });
  const uses=new Map(),colors=new Set(['baseColorTexture','emissiveTexture','sheenColorTexture']);
  const visit=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,child]of Object.entries(value)){
      if(key.endsWith('Texture')&&child&&Number.isInteger(child.index)){
        check(asset.textures[child.index],`Material texture ${child.index} is missing`);
        if(!uses.has(child.index))uses.set(child.index,new Set());uses.get(child.index).add(colors.has(key)?'color':'data');
      }else visit(child);
    }
  };
  asset.materials.forEach(visit);
  const usedImages=new Map();let rendererTextureVariants=0,rendererTextureRgbaBytes=0,rendererTextureMipBytes=0;
  for(const [textureIndex,kinds]of uses){
    const image=images[asset.textures[textureIndex].source];check(image,`Texture ${textureIndex}: missing image`);
    usedImages.set(image.sha256,image);rendererTextureVariants+=kinds.size;
    rendererTextureRgbaBytes+=image.rgbaBytes*kinds.size;rendererTextureMipBytes+=Math.ceil(image.rgbaBytes*4/3)*kinds.size;
  }
  const uniqueUsedImageRgbaBytes=[...usedImages.values()].reduce((sum,image)=>sum+image.rgbaBytes,0);
  check(uniqueUsedImageRgbaBytes<=BUDGETS.maxUniqueUsedImageRgbaBytes,'Textures: unique used-image RGBA8 budget exceeds 16 MiB');
  return {images,compressedPngBytes:images.reduce((sum,image)=>sum+image.compressedBytes,0),uniqueUsedImages:usedImages.size,
    uniqueUsedImageRgbaBytes,uniqueUsedImageMipBytes:[...usedImages.values()].reduce((sum,image)=>sum+Math.ceil(image.rgbaBytes*4/3),0),
    rendererTextureVariants,rendererTextureRgbaBytes,rendererTextureMipBytes,
    estimate:'RGBA8 or SRGB8_ALPHA8; mip estimate includes 4/3 chain. Renderer estimate counts each used texture-index/color-space variant; unique-image estimate deduplicates identical PNG hashes.'};
}

function retargetComparison(before,after,id){
  const a=prepareEquipment(before,id),b=prepareEquipment(after,id);
  check(a.parts.length===b.parts.length,'Retarget: prepared part count changed');
  for(let i=0;i<a.parts.length;i++)for(const field of ['positions','normals','uv','uv1','colors','indices'])sameArray(a.parts[i][field],b.parts[i][field],`Retarget prepared ${field}`);
  const game=new DuelEngine();game.setMode('versus');
  for(const slot of [1,2])check(game.setLoadout(slot,{weapon:WEAPONS[id]?id:'sword',defense:WEAPONS[id]?'none':id}),'Retarget: cannot configure real fighter');
  game.phase='fight';const poseSamples=[];let poses=0,verticesCompared=0,maxWorldPositionDelta=0,maxSocketError=0,maxMaulHandGripDistance=0;
  const verify=requestedState=>{
    for(const fighter of game.fighters){
      const poseBefore=JSON.stringify(fighter.pose),t=equipmentTransform(fighter,id);check(t,'Retarget: equipment unexpectedly hidden');
      poseSamples.push({slot:fighter.slot,state:requestedState==='guard'&&!fighter.guard?'recovery':requestedState,
        guard:!!fighter.guard,lunge:fighter.lunge,extension:t.extension});
      const localSocket=(asset,name)=>{
        const node=asset.nodes.find(node=>node.name===name);check(node,`Retarget: missing ${name}`);return Array.from(node.worldMatrix.subarray(12,15));
      };
      const testSocket=(name,target)=>{
        const left=point(t.matrix,deformEquipmentPoint(localSocket(before,name),t)),right=point(t.matrix,deformEquipmentPoint(localSocket(after,name),t));
        check(distance(left,right)<1e-10,`Retarget: ${name} world position changed`);
        const error=distance(right,xyz(target));maxSocketError=Math.max(maxSocketError,error);check(error<2e-5,`Retarget: ${name} misses physical pose`);return right;
      };
      testSocket(WEAPONS[id]?'Socket_Grip_Main':'Socket_Grip_Secondary',WEAPONS[id]?fighter.pose.mainHand:fighter.pose.offHand);
      if(WEAPONS[id]||id==='knife')testSocket('Socket_Strike',WEAPONS[id]?fighter.pose.tip:fighter.pose.defenseTip);
      if(id==='maul'){
        const grip=testSocket('Socket_Grip_Secondary',fighter.pose.offGrip);
        const error=distance(grip,xyz(fighter.pose.offHand));maxMaulHandGripDistance=Math.max(maxMaulHandGripDistance,error);
        check(error<.015,'Retarget: maul secondary hand lost physical grip');
      }
      for(let part=0;part<a.parts.length;part++){
        const left=a.parts[part].positions,right=b.parts[part].positions;
        for(let v=0;v<left.length;v+=3){
          const p=point(t.matrix,deformEquipmentPoint(left.subarray(v,v+3),t)),q=point(t.matrix,deformEquipmentPoint(right.subarray(v,v+3),t)),delta=distance(p,q);
          check(p.every(Number.isFinite)&&q.every(Number.isFinite)&&delta<1e-10,'Retarget: deformed world position changed');
          maxWorldPositionDelta=Math.max(maxWorldPositionDelta,delta);verticesCompared++;
        }
      }
      check(JSON.stringify(fighter.pose)===poseBefore,'Retarget: render preparation mutated physics');poses++;
    }
  };
  verify('rest');
  for(let step=0;step<48;step++){
    for(const slot of [1,2])game.setControl(slot,{mainX:.7,mainY:.45,offX:1,offY:.9,wrist:.35,lean:slot===1?.4:-.3,thrust:step===0,guard:step>=24});
    game.clock+=STEP;game.updateFootwork(STEP);for(const fighter of game.fighters)game.updateFighter(fighter,STEP);
    if(step===15)verify('attack');if(step===47)verify('guard');
  }
  return {poses,slots:[1,2],states:[...new Set(poseSamples.map(sample=>sample.state))],poseSamples,verticesCompared,maxWorldPositionDelta,maxSocketError,maxMaulHandGripDistance,
    api:['parseGLB','prepareEquipment','equipmentTransform','deformEquipmentPoint']};
}

/** Validate a material-only pair through the actual runtime decoder and rig adapter. */
export function validateMaterialPair(v1Bytes,v2Bytes,id,{retarget=true}={}){
  const before=document(v1Bytes),after=document(v2Bytes),a=before.asset,b=after.asset;
  const allowed=new Set(['materials','textures','images','bufferViews','buffers']);
  for(const key of new Set([...Object.keys(before.json),...Object.keys(after.json)]))if(!allowed.has(key))sameJSON(before.json[key],after.json[key],`JSON ${key}`);
  sameJSON(before.json.materials?.map(m=>m.name),after.json.materials?.map(m=>m.name),'Material names/order');
  sameJSON([...extensionNames(before.json)].sort(),[...extensionNames(after.json)].sort(),'Extension set');
  const stripLength=buffers=>buffers?.map(({byteLength,...rest})=>rest);sameJSON(stripLength(before.json.buffers),stripLength(after.json.buffers),'Buffer declarations except byteLength');
  check(a.primitives.length===b.primitives.length,'Decoded primitive count changed');
  for(let i=0;i<a.primitives.length;i++){
    const p=a.primitives[i],q=b.primitives[i];
    for(const [field,label]of [['positions','POSITION'],['normals','NORMAL'],['uv','UV TEXCOORD_0'],['uv1','UV TEXCOORD_1'],['indices','index ordering'],['joints','JOINTS'],['weights','WEIGHTS'],['colors','COLOR']])sameArray(p[field],q[field],`Decoded ${label}`);
    sameArray(p.worldMatrix,q.worldMatrix,'Decoded world matrix');
    for(let v=0;v<p.positions.length;v+=3)check(distance(point(p.worldMatrix,p.positions.subarray(v,v+3)),point(q.worldMatrix,q.positions.subarray(v,v+3)))<1e-12,'Decoded world position changed');
  }
  check(a.skins.length===b.skins.length,'Decoded skin count changed');
  for(let i=0;i<a.skins.length;i++)sameArray(a.skins[i].inverseBindMatrices,b.skins[i].inverseBindMatrices,'Decoded inverse bind matrices IBM');
  const imageViews=new Set((before.json.images??[]).map(image=>image.bufferView)),accessorViews=new Set();
  for(const accessor of before.json.accessors??[]){
    if(accessor.bufferView!==undefined)accessorViews.add(accessor.bufferView);
    if(accessor.sparse){accessorViews.add(accessor.sparse.indices.bufferView);accessorViews.add(accessor.sparse.values.bufferView);}
  }
  let protectedViewCount=0,protectedViewBytes=0;
  for(const [index,view]of (before.json.bufferViews??[]).entries()){
    if(imageViews.has(index)&&!accessorViews.has(index))continue;
    const revised=after.json.bufferViews?.[index];sameJSON(view,revised,`Protected geometry/IBM bufferView ${index}`);
    const offset=view.byteOffset??0,end=offset+view.byteLength;
    check(after.bin.length>=end&&before.bin.subarray(offset,end).equals(after.bin.subarray(offset,end)),`Protected geometry/IBM bufferView ${index} raw bytes changed`);
    protectedViewCount++;protectedViewBytes+=view.byteLength;
  }
  const revisedImageViews=new Set((after.json.images??[]).map(image=>image.bufferView));
  for(let index=(before.json.bufferViews??[]).length;index<(after.json.bufferViews??[]).length;index++)check(revisedImageViews.has(index),`New bufferView ${index} is not an image view`);
  const baseTextures=imageBudgets(a),textures=imageBudgets(b),fileGrowth=(v2Bytes.length-v1Bytes.length)/v1Bytes.length;
  const warnings=[];if(fileGrowth>BUDGETS.targetFileGrowth)warnings.push(`GLB size grew ${(100*fileGrowth).toFixed(1)}%, above the 25% target`);
  const retargetReport=retarget?retargetComparison(a,b,id):null;
  return {ok:true,id,geometryUnchanged:true,protectedViewCount,protectedViewBytes,immutableJSONSections:[...new Set([...Object.keys(before.json),...Object.keys(after.json)])].filter(key=>!allowed.has(key)),
    v1:{bytes:v1Bytes.length,sha256:hash(v1Bytes),compressedPngBytes:baseTextures.compressedPngBytes},
    v2:{bytes:v2Bytes.length,sha256:hash(v2Bytes)},fileGrowth,compressedPngGrowth:(textures.compressedPngBytes-baseTextures.compressedPngBytes)/Math.max(1,baseTextures.compressedPngBytes),
    materials:b.materials.map(material=>material.name),triangles:b.primitives.reduce((sum,p)=>sum+p.indices.length/3,0),textures,retarget:retargetReport,warnings};
}

export async function validateEquipmentMaterialsV2(v1Directory=DEFAULT_V1,v2Directory=path.join(v1Directory,'v2')){
  const v1=path.resolve(v1Directory),v2=path.resolve(v2Directory),assets=[],v1Evidence=[];
  check(v1!==v2,'V2 output directory must differ from frozen v1');
  let manifest=null,manifestSha256=null,manifestError=null;
  try{
    const manifestBytes=await readFile(path.join(v1,'asset-contract.json'));manifestSha256=hash(manifestBytes);manifest=JSON.parse(manifestBytes);
    check(manifestSha256===V1_MANIFEST_SHA256,'Frozen v1 manifest SHA-256 changed');
  }catch(error){manifestError=error.message;}
  for(const id of IDS){
    try{
      const base=await readFile(path.join(v1,`${id}.glb`)),sha256=hash(base),claim=manifest?.assets?.find(asset=>asset.id===id);
      const unchanged=sha256===V1_SHA256[id]&&claim?.sha256===V1_SHA256[id]&&claim.bytes===base.length;
      v1Evidence.push({id,bytes:base.length,sha256,unchanged});check(!manifestError,manifestError);
      check(unchanged,`Frozen v1 ${id} bytes/hash or manifest claim changed`);
      const revised=await readFile(path.join(v2,`${id}.glb`));
      assets.push(validateMaterialPair(base,revised,id));
    }catch(error){assets.push({ok:false,id,error:error.message});}
  }
  const report={ok:!manifestError&&assets.every(asset=>asset.ok),validator:'equipment-materials-v2-native-compare-v1',validatedAt:new Date().toISOString(),v1Directory:v1,v2Directory:v2,
    v1ManifestSha256:manifestSha256,v1Frozen:!manifestError&&v1Evidence.length===IDS.length&&v1Evidence.every(asset=>asset.unchanged),v1Evidence,...(manifestError?{manifestError}:{}),budgets:BUDGETS,
    budgetScope:'Per asset. Aggregate estimates sum separately loaded assets without cross-GLB sharing.',
    totals:{uniqueUsedImageRgbaBytes:assets.reduce((sum,asset)=>sum+(asset.textures?.uniqueUsedImageRgbaBytes??0),0),
      rendererTextureMipBytes:assets.reduce((sum,asset)=>sum+(asset.textures?.rendererTextureMipBytes??0),0),
      retargetedVerticesCompared:assets.reduce((sum,asset)=>sum+(asset.retarget?.verticesCompared??0),0)},
    preservation:'All non-image/accessor/IBM bufferView descriptors and bytes are immutable. Original image holes may be replaced/reused; image views and BIN length may change.',assets};
  await writeFile(path.join(v2,'validation.json'),JSON.stringify(report,null,2)+'\n');return report;
}

function selfTest(){
  assert.equal(typeof validateMaterialPair,'function','the material-only comparison must exist');
  const encode=(json,bin)=>{
    const source=Buffer.from(JSON.stringify(json)),jsonChunk=Buffer.alloc(Math.ceil(source.length/4)*4,32);source.copy(jsonChunk);
    const binary=Buffer.alloc(Math.ceil(bin.length/4)*4);bin.copy(binary);
    const result=Buffer.alloc(28+jsonChunk.length+binary.length);
    result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);
    result.writeUInt32LE(jsonChunk.length,12);result.writeUInt32LE(0x4e4f534a,16);jsonChunk.copy(result,20);
    result.writeUInt32LE(binary.length,20+jsonChunk.length);result.writeUInt32LE(0x004e4942,24+jsonChunk.length);binary.copy(result,28+jsonChunk.length);return result;
  };
  const fixture=()=>{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQ0bD5DwACRAF4aig0hQAAAABJRU5ErkJggg==','base64');
    const bin=Buffer.concat([Buffer.alloc(152),png]);
    [0,0,0,.1,0,0,0,1.02,0].forEach((v,i)=>bin.writeFloatLE(v,i*4));
    [0,0,1,0,0,1,0,0,1].forEach((v,i)=>bin.writeFloatLE(v,36+i*4));
    [0,0,1,0,0,1].forEach((v,i)=>bin.writeFloatLE(v,72+i*4));
    [0,1,2].forEach((v,i)=>bin.writeUInt16LE(v,96+i*2));
    for(const offset of [104,124,144])bin.writeFloatLE(1,offset);
    // A synthetic inverse-bind accessor is present even though real equipment is unskinned.
    const identity=Buffer.alloc(64);for(const offset of [0,20,40,60])identity.writeFloatLE(1,offset);
    const full=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4),identity]),ibmOffset=full.length-64;
    const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'WD_sword_Asset',children:[1,2,3]},
      {name:'Render_sword',mesh:0},{name:'Socket_Grip_Main'},{name:'Socket_Strike',translation:[0,1.02,0]}],
      meshes:[{name:'Sword',primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],
      materials:[{name:'WD_steel',pbrMetallicRoughness:{baseColorTexture:{index:0},roughnessFactor:.4}}],
      buffers:[{byteLength:full.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36},
        {buffer:0,byteOffset:72,byteLength:24},{buffer:0,byteOffset:96,byteLength:6},{buffer:0,byteOffset:152,byteLength:png.length},{buffer:0,byteOffset:ibmOffset,byteLength:64}],
      accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3,min:[0,0,0],max:[.1,1.02,0]},
        {bufferView:1,componentType:5126,type:'VEC3',count:3},{bufferView:2,componentType:5126,type:'VEC2',count:3},
        {bufferView:3,componentType:5123,type:'SCALAR',count:3},{bufferView:5,componentType:5126,type:'MAT4',count:1}],
      skins:[{name:'Fixture_Skin',joints:[2],inverseBindMatrices:4}],images:[{bufferView:4,mimeType:'image/png'}],textures:[{source:0,sampler:0}],samplers:[{}]};
    return {json,bin:full};
  };
  let cases=0;
  const base=fixture(),v1=encode(base.json,base.bin),changed=structuredClone(base.json);
  changed.materials[0].pbrMetallicRoughness.roughnessFactor=.55;
  const result=validateMaterialPair(v1,encode(changed,base.bin),'sword',{retarget:false});assert.equal(result.geometryUnchanged,true);cases++;
  const relocated=fixture(),oldImage=relocated.json.bufferViews[4],png=Buffer.from(relocated.bin.subarray(oldImage.byteOffset,oldImage.byteOffset+oldImage.byteLength));
  relocated.bin.fill(0,oldImage.byteOffset,oldImage.byteOffset+oldImage.byteLength);
  relocated.json.bufferViews[4]={...oldImage,byteOffset:relocated.bin.length};relocated.bin=Buffer.concat([relocated.bin,png]);
  relocated.json.buffers[0].byteLength=relocated.bin.length;
  assert.equal(validateMaterialPair(v1,encode(relocated.json,relocated.bin),'sword',{retarget:false}).geometryUnchanged,true,'old image holes may be zeroed while geometry and IBM remain exact');cases++;
  const reject=(name,mutate,pattern)=>{
    const next=fixture();mutate(next.json,next.bin);
    assert.throws(()=>validateMaterialPair(v1,encode(next.json,next.bin),'sword',{retarget:false}),pattern,name);cases++;
  };
  reject('one world vertex changed',(_json,bin)=>bin.writeFloatLE(.025,0),/POSITION|world position|BIN prefix/i);
  reject('one UV changed',(_json,bin)=>bin.writeFloatLE(.25,72),/UV|TEXCOORD|BIN prefix/i);
  reject('index order changed',(_json,bin)=>{bin.writeUInt16LE(2,98);bin.writeUInt16LE(1,100);},/index|indices|BIN prefix/i);
  reject('one IBM changed',(json,bin)=>bin.writeFloatLE(.02,json.bufferViews[5].byteOffset+48),/inverse.bind|IBM|BIN prefix/i);
  reject('node renamed',json=>json.nodes[1].name='Renamed_Render',/nodes|name/i);
  reject('node position changed',json=>json.nodes[1].translation=[.01,0,0],/nodes|world/i);
  reject('accessor ordering changed',json=>json.accessors.reverse(),/accessor|indices|POSITION|NORMAL|index|range|inverseBindMatrices/i);
  reject('material renamed',json=>json.materials[0].name='OtherSteel',/material.*name/i);
  reject('sampler changed',json=>json.samplers[0].wrapS=33071,/samplers/i);
  reject('new extension',json=>json.extensionsUsed=['KHR_materials_clearcoat'],/extension/i);
  reject('PNG CRC corruption',(json,bin)=>bin[json.bufferViews[4].byteOffset+50]^=1,/PNG|CRC|inflate/i);
  reject('oversized image',(json,bin)=>bin.writeUInt32BE(1024,json.bufferViews[4].byteOffset+16),/dimensions/i);
  const duplicateHeader=fixture(),imageView=duplicateHeader.json.bufferViews[4],image=duplicateHeader.bin.subarray(imageView.byteOffset,imageView.byteOffset+imageView.byteLength);
  const duplicatePng=Buffer.concat([image.subarray(0,33),image.subarray(8,33),image.subarray(33)]);
  duplicateHeader.json.bufferViews[4]={buffer:0,byteOffset:duplicateHeader.bin.length,byteLength:duplicatePng.length};
  duplicateHeader.bin=Buffer.concat([duplicateHeader.bin,duplicatePng]);duplicateHeader.json.buffers[0].byteLength=duplicateHeader.bin.length;
  assert.throws(()=>validateMaterialPair(v1,encode(duplicateHeader.json,duplicateHeader.bin),'sword',{retarget:false}),/IHDR|PNG.*order/i,'duplicate PNG header must not pass as browser-decodable');cases++;
  const palette=fixture(),invalidPalette=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAMAAAB4W+j4AAAAC0lEQVR4nGNgYAAAAAMAAbitOmMAAAAASUVORK5CYII=','base64');
  palette.json.bufferViews[4]={buffer:0,byteOffset:palette.bin.length,byteLength:invalidPalette.length};palette.bin=Buffer.concat([palette.bin,invalidPalette]);palette.json.buffers[0].byteLength=palette.bin.length;
  assert.throws(()=>validateMaterialPair(v1,encode(palette.json,palette.bin),'sword',{retarget:false}),/PNG format/i,'illegal indexed 16-bit PNG must not pass');cases++;
  const unknownChunk=Buffer.concat([v1,Buffer.alloc(8)]);unknownChunk.writeUInt32LE(unknownChunk.length,8);unknownChunk.writeUInt32LE(0x12345678,unknownChunk.length-4);
  assert.throws(()=>validateMaterialPair(v1,unknownChunk,'sword',{retarget:false}),/chunks/i);cases++;
  console.log(JSON.stringify({ok:true,selfTestCases:cases}));
}

if(path.resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.includes('--self-test'))selfTest();
    else{
      const report=await validateEquipmentMaterialsV2(process.argv[2],process.argv[3]);
      console.log(JSON.stringify({ok:report.ok,report:path.join(report.v2Directory,'validation.json'),assets:report.assets.map(asset=>({id:asset.id,ok:asset.ok,error:asset.error,
        triangles:asset.triangles,bytes:asset.v2?.bytes,uniqueUsedImageRgbaBytes:asset.textures?.uniqueUsedImageRgbaBytes,retargetPoses:asset.retarget?.poses,warnings:asset.warnings}))},null,2));
      if(!report.ok)process.exitCode=1;
    }
  }catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
