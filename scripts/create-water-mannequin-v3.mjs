// Material-only GLB revision. Geometry sections and their binary views stay exact.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const from=path.join(root,'public/assets/characters/water-mannequin/v2');
const out=path.join(root,'public/assets/characters/water-mannequin/v3');
const maps=path.join(root,'docs/assets/characters/v3/textures');await mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const receipt=[];
for(const name of ['water-mannequin','water-mannequin-amber','water-mannequin-boss']){
  const bytes=await readFile(path.join(from,name+'.glb'));const jsonLength=bytes.readUInt32LE(12);
  const g=JSON.parse(bytes.subarray(20,20+jsonLength).toString());const original=structuredClone(g);
  const bin=bytes.subarray(28+jsonLength,28+jsonLength+bytes.readUInt32LE(20+jsonLength));
  const originalImages=new Map(g.images.map((image,i)=>[image.bufferView,i]));
  const oldViews=g.bufferViews.map(view=>Buffer.from(bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength)));
  const mapFiles=['wood-normal.png','wood-basecolor.png','wood-orm.png','brass-basecolor.png','brass-orm.png','brass-normal.png','leather-basecolor.png','leather-orm.png','leather-normal.png','cloth-normal.png','cloth-orm.png'];
  const pngs=await Promise.all(mapFiles.map(f=>readFile(path.join(maps,f))));
  const textures={};
  // Replace the 3 existing wood images while retaining image/texture indices.
  for(let i=0;i<3;i++){
    const view=g.images[i].bufferView;oldViews[view]=pngs[i];g.images[i].name=mapFiles[i].replace('.png','');
    textures[mapFiles[i]]=g.textures.findIndex(t=>t.source===i);
  }
  const sampler=g.textures[0]?.sampler;
  for(let i=3;i<mapFiles.length;i++){
    const bufferView=g.bufferViews.length;g.bufferViews.push({buffer:0,byteOffset:0,byteLength:pngs[i].length});oldViews.push(pngs[i]);
    const image=g.images.length;g.images.push({bufferView,mimeType:'image/png',name:mapFiles[i].replace('.png','')});
    textures[mapFiles[i]]=g.textures.length;g.textures.push({source:image,...(sampler===undefined?{}:{sampler})});
  }
  const slot=file=>({index:textures[file],texCoord:0});
  const setMap=(m,kind,{color=true,normal=.3,ao=.18}={})=>{
    const p=m.pbrMetallicRoughness;
    if(color){p.baseColorTexture=slot(kind+'-basecolor.png');p.baseColorFactor=[1,1,1,1];}
    p.metallicRoughnessTexture=slot(kind+'-orm.png');p.metallicFactor=1;p.roughnessFactor=1;
    m.normalTexture={...slot(kind+'-normal.png'),scale:normal};m.occlusionTexture={...slot(kind+'-orm.png'),strength:ao};
  };
  for(const m of g.materials){
    if(m.name==='Beech_Wood_Grain')setMap(m,'wood',{normal:.30,ao:.20});
    else if(m.name==='Satin_Brass')setMap(m,'brass',{normal:.45,ao:.20});
    else if(m.name==='Wrapped_Brown_Leather')setMap(m,'leather',{normal:.4,ao:.18});
    else if(m.name==='Endgrain_Joints'){
      setMap(m,'wood',{color:false,normal:.15,ao:.18});m.pbrMetallicRoughness.metallicFactor=0;
    }else if(m.name==='Mint_Woven_Sash'||m.name==='Boss_Burgundy_Woven_Cloth'){
      setMap(m,'cloth',{color:false,normal:.4,ao:.12});m.pbrMetallicRoughness.metallicFactor=0;
      // Only the already-supported sheen extension; no new anisotropy shader.
      m.extensions??={};m.extensions.KHR_materials_sheen={sheenColorFactor:m.name.startsWith('Boss')?[.12,.025,.035]:[.025,.12,.10],sheenRoughnessFactor:.82};
      g.extensionsUsed??=[];if(!g.extensionsUsed.includes('KHR_materials_sheen'))g.extensionsUsed.push('KHR_materials_sheen');
    }
  }
  // Repack views without touching a single geometry byte or accessor descriptor.
  let offset=0;const chunks=[];
  for(let i=0;i<g.bufferViews.length;i++){
    const data=oldViews[i];g.bufferViews[i].byteOffset=offset;g.bufferViews[i].byteLength=data.length;
    chunks.push(data);offset+=data.length;const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}
  }
  const binary=Buffer.concat(chunks);g.buffers[0].byteLength=binary.length;
  for(const key of ['nodes','meshes','skins','accessors','scenes','scene'])if(JSON.stringify(g[key])!==JSON.stringify(original[key]))throw Error(`Changed ${key}`);
  const json=Buffer.from(JSON.stringify(g));const paddedJSON=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+paddedJSON.length+binary.length,8);header.writeUInt32LE(paddedJSON.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(binary.length,0);bh.writeUInt32LE(0x004e4942,4);
  const result=Buffer.concat([header,paddedJSON,bh,binary]);await writeFile(path.join(out,name+'.glb'),result);
  receipt.push({name,source_sha256:hash(bytes),sha256:hash(result),bytes:result.length,texture_count:g.images.length,material_names:g.materials.map(m=>m.name),geometry_json_unchanged:true,original_images_replaced:[...originalImages.keys()]});
}
await writeFile(path.join(out,'build-receipt.json'),JSON.stringify({revision:3,material_only:true,assets:receipt},null,2));
console.log(JSON.stringify(receipt.map(({name,bytes,texture_count})=>({name,bytes,texture_count})),null,2));
