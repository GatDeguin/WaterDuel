import {prepareWorkshopAir,sampleWorkshopAir} from '../workshop-air.js';
const multiply=(a,b)=>{const o=new Float32Array(16);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)o[j*4+i]+=a[k*4+i]*b[j*4+k];return o;};
const worldPoint=(part,index)=>{const m=part.worldMatrix,p=part.positions,i=index*3;return [0,1,2].map(a=>m[a]*p[i]+m[a+4]*p[i+1]+m[a+8]*p[i+2]+m[a+12]);};
const bounds=points=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let a=0;a<3;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);}return {min,max};};
function rodPivot(part,triangles){
 const parents=triangles.map((_,i)=>i),owners=new Map(),root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 for(let i=0;i<triangles.length;i++)for(let k=0;k<3;k++){
  const p=worldPoint(part,part.indices[triangles[i]*3+k]),key=p.map(v=>Math.round(v*1e5)).join(':');
  if(owners.has(key))parents[root(i)]=root(owners.get(key));else owners.set(key,i);
 }
 const components=new Map();for(let i=0;i<triangles.length;i++){const id=root(i);if(!components.has(id))components.set(id,[]);for(let k=0;k<3;k++)components.get(id).push(worldPoint(part,part.indices[triangles[i]*3+k]));}
 const rods=[...components.values()].map(bounds).filter(b=>b.max[0]-b.min[0]>.3&&b.max[1]-b.min[1]<.15&&b.max[2]-b.min[2]<.15);
 rods.sort((a,b)=>(b.max[0]-b.min[0])-(a.max[0]-a.min[0]));
 if(!rods.length)throw Error('No se encontró la varilla real del banderín.');
 return rods[0].min.map((v,i)=>(v+rods[0].max[i])/2);
}
function preparePennants(contract,parts){
 const checks=contract.crossingClearance?.checks??[],flags=[];
 for(const check of checks.filter(c=>/^(apron-(left|right)|rear-pennant-(left|right))$/.test(c.id))){
  const selected=check.front?.triangleIndicesByNode,brass=parts.find(p=>p.nodeName==='Workshop_StaticBrass');
  if(!selected||!brass||!selected[brass.nodeName])continue;
  const selections=[],points=[];
  for(const part of parts){
   if(!/forest-green-woven|gold-thread|mint-enamel/.test(part.nodeName)||!selected[part.nodeName])continue;
   const triangles=selected[part.nodeName];
   if(triangles.some(t=>!Number.isInteger(t)||t<0||t*3+2>=part.indices.length))throw Error('Selección de banderín fuera de la malla.');
   for(const t of triangles)for(let k=0;k<3;k++)points.push(worldPoint(part,part.indices[t*3+k]));
   selections.push({sourceName:part.nodeName,name:`${part.nodeName}::air-${check.id}`,triangles:new Set(triangles)});
  }
  if(!points.length)continue;
  const measured=bounds(points),pivot=rodPivot(brass,selected[brass.nodeName]);
  const planes=checks.filter(c=>c.id===check.id||c.id===`${check.id}-floor`).map(c=>({axis:c.axis,minimum:c.back.componentBounds.max[c.axis]+c.minClearance}));
  flags.push({id:check.id,pivot,bounds:measured,selections,names:selections.map(s=>s.name),planes,
   center:measured.min.map((v,i)=>(v+measured.max[i])/2),corners:Array.from({length:8},(_,i)=>[0,1,2].map(a=>measured[(i>>a)&1?'max':'min'][a]))});
 }
 return flags;
}
export function prepareWorkshopMotion(contract,parts){
  const fan=contract?.fanRotor;if(!fan)return null;
  if(typeof fan.name!=='string'||parts.filter(p=>p.nodeName===fan.name).length!==1||
    !Array.isArray(fan.pivot)||fan.pivot.length!==3||!fan.pivot.every(Number.isFinite)||
    !Array.isArray(fan.axis)||fan.axis.length!==3||fan.axis.some((v,i)=>v!==[0,0,1][i])||
    !Number.isFinite(fan.angularSpeed)||Math.abs(fan.angularSpeed)>30)throw Error('Contrato de rotor incompatible con el taller.');
  const air=prepareWorkshopAir(fan),pennants=preparePennants(contract,parts);
  return {name:fan.name,pivot:[...fan.pivot],axis:[...fan.axis],angularSpeed:fan.angularSpeed,radius:air.radius,air,pennants,
    dynamicNames:new Set([fan.name,...pennants.flatMap(p=>p.names)])};
}
function subset(part,triangles,nodeName){
 const remap=new Map(),indices=[],fields={};for(const name of ['positions','normals','uv','uv1','colors','joints','weights'])if(part[name])fields[name]=[];
 for(const t of triangles)for(let k=0;k<3;k++){
  const old=part.indices[t*3+k];if(!remap.has(old)){
   remap.set(old,remap.size);for(const [name,values]of Object.entries(fields)){const width=['uv','uv1'].includes(name)?2:['positions','normals'].includes(name)?3:4;for(let a=0;a<width;a++)values.push(part[name][old*width+a]);}
  }indices.push(remap.get(old));
 }
 const out={...part,nodeName,sourceNodeName:part.nodeName,sourceTriangles:triangles,indices:new Uint32Array(indices)};
 for(const [name,values]of Object.entries(fields))out[name]=new part[name].constructor(values);return out;
}
// Startup-only triangle partition. UVs, normals, colours, winding and every
// original triangle are retained once; only cloth/stitched trim gets a hinge.
export function splitWorkshopMotionAsset(asset,motion){
 if(!motion?.pennants?.length)return asset;
 const output=[];
 for(const part of asset.primitives){
  const selections=motion.pennants.flatMap(p=>p.selections).filter(s=>s.sourceName===part.nodeName);
  if(!selections.length){output.push(part);continue;}
  const fixed=[],groups=selections.map(s=>({selection:s,triangles:[]}));
  for(let t=0;t<part.indices.length/3;t++){
   const owners=groups.filter(g=>g.selection.triangles.has(t));if(owners.length>1)throw Error('Triángulo de banderín duplicado en el contrato.');
   (owners[0]?.triangles??fixed).push(t);
  }
  if(fixed.length)output.push(subset(part,fixed,part.nodeName));
  for(const group of groups)if(group.triangles.length)output.push(subset(part,group.triangles,group.selection.name));
 }
 return {...asset,primitives:output};
}
function pennantAngle(flag,motion,time){
 const p={x:flag.center[0],y:flag.center[1],z:flag.center[2]},air=sampleWorkshopAir(motion.air,p,time);
 let angle=-.09*Math.tanh(air.z*10)*(1+.15*Math.sin(time*motion.angularSpeed*.7+flag.pivot[0]));
 const safe=a=>{const c=Math.cos(a),s=Math.sin(a);return flag.corners.every(p=>{const y=p[1]-flag.pivot[1],z=p[2]-flag.pivot[2],q=[p[0],flag.pivot[1]+c*y-s*z,flag.pivot[2]+s*y+c*z];return flag.planes.every(plane=>q[plane.axis]>=plane.minimum-1e-7);});};
 if(!safe(angle)){let low=0,high=1;for(let i=0;i<18;i++){const mid=(low+high)/2;if(safe(angle*mid))low=mid;else high=mid;}angle*=low;}
 return angle;
}
export function environmentPartMatrix(part,motion,time,{staticCapture=false}={}){
  if(!motion)return part.worldMatrix;
  const flag=motion.pennants?.find(p=>p.names.includes(part.nodeName));
  if(flag){
    const t=Number.isFinite(time)?time:0,angle=pennantAngle(flag,motion,t);if(!angle)return part.worldMatrix;if(staticCapture)return null;
    const c=Math.cos(angle),s=Math.sin(angle),[,y,z]=flag.pivot;
    return multiply(new Float32Array([1,0,0,0,0,c,s,0,0,-s,c,0,0,y-c*y+s*z,z-s*y-c*z,1]),part.worldMatrix);
  }
  if(part.nodeName!==motion.name)return part.worldMatrix;
  if(staticCapture)return null;
  const angle=(((Number.isFinite(time)?time:0)*motion.angularSpeed)%(Math.PI*2)),c=Math.cos(angle),s=Math.sin(angle),[x,y,z]=motion.pivot;
  // T(pivot) Rz(angle) T(-pivot) * restWorld. Static nodes remain unchanged.
  const m=new Float32Array([c,s,0,0,-s,c,0,0,0,0,1,0,x-c*x+s*y,y-s*x-c*y,0,1]);
  return multiply(m,part.worldMatrix);
}
