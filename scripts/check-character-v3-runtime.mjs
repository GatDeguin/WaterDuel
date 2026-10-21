// CPU-only check through the actual runtime parser, rigid preparation and retargeting.
// Writes only the material-v3 compatibility receipt; no WebGL or network is used.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {materialSheen} from '../public/rendering/sheen.js';
import {DuelEngine} from '../public/engine.js';

const assetRoot=fileURLToPath(new URL('../public/assets/characters/water-mannequin/',import.meta.url));
const baseline=path.resolve(process.argv[2]??path.join(assetRoot,'v2'));
const candidate=path.resolve(process.argv[3]??path.join(assetRoot,'v3'));
const outputFile=path.join(candidate,'runtime-compatibility.json');
const variants=[['normal','water-mannequin.glb'],['amber','water-mannequin-amber.glb'],['boss','water-mannequin-boss.glb']];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,message)=>{if(!ok)throw new Error(message);};
function canonical(value){
  if(ArrayBuffer.isView(value)){
    check(value.every(Number.isFinite),'Non-finite runtime attribute');
    return {type:value.constructor.name,length:value.length,sha256:sha256(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
  }
  if(value instanceof Map)return [...value].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([key,item])=>[key,canonical(item)]);
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  if(typeof value==='number')check(Number.isFinite(value),'Non-finite runtime metadata');
  return value;
}
const digest=value=>sha256(JSON.stringify(canonical(value)));
function identical(a,b,label){
  const baselineSHA256=digest(a),candidateSHA256=digest(b);
  check(baselineSHA256===candidateSHA256,`${label}: v3 differs from v2`);
  return {identical:true,baselineSHA256,candidateSHA256};
}
async function load(directory,filename){
  const file=path.join(directory,filename),bytes=await readFile(file);
  const parsed=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  return {file,fileBytes:bytes.length,fileSHA256:sha256(bytes),parsed,prepared:prepareCharacter(parsed)};
}
function geometry(asset){
  return {nodes:asset.nodes,skins:asset.skins,primitives:asset.primitives,
    materialNames:asset.materials.map(m=>m.name),bounds:asset.bounds};
}
function preparation(prepared){
  const {parts,bones,source,nodesByName,triangleCount,excludedTriangles,apron,apronVariant}=prepared;
  return {parts,bones,source,nodesByName,triangleCount,excludedTriangles,apron,apronVariant};
}
function partAttributeHash(parts,attribute){return digest(parts.map(part=>({nodeName:part.nodeName,boneName:part.boneName,data:part[attribute]??null})));}
function retargetedPositions(parts,matrices){
  const hash=createHash('sha256');
  for(let i=0;i<parts.length;i++){
    const p=parts[i].positions,m=matrices[i],world=new Float64Array(p.length);
    check(m?.length===16&&m.every(Number.isFinite),'Non-finite retargeted matrix');
    for(let v=0;v<p.length;v+=3)for(let axis=0;axis<3;axis++)world[v+axis]=m[axis]*p[v]+m[axis+4]*p[v+1]+m[axis+8]*p[v+2]+m[axis+12];
    check(world.every(Number.isFinite),'Non-finite retargeted position');
    hash.update(`${i}:${world.length}:`);hash.update(new Uint8Array(world.buffer));
  }
  return hash.digest('hex');
}
function retargetComparison(base,next,id){
  const game=new DuelEngine();
  if(id==='boss')game.setDifficulty('boss');
  game.setMode('versus');
  const samples=[];
  function sample(stage){
    const fighters=id==='boss'?[game.fighters[1]]:game.fighters;
    for(const fighter of fighters){
      const poseBefore=digest(fighter.pose),a=characterTransforms(base,fighter),b=characterTransforms(next,fighter);
      check(digest(fighter.pose)===poseBefore,'Retargeting mutated simulation pose');
      const matrices=identical(a,b,`${stage} direction ${fighter.dir} matrices`);
      const baselinePositionsSHA256=retargetedPositions(base.parts,a),candidatePositionsSHA256=retargetedPositions(next.parts,b);
      check(baselinePositionsSHA256===candidatePositionsSHA256,`${stage}: retargeted positions differ`);
      samples.push({stage,direction:fighter.dir,boss:!!fighter.boss,partCount:a.length,matrices,
        worldPositions:{identical:true,baselineSHA256:baselinePositionsSHA256,candidateSHA256:candidatePositionsSHA256},simulationPoseUnchanged:true});
    }
  }
  sample('initial');
  game.start();for(let frame=0;frame<81;frame++)game.update(.04);
  game.setControl(1,{mainX:.8,mainY:.8,offX:-.5,offY:.3,move:0,wrist:.4,thrust:false,guard:false});
  game.setControl(2,{mainX:-.7,mainY:.6,offX:.4,offY:.2,move:0,wrist:-.3,thrust:false,guard:true});
  for(let frame=0;frame<60;frame++)game.update(1/120);
  sample('simulated-control');
  return {samples,allIdentical:true};
}
function materialInventory(asset){
  const imageSlots=['baseColorTexture','normalTexture','metallicRoughnessTexture','occlusionTexture','emissiveTexture'];
  return asset.materials.map((material,index)=>{
    const sheen=materialSheen(material),maps={};
    for(const slot of imageSlots){const info=material[slot];if(info)maps[slot]=info;}
    if(sheen.colorTexture)maps.sheenColorTexture=sheen.colorTexture;
    if(sheen.roughnessTexture)maps.sheenRoughnessTexture=sheen.roughnessTexture;
    for(const [slot,info]of Object.entries(maps)){
      check(info.index<asset.textures.length,`${material.name}.${slot}: texture absent`);
      check([0,1].includes(info.texCoord??0),`${material.name}.${slot}: UV unsupported`);
      check(!info.extensions?.KHR_texture_transform,`${material.name}.${slot}: runtime ignores texture transforms`);
    }
    return {index,name:material.name,maps,sheen:{color:Array.from(sheen.color),roughness:sheen.roughness,
      declared:!!material.extensions?.KHR_materials_sheen}};
  });
}
async function compareVariant(id,filename){
  const [base,next]=await Promise.all([load(baseline,filename),load(candidate,filename)]);
  const parsed=identical(geometry(base.parsed),geometry(next.parsed),'Runtime-decoded geometry/rig');
  const prepared=identical(preparation(base.prepared),preparation(next.prepared),'Prepared runtime parts/rig');
  const apron=identical({descriptor:base.prepared.apron,variant:base.prepared.apronVariant,
    parts:base.prepared.parts.filter(p=>p.accessory==='apron')},{descriptor:next.prepared.apron,variant:next.prepared.apronVariant,
    parts:next.prepared.parts.filter(p=>p.accessory==='apron')},'Apron geometry and descriptor');
  const attributes={};
  for(const name of ['positions','normals','indices','uv','uv1','colors']){
    const a=partAttributeHash(base.prepared.parts,name),b=partAttributeHash(next.prepared.parts,name);
    check(a===b,`Prepared ${name} changed`);attributes[name]={identical:true,baselineSHA256:a,candidateSHA256:b};
  }
  const materials=materialInventory(next.parsed);
  return {variant:id,ok:true,baseline:{file:base.file,bytes:base.fileBytes,sha256:base.fileSHA256},
    candidate:{file:next.file,bytes:next.fileBytes,sha256:next.fileSHA256},
    counts:{nodes:next.parsed.nodes.length,skins:next.parsed.skins.length,primitives:next.parsed.primitives.length,
      parts:next.prepared.parts.length,bones:next.prepared.bones.size,triangles:next.prepared.triangleCount,
      excludedTriangles:next.prepared.excludedTriangles,apronParts:next.prepared.parts.filter(p=>p.accessory==='apron').length,
      images:next.parsed.images.length,textures:next.parsed.textures.length,materials:next.parsed.materials.length},
    parsed,prepared,attributes,apron,retargeting:retargetComparison(base.prepared,next.prepared,id),
    textures:{parserAccepted:true,images:next.parsed.images.map((image,index)=>({index,name:image.name,mimeType:image.mimeType,
      encodedBytes:image.bytes.length,sha256:sha256(image.bytes)})),bindings:next.parsed.textures,samplers:next.parsed.samplers},
    materials,extensionsUsed:next.parsed.json.extensionsUsed??[],extensionsRequired:next.parsed.json.extensionsRequired??[]};
}
const settled=await Promise.allSettled(variants.map(([id,filename])=>compareVariant(id,filename)));
const results=settled.map((result,index)=>result.status==='fulfilled'?result.value:{variant:variants[index][0],ok:false,error:result.reason?.stack??String(result.reason)});
const output={ok:results.every(result=>result.ok),generatedAt:new Date().toISOString(),baselineDirectory:baseline,candidateDirectory:candidate,
  method:['Actual runtime parseGLB','Actual runtime prepareCharacter and apron classification','SHA-256 over decoded and prepared data',
    'Actual characterTransforms with initial and simulated DuelEngine poses','CPU materialSheen semantic validation'],
  scope:'CPU compatibility only. No image decoding, GPU upload, WebGL rendering, or visual equivalence claim.',results};
await writeFile(outputFile,`${JSON.stringify(output,null,2)}\n`);
console.log(JSON.stringify({ok:output.ok,outputFile,results:results.map(result=>({variant:result.variant,ok:result.ok,counts:result.counts,
  retargetSamples:result.retargeting?.samples.length,error:result.error}))},null,2));
if(!output.ok)process.exitCode=1;
