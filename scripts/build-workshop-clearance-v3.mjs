// Derive exact complete-component triangle selections from the final GLB.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parseGLB} from '../public/rendering/glb.js';
import {verifyCrossingClearance} from './verify-workshop-runtime-v3.mjs';
const root=new URL('../',import.meta.url),out=new URL('public/assets/environment/workshop/',root);
const read=async name=>JSON.parse(await readFile(new URL(name,out),'utf8'));
const write=async(name,data)=>writeFile(new URL(name,out),JSON.stringify(data,null,2)+'\n');
const bytes=await readFile(new URL('workshop-runtime-v3.glb',out));
const parsed=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const evidence=await read('selection-evidence-v3.json'),contract=await read('asset-contract-v3.json');
const key=p=>p.map(v=>Math.round(v/1e-5)).join(',');
const point=(p,i)=>[0,1,2].map(j=>p.worldMatrix[j]*p.positions[i*3]+p.worldMatrix[4+j]*p.positions[i*3+1]+p.worldMatrix[8+j]*p.positions[i*3+2]+p.worldMatrix[12+j]);
const empty=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
const include=(b,p)=>p.forEach((v,i)=>{b.min[i]=Math.min(b.min[i],v);b.max[i]=Math.max(b.max[i],v);});
const byNode=new Map();
for(const primitive of parsed.primitives){
 assert(!byNode.has(primitive.nodeName),'One primitive per node required');
 const n=primitive.indices.length/3,parent=Array.from({length:n},(_,i)=>i),vertices=new Map();
 const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const positions=Array.from({length:primitive.positions.length/3},(_,i)=>point(primitive,i));
 for(let i=0;i<n;i++)for(let j=0;j<3;j++){
  const k=key(positions[primitive.indices[3*i+j]]);
  if(vertices.has(k))parent[find(i)]=find(vertices.get(k));else vertices.set(k,i);
 }
 const comps=new Map();
 for(let i=0;i<n;i++){
  const r=find(i);if(!comps.has(r))comps.set(r,{triangles:[],keys:new Set(),bounds:empty()});
  const c=comps.get(r);c.triangles.push(i);
  for(let j=0;j<3;j++){const p=positions[primitive.indices[3*i+j]];c.keys.add(key(p));include(c.bounds,p);}
 }
 byNode.set(primitive.nodeName,{primitive,comps:[...comps.values()]});
}
function selector(reference){
 const triangleIndicesByNode={},bounds=empty();let components=0;
 for(const [name,points] of Object.entries(reference)){
  const data=byNode.get(name);assert(data,'Missing node '+name);
  const keys=new Set(points.map(key)),selected=data.comps.filter(c=>[...c.keys].some(k=>keys.has(k)));
  assert(selected.length,'Empty selector '+name);
  triangleIndicesByNode[name]=selected.flatMap(c=>c.triangles).sort((a,b)=>a-b);
  for(const c of selected){include(bounds,c.bounds.min);include(bounds,c.bounds.max);components++;}
 }
 return {nodeNames:Object.keys(triangleIndicesByNode).sort(),triangleIndicesByNode,componentBounds:{...bounds,tolerance:1e-5},selectedComponents:components};
}
const checks=[];
for(const assembly of evidence.assemblies){
 const front=selector(assembly.front),back=selector(assembly.back);
 const make=(id,axis,minClearance,back)=>({id,axis,minClearance,front,back,
  measuredClearance:front.componentBounds.min[axis]-back.componentBounds.max[axis]});
 checks.push(make(assembly.id,2,.01,back));
 if(Object.keys(assembly.floor).length)checks.push(make(assembly.id+'-floor',1,.003,selector(assembly.floor)));
}
contract.crossingClearance={coordinateSpace:'runtime world',checks};
const report=verifyCrossingClearance(parsed,contract.crossingClearance);
await write('asset-contract-v3.json',contract);
await write('geometry-verification-v3.json',{passed:report.ok,...report,
 scope:'Exact triangles from complete welded-position components in the final GLB. Positive separating-axis gaps prove no intersections with every audited structural blocker, including cloth/floor.'});
console.log(JSON.stringify({passed:report.ok,checks:report.checks.map(c=>({id:c.id,measuredClearance:c.measuredClearance}))},null,2));
