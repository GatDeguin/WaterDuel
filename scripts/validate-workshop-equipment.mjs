// Independent native-Node validation of the seven standalone workshop GLBs.
// Usage: node scripts/validate-workshop-equipment.mjs [asset-directory]
// Parser regression checks: node scripts/validate-workshop-equipment.mjs --self-test
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const IDS=['sword','spear','axe','maul','short','long','knife'];
const REACH={sword:1.02,spear:1.35,axe:.92,maul:1.08,knife:.42};
const PRIMARY=new Set(['sword','spear','axe','maul']);
const DEFAULT_DIRECTORY=fileURLToPath(new URL('../public/assets/equipment/workshop/',import.meta.url));
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const integer=(value,label,min=0)=>{check(Number.isSafeInteger(value)&&value>=min,`${label}: invalid integer`);return value;};
const list=(value,label)=>{check(Array.isArray(value),`${label}: expected array`);return value;};
const ref=(items,index,label)=>{integer(index,label);check(index<items.length,`${label}: index outside array`);return items[index];};
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const near=(a,b,tolerance=1e-5)=>a.length===b.length&&a.every((value,i)=>Math.abs(value-b[i])<=tolerance);
const multiply=(a,b)=>Array.from({length:16},(_,index)=>{
  const row=index%4,column=Math.floor(index/4);let value=0;
  for(let k=0;k<4;k++)value+=a[k*4+row]*b[column*4+k];return value;
});
const transform=(m,p)=>[0,1,2].map(row=>m[row]*p[0]+m[row+4]*p[1]+m[row+8]*p[2]+m[row+12]);

function finiteJSON(value,label='JSON'){
  if(typeof value==='number')check(Number.isFinite(value),`${label}: non-finite number`);
  else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))finiteJSON(child,`${label}.${key}`);
}

function nodeMatrix(node,label){
  if(node.matrix!==undefined){
    check(node.translation===undefined&&node.rotation===undefined&&node.scale===undefined,`${label}: matrix and TRS coexist`);
    check(list(node.matrix,label).length===16&&node.matrix.every(Number.isFinite),`${label}: invalid matrix`);
    check(near([node.matrix[3],node.matrix[7],node.matrix[11],node.matrix[15]],[0,0,0,1]),`${label}: non-affine matrix`);
    return node.matrix;
  }
  const t=node.translation??[0,0,0],q=node.rotation??[0,0,0,1],s=node.scale??[1,1,1];
  check(list(t,label).length===3&&list(q,label).length===4&&list(s,label).length===3,`${label}: invalid TRS dimensions`);
  check([...t,...q,...s].every(Number.isFinite)&&s.every(v=>Math.abs(v)>1e-6&&Math.abs(v)<=100),`${label}: invalid transform values`);
  check(Math.abs(Math.hypot(...q)-1)<1e-4,`${label}: quaternion not normalized`);
  const [x,y,z,w]=q,x2=2*x,y2=2*y,z2=2*z;
  return [(1-y*y2-z*z2)*s[0],(x*y2+w*z2)*s[0],(x*z2-w*y2)*s[0],0,
    (x*y2-w*z2)*s[1],(1-x*x2-z*z2)*s[1],(y*z2+w*x2)*s[1],0,
    (x*z2+w*y2)*s[2],(y*z2-w*x2)*s[2],(1-x*x2-y*y2)*s[2],0,...t,1];
}

function imageSize(bytes,mime,label){
  if(mime==='image/png'){
    check(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR',`${label}: invalid PNG header`);
    return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  }
  if(mime==='image/jpeg'){
    check(bytes.length>=4&&bytes[0]===255&&bytes[1]===216,`${label}: invalid JPEG header`);
    for(let offset=2;offset<bytes.length;){
      check(bytes[offset++]===255,`${label}: invalid JPEG marker`);
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];if(marker===217||marker===218)break;
      if(marker===1||marker>=208&&marker<=215)continue;
      check(offset+2<=bytes.length,`${label}: truncated JPEG segment`);
      const length=bytes.readUInt16BE(offset);check(length>=2&&offset+length<=bytes.length,`${label}: invalid JPEG segment length`);
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
        check(length>=8,`${label}: truncated JPEG frame`);return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];
      }
      offset+=length;
    }
    throw new Error(`${label}: JPEG dimensions missing`);
  }
  check(mime==='image/webp'&&bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP',`${label}: unsupported or invalid image MIME/header`);
  const kind=bytes.toString('ascii',12,16);
  if(kind==='VP8X')return [1+bytes.readUIntLE(24,3),1+bytes.readUIntLE(27,3)];
  if(kind==='VP8L'){
    check(bytes[20]===47,`${label}: invalid WebP lossless header`);const bits=bytes.readUInt32LE(21);
    return [1+(bits&16383),1+((bits>>>14)&16383)];
  }
  check(kind==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42,`${label}: invalid WebP lossy frame`);
  return [bytes.readUInt16LE(26)&16383,bytes.readUInt16LE(28)&16383];
}

/** Parse actual binary data independently of Blender and the optional manifest. */
export function validateGlbBuffer(bytes,id){
  check(IDS.includes(id),`Unknown equipment ID ${id}`);
  check(Buffer.isBuffer(bytes)&&bytes.length>=28,'GLB: truncated header');
  check(bytes.readUInt32LE(0)===0x46546c67,'GLB: invalid magic');
  check(bytes.readUInt32LE(4)===2,'GLB: expected version 2');
  check(bytes.readUInt32LE(8)===bytes.length&&bytes.length%4===0,'GLB: invalid declared length/alignment');
  const chunks=[];
  for(let offset=12;offset<bytes.length;){
    check(offset+8<=bytes.length,'GLB: truncated chunk header');
    const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4),start=offset+8;
    check(length%4===0&&start+length<=bytes.length,'GLB: invalid chunk bounds/alignment');
    chunks.push({type,length,data:bytes.subarray(start,start+length)});offset=start+length;
  }
  check(chunks.length===2&&chunks[0].type===0x4e4f534a&&chunks[1].type===0x004e4942,'GLB: expected exactly JSON then BIN chunks');
  const gltf=JSON.parse(chunks[0].data.toString('utf8').trimEnd()),bin=chunks[1].data;finiteJSON(gltf);
  check(gltf.asset?.version==='2.0','glTF: expected asset.version 2.0');
  const buffers=list(gltf.buffers,'buffers'),views=list(gltf.bufferViews,'bufferViews'),accessors=list(gltf.accessors,'accessors');
  const meshes=list(gltf.meshes,'meshes'),nodes=list(gltf.nodes,'nodes'),materials=list(gltf.materials,'materials');
  const scenes=list(gltf.scenes,'scenes'),textures=list(gltf.textures??[],'textures'),images=list(gltf.images??[],'images');
  check(buffers.length===1&&buffers[0].uri===undefined,'GLB: expected one embedded buffer without URI');
  const bufferLength=integer(buffers[0].byteLength,'buffer.byteLength',1);
  check(bufferLength<=bin.length&&bin.length-bufferLength<=3,'GLB: binary length does not match buffer');
  check(materials.length>0&&materials.length<=14,'Materials: expected 1–14 material slots');
  check(!(gltf.extensionsUsed??[]).some(name=>['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].includes(name)),'GLB: external decoder extension is unsupported');
  for(const [i,view]of views.entries()){
    const label=`bufferViews[${i}]`,offset=integer(view.byteOffset??0,`${label}.byteOffset`),length=integer(view.byteLength,`${label}.byteLength`,1);
    check(view.buffer===0&&offset+length<=bufferLength,`${label}: outside embedded buffer`);
    if(view.byteStride!==undefined)check(Number.isInteger(view.byteStride)&&view.byteStride>=4&&view.byteStride<=252&&view.byteStride%4===0,`${label}: invalid byteStride`);
    if(view.target!==undefined)check([34962,34963].includes(view.target),`${label}: invalid target`);
  }
  const componentTypes={5120:[1,'readInt8'],5121:[1,'readUInt8'],5122:[2,'readInt16LE'],5123:[2,'readUInt16LE'],5125:[4,'readUInt32LE'],5126:[4,'readFloatLE']};
  const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},decoded=[];
  for(const [i,a]of accessors.entries()){
    const label=`accessors[${i}]`,component=componentTypes[a.componentType],width=widths[a.type];
    check(component&&width,`${label}: unsupported component type/shape`);
    const [cb,read]=component,count=integer(a.count,`${label}.count`,1),offset=integer(a.byteOffset??0,`${label}.byteOffset`);
    check(count*width<=10_000_000&&offset%cb===0,`${label}: excessive size or invalid alignment`);
    check(!a.normalized||[5120,5121,5122,5123].includes(a.componentType),`${label}: invalid normalized encoding`);
    const columns=a.type.startsWith('MAT')?Number(a.type.slice(3)):1,rows=width/columns;
    const columnBytes=columns>1?Math.ceil(rows*cb/4)*4:rows*cb,elementBytes=columnBytes*columns;
    const componentOffset=j=>Math.floor(j/rows)*columnBytes+(j%rows)*cb,values=new Float64Array(count*width);
    if(a.bufferView!==undefined){
      const view=ref(views,a.bufferView,`${label}.bufferView`),stride=view.byteStride??elementBytes,start=(view.byteOffset??0)+offset;
      check(start%cb===0&&stride>=elementBytes&&stride%cb===0&&offset+(count-1)*stride+elementBytes<=view.byteLength,`${label}: invalid bufferView range/stride`);
      for(let k=0;k<count;k++)for(let j=0;j<width;j++)values[k*width+j]=bin[read](start+k*stride+componentOffset(j));
    }else check(a.sparse&&offset===0,`${label}: missing bufferView or sparse data`);
    if(a.sparse){
      const sparse=a.sparse,n=integer(sparse.count,`${label}.sparse.count`,1),ic=componentTypes[sparse.indices?.componentType];
      check(n<=count&&[5121,5123,5125].includes(sparse.indices?.componentType),`${label}: invalid sparse count/index type`);
      const iv=ref(views,sparse.indices.bufferView,`${label}.sparse.indices`),vv=ref(views,sparse.values?.bufferView,`${label}.sparse.values`);
      const io=integer(sparse.indices.byteOffset??0,`${label}.sparse.indexOffset`),vo=integer(sparse.values.byteOffset??0,`${label}.sparse.valueOffset`);
      check(!iv.byteStride&&!vv.byteStride&&io+n*ic[0]<=iv.byteLength&&vo+n*elementBytes<=vv.byteLength,`${label}: sparse data outside bufferView`);
      check(((iv.byteOffset??0)+io)%ic[0]===0&&((vv.byteOffset??0)+vo)%cb===0,`${label}: sparse data unaligned`);
      let previous=-1;
      for(let k=0;k<n;k++){
        const index=bin[ic[1]]((iv.byteOffset??0)+io+k*ic[0]);check(index>previous&&index<count,`${label}: sparse index invalid`);previous=index;
        for(let j=0;j<width;j++)values[index*width+j]=bin[read]((vv.byteOffset??0)+vo+k*elementBytes+componentOffset(j));
      }
    }
    for(const value of values)check(Number.isFinite(value),`${label}: non-finite binary value`);
    for(const bound of ['min','max'])if(a[bound]!==undefined){
      check(list(a[bound],`${label}.${bound}`).length===width,`${label}: invalid bound dimensions`);
      for(let j=0;j<width;j++)for(let k=0;k<count;k++)check(bound==='min'?values[k*width+j]>=a.min[j]-1e-5:values[k*width+j]<=a.max[j]+1e-5,`${label}: data exceeds declared ${bound}`);
    }
    decoded.push({a,values,width,count});
  }
  let triangles=0,vertices=0,primitives=0,maxNormalError=0;
  const meshTriangles=[];
  for(const [i,mesh]of meshes.entries()){
    let meshCount=0;
    for(const [j,primitive]of list(mesh.primitives,`meshes[${i}].primitives`).entries()){
      const label=`mesh ${i} primitive ${j}`,attrs=primitive.attributes??{},p=ref(decoded,attrs.POSITION,`${label}.POSITION`),n=ref(decoded,attrs.NORMAL,`${label}.NORMAL`);
      check(p.a.type==='VEC3'&&p.a.componentType===5126&&p.a.min&&p.a.max,`${label}: POSITION must be float VEC3 with bounds`);
      check(n.a.type==='VEC3'&&n.a.componentType===5126&&n.count===p.count,`${label}: NORMAL must match POSITION`);
      for(let k=0;k<n.count;k++)maxNormalError=Math.max(maxNormalError,Math.abs(Math.hypot(...n.values.subarray(k*3,k*3+3))-1));
      check(maxNormalError<=.03,`${label}: normals are not near unit length`);
      for(const [semantic,index]of Object.entries(attrs))check(ref(decoded,index,`${label}.${semantic}`).count===p.count,`${label}: attribute count mismatch`);
      ref(materials,primitive.material,`${label}.material`);let count=p.count;
      if(primitive.indices!==undefined){
        const indices=ref(decoded,primitive.indices,`${label}.indices`);
        check(indices.a.type==='SCALAR'&&[5121,5123,5125].includes(indices.a.componentType)&&!indices.a.normalized,`${label}: invalid index accessor`);
        for(const index of indices.values)check(index<p.count,`${label}: vertex index outside POSITION`);count=indices.count;
      }
      check((primitive.mode??4)===4&&count%3===0,`${label}: expected complete triangle list`);
      meshCount+=count/3;vertices+=p.count;primitives++;
    }
    meshTriangles.push(meshCount);triangles+=meshCount;
  }
  check(triangles>0&&triangles<=25000,'Geometry: triangle count outside 1–25000 budget');
  const names=new Map(),parents=new Array(nodes.length).fill(-1),matrices=nodes.map((node,i)=>{
    check(typeof node.name==='string'&&node.name.trim()&&!names.has(node.name),`nodes[${i}]: missing or duplicate name`);names.set(node.name,i);
    check(node.skin===undefined,`nodes[${i}]: expected rigid equipment without skin`);
    if(node.mesh!==undefined)ref(meshes,node.mesh,`nodes[${i}].mesh`);
    for(const child of node.children??[]){ref(nodes,child,`nodes[${i}].child`);check(parents[child]===-1,`nodes[${child}]: multiple parents`);parents[child]=i;}
    const matrix=nodeMatrix(node,`nodes[${i}]`),det=matrix[0]*(matrix[5]*matrix[10]-matrix[6]*matrix[9])-matrix[4]*(matrix[1]*matrix[10]-matrix[2]*matrix[9])+matrix[8]*(matrix[1]*matrix[6]-matrix[2]*matrix[5]);
    check(Number.isFinite(det)&&Math.abs(det)>1e-9,`nodes[${i}]: singular transform`);return matrix;
  });
  const root=names.get(`WD_${id}_Asset`);check(root!==undefined,`Root: missing WD_${id}_Asset`);
  check(parents[root]===-1&&near(matrices[root],identity()),'Root pivot: expected identity transform at grip origin');
  const scene=ref(scenes,gltf.scene??0,'scene');check(list(scene.nodes,'scene.nodes').length===1&&scene.nodes[0]===root,'Scene: expected equipment root as sole scene root');
  const world=new Array(nodes.length),visiting=new Set();
  const worldMatrix=i=>{if(world[i])return world[i];check(!visiting.has(i),'Nodes: hierarchy cycle');visiting.add(i);world[i]=parents[i]<0?matrices[i]:multiply(worldMatrix(parents[i]),matrices[i]);visiting.delete(i);return world[i];};
  for(let i=0;i<nodes.length;i++)worldMatrix(i);
  const active=new Set(),visit=i=>{if(active.has(i))return;active.add(i);for(const child of nodes[i].children??[])visit(child);};visit(root);
  check(active.size===nodes.length,'Scene: detached nodes outside equipment root');
  const sockets={};
  for(const [name,index]of names)if(name.startsWith('Socket_')){
    check(nodes[index].mesh===undefined,`${name}: socket must be an empty transform`);
    check(near(world[index].slice(0,12),identity().slice(0,12)),`${name}: expected identity socket rotation/scale`);
    sockets[name]=world[index].slice(12,15);
  }
  const socket=(name,expected)=>check(sockets[name]&&near(sockets[name],expected),`${name}: expected GLB position ${JSON.stringify(expected)}`);
  socket(PRIMARY.has(id)?'Socket_Grip_Main':'Socket_Grip_Secondary',[0,0,0]);
  if(id==='maul')socket('Socket_Grip_Secondary',[0,-.22,0]);
  if(REACH[id])socket('Socket_Strike',[0,REACH[id],0]);
  if(id==='short'||id==='long')socket('Socket_DefenseCenter',[0,0,id==='short'?.06:.075]);
  if(!PRIMARY.has(id))check(!sockets.Socket_Grip_Main,'Secondary equipment must not expose a primary grip');
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};let triangleInstances=0,nearGrip=false;
  for(const i of active){
    if(nodes[i].mesh===undefined)continue;const mesh=meshes[nodes[i].mesh];triangleInstances+=meshTriangles[nodes[i].mesh];
    for(const primitive of mesh.primitives){
      const positions=decoded[primitive.attributes.POSITION];
      for(let k=0;k<positions.count;k++){
        const p=transform(world[i],positions.values.subarray(k*3,k*3+3));check(p.every(v=>Number.isFinite(v)&&Math.abs(v)<=3),'Geometry: non-finite or implausible metre-scale world vertex');
        nearGrip ||= Math.hypot(...p)<.12;
        for(let axis=0;axis<3;axis++){bounds.min[axis]=Math.min(bounds.min[axis],p[axis]);bounds.max[axis]=Math.max(bounds.max[axis],p[axis]);}
      }
    }
  }
  check(triangleInstances>0&&triangleInstances<=25000,'Scene: rendered triangle instances exceed 25000 budget');
  check(nearGrip,'Grip: no geometry near the claimed hand origin');bounds.size=bounds.max.map((v,i)=>v-bounds.min[i]);
  if(REACH[id])check(bounds.max[1]>=REACH[id]-.05&&bounds.max[1]<=REACH[id]+.08,'Geometry: visible reach disagrees with Socket_Strike');
  else check(bounds.max[2]>.04&&bounds.max[2]>Math.abs(bounds.min[2]),'Shield: front geometry must extend toward GLB +Z from the rear grip');
  check(images.length>0&&textures.length>0,'Textures: expected embedded base-color and normal images');
  const imageReport=images.map((image,i)=>{
    const label=`images[${i}]`;check(image.uri===undefined,`${label}: image URI dependency is forbidden`);
    const view=ref(views,image.bufferView,`${label}.bufferView`),start=view.byteOffset??0,[width,height]=imageSize(bin.subarray(start,start+view.byteLength),image.mimeType,label);
    check(width>0&&height>0&&width<=1024&&height<=1024,`${label}: texture dimensions exceed 1024 or are empty`);
    return {name:image.name??null,mimeType:image.mimeType,width,height,bytes:view.byteLength};
  });
  for(const [i,texture]of textures.entries()){
    ref(images,texture.source??texture.extensions?.EXT_texture_webp?.source,`textures[${i}].source`);
    if(texture.sampler!==undefined)ref(gltf.samplers??[],texture.sampler,`textures[${i}].sampler`);
  }
  let baseColorTextures=0,normalTextures=0;
  for(const [i,material]of materials.entries()){
    const pbr=material.pbrMetallicRoughness??{};
    check(typeof material.name==='string'&&material.name.trim(),`materials[${i}]: missing name`);
    for(const key of ['metallicFactor','roughnessFactor'])if(pbr[key]!==undefined)check(pbr[key]>=0&&pbr[key]<=1,`materials[${i}]: invalid ${key}`);
    if(pbr.baseColorFactor!==undefined)check(list(pbr.baseColorFactor,'baseColorFactor').length===4&&pbr.baseColorFactor.every(v=>v>=0&&v<=1),`materials[${i}]: invalid base color`);
    const walk=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value))if(key.endsWith('Texture')&&child)ref(textures,child.index,`materials[${i}].${key}`);else walk(child);};walk(material);
    if(pbr.baseColorTexture)baseColorTextures++;if(material.normalTexture)normalTextures++;
  }
  check(baseColorTextures>0&&normalTextures>0,'Materials: embedded base-color or normal texture was lost during export');
  return {ok:true,id,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),triangles,triangleInstances,vertices,primitives,
    meshes:meshes.length,nodes:nodes.length,materials:materials.length,materialNames:materials.map(m=>m.name),textures:textures.length,images:imageReport,
    baseColorTextures,normalTextures,maxNormalError,root:nodes[root].name,sockets,bounds,extensionsUsed:gltf.extensionsUsed??[]};
}

export async function validateWorkshopDirectory(directory=DEFAULT_DIRECTORY){
  const folder=path.resolve(directory),assets=[];let manifest=null,manifestError=null;
  try{manifest=JSON.parse(await readFile(path.join(folder,'asset-contract.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')manifestError=error.message;}
  for(const id of IDS){
    try{
      const result=validateGlbBuffer(await readFile(path.join(folder,`${id}.glb`)),id);
      if(manifest){
        const claim=manifest.assets?.find(asset=>asset.id===id);check(claim,`Manifest: missing ${id}`);
        check(claim.file===`${id}.glb`&&claim.bytes===result.bytes&&claim.triangles===result.triangles,`Manifest: file/bytes/triangles disagree for ${id}`);
        if(claim.sha256)check(claim.sha256===result.sha256,`Manifest: SHA-256 disagrees for ${id}`);
        for(const claimed of claim.sockets??[])check(result.sockets[claimed.name]&&near(result.sockets[claimed.name],claimed.position_glb),`Manifest: socket ${claimed.name} transform disagrees`);
        if(claim.source_bounds){
          const {min,max}=claim.source_bounds,convertedMin=[min[0],min[2],-max[1]],convertedMax=[max[0],max[2],-min[1]];
          check(near(result.bounds.min,convertedMin,.003)&&near(result.bounds.max,convertedMax,.003),`Manifest: source-to-GLB bounds conversion disagrees for ${id}`);
        }
      }
      assets.push(result);
    }catch(error){assets.push({ok:false,id,file:`${id}.glb`,error:error.message});}
  }
  const result={ok:!manifestError&&assets.every(asset=>asset.ok),validator:'native-node-workshop-glb-v1',validatedAt:new Date().toISOString(),
    directory:folder,budgets:{trianglesPerAsset:25000,materialsPerAsset:14,textureDimension:1024},manifestChecked:!!manifest,...(manifestError?{manifestError}:{}),assets};
  await writeFile(path.join(folder,'validation.json'),JSON.stringify(result,null,2)+'\n');return result;
}

function selfTest(){
  assert.equal(typeof validateGlbBuffer,'function','the standalone GLB validator must exist');
  const encode=(json,bin)=>{
    const source=Buffer.from(JSON.stringify(json)),jsonChunk=Buffer.alloc(Math.ceil(source.length/4)*4,0x20);source.copy(jsonChunk);
    const binary=Buffer.alloc(Math.ceil(bin.length/4)*4);bin.copy(binary);
    const result=Buffer.alloc(12+8+jsonChunk.length+8+binary.length);
    result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);
    result.writeUInt32LE(jsonChunk.length,12);result.writeUInt32LE(0x4e4f534a,16);jsonChunk.copy(result,20);
    result.writeUInt32LE(binary.length,20+jsonChunk.length);result.writeUInt32LE(0x004e4942,24+jsonChunk.length);binary.copy(result,28+jsonChunk.length);
    return result;
  };
  const fixture=(id='sword')=>{
    const reach={sword:1.02,spear:1.35,axe:.92,maul:1.08,knife:.42}[id],shield=id==='short'||id==='long';
    const positions=shield?[0,0,.03,.1,0,.03,0,.3,.12]:[0,0,0,.04,0,0,0,reach,0];
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
    const bin=Buffer.concat([Buffer.alloc(80),png]);positions.forEach((v,i)=>bin.writeFloatLE(v,i*4));
    [0,0,1,0,0,1,0,0,1].forEach((v,i)=>bin.writeFloatLE(v,36+i*4));[0,1,2].forEach((v,i)=>bin.writeUInt16LE(v,72+i*2));
    const nodes=[{name:`WD_${id}_Asset`,children:[1,2]},{name:'Geometry',mesh:0},
      {name:shield||id==='knife'?'Socket_Grip_Secondary':'Socket_Grip_Main'}];
    if(reach){nodes[0].children.push(nodes.length);nodes.push({name:'Socket_Strike',translation:[0,reach,0]});}
    if(id==='maul'){nodes[0].children.push(nodes.length);nodes.push({name:'Socket_Grip_Secondary',translation:[0,-.22,0]});}
    if(shield){nodes[0].children.push(nodes.length);nodes.push({name:'Socket_DefenseCenter',translation:[0,0,id==='short'?.06:.075]});}
    const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes,meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]}],
      materials:[{name:'Steel',pbrMetallicRoughness:{metallicFactor:.9,roughnessFactor:.3,baseColorTexture:{index:0}},normalTexture:{index:0}}],buffers:[{byteLength:bin.length}],
      images:[{bufferView:3,mimeType:'image/png'}],textures:[{source:0}],
      bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36},{buffer:0,byteOffset:72,byteLength:6},{buffer:0,byteOffset:80,byteLength:png.length}],
      accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:shield?[.1,.3,.12]:[.04,reach,0]},
        {bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5123,count:3,type:'SCALAR'}]};
    return {json,bin};
  };
  let cases=0;
  for(const id of ['sword','spear','axe','maul','short','long','knife']){
    const {json,bin}=fixture(id),result=validateGlbBuffer(encode(json,bin),id);
    assert.equal(result.triangles,1);assert.equal(result.materials,1);cases++;
  }
  const rejects=(change,pattern,id='sword')=>{
    const {json,bin}=fixture(id);change(json,bin);
    assert.throws(()=>validateGlbBuffer(encode(json,bin),id),pattern);cases++;
  };
  rejects(json=>json.buffers[0].uri='remote.bin',/URI|embedded/i);
  rejects((_json,bin)=>bin.writeFloatLE(NaN,0),/finite/i);
  rejects(json=>json.nodes[0].translation=[.1,0,0],/root.*identity/i);
  rejects(json=>json.nodes.find(n=>n.name==='Socket_Strike').translation=[0,.9,0],/Socket_Strike/i);
  rejects(json=>json.nodes.find(n=>n.name==='Socket_Grip_Secondary').translation=[0,.22,0],/Socket_Grip_Secondary/i,'maul');
  rejects((_json,bin)=>bin.writeFloatLE(0,44),/normal/i);
  rejects((_json,bin)=>bin.writeUInt16LE(3,76),/index/i);
  rejects(json=>json.materials=Array.from({length:15},()=>({name:'Material'})),/material/i);
  rejects(json=>json.nodes[1].children=[0],/cycle|parent|root/i);
  rejects((_json,bin)=>bin.writeUInt32BE(2048,96),/dimensions/i);
  rejects(json=>json.images[0].uri='https://example.invalid/image.png',/URI/i);
  rejects(json=>delete json.materials[0].normalTexture,/normal texture/i);
  rejects(json=>{
    // An extra instance must not bypass the per-asset rendered triangle budget.
    const children=json.nodes[0].children;
    for(let i=0;i<25000;i++){children.push(json.nodes.length);json.nodes.push({name:`Instance_${i}`,mesh:0});}
  },/triangle.*budget/i);
  rejects(json=>json.accessors[0].count=4,/range|stride|bufferView/i);
  rejects(json=>json.bufferViews[0].byteStride=2,/stride/i);
  rejects(json=>json.nodes[0].children.push(1),/parents/i);
  rejects(json=>json.nodes[2].rotation=[0,0,0,2],/quaternion/i);
  const invalid=encode(fixture().json,fixture().bin);invalid.writeUInt32LE(1,4);
  assert.throws(()=>validateGlbBuffer(invalid,'sword'),/version/i);cases++;
  console.log(JSON.stringify({ok:true,selfTestCases:cases}));
}

if(path.resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.includes('--self-test'))selfTest();
    else{
      const result=await validateWorkshopDirectory(process.argv[2]);
      console.log(JSON.stringify({ok:result.ok,report:path.join(result.directory,'validation.json'),assets:result.assets.map(({id,ok,triangles,bytes,error})=>({id,ok,triangles,bytes,error}))},null,2));
      if(!result.ok)process.exitCode=1;
    }
  }catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
