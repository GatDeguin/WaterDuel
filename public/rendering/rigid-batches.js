// Startup-only rigid character batching. Vertices stay bone-local; this helper
// never changes a bind frame, computes normals, drops detail or welds UV seams.
const ATTRIBUTES=Object.freeze([['positions',3],['normals',3],['uv',2],['uv1',2],['colors',4],['joints',4],['weights',4],['tangents',4]]);
const IDENTITY_FIELDS=new Set(['nodeName','nodeIndex','meshIndex','primitiveIndex','sourceNames','sourcePartIndices','bounds','indices',...ATTRIBUTES.map(([name])=>name)]);
function scalarKey(value){
 if(value===undefined)return ['undefined'];if(value===null)return ['null'];
 if(typeof value==='number')return Number.isFinite(value)?['number',Object.is(value,-0)?'-0':String(value)]:null;
 if(typeof value==='string'||typeof value==='boolean')return [typeof value,value];
 if(Array.isArray(value)||ArrayBuffer.isView(value)){
  const items=Array.from(value,scalarKey);return items.some(v=>v===null)?null:[value.constructor.name,items];
 }
 if(typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
  const items=[];for(const key of Object.keys(value).sort()){const v=scalarKey(value[key]);if(v===null)return null;items.push([key,v]);}return ['object',items];
 }
 return null;
}
function validate(part){
 const count=part.positions?.length/3;
 if(!Number.isInteger(count)||count<0||!part.indices||part.indices.length%3)throw new RangeError('Invalid rigid vertex/index layout');
 for(const [name,width]of ATTRIBUTES)if(part[name]!=null&&part[name].length!==count*width)throw new RangeError(`Invalid rigid attribute layout: ${name}`);
 for(const index of part.indices)if(!Number.isInteger(index)||index<0||index>=count)throw new RangeError('Rigid index outside vertex buffer');
 return count;
}
function eligible(part,materials){
 const names=part.sourceNames??[part.nodeName];
 if(typeof part.boneName!=='string'||names.some(name=>/woven|cloth|fabric/i.test(name)))return false;
 const material=materials?.[part.material??0]??{};
 return String(material.alphaMode??'OPAQUE').toUpperCase()!=='BLEND'&&
  ![material.transmission,material.transmissionFactor,material.extensions?.KHR_materials_transmission?.transmissionFactor].some(v=>Number(v)>0);
}
function groupKey(part){
 const metadata={};for(const key of Object.keys(part))if(!IDENTITY_FIELDS.has(key))metadata[key]=part[key];
 const record=scalarKey(metadata);if(record===null)return null;
 const layout=ATTRIBUTES.map(([name,width])=>[name,width,part[name]==null?null:part[name].constructor.name]);
 return JSON.stringify([record,layout]);
}
function boundsOf(positions){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<positions.length;i++){
  const value=positions[i],axis=i%3;if(!Number.isFinite(value))throw new RangeError('Rigid positions must be finite');
  min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
 }
 if(!positions.length)min.fill(0),max.fill(0);
 return {min,max,space:'bone-local'};
}
function merge(entries){
 const first=entries[0].part,vertices=entries.reduce((sum,e)=>sum+e.vertices,0),indexCount=entries.reduce((sum,e)=>sum+e.part.indices.length,0);
 const out={...first,sourceNames:entries.flatMap(e=>e.part.sourceNames??[e.part.nodeName]),sourcePartIndices:entries.map(e=>e.index)};
 if(entries.length>1){
  for(const [name,width]of ATTRIBUTES)if(first[name]!=null){
   const target=new first[name].constructor(vertices*width);let offset=0;
   for(const {part}of entries){const source=part[name];if(target.set)target.set(source,offset);else for(let i=0;i<source.length;i++)target[offset+i]=source[i];offset+=source.length;}out[name]=target;
  }
  out.indices=new Uint32Array(indexCount);let vertex=0,index=0;
  for(const entry of entries){for(const value of entry.part.indices)out.indices[index++]=value+vertex;vertex+=entry.vertices;}
 }
 out.bounds=boundsOf(out.positions);return out;
}
export function batchRigidCharacter(prepared,materials=prepared?.asset?.materials){
 if(!Array.isArray(prepared?.parts))throw new TypeError('Prepared rigid character parts required');
 const groups=[],byKey=new Map();let triangles=0;
 for(let index=0;index<prepared.parts.length;index++){
  const part=prepared.parts[index],vertices=validate(part),entry={part,vertices,index};triangles+=part.indices.length/3;
  const key=eligible(part,materials)?groupKey(part):null;
  if(key!==null&&byKey.has(key))byKey.get(key).push(entry);
  else{const group=[entry];groups.push(group);if(key!==null)byKey.set(key,group);}
 }
 const parts=groups.map(merge);
 return {...prepared,parts,rigidBatchStats:{before:prepared.parts.length,after:parts.length,triangles,
  mergedGroups:groups.filter(g=>g.length>1).length,removedDrawsPerPass:prepared.parts.length-parts.length,
  scope:'Opaque/masked compatible rigid parts; bone-local attributes and all source triangles retained'}};
}
