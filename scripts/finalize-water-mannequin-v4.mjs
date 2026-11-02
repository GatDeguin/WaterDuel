import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter} from '../public/rendering/asset-rig.js';
import {characterResources} from '../public/rendering/character-resources.js';
const root=fileURLToPath(new URL('../',import.meta.url)),relative='public/assets/characters/water-mannequin/v4';
const load=async file=>JSON.parse(await readFile(path.join(root,file),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=async (file,value)=>writeFile(path.join(root,file),JSON.stringify(value,null,2)+'\n');
const oldContract=await load('public/assets/characters/water-mannequin/v3/rig-contract.json');
const variants={},runtimeImages=new Map(),embeddedImages=new Map();
const imageBudget=image=>{
  assert.equal(image.mimeType,'image/png');const b=Buffer.from(image.bytes),width=b.readUInt32BE(16),height=b.readUInt32BE(20);let mip=0;
  for(let w=width,h=height;;w=Math.max(1,w>>1),h=Math.max(1,h>>1)){mip+=w*h*4;if(w===1&&h===1)break;}
  return {name:image.name,width,height,encodedBytes:b.length,sha256:hash(b),gpuRGBA8MipBytes:mip};
};
for(const [id,name]of [['mint','water-mannequin'],['amber','water-mannequin-amber'],['boss','water-mannequin-boss']]){
  const file=`${relative}/${name}.glb`,bytes=await readFile(path.join(root,file));
  const parsed=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),prepared=prepareCharacter(parsed),gpu=characterResources(parsed,prepared.parts);
  const oldBytes=await readFile(path.join(root,`public/assets/characters/water-mannequin/v3/${name}.glb`));
  const old=JSON.parse(oldBytes.subarray(20,20+oldBytes.readUInt32LE(12)).toString());
  const protectedMaterials=['Mint_Latex_Transmission','Water_IOR_1.333','Water_Surface_Crest'];
  for(const material of protectedMaterials)assert.deepEqual(parsed.json.materials.find(m=>m.name===material),old.materials.find(m=>m.name===material));
  const oldCloth=old.materials.find(m=>/Woven/.test(m.name)),cloth=parsed.json.materials.find(m=>m.name===oldCloth.name);
  assert.deepEqual(cloth.pbrMetallicRoughness.baseColorFactor,oldCloth.pbrMetallicRoughness.baseColorFactor);
  assert.equal(parsed.skins[0].joints.length,18);assert.equal(gpu.images.length,3);
  assert.equal(parsed.nodes.filter(n=>n.name.startsWith('Socket_')).length,5);
  const construction=await load(`docs/assets/characters/v4/${name}-construction.json`),roundtrip=await load(`${relative}/${name}-roundtrip.json`),validation=await load(`${relative}/validation-${id}.json`);
  assert.equal(construction.rig_rest_pose_sockets_exact,true);assert.equal(roundtrip.ok,true);
  const images=gpu.images.map(imageBudget),embedded=parsed.images.map(imageBudget);
  for(const im of images)runtimeImages.set(im.sha256,im);for(const im of embedded)embeddedImages.set(im.sha256,im);
  const triangles=parsed.primitives.reduce((n,p)=>n+p.indices.length/3,0);assert.ok(triangles<=(id==='boss'?90000:65000));
  variants[id]={...oldContract.variants[id],glb:name+'.glb',source:`docs/assets/characters/v4/${name}.blend`,
    bytes:bytes.length,sha256:hash(bytes),triangles,meshes:parsed.json.meshes.length,materials:parsed.materials.length,
    textures:parsed.textures.length,images:parsed.images.length,runtimeTextureCount:gpu.textures.length,runtimeImageCount:gpu.images.length,
    preparedParts:prepared.parts.length,renderedTriangles:prepared.triangleCount,bones:18,runtimeBones:prepared.bones.size,
    bounds_glb:validation.bounds,runtime_cpu_counts:undefined,
    optional_equipment_nodes:parsed.nodes.filter(n=>/Preview_Rapier/.test(n.name)).map(n=>n.name),
    preview:'waterduel-models-v4.png',detail:undefined,baseline_sha256:hash(oldBytes),
    geometry_bytes_sha256:undefined,roundtrip,textureBudget:{images,gpuRGBA8MipBytes:images.reduce((n,im)=>n+im.gpuRGBA8MipBytes,0)},
    protectedMaterialsIdenticalV3:protectedMaterials,physical:`docs/assets/characters/v4/${name}-physical.json`};
}
const sweep=await load(`${relative}/pose-sweep.json`);assert.equal(sweep.ok,true);
assert.equal(runtimeImages.size,3,'Las tres variantes deben compartir exactamente los atlas');
const budget={runtimeUniqueImages:[...runtimeImages.values()],runtimeRGBA8MipBytes:[...runtimeImages.values()].reduce((n,im)=>n+im.gpuRGBA8MipBytes,0),
  rawEmbeddedUniqueImages:embeddedImages.size,rawEmbeddedRGBA8MipBytes:[...embeddedImages.values()].reduce((n,im)=>n+im.gpuRGBA8MipBytes,0),
  note:'Visible character resources pruned/remapped before GPU upload; optional rapier images remain embedded for authoring previews. RGBA8+mips estimates exclude driver overhead.'};
const limits={physics:'Planar multibody with depth layers and reduced lateral neck; 16 DOF, not a full 3D Coulomb solver.',
  cloth:'12-node reduced cloth. Body drives accessory; accessory cannot prop up or displace body. Dynamic textured vertex positions share the contact surface.',
  optical:'Imported head/water/crest are static presentation geometry; game generates its own membrane/water. Protected serialized materials equal v3.',
  sweep:sweep.scope,performance:'No FPS or phone-hardware benchmark is inferred from CPU tests or Blender previews.',
  publication:'Principal owns versions, packaging and publication; this script never publishes.'};
const contract={...oldContract,date:'2026-11-02',asset:'WaterDuel mannequin v4 — construction, unique UV and physical integration',material_only:false,
  geometry_baseline:'v3 authored rig/pivots preserved; geometry and UV revised',variants,
  solver:{dofs:16,appendIndices:{frontAnkle:14,backAnkle:15},authoredJoints:18,sockets:5,footFrame:'pose.feet.front/back.matrix, world units, origin at achieved ankle',
    legacy:'Snapshots without feet use the historical horizontal foot mapper; snapshots without cloth use the legacy apron hinge.'},
  textures:budget,limits};
await save(`${relative}/rig-contract.json`,contract);
const renderer=await readFile(path.join(root,'public/render3d.js'),'utf8');
await save(`${relative}/asset-info.json`,{date:'2026-11-02',revision:4,materialOnly:false,runtimeSelected:renderer.includes('characters/water-mannequin/v4/'),
  variants,textureBudget:budget,cpuPoseSweep:{profiles:sweep.profiles,samples:sweep.samples,vertices:sweep.verticesExamined,maxBelowFloor:sweep.maximumBelowFloor},limits});
const files=[`${relative}/asset-info.json`,`${relative}/rig-contract.json`,`${relative}/pose-sweep.json`,`${relative}/waterduel-models-v4.png`];
for(const v of Object.values(variants))files.push(`${relative}/${v.glb}`,v.source,v.physical);
for(const name of ['body-basecolor.png','body-normal.png','body-orm.png','atlas-stats.json'])files.push(`docs/assets/characters/v4/textures/${name}`);
const receipts=[];for(const file of files){const bytes=await readFile(path.join(root,file));receipts.push({file,bytes:bytes.length,sha256:hash(bytes)});}
await save(`${relative}/delivery-sha256.json`,{revision:4,files:receipts});
console.log(JSON.stringify({ok:true,runtimeSelected:renderer.includes('characters/water-mannequin/v4/'),variants:Object.keys(variants),filesHashed:receipts.length,budget},null,2));
