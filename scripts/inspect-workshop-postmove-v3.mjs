import{readFile}from'node:fs/promises';
import{parseGLB}from'../public/rendering/glb.js';
const root=new URL('../',import.meta.url),out=new URL('public/assets/environment/workshop/',root);
const b=await readFile(new URL('workshop-runtime-v3.glb',out)),p=parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const report=JSON.parse(await readFile(new URL('geometric-reimport-v3.json',out),'utf8'));
const map=JSON.parse(await readFile(new URL('audit/workshop-v3-selection-map.json',root),'utf8'));
const S=95/147,T=.3245-1.15*S;
for(const assembly of report.allOtherExportedGeometry){
 if(!assembly.externalTriangleCrossings)continue;
 const samples=assembly.examples.slice(0,8).map(e=>{
  const prim=p.primitives.find(a=>a.nodeName===e.otherMesh);
  const points=[0,1,2].map(j=>{
   const i=prim.indices[e.otherTriangle*3+j]*3;
   return[prim.positions[i]/S,-prim.positions[i+2]/S,(prim.positions[i+1]-T)/S];
  });
  return{...e,sourcePoints:points};
 });
 console.log(JSON.stringify({id:assembly.id,crossings:assembly.externalTriangleCrossings,samples},null,2));
}
console.log(JSON.stringify(map.assemblies.filter(a=>a.id==='rear_blueprint').map(a=>({id:a.id,brass:a.runtimeSelections.filter(r=>r.nodeName==='Workshop_StaticBrass').flatMap(r=>r.componentList.map(c=>c.sourceObject))})),null,2));
const contract=JSON.parse(await readFile(new URL('asset-contract-v3.json',out),'utf8'));
const board=contract.crossingClearance.checks.find(c=>c.id==='drafting-board').front;
const box=board.componentBounds;
const top=[];
for(const prim of p.primitives){
 const excluded=new Set(board.triangleIndicesByNode[prim.nodeName]??[]);
 for(let i=0;i<prim.indices.length/3;i++){
  if(excluded.has(i))continue;
  const tri=[0,1,2].map(j=>{
   const k=prim.indices[i*3+j]*3,m=prim.worldMatrix;
   return[0,1,2].map(a=>m[a]*prim.positions[k]+m[4+a]*prim.positions[k+1]+m[8+a]*prim.positions[k+2]+m[12+a]);
  });
  if([0,2].some(a=>Math.min(...tri.map(v=>v[a]))>box.max[a]||Math.max(...tri.map(v=>v[a]))<box.min[a]))continue;
  const maxY=Math.max(...tri.map(v=>v[1]));
  if(maxY>box.min[1]+.65*S)continue;
  const maxSourceZ=(maxY-T)/S;
  top.push({node:prim.nodeName,ordinal:i,maxSourceZ,sourcePoints:tri.map(v=>[v[0]/S,-v[2]/S,(v[1]-T)/S])});
 }
}
top.sort((a,b)=>b.maxSourceZ-a.maxSourceZ);
console.log(JSON.stringify({lowerObstacles:top.slice(0,8),recommendedBoardSourceDeltaZ:top[0].maxSourceZ-2.120000243+.04},null,2));
