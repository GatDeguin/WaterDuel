// Independent, dependency-free structural QA for the delivered character GLB.
// Usage: node scripts/validate-water-mannequin.mjs [path/to/character.glb]
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultFile=fileURLToPath(new URL('../public/assets/characters/water-mannequin/water-mannequin.glb',import.meta.url));
const file=path.resolve(process.argv[2]||defaultFile);
const requireThat=(condition,message)=>{if(!condition)throw new Error(message);};
const integer=(n,label,min=0)=>{requireThat(Number.isSafeInteger(n)&&n>=min,`${label}: invalid integer ${n}`);return n;};
const reference=(items,index,label)=>{integer(index,label);requireThat(index<items.length,`${label}: index ${index} outside ${items.length} entries`);return items[index];};
const array=(value,label)=>{requireThat(Array.isArray(value),`${label}: expected array`);return value;};
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const multiply=(a,b)=>Array.from({length:16},(_,n)=>{const r=n%4,c=Math.floor(n/4);let v=0;for(let k=0;k<4;k++)v+=a[k*4+r]*b[c*4+k];return v;});
const emptyBounds=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
const include=(bounds,p)=>{for(let j=0;j<3;j++){bounds.min[j]=Math.min(bounds.min[j],p[j]);bounds.max[j]=Math.max(bounds.max[j],p[j]);}};
const finishBounds=b=>Number.isFinite(b.min[0])?{min:b.min,max:b.max,size:b.max.map((v,i)=>v-b.min[i])}:null;
const transformed=(m,p)=>[0,1,2].map(r=>m[r]*p[0]+m[r+4]*p[1]+m[r+8]*p[2]+m[r+12]);

function finiteJSON(value,label='JSON'){
  if(typeof value==='number')requireThat(Number.isFinite(value),`${label}: non-finite number`);
  else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))finiteJSON(child,`${label}.${key}`);
}

function localMatrix(node,label){
  if(node.matrix){
    requireThat(!node.translation&&!node.rotation&&!node.scale,`${label}: matrix and TRS cannot coexist`);
    requireThat(array(node.matrix,`${label}.matrix`).length===16,`${label}: matrix must contain 16 numbers`);
    requireThat(node.matrix.every(Number.isFinite),`${label}: matrix must contain finite numbers`);
    requireThat(node.matrix[3]===0&&node.matrix[7]===0&&node.matrix[11]===0&&node.matrix[15]===1,`${label}: matrix must be affine`);
    return node.matrix;
  }
  const t=node.translation||[0,0,0],q=node.rotation||[0,0,0,1],s=node.scale||[1,1,1];
  requireThat(Array.isArray(t)&&Array.isArray(q)&&Array.isArray(s)&&t.length===3&&q.length===4&&s.length===3,`${label}: invalid TRS dimensions`);
  requireThat([...t,...q,...s].every(Number.isFinite),`${label}: TRS must contain finite numbers`);
  requireThat(Math.abs(Math.hypot(...q)-1)<1e-4,`${label}: quaternion is not normalized`);
  const [x,y,z,w]=q,x2=x+x,y2=y+y,z2=z+z;
  return [(1-y*y2-z*z2)*s[0],(x*y2+w*z2)*s[0],(x*z2-w*y2)*s[0],0,
    (x*y2-w*z2)*s[1],(1-x*x2-z*z2)*s[1],(y*z2+w*x2)*s[1],0,
    (x*z2+w*y2)*s[2],(y*z2-w*x2)*s[2],(1-x*x2-y*y2)*s[2],0,...t,1];
}

async function validate(){
  const bytes=await readFile(file);
  requireThat(bytes.length>=20,'GLB: file shorter than header and JSON chunk');
  requireThat(bytes.readUInt32LE(0)===0x46546c67,'GLB: invalid magic');
  requireThat(bytes.readUInt32LE(4)===2,'GLB: expected version 2');
  requireThat(bytes.readUInt32LE(8)===bytes.length,'GLB: declared length differs from file length');
  requireThat(bytes.length%4===0,'GLB: total length is not aligned to four bytes');
  const chunks=[];
  for(let offset=12;offset<bytes.length;){
    requireThat(offset+8<=bytes.length,'GLB: truncated chunk header');
    const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4),start=offset+8;
    requireThat(length%4===0&&start+length<=bytes.length,'GLB: unaligned or overflowing chunk');
    chunks.push({type,length,start,data:bytes.subarray(start,start+length)});offset=start+length;
  }
  requireThat(chunks[0]?.type===0x4e4f534a,'GLB: first chunk must be JSON');
  requireThat(chunks.filter(c=>c.type===0x4e4f534a).length===1,'GLB: expected one JSON chunk');
  requireThat(chunks.filter(c=>c.type===0x004e4942).length===1,'GLB: expected one binary chunk');
  requireThat(chunks[1]?.type===0x004e4942,'GLB: binary chunk must immediately follow JSON');
  const gltf=JSON.parse(chunks[0].data.toString('utf8').trimEnd()),bin=chunks[1].data;
  finiteJSON(gltf);requireThat(gltf.asset?.version==='2.0','glTF: expected asset.version 2.0');
  const buffers=array(gltf.buffers,'buffers'),views=array(gltf.bufferViews,'bufferViews'),accessors=array(gltf.accessors,'accessors');
  const meshes=array(gltf.meshes,'meshes'),nodes=array(gltf.nodes,'nodes'),materials=array(gltf.materials,'materials');
  const skins=array(gltf.skins,'skins'),textures=gltf.textures||[],images=gltf.images||[],scenes=array(gltf.scenes,'scenes');
  requireThat(buffers.length===1&&!buffers[0].uri,'GLB: expected one embedded buffer without URI');
  const bufferLength=integer(buffers[0].byteLength,'buffer.byteLength',1);
  requireThat(bufferLength<=bin.length&&bin.length-bufferLength<=3,'GLB: BIN length differs from buffer plus allowed padding');
  for(let i=0;i<views.length;i++){
    const view=views[i],label=`bufferViews[${i}]`;
    requireThat(view.buffer===0,`${label}: expected embedded buffer 0`);
    const start=integer(view.byteOffset??0,`${label}.byteOffset`),length=integer(view.byteLength,`${label}.byteLength`,1);
    requireThat(start+length<=bufferLength,`${label}: exceeds embedded buffer`);
    if(view.byteStride!==undefined){integer(view.byteStride,`${label}.byteStride`,4);requireThat(view.byteStride<=252&&view.byteStride%4===0,`${label}: invalid byteStride`);}
    if(view.target!==undefined)requireThat([34962,34963].includes(view.target),`${label}: invalid target`);
  }
  const components={5120:{bytes:1,read:'readInt8'},5121:{bytes:1,read:'readUInt8'},5122:{bytes:2,read:'readInt16LE'},5123:{bytes:2,read:'readUInt16LE'},5125:{bytes:4,read:'readUInt32LE'},5126:{bytes:4,read:'readFloatLE'}};
  const dimensions={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  const decoded=[];
  for(let i=0;i<accessors.length;i++){
    const a=accessors[i],label=`accessors[${i}]`,component=components[a.componentType],width=dimensions[a.type];
    requireThat(component&&width,`${label}: unsupported componentType or type`);
    const count=integer(a.count,`${label}.count`,1),offset=integer(a.byteOffset??0,`${label}.byteOffset`),cb=component.bytes;
    if(a.normalized)requireThat([5120,5121,5122,5123].includes(a.componentType),`${label}: only 8/16-bit integers may be normalized`);
    requireThat(count*width<=50_000_000,`${label}: excessive decoded value count`);
    requireThat(offset%cb===0,`${label}: unaligned byteOffset`);
    const columns=a.type.startsWith('MAT')?Number(a.type.slice(3)):1,rows=width/columns;
    const columnBytes=columns>1?Math.ceil(rows*cb/4)*4:rows*cb,elementBytes=columnBytes*columns;
    const componentOffset=j=>Math.floor(j/rows)*columnBytes+(j%rows)*cb;
    const values=new Float64Array(count*width);
    if(a.bufferView!==undefined){
      const view=reference(views,a.bufferView,`${label}.bufferView`),stride=view.byteStride||elementBytes,start=(view.byteOffset||0)+offset;
      requireThat(start%cb===0&&stride>=elementBytes&&stride%cb===0,`${label}: invalid alignment or stride`);
      requireThat(offset+(count-1)*stride+elementBytes<=view.byteLength,`${label}: exceeds bufferView`);
      for(let k=0;k<count;k++)for(let j=0;j<width;j++)values[k*width+j]=bin[component.read](start+k*stride+componentOffset(j));
    }else requireThat(offset===0,`${label}: byteOffset requires bufferView`);
    if(a.sparse){
      const sparse=a.sparse,n=integer(sparse.count,`${label}.sparse.count`,1),ic=components[sparse.indices?.componentType];
      requireThat(n<=count&&[5121,5123,5125].includes(sparse.indices?.componentType),`${label}: invalid sparse count or index type`);
      const iv=reference(views,sparse.indices.bufferView,`${label}.sparse.indices.bufferView`),vv=reference(views,sparse.values.bufferView,`${label}.sparse.values.bufferView`);
      const io=integer(sparse.indices.byteOffset??0,`${label}.sparse.indices.byteOffset`),vo=integer(sparse.values.byteOffset??0,`${label}.sparse.values.byteOffset`);
      requireThat(!iv.byteStride&&!vv.byteStride&&io+n*ic.bytes<=iv.byteLength&&vo+n*elementBytes<=vv.byteLength,`${label}: sparse data exceeds bufferView`);
      requireThat(((iv.byteOffset||0)+io)%ic.bytes===0&&((vv.byteOffset||0)+vo)%cb===0,`${label}: sparse data unaligned`);
      let previous=-1;
      for(let k=0;k<n;k++){
        const index=bin[ic.read]((iv.byteOffset||0)+io+k*ic.bytes);
        requireThat(index>previous&&index<count,`${label}: sparse indices must increase and remain in range`);previous=index;
        for(let j=0;j<width;j++)values[index*width+j]=bin[component.read]((vv.byteOffset||0)+vo+k*elementBytes+componentOffset(j));
      }
    }
    for(const value of values)requireThat(Number.isFinite(value),`${label}: non-finite binary value`);
    for(const bound of ['min','max'])if(a[bound]){
      requireThat(a[bound].length===width,`${label}.${bound}: wrong dimensions`);
      for(let j=0;j<width;j++)for(let k=0;k<count;k++)requireThat(bound==='min'?values[k*width+j]>=a.min[j]-1e-5:values[k*width+j]<=a.max[j]+1e-5,`${label}: data exceeds declared ${bound}`);
    }
    decoded.push({accessor:a,values,width,count});
  }
  let triangles=0,vertices=0,primitives=0;
  for(let i=0;i<meshes.length;i++){
    const mesh=meshes[i];
    for(const [j,primitive]of array(mesh.primitives,`meshes[${i}].primitives`).entries()){
      const label=`mesh ${i} primitive ${j}`,attrs=primitive.attributes||{},p=reference(decoded,attrs.POSITION,`${label}.POSITION`),n=reference(decoded,attrs.NORMAL,`${label}.NORMAL`);
      requireThat(p.accessor.type==='VEC3'&&p.accessor.componentType===5126,`${label}: POSITION must be float VEC3`);
      requireThat(n.accessor.type==='VEC3'&&n.accessor.componentType===5126&&n.count===p.count,`${label}: NORMAL must match POSITION`);
      requireThat(p.accessor.min&&p.accessor.max,`${label}: POSITION requires bounds`);
      for(let k=0;k<n.count;k++)requireThat(Math.abs(Math.hypot(...n.values.subarray(k*3,k*3+3))-1)<.02,`${label}: invalid normal length`);
      for(const [semantic,index]of Object.entries(attrs))requireThat(reference(decoded,index,`${label}.${semantic}`).count===p.count,`${label}: attribute count mismatch`);
      reference(materials,primitive.material,`${label}.material`);
      let count=p.count;
      if(primitive.indices!==undefined){
        const indices=reference(decoded,primitive.indices,`${label}.indices`);
        requireThat(indices.accessor.type==='SCALAR'&&[5121,5123,5125].includes(indices.accessor.componentType),`${label}: invalid index accessor`);
        for(const index of indices.values)requireThat(index<p.count,`${label}: vertex index outside POSITION`);count=indices.count;
      }
      requireThat((primitive.mode??4)===4&&count%3===0,`${label}: expected complete triangle list`);
      triangles+=count/3;vertices+=p.count;primitives++;
    }
  }
  requireThat(triangles>0,'Geometry: empty character');
  const names=new Set(),parents=new Array(nodes.length).fill(-1),matrices=nodes.map((node,i)=>{
    requireThat(typeof node.name==='string'&&node.name.trim().length>0,`nodes[${i}]: missing readable name`);
    requireThat(!names.has(node.name),`nodes[${i}]: duplicate name ${node.name}`);names.add(node.name);
    if(node.mesh!==undefined)reference(meshes,node.mesh,`nodes[${i}].mesh`);
    for(const child of node.children||[]){reference(nodes,child,`nodes[${i}].child`);requireThat(parents[child]===-1,`nodes[${child}]: multiple parents`);parents[child]=i;}
    return localMatrix(node,`nodes[${i}]`);
  });
  for(const required of ['Balloon_Latex','Water_Contained','WD_Mannequin_Rig'])requireThat(names.has(required),`Character: missing node ${required}`);
  requireThat(skins.some(skin=>skin.joints?.length>=14),'Character: requires a skin with at least 14 joints');
  for(const [i,skin]of skins.entries()){
    const joints=array(skin.joints,`skins[${i}].joints`);requireThat(new Set(joints).size===joints.length,`skins[${i}]: duplicate joints`);
    for(const joint of joints)reference(nodes,joint,`skins[${i}].joint`);
    if(skin.skeleton!==undefined)reference(nodes,skin.skeleton,`skins[${i}].skeleton`);
    if(skin.inverseBindMatrices!==undefined){const inverse=reference(decoded,skin.inverseBindMatrices,`skins[${i}].inverseBindMatrices`);requireThat(inverse.accessor.type==='MAT4'&&inverse.accessor.componentType===5126&&inverse.count===joints.length,`skins[${i}]: invalid inverse bind matrices`);}
  }
  let skinnedNodes=0;
  for(const [i,node]of nodes.entries())if(node.skin!==undefined){
    const skin=reference(skins,node.skin,`nodes[${i}].skin`),mesh=reference(meshes,node.mesh,`nodes[${i}].mesh`);skinnedNodes++;
    for(const primitive of mesh.primitives){
      const joints=reference(decoded,primitive.attributes.JOINTS_0,`nodes[${i}].JOINTS_0`),weights=reference(decoded,primitive.attributes.WEIGHTS_0,`nodes[${i}].WEIGHTS_0`);
      requireThat(joints.width===4&&weights.width===4&&joints.count===weights.count,`nodes[${i}]: invalid skin attributes`);
      requireThat([5121,5123].includes(joints.accessor.componentType)&&!joints.accessor.normalized,`nodes[${i}]: JOINTS_0 must use unsigned integers`);
      requireThat(weights.accessor.componentType===5126||([5121,5123].includes(weights.accessor.componentType)&&weights.accessor.normalized),`nodes[${i}]: invalid WEIGHTS_0 encoding`);
      requireThat(primitive.attributes.JOINTS_1===undefined&&primitive.attributes.WEIGHTS_1===undefined,`nodes[${i}]: this character QA expects four influences per vertex`);
      for(const joint of joints.values)requireThat(Number.isInteger(joint)&&joint>=0&&joint<skin.joints.length,`nodes[${i}]: joint index outside skin`);
      for(let k=0;k<weights.count;k++){
        const row=weights.values.subarray(k*4,k*4+4),divisor=weights.accessor.normalized?(weights.accessor.componentType===5121?255:65535):1;
        requireThat([...row].every(v=>v>=0)&&Math.abs([...row].reduce((s,v)=>s+v,0)/divisor-1)<.01,`nodes[${i}]: skin weights must sum to one`);
      }
    }
  }
  requireThat(skinnedNodes>0,'Character: skin is not attached to any mesh node');
  for(const [i,material]of materials.entries()){
    requireThat(typeof material.name==='string'&&material.name.trim(),`materials[${i}]: missing name`);
    requireThat(['OPAQUE','MASK','BLEND'].includes(material.alphaMode||'OPAQUE'),`materials[${i}]: invalid alphaMode`);
    if(material.pbrMetallicRoughness?.baseColorFactor){const color=material.pbrMetallicRoughness.baseColorFactor;requireThat(Array.isArray(color)&&color.length===4&&color.every(v=>Number.isFinite(v)&&v>=0&&v<=1),`materials[${i}]: invalid baseColorFactor`);}
    for(const factor of ['metallicFactor','roughnessFactor'])if(material.pbrMetallicRoughness?.[factor]!==undefined)requireThat(material.pbrMetallicRoughness[factor]>=0&&material.pbrMetallicRoughness[factor]<=1,`materials[${i}]: invalid ${factor}`);
    const walkTextures=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value))if(key.endsWith('Texture')&&child)reference(textures,child.index,`materials[${i}].${key}`);else walkTextures(child);};walkTextures(material);
  }
  for(const extension of ['KHR_materials_transmission','KHR_materials_ior'])requireThat(gltf.extensionsUsed?.includes(extension),`Character: missing ${extension}`);
  const transparentNodes={};
  for(const name of ['Balloon_Latex','Water_Contained']){
    const node=nodes.find(n=>n.name===name),mesh=reference(meshes,node.mesh,`${name}.mesh`);
    transparentNodes[name]=mesh.primitives.map(primitive=>{
      const m=materials[primitive.material],transmission=m.extensions?.KHR_materials_transmission?.transmissionFactor,ior=m.extensions?.KHR_materials_ior?.ior;
      requireThat(transmission>0&&transmission<=1,`${name}: material ${m.name} requires physical transmission`);
      requireThat(ior>1&&ior<=3,`${name}: material ${m.name} requires a plausible explicit IOR`);
      return {material:m.name,transmission,ior};
    });
  }
  for(const [i,texture]of textures.entries()){
    const source=texture.source??texture.extensions?.EXT_texture_webp?.source;
    reference(images,source,`textures[${i}].source`);
    if(texture.sampler!==undefined)reference(gltf.samplers||[],texture.sampler,`textures[${i}].sampler`);
  }
  for(const [i,image]of images.entries()){
    requireThat(!image.uri,`images[${i}]: expected embedded image`);reference(views,image.bufferView,`images[${i}].bufferView`);
    requireThat(['image/png','image/jpeg','image/webp'].includes(image.mimeType),`images[${i}]: unsupported mimeType`);
  }
  const world=new Array(nodes.length),visiting=new Set();
  const worldMatrix=i=>{if(world[i])return world[i];requireThat(!visiting.has(i),'Nodes: hierarchy cycle');visiting.add(i);world[i]=parents[i]<0?matrices[i]:multiply(worldMatrix(parents[i]),matrices[i]);visiting.delete(i);return world[i];};
  for(let i=0;i<nodes.length;i++)worldMatrix(i);
  const sceneIndex=gltf.scene??0,scene=reference(scenes,sceneIndex,'scene'),active=new Set();
  const visit=i=>{reference(nodes,i,'scene node');if(active.has(i))return;active.add(i);for(const child of nodes[i].children||[])visit(child);};
  for(const i of array(scene.nodes,'scene.nodes')){requireThat(parents[i]===-1,`scene node ${i}: root has parent`);visit(i);}
  for(const name of ['Balloon_Latex','Water_Contained','WD_Mannequin_Rig'])requireThat(active.has(nodes.findIndex(n=>n.name===name)),`${name}: not part of active scene`);
  const bounds=emptyBounds(),nodeBounds={};let triangleInstances=0;
  for(const i of active){
    const node=nodes[i];if(node.mesh===undefined)continue;
    const local=emptyBounds(),skin=node.skin===undefined?null:skins[node.skin];
    const jointMatrices=skin?.joints.map((joint,j)=>multiply(world[joint],skin.inverseBindMatrices===undefined?identity():decoded[skin.inverseBindMatrices].values.subarray(j*16,j*16+16)));
    for(const primitive of meshes[node.mesh].primitives){
      const positions=decoded[primitive.attributes.POSITION],joints=skin?decoded[primitive.attributes.JOINTS_0]:null,weights=skin?decoded[primitive.attributes.WEIGHTS_0]:null;
      for(let k=0;k<positions.count;k++){
        const vertex=positions.values.subarray(k*3,k*3+3);let p;
        if(skin){
          p=[0,0,0];const divisor=weights.accessor.normalized?(weights.accessor.componentType===5121?255:65535):1;
          for(let j=0;j<4;j++){const weight=weights.values[k*4+j]/divisor;if(!weight)continue;const v=transformed(jointMatrices[joints.values[k*4+j]],vertex);for(let r=0;r<3;r++)p[r]+=v[r]*weight;}
        }else p=transformed(world[i],vertex);
        requireThat(p.every(Number.isFinite),`${node.name}: non-finite world vertex`);include(local,p);include(bounds,p);
      }
    }
    nodeBounds[node.name]=finishBounds(local);
    for(const primitive of meshes[node.mesh].primitives)triangleInstances+=(primitive.indices===undefined?decoded[primitive.attributes.POSITION].count:decoded[primitive.indices].count)/3;
  }
  requireThat(finishBounds(bounds),'Scene: no visible mesh bounds');
  return {ok:true,file,bytes:bytes.length,chunks:chunks.map(({type,length})=>({type:type===0x4e4f534a?'JSON':type===0x004e4942?'BIN':type,length})),
    meshes:meshes.length,primitives,vertices,triangles,triangleInstances,nodes:nodes.length,materials:materials.length,skins:skins.length,joints:skins.map(s=>s.joints.length),skinnedNodes,textures:textures.length,images:images.length,
    bounds:{space:'glTF world, initial node and skin transforms; animations not evaluated',...finishBounds(bounds)},
    characterBounds:Object.fromEntries(['Balloon_Latex','Water_Contained'].map(name=>[name,nodeBounds[name]])),transparency:transparentNodes,
    materialNames:materials.map(m=>m.name),extensionsUsed:gltf.extensionsUsed||[]};
}

try{console.log(JSON.stringify(await validate(),null,2));}
catch(error){console.error(JSON.stringify({ok:false,file,error:error.message},null,2));process.exitCode=1;}
