// Local, GPU-independent GLB 2 reader. Matrices are glTF column-major; geometry
// remains in mesh-local space. No nodes/materials are silently filtered here.
const MAGIC=0x46546c67,JSON_CHUNK=0x4e4f534a,BIN_CHUNK=0x004e4942;
const MAX_BYTES=128*1024*1024,MAX_DECODED=256*1024*1024,MAX_ELEMENTS=4_000_000;
const COMPONENTS={5120:[1,'getInt8'],5121:[1,'getUint8'],5122:[2,'getInt16'],5123:[2,'getUint16'],5125:[4,'getUint32'],5126:[4,'getFloat32']};
const WIDTH={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
const MATERIAL_EXTENSIONS=new Set(['KHR_materials_clearcoat','KHR_materials_transmission','KHR_materials_volume','KHR_materials_ior','KHR_materials_sheen','KHR_materials_specular','KHR_materials_unlit','KHR_materials_emissive_strength']);
const fail=message=>{throw new Error(`GLB: ${message}`);};
const integer=(n,label,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(n)||n<min||n>max)fail(`${label} out of bounds`);return n;};
const finite=(n,label)=>{if(typeof n!=='number'||!Number.isFinite(n))fail(`${label} must be finite`);return n;};
function vector(value,length,fallback,label){
  if(value===undefined)return [...fallback];
  if(!Array.isArray(value)||value.length!==length)fail(`${label} invalid length`);
  return value.map(n=>finite(n,label));
}
const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function multiply(a,b){
  const out=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){
    const n=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
    out[c*4+r]=n;if(!Number.isFinite(out[c*4+r]))fail('world matrix must be finite');
  }
  return out;
}
function localMatrix(node){
  if(node.matrix!==undefined){
    if(node.translation!==undefined||node.rotation!==undefined||node.scale!==undefined)fail('node matrix cannot coexist with TRS');
    const matrix=new Float32Array(vector(node.matrix,16,[],'node matrix'));
    if(!matrix.every(Number.isFinite)||Math.abs(matrix[3])+Math.abs(matrix[7])+Math.abs(matrix[11])>1e-6||Math.abs(matrix[15]-1)>1e-6)fail('node matrix invalid');
    return matrix;
  }
  const t=vector(node.translation,3,[0,0,0],'translation'),s=vector(node.scale,3,[1,1,1],'scale');
  const q=vector(node.rotation,4,[0,0,0,1],'rotation'),norm=Math.hypot(...q);
  if(Math.abs(norm-1)>1e-4)fail('node rotation must be a unit quaternion');
  const [x,y,z,w]=q,x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
  const out=new Float32Array([(1-yy-zz)*s[0],(xy+wz)*s[0],(xz-wy)*s[0],0,
    (xy-wz)*s[1],(1-xx-zz)*s[1],(yz+wx)*s[1],0,
    (xz+wy)*s[2],(yz-wx)*s[2],(1-xx-yy)*s[2],0,...t,1]);
  if(!out.every(Number.isFinite))fail('node matrix must be finite');return out;
}

/** Parse owned typed arrays and embedded image bytes, without fetch/DOM/GPU. */
export function parseGLB(arrayBuffer){
  if(!(arrayBuffer instanceof ArrayBuffer))fail('input must be an ArrayBuffer');
  const size=arrayBuffer.byteLength;
  if(size<20||size>MAX_BYTES)fail('input length out of bounds');
  const data=new DataView(arrayBuffer);
  if(data.getUint32(0,true)!==MAGIC||data.getUint32(4,true)!==2||data.getUint32(8,true)!==size)fail('invalid header magic, version or length');
  let offset=12,jsonBytes=null,binBytes=null,chunkIndex=0;
  while(offset<size){
    if(offset+8>size)fail('truncated chunk header');
    const length=data.getUint32(offset,true),type=data.getUint32(offset+4,true);offset+=8;
    if(length%4||length>size-offset)fail('invalid chunk length');
    const bytes=new Uint8Array(arrayBuffer,offset,length);
    if(chunkIndex===0&&type!==JSON_CHUNK)fail('first chunk must be JSON');
    if(type===JSON_CHUNK){if(jsonBytes)fail('duplicate JSON chunk');jsonBytes=bytes;}
    if(type===BIN_CHUNK){if(binBytes)fail('duplicate BIN chunk');binBytes=bytes;}
    offset+=length;chunkIndex++;
  }
  if(!jsonBytes)fail('missing JSON chunk');
  let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(jsonBytes));}catch{fail('invalid JSON encoding/content');}
  if(!json||typeof json!=='object'||json.asset?.version!=='2.0'||(json.asset.minVersion&&json.asset.minVersion!=='2.0'))fail('unsupported asset version');
  for(const name of json.extensionsRequired??[])if(!MATERIAL_EXTENSIONS.has(name))fail(`required extension unsupported: ${name}`);
  const list=(key)=>{const a=json[key]??[];if(!Array.isArray(a)||a.length>100_000||a.some(value=>!value||typeof value!=='object'||Array.isArray(value)))fail(`${key} invalid object array`);return a;};
  const buffers=list('buffers'),views=list('bufferViews'),accessors=list('accessors'),rawNodes=list('nodes'),rawMeshes=list('meshes'),rawSkins=list('skins');
  if(buffers.length>1)fail('only one embedded buffer is supported');
  for(const buffer of buffers){
    if(buffer.uri!==undefined)fail('buffer URI unsupported; embedded data only');
    integer(buffer.byteLength,'buffer byteLength',0,MAX_BYTES);
    if(buffer.byteLength>(binBytes?.byteLength??0)||((binBytes?.byteLength??0)-buffer.byteLength)>3)fail('BIN buffer length mismatch');
  }
  if(!buffers.length&&binBytes?.byteLength)fail('BIN chunk has no buffer declaration');
  const bin=new DataView(binBytes?.buffer??new ArrayBuffer(0),binBytes?.byteOffset??0,binBytes?.byteLength??0);
  for(const view of views){
    if(integer(view.buffer,'bufferView.buffer')!==0||!buffers[0])fail('bufferView buffer missing');
    const start=integer(view.byteOffset??0,'bufferView byteOffset'),length=integer(view.byteLength,'bufferView byteLength',0,MAX_BYTES);
    if(start>buffers[0].byteLength||length>buffers[0].byteLength-start)fail('bufferView range exceeds buffer');
    if(view.byteStride!==undefined){integer(view.byteStride,'bufferView byteStride',4,252);if(view.byteStride%4)fail('bufferView byteStride must be a multiple of four');}
  }
  let decodedBytes=0;
  function allocate(Type,length){
    integer(length,'decoded element count',0,MAX_ELEMENTS*16);
    const bytes=length*Type.BYTES_PER_ELEMENT;
    if(bytes>MAX_DECODED-decodedBytes)fail('decoded allocation budget exceeded');
    decodedBytes+=bytes;return new Type(length);
  }
  // Validate all accessor ranges before any accessor allocation.
  const descriptors=accessors.map((a,index)=>{
    if(a.sparse!==undefined)fail(`sparse accessor unsupported: ${index}`);
    const info=COMPONENTS[a.componentType],width=WIDTH[a.type];
    if(!info||!width)fail(`accessor ${index} component/type unsupported`);
    const count=integer(a.count,`accessor ${index} count`,1,MAX_ELEMENTS),view=views[integer(a.bufferView,`accessor ${index} bufferView`,0,views.length-1)];
    const [componentBytes,method]=info,elementBytes=componentBytes*width,start=integer(a.byteOffset??0,'accessor byteOffset');
    const stride=view.byteStride??elementBytes;
    if(stride<elementBytes||stride%componentBytes||start%componentBytes||(view.byteOffset??0)%componentBytes)fail(`accessor ${index} stride/alignment invalid`);
    if(start>view.byteLength||elementBytes>view.byteLength-start||(count-1)*stride>view.byteLength-start-elementBytes)fail(`accessor ${index} range exceeds bufferView`);
    if(a.normalized!==undefined&&typeof a.normalized!=='boolean')fail('accessor normalized must be boolean');
    if(a.normalized&&![5120,5121,5122,5123].includes(a.componentType))fail('accessor normalized component unsupported');
    for(const key of ['min','max'])if(a[key]!==undefined)vector(a[key],width,[],`accessor ${key}`);
    if(a.min&&a.max&&a.min.some((value,i)=>value>a.max[i]))fail(`accessor ${index} bounds min exceeds max`);
    return {count,width,stride,start:(view.byteOffset??0)+start,method,componentBytes,componentType:a.componentType,normalized:!!a.normalized,type:a.type};
  });
  const accessorCache=new Map();
  function read(index,kind='float',type=null){
    integer(index,'accessor index',0,descriptors.length-1);const d=descriptors[index];
    if(type&&d.type!==type)fail(`accessor type expected ${type}`);
    if(kind!=='float'&&(d.normalized||![5121,5123,5125].includes(d.componentType)))fail('integer accessor must use unsigned non-normalized components');
    if(kind==='joints'&&d.componentType===5125)fail('JOINTS must be UNSIGNED_BYTE or UNSIGNED_SHORT');
    const key=`${index}:${kind}`;if(accessorCache.has(key))return accessorCache.get(key);
    const out=allocate(kind==='indices'?Uint32Array:kind==='joints'?Uint16Array:Float32Array,d.count*d.width);
    for(let i=0;i<d.count;i++)for(let c=0;c<d.width;c++){
      let value=bin[d.method](d.start+i*d.stride+c*d.componentBytes,true);
      if(d.normalized){
        if(d.componentType===5120)value=Math.max(value/127,-1);
        if(d.componentType===5121)value/=255;
        if(d.componentType===5122)value=Math.max(value/32767,-1);
        if(d.componentType===5123)value/=65535;
      }
      out[i*d.width+c]=value;if(!Number.isFinite(out[i*d.width+c]))fail(`accessor ${index} must be finite`);
    }
    accessorCache.set(key,out);return out;
  }
  const nodeCount=rawNodes.length,parents=new Int32Array(nodeCount).fill(-1);
  const nodes=rawNodes.map((node,index)=>{
    const children=node.children??[];if(!Array.isArray(children))fail('node children invalid');
    for(const child of children){integer(child,'node child',0,nodeCount-1);if(parents[child]!==-1)fail('node has multiple parents');parents[child]=index;}
    return {name:node.name??`Node_${index}`,nodeIndex:index,parentIndex:-1,children:[...children],localMatrix:localMatrix(node),worldMatrix:null,
      meshIndex:node.mesh===undefined?null:integer(node.mesh,'node mesh',0,rawMeshes.length-1),skinIndex:node.skin===undefined?null:integer(node.skin,'node skin',0,rawSkins.length-1),extras:node.extras??null};
  });
  const roots=[];
  for(let i=0;i<nodes.length;i++){nodes[i].parentIndex=parents[i];if(parents[i]===-1)roots.push(i);}
  const queue=[...roots];
  for(let cursor=0;cursor<queue.length;cursor++){
    const index=queue[cursor],node=nodes[index];
    node.worldMatrix=node.parentIndex<0?node.localMatrix.slice():multiply(nodes[node.parentIndex].worldMatrix,node.localMatrix);
    queue.push(...node.children);
  }
  if(queue.length!==nodes.length)fail('node hierarchy cycle');
  const skins=rawSkins.map((skin,index)=>{
    if(!Array.isArray(skin.joints)||!skin.joints.length||new Set(skin.joints).size!==skin.joints.length)fail(`skin ${index} invalid joints`);
    const joints=skin.joints.map(j=>integer(j,'skin joint',0,nodes.length-1));
    let inverseBindMatrices;
    if(skin.inverseBindMatrices!==undefined){
      const descriptor=descriptors[integer(skin.inverseBindMatrices,'inverseBindMatrices accessor',0,descriptors.length-1)];
      if(descriptor.type!=='MAT4'||descriptor.componentType!==5126)fail('inverseBindMatrices must be FLOAT MAT4');
      inverseBindMatrices=read(skin.inverseBindMatrices,'float','MAT4');
      if(inverseBindMatrices.length<joints.length*16)fail('skin inverseBindMatrices count mismatch');
      inverseBindMatrices=inverseBindMatrices.subarray(0,joints.length*16);
      for(let i=0;i<inverseBindMatrices.length;i+=16)if(Math.abs(inverseBindMatrices[i+3])+Math.abs(inverseBindMatrices[i+7])+Math.abs(inverseBindMatrices[i+11])>1e-6||Math.abs(inverseBindMatrices[i+15]-1)>1e-6)fail('inverseBindMatrices fourth row must be affine');
    }else{inverseBindMatrices=allocate(Float32Array,joints.length*16);for(let i=0;i<joints.length;i++)inverseBindMatrices.set(identity(),i*16);}
    return {name:skin.name??`Skin_${index}`,joints,inverseBindMatrices,skeleton:skin.skeleton===undefined?null:integer(skin.skeleton,'skin skeleton',0,nodes.length-1)};
  });
  const images=list('images').map(image=>{
    if(image.uri!==undefined)fail('image URI unsupported; embedded images only');
    const view=views[integer(image.bufferView,'image bufferView',0,views.length-1)];
    if(!['image/png','image/jpeg'].includes(image.mimeType))fail('embedded image MIME unsupported');
    const bytes=allocate(Uint8Array,view.byteLength);bytes.set(new Uint8Array(bin.buffer,bin.byteOffset+(view.byteOffset??0),view.byteLength));
    return {name:image.name??'',bytes,mimeType:image.mimeType};
  });
  const samplers=list('samplers').map(s=>{
    const mag=s.magFilter??9729,min=s.minFilter??9987,wrapS=s.wrapS??10497,wrapT=s.wrapT??10497;
    if(![9728,9729].includes(mag)||![9728,9729,9984,9985,9986,9987].includes(min)||![33071,33648,10497].includes(wrapS)||![33071,33648,10497].includes(wrapT))fail('sampler enum unsupported');
    return {magFilter:mag,minFilter:min,wrapS,wrapT};
  });
  const textures=list('textures').map(texture=>({source:integer(texture.source,'texture source',0,images.length-1),sampler:texture.sampler===undefined?null:integer(texture.sampler,'texture sampler',0,samplers.length-1)}));
  function textureInfo(info,extra={}){
    if(info===undefined)return null;
    return {index:integer(info.index,'material texture index',0,textures.length-1),texCoord:integer(info.texCoord??0,'texture texCoord',0,1),extensions:info.extensions??{},...extra};
  }
  function material(source={}){
    const p=source.pbrMetallicRoughness??{},baseColorFactor=vector(p.baseColorFactor,4,[1,1,1,1],'baseColorFactor');
    const metallicFactor=finite(p.metallicFactor??1,'metallicFactor'),roughnessFactor=finite(p.roughnessFactor??1,'roughnessFactor');
    if([...baseColorFactor,metallicFactor,roughnessFactor].some(n=>n<0||n>1))fail('PBR factor outside [0,1]');
    const baseColorTexture=textureInfo(p.baseColorTexture),metallicRoughnessTexture=textureInfo(p.metallicRoughnessTexture);
    const alphaMode=source.alphaMode??'OPAQUE';if(!['OPAQUE','MASK','BLEND'].includes(alphaMode))fail('material alphaMode unsupported');
    return {name:source.name??'',baseColorFactor,metallicFactor,roughnessFactor,baseColorTexture,metallicRoughnessTexture,
      pbrMetallicRoughness:{baseColorFactor,metallicFactor,roughnessFactor,baseColorTexture,metallicRoughnessTexture},
      normalTexture:textureInfo(source.normalTexture,{scale:finite(source.normalTexture?.scale??1,'normal scale')}),
      occlusionTexture:textureInfo(source.occlusionTexture,{strength:finite(source.occlusionTexture?.strength??1,'occlusion strength')}),
      emissiveTexture:textureInfo(source.emissiveTexture),emissiveFactor:vector(source.emissiveFactor,3,[0,0,0],'emissiveFactor'),
      alphaMode,alphaCutoff:finite(source.alphaCutoff??.5,'alphaCutoff'),doubleSided:!!source.doubleSided,extensions:source.extensions??{}};
  }
  const materials=list('materials').map(material),defaultMaterial=material();
  const scenes=list('scenes');let activeRoots=roots;
  if(scenes.length){const scene=scenes[integer(json.scene??0,'default scene',0,scenes.length-1)];if(!Array.isArray(scene.nodes??[]))fail('scene nodes invalid');activeRoots=scene.nodes??[];}
  const active=new Set(),activeQueue=[];
  for(const root of activeRoots){integer(root,'scene root',0,nodes.length-1);if(parents[root]!==-1)fail('scene root has parent');activeQueue.push(root);}
  for(let i=0;i<activeQueue.length;i++){const n=activeQueue[i];if(active.has(n))continue;active.add(n);activeQueue.push(...nodes[n].children);}
  const primitives=[],bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const nodeIndex of active){
    const node=nodes[nodeIndex];if(node.meshIndex===null)continue;
    const mesh=rawMeshes[node.meshIndex];if(!Array.isArray(mesh.primitives))fail('mesh primitives missing');
    for(let primitiveIndex=0;primitiveIndex<mesh.primitives.length;primitiveIndex++){
      const primitive=mesh.primitives[primitiveIndex],attributes=primitive.attributes??{};
      if((primitive.mode??4)!==4)fail('only TRIANGLES primitives supported');
      if(primitive.targets?.length)fail('morph targets unsupported');
      const positions=read(attributes.POSITION,'float','VEC3'),count=positions.length/3;
      const normals=attributes.NORMAL===undefined?null:read(attributes.NORMAL,'float','VEC3');
      const uv=attributes.TEXCOORD_0===undefined?null:read(attributes.TEXCOORD_0,'float','VEC2');
      const uv1=attributes.TEXCOORD_1===undefined?null:read(attributes.TEXCOORD_1,'float','VEC2');
      const joints=attributes.JOINTS_0===undefined?null:read(attributes.JOINTS_0,'joints','VEC4');
      const weights=attributes.WEIGHTS_0===undefined?null:read(attributes.WEIGHTS_0,'float','VEC4');
      let colors=null;
      if(attributes.COLOR_0!==undefined){
        const d=descriptors[integer(attributes.COLOR_0,'COLOR_0 accessor',0,descriptors.length-1)];
        if(!['VEC3','VEC4'].includes(d.type)||![5121,5123,5126].includes(d.componentType)||(d.componentType!==5126&&!d.normalized))fail('COLOR_0 component/type unsupported');
        if(d.count!==count)fail('COLOR_0 count mismatch');
        const raw=read(attributes.COLOR_0,'float');colors=allocate(Float32Array,count*4);
        for(let i=0;i<count;i++)for(let c=0;c<4;c++)colors[i*4+c]=c===3&&d.width===3?1:Math.max(0,Math.min(1,raw[i*d.width+c]));
      }
      for(const [attribute,array,width] of [['NORMAL',normals,3],['UV',uv,2],['UV1',uv1,2],['JOINTS',joints,4],['WEIGHTS',weights,4]])if(array&&array.length!==count*width)fail(`${attribute} count mismatch`);
      if(!!joints!==!!weights||((joints||weights)&&node.skinIndex===null)||(node.skinIndex!==null&&!joints))fail('skin JOINTS/WEIGHTS missing or inconsistent');
      if(joints){
        const skin=skins[node.skinIndex];for(let i=0;i<joints.length;i++)if(joints[i]>=skin.joints.length||weights[i]<0||weights[i]>1)fail('skin joint index or weight out of bounds');
      }
      let indices;
      if(primitive.indices===undefined){indices=allocate(Uint32Array,count);for(let i=0;i<count;i++)indices[i]=i;}
      else indices=read(primitive.indices,'indices','SCALAR');
      if(indices.length%3)fail('triangle index count must be multiple of three');
      for(const index of indices)if(index>=count)fail('primitive index exceeds vertex count');
      const materialIndex=primitive.material===undefined?-1:integer(primitive.material,'primitive material',0,materials.length-1),m=node.worldMatrix;
      for(let i=0;i<positions.length;i+=3)for(let c=0;c<3;c++){
        const value=m[c]*positions[i]+m[4+c]*positions[i+1]+m[8+c]*positions[i+2]+m[12+c];
        if(!Number.isFinite(value))fail('world bounds must be finite');bounds.min[c]=Math.min(bounds.min[c],value);bounds.max[c]=Math.max(bounds.max[c],value);
      }
      primitives.push({positions,normals,uv,uv1,indices,material:materialIndex,nodeName:node.name,nodeIndex,meshIndex:node.meshIndex,primitiveIndex,
        worldMatrix:node.worldMatrix,skinIndex:node.skinIndex,joints,weights,colors});
    }
  }
  return {json,images,textures,samplers,materials,defaultMaterial,primitives,nodes,worldMatrices:nodes.map(n=>n.worldMatrix),skins,
    bounds:primitives.length?bounds:null,decodedBytes,sourceBytes:size};
}

/** Fetch transport only; parsing owns no browser or renderer resources. */
export async function loadGLB(url,{fetchImpl=globalThis.fetch,signal}={}){
  if(typeof fetchImpl!=='function')fail('fetch implementation unavailable');
  const response=await fetchImpl(url,{signal});
  if(!response.ok)fail(`HTTP ${response.status} loading ${url}`);
  return parseGLB(await response.arrayBuffer());
}
