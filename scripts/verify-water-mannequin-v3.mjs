// Certify the material-only v3 against frozen v2 GLBs using Node stdlib only.
// Usage: node scripts/verify-water-mannequin-v3.mjs [v2-directory] [v3-directory]
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const assetRoot=fileURLToPath(new URL('../public/assets/characters/water-mannequin/',import.meta.url));
const baseline=path.resolve(process.argv[2]||path.join(assetRoot,'v2'));
const candidate=path.resolve(process.argv[3]||path.join(assetRoot,'v3'));
const variants=[['normal','water-mannequin.glb'],['amber','water-mannequin-amber.glb'],['boss','water-mannequin-boss.glb']];
const allowedNewExtensions=new Set(['KHR_materials_sheen']);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const integer=(value,label,min=0)=>{check(Number.isSafeInteger(value)&&value>=min,`${label}: invalid integer`);return value;};
const ref=(items,index,label)=>{integer(index,label);check(Array.isArray(items)&&index<items.length,`${label}: index out of range`);return items[index];};
const canonical=value=>value===undefined?undefined:JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a,b,label)=>check(canonical(a)===canonical(b),`${label}: changed from frozen v2`);
const finiteJSON=(value,label='glTF')=>{if(typeof value==='number')check(Number.isFinite(value),`${label}: non-finite number`);else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))finiteJSON(child,`${label}.${key}`);};

async function readGLB(file){
  const bytes=await readFile(file);
  check(bytes.length>=20&&bytes.readUInt32LE(0)===0x46546c67,`${file}: invalid GLB magic/header`);
  check(bytes.readUInt32LE(4)===2&&bytes.readUInt32LE(8)===bytes.length&&bytes.length%4===0,`${file}: invalid GLB version/length`);
  const chunks=[];
  for(let offset=12;offset<bytes.length;){
    check(offset+8<=bytes.length,`${file}: truncated chunk header`);
    const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4),start=offset+8;
    check(length%4===0&&start+length<=bytes.length,`${file}: overflowing/unaligned chunk`);
    chunks.push({type,data:bytes.subarray(start,start+length)});offset=start+length;
  }
  check(chunks.length===2&&chunks[0].type===0x4e4f534a&&chunks[1].type===0x004e4942,`${file}: expected JSON and BIN chunks`);
  const json=JSON.parse(chunks[0].data.toString('utf8').trimEnd()),bin=chunks[1].data;
  finiteJSON(json);check(json.asset?.version==='2.0',`${file}: expected glTF 2.0`);
  check(json.buffers?.length===1&&!json.buffers[0].uri,`${file}: expected one embedded buffer`);
  const declared=integer(json.buffers[0].byteLength,'buffer.byteLength',1);
  check(declared<=bin.length&&bin.length-declared<=3,`${file}: invalid BIN padding`);
  check(Array.isArray(json.bufferViews),`${file}: missing bufferViews`);
  const views=json.bufferViews.map((view,index)=>{
    check(view.buffer===0,`bufferView ${index}: external buffer`);
    const offset=integer(view.byteOffset??0,`bufferView ${index} offset`),length=integer(view.byteLength,`bufferView ${index} length`,1);
    check(offset+length<=declared,`bufferView ${index}: exceeds BIN`);
    return bin.subarray(offset,offset+length);
  });
  return {file,bytes,json,bin:bin.subarray(0,declared),views};
}

const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return (crc^0xffffffff)>>>0;};
const mipBytes=(width,height)=>{let total=0;while(true){total+=width*height*4;if(width===1&&height===1)return total;width=Math.max(1,Math.floor(width/2));height=Math.max(1,Math.floor(height/2));}};

function inspectPNG(bytes,label){
  check(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),`${label}: invalid PNG signature`);
  let header=null,ended=false,seenData=false;const data=[];
  for(let offset=8;offset<bytes.length;){
    check(offset+12<=bytes.length,`${label}: truncated PNG chunk`);
    const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),start=offset+8,end=start+length;
    check(end+4<=bytes.length,`${label}: PNG chunk exceeds image`);
    check(crc32(bytes.subarray(offset+4,end))===bytes.readUInt32BE(end),`${label}: bad ${type} CRC`);
    if(!header){
      check(type==='IHDR'&&length===13,`${label}: first PNG chunk must be IHDR`);
      header={width:bytes.readUInt32BE(start),height:bytes.readUInt32BE(start+4),bitDepth:bytes[start+8],colorType:bytes[start+9],interlace:bytes[start+12]};
      check(header.width>=512&&header.width<=1024&&header.height>=512&&header.height<=1024,`${label}: dimensions must each be 512..1024`);
      check((header.width&(header.width-1))===0&&(header.height&(header.height-1))===0,`${label}: expected power-of-two dimensions`);
      check(bytes[start+10]===0&&bytes[start+11]===0&&[0,1].includes(header.interlace),`${label}: unsupported PNG coding`);
      const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      check(depths[header.colorType]?.includes(header.bitDepth),`${label}: invalid PNG color type/bit depth`);
    }else check(type!=='IHDR',`${label}: duplicate IHDR`);
    if(type==='IDAT'){seenData=true;data.push(bytes.subarray(start,end));}
    if(type==='IEND'){check(length===0&&end+4===bytes.length,`${label}: invalid IEND or trailing bytes`);ended=true;break;}
    offset=end+4;
  }
  check(ended&&seenData,`${label}: incomplete PNG`);
  const channels={0:1,2:3,3:1,4:2,6:4}[header.colorType],bitsPerPixel=channels*header.bitDepth;
  let rasterBytes;
  if(!header.interlace)rasterBytes=header.height*(1+Math.ceil(header.width*bitsPerPixel/8));
  else{
    rasterBytes=0;
    for(const [x,y,dx,dy]of [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]){
      const w=Math.max(0,Math.ceil((header.width-x)/dx)),h=Math.max(0,Math.ceil((header.height-y)/dy));
      if(w&&h)rasterBytes+=h*(1+Math.ceil(w*bitsPerPixel/8));
    }
  }
  const inflated=inflateSync(Buffer.concat(data),{maxOutputLength:rasterBytes});
  check(inflated.length===rasterBytes,`${label}: PNG raster length mismatch`);
  return {...header,encodedBytes:bytes.length,sha256:sha256(bytes),gpuRGBA8Bytes:header.width*header.height*4,gpuRGBA8MipBytes:mipBytes(header.width,header.height)};
}

function imageInventory(glb){
  const images=glb.json.images||[],textures=glb.json.textures||[];
  const inventory=images.map((image,index)=>{
    check(!image.uri&&image.mimeType==='image/png',`image ${index}: must be embedded PNG`);
    const bytes=ref(glb.views,image.bufferView,`image ${index}.bufferView`);
    return {index,name:image.name??null,...inspectPNG(bytes,`image ${index}`)};
  });
  const bindings=textures.map((texture,index)=>{
    check(texture.source!==undefined,`texture ${index}: expected ordinary embedded PNG source`);
    const image=ref(inventory,texture.source,`texture ${index}.source`);
    if(texture.sampler!==undefined)ref(glb.json.samplers||[],texture.sampler,`texture ${index}.sampler`);
    return {index,image:image.index,sampler:texture.sampler??null};
  });
  return {images:inventory,textureBindings:bindings,encodedBytes:inventory.reduce((sum,image)=>sum+image.encodedBytes,0),
    gpuRGBA8Bytes:inventory.reduce((sum,image)=>sum+image.gpuRGBA8Bytes,0),
    gpuRGBA8MipBytes:inventory.reduce((sum,image)=>sum+image.gpuRGBA8MipBytes,0),
    gpuRGBA8MipBytesPerTexture:bindings.reduce((sum,texture)=>sum+inventory[texture.image].gpuRGBA8MipBytes,0),
    estimate:'RGBA8 allocation, full mip chain; no GPU compression; per-image and per-texture totals exclude renderer overhead'};
}

function accessorViews(json){
  const used=new Set();
  for(const [index,accessor]of (json.accessors||[]).entries()){
    if(accessor.bufferView!==undefined)used.add(integer(accessor.bufferView,`accessor ${index}.bufferView`));
    if(accessor.sparse){used.add(integer(accessor.sparse.indices?.bufferView,`accessor ${index}.sparse.indices`));used.add(integer(accessor.sparse.values?.bufferView,`accessor ${index}.sparse.values`));}
  }
  return [...used].sort((a,b)=>a-b);
}

function textureIndices(value,indices=new Set()){
  if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){
    if(key.endsWith('Texture')&&child){integer(child.index,`${key}.index`);indices.add(child.index);}
    else textureIndices(child,indices);
  }
  return indices;
}

function extensionNames(json){
  const used=json.extensionsUsed||[],required=json.extensionsRequired||[];
  check(Array.isArray(used)&&used.every(name=>typeof name==='string')&&new Set(used).size===used.length,'extensionsUsed: invalid array');
  check(Array.isArray(required)&&required.every(name=>used.includes(name)),'extensionsRequired: extension absent from extensionsUsed');
  const actual=new Set();
  const walk=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(key==='extensions'&&child)for(const name of Object.keys(child))actual.add(name);walk(child);}};
  walk(json);for(const name of actual)check(used.includes(name),`extension ${name}: not declared in extensionsUsed`);
  return new Set([...used,...required,...actual]);
}

function protectedHeadMaterials(base,next){
  const protectedIndices=new Set(),nodes=[];
  for(const name of ['Balloon_Latex','Water_Contained']){
    const node=base.json.nodes.find(item=>item.name===name);check(node,`missing protected node ${name}`);
    const mesh=ref(base.json.meshes,node.mesh,`${name}.mesh`),slots=[];
    for(const primitive of mesh.primitives){ref(base.json.materials,primitive.material,`${name}.material`);protectedIndices.add(primitive.material);slots.push(primitive.material);}
    nodes.push({name,materialSlots:slots});
  }
  const materials=[];
  for(const index of protectedIndices){
    const material=base.json.materials[index];same(material,next.json.materials[index],`protected material ${index} (${material.name})`);
    // A frozen JSON material may still point to an altered texture image.
    // Check its dependencies too so head/water appearance is actually frozen.
    const textures=[];
    for(const ti of textureIndices(material)){
      const a=ref(base.json.textures||[],ti,'protected texture'),b=ref(next.json.textures||[],ti,'protected texture');same(a,b,`protected texture ${ti}`);
      if(a.sampler!==undefined)same(base.json.samplers[a.sampler],next.json.samplers[a.sampler],`protected sampler ${a.sampler}`);
      const imageA=ref(base.json.images,a.source,'protected image'),imageB=ref(next.json.images,b.source,'protected image');
      check(sha256(ref(base.views,imageA.bufferView,'protected image view'))===sha256(ref(next.views,imageB.bufferView,'protected image view')),`protected texture ${ti}: image bytes changed`);
      textures.push(ti);
    }
    materials.push({index,name:material.name,canonicalSHA256:sha256(Buffer.from(canonical(material))),protectedTextures:textures});
  }
  return {nodes,materials};
}

async function compareVariant(id,filename){
  const [base,next]=await Promise.all([readGLB(path.join(baseline,filename)),readGLB(path.join(candidate,filename))]);
  const sections=['meshes','nodes','skins','accessors','scenes','scene','animations'];
  for(const section of sections)same(base.json[section],next.json[section],section);
  check(Array.isArray(base.json.accessors)&&Array.isArray(base.json.materials),'baseline: missing accessors/materials');
  same(base.json.materials.map(material=>material.name),next.json.materials?.map(material=>material.name),'material names/order');
  const slots=json=>json.meshes.map(mesh=>mesh.primitives.map(primitive=>primitive.material));
  same(slots(base.json),slots(next.json),'primitive material indices');
  const views=accessorViews(base.json),viewHashes=[],aggregate=createHash('sha256');let geometryBytes=0;
  check(views.length>0,'baseline: no accessor bufferViews');
  for(const index of views){
    const a=ref(base.views,index,'baseline geometry view'),b=ref(next.views,index,'candidate geometry view');
    const metadata=view=>Object.fromEntries(Object.entries(view).filter(([key])=>key!=='byteOffset'));
    same(metadata(base.json.bufferViews[index]),metadata(next.json.bufferViews[index]),`geometry bufferView ${index} layout`);
    const hash=sha256(a);check(hash===sha256(b),`geometry bufferView ${index}: binary bytes changed`);
    viewHashes.push({bufferView:index,bytes:a.length,sha256:hash});geometryBytes+=a.length;
    aggregate.update(`${index}:${a.length}:`);aggregate.update(a);
  }
  const protectedMaterials=protectedHeadMaterials(base,next);
  const before=extensionNames(base.json),after=extensionNames(next.json),added=[...after].filter(name=>!before.has(name)).sort(),removed=[...before].filter(name=>!after.has(name)).sort();
  for(const name of added)check(allowedNewExtensions.has(name),`new extension not admitted by runtime: ${name}`);
  const textures=imageInventory(next);
  return {variant:id,ok:true,baseline:base.file,candidate:next.file,baselineBytes:base.bytes.length,candidateBytes:next.bytes.length,
    unchangedJSONSections:sections,materialNamesAndPrimitiveIndicesIdentical:true,
    geometry:{accessors:base.json.accessors.length,bufferViews:views.length,bytes:geometryBytes,sha256:aggregate.digest('hex'),views:viewHashes,
      inverseBindMatrixAccessors:(base.json.skins||[]).map(skin=>skin.inverseBindMatrices??null),
      uvAccessors:[...new Set(base.json.meshes.flatMap(mesh=>mesh.primitives.flatMap(primitive=>Object.entries(primitive.attributes).filter(([name])=>name.startsWith('TEXCOORD_')).map(([,index])=>index))))].sort((a,b)=>a-b),
      originalBinPrefixAlsoIdentical:next.bin.length>=base.bin.length&&next.bin.subarray(0,base.bin.length).equals(base.bin)},
    protectedHeadAndWater:protectedMaterials,extensions:{added,removed},textures};
}

const comparisons=await Promise.allSettled(variants.map(([id,filename])=>compareVariant(id,filename)));
const results=comparisons.map((result,index)=>result.status==='fulfilled'?result.value:{variant:variants[index][0],ok:false,error:result.reason?.message||String(result.reason)});
const passed=results.filter(result=>result.ok),uniqueImages=new Map();
for(const result of passed)for(const image of result.textures.images)uniqueImages.set(image.sha256,image);
const unique=[...uniqueImages.values()];
const output={ok:results.every(result=>result.ok),baselineDirectory:baseline,candidateDirectory:candidate,
  policy:{materialOnly:true,allowedNewExtensions:[...allowedNewExtensions],pngDimensions:'each axis 512 or 1024; embedded PNG only',gpuBudget:'reported estimate, no unstated byte ceiling'},
  summary:{variantsPassed:passed.length,variantsExpected:variants.length,totalCandidateFileBytes:passed.reduce((sum,result)=>sum+result.candidateBytes,0),
    accessorBufferViewBytesPreserved:passed.reduce((sum,result)=>sum+result.geometry.bytes,0),
    embeddedImageBytesAcrossFiles:passed.reduce((sum,result)=>sum+result.textures.encodedBytes,0),
    gpuRGBA8MipBytesAcrossFiles:passed.reduce((sum,result)=>sum+result.textures.gpuRGBA8MipBytes,0),
    uniqueImageCountBySHA256:unique.length,uniqueImageEncodedBytes:unique.reduce((sum,image)=>sum+image.encodedBytes,0),
    uniqueImageGPU_RGBA8MipBytes:unique.reduce((sum,image)=>sum+image.gpuRGBA8MipBytes,0)},results};
console.log(JSON.stringify(output,null,2));
if(!output.ok)process.exitCode=1;
