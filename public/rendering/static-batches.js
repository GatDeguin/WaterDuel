// Startup-only opaque geometry batching. No decimation, texture baking or LOD.
const identity=()=>Float32Array.from([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const determinant=m=>m[0]*(m[5]*m[10]-m[6]*m[9])+m[1]*(m[6]*m[8]-m[4]*m[10])+m[2]*(m[4]*m[9]-m[5]*m[8]);
function transform(part,positions,normals,offset){
 const m=part.worldMatrix??identity(),d=determinant(m),n=[m[5]*m[10]-m[6]*m[9],m[6]*m[8]-m[4]*m[10],m[4]*m[9]-m[5]*m[8],m[9]*m[2]-m[10]*m[1],m[10]*m[0]-m[8]*m[2],m[8]*m[1]-m[9]*m[0],m[1]*m[6]-m[2]*m[5],m[2]*m[4]-m[0]*m[6],m[0]*m[5]-m[1]*m[4]];
 for(let v=0;v<part.positions.length;v+=3){
  const x=part.positions[v],y=part.positions[v+1],z=part.positions[v+2];
  for(let r=0;r<3;r++)positions[offset+v+r]=m[r]*x+m[4+r]*y+m[8+r]*z+m[12+r];
  const a=part.normals[v],b=part.normals[v+1],c=part.normals[v+2];let length=0;
  for(let r=0;r<3;r++){const value=(n[r]*a+n[3+r]*b+n[6+r]*c)/d;normals[offset+v+r]=value;length+=value*value;}
  length=Math.sqrt(length)||1;for(let r=0;r<3;r++)normals[offset+v+r]/=length;
 }
}
export function batchStaticAsset(asset,{dynamicNames=new Set()}={}){
 const groups=new Map(),passthrough=[];
 for(const p of asset.primitives){
  const material=asset.materials[p.material??0]??{},matrix=p.worldMatrix??identity();
  if(dynamicNames.has(p.nodeName)||material.alphaMode==='BLEND'||material.extensions?.KHR_materials_transmission?.transmissionFactor>0||!p.normals||determinant(matrix)<=1e-10){passthrough.push(p);continue;}
  const key=[p.material??0,!!p.uv,!!p.uv1,!!p.colors].join(':');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
 }
 const merged=[];
 for(const parts of groups.values()){
  if(parts.length===1){merged.push(parts[0]);continue;}
  const vertices=parts.reduce((s,p)=>s+p.positions.length/3,0),indices=parts.reduce((s,p)=>s+p.indices.length,0),first=parts[0];
  const p={nodeName:`Static batch ${first.material??0}`,material:first.material??0,worldMatrix:identity(),positions:new Float32Array(vertices*3),normals:new Float32Array(vertices*3),indices:new Uint32Array(indices)};
  for(const [field,size]of [['uv',2],['uv1',2],['colors',4]])if(first[field])p[field]=new Float32Array(vertices*size);
  let vertex=0,index=0;
  for(const part of parts){
   transform(part,p.positions,p.normals,vertex*3);
   for(const [field,size]of [['uv',2],['uv1',2],['colors',4]])if(p[field])p[field].set(part[field],vertex*size);
   for(let i=0;i<part.indices.length;i++)p.indices[index++]=vertex+part.indices[i];vertex+=part.positions.length/3;
  }merged.push(p);
 }
 return {...asset,primitives:[...merged,...passthrough],batchStats:{before:asset.primitives.length,after:merged.length+passthrough.length,triangles:asset.primitives.reduce((s,p)=>s+p.indices.length/3,0)}};
}
