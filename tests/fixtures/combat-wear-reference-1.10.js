/** Decals anchored to actual delivered triangles. Projection is done once per
 * owned contact ID; subsequent frames only evaluate the same barycentric patch
 * with the renderer's already-computed bone/equipment matrices. */
import {bodyForBone,bodyVisible,equipmentBody} from './joint-damage.js';
import {deformEquipmentPoint} from './asset-rig.js';
const caches=new WeakMap(),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const xyz=p=>[p.x,p.y,p.z??0],sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const d=Math.hypot(...a);return d>1e-12?a.map(v=>v/d):null;};
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const vector=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]);
function inverse(m){
  if(!m||m.length!==16||!Array.from(m).every(Number.isFinite))return null;
  const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(Math.abs(det)<1e-12)return null;
  const n=[(e*i-f*h)/det,(f*g-d*i)/det,(d*h-e*g)/det,0,(c*h-b*i)/det,(a*i-c*g)/det,(b*g-a*h)/det,0,(b*f-c*e)/det,(c*d-a*f)/det,(a*e-b*d)/det,0,0,0,0,1],p=point(n,[m[12],m[13],m[14]]);for(let k=0;k<3;k++)n[12+k]=-p[k];return n;
}
const vertex=(part,index,deform)=>{const p=Array.from(part.positions.subarray(index*3,index*3+3));return deform?deformEquipmentPoint(p,deform):p;};
function materialOf(source,part){
  const raw=(source.materials??source.prepared.asset?.materials??source.prepared.asset?.json?.materials)?.[part.material];
  const metallic=raw?.metallicFactor??raw?.pbrMetallicRoughness?.metallicFactor;
  return Number.isFinite(metallic)?metallic>.5?'metal':'wood':null;
}
function sources(geometry,mark){
  if(!geometry)return [];
  const primary=mark.body==='weapon'&&mark.key!=='main-palm',secondary=mark.body==='offWeapon'||mark.key==='guard';
  if(primary||secondary){
    const items=Array.isArray(geometry.equipment)?geometry.equipment:Object.values(geometry.equipment??{});
    return items.filter(item=>equipmentBody(item.prepared?.id)===mark.body).map(item=>({...item,kind:'equipment'}));
  }
  return geometry.prepared&&geometry.matrices?[{prepared:geometry.prepared,matrices:geometry.matrices,materials:geometry.materials,kind:'character'}]:[];
}
function rayHit(origin,direction,a,b,c,maximum=.16){
  const e=sub(b,a),f=sub(c,a),p=cross(direction,f),det=dot(e,p);if(Math.abs(det)<1e-12)return null;
  const s=sub(origin,a),u=dot(s,p)/det;if(u<0||u>1)return null;
  const q=cross(s,e),v=dot(direction,q)/det;if(v<0||u+v>1)return null;
  const t=dot(f,q)/det;return t>=0&&t<=maximum?{u,v,t}:null;
}
function barycentric(p,a,b,c){const e=sub(b,a),f=sub(c,a),d=sub(p,a),aa=dot(e,e),ab=dot(e,f),bb=dot(f,f),pa=dot(d,e),pb=dot(d,f),den=aa*bb-ab*ab;return [(bb*pa-ab*pb)/den,(aa*pb-ab*pa)/den];}
function clipPatch(polygon){
  for(const evaluate of [p=>p[0],p=>p[1],p=>1-p[0]-p[1]]){
    const out=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=evaluate(a),db=evaluate(b);if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}polygon=out;if(polygon.length<3)break;
  }
  return polygon;
}
function project(mark,geometry,oil=false){
  if(!mark.position||!mark.normal||!Object.values(mark.position).every(Number.isFinite))return null;
  const direction=unit(xyz(mark.normal));if(!direction)return null;
  const position=xyz(mark.position),origin=position.map((v,i)=>v-direction[i]*.035);let best=null;
  for(const source of sources(geometry,mark))for(let pi=0;pi<source.prepared.parts.length;pi++){
    const part=source.prepared.parts[pi];if(source.kind==='character'&&bodyForBone(part.boneName)!==mark.body||part.accessory)continue;
    const material=materialOf(source,part);if(oil&&material!=='metal')continue;
    const deform=source.kind==='equipment'?source.transform:null,matrix=source.kind==='equipment'?(source.transform?.matrix??source.matrix):source.matrices[pi],inv=inverse(matrix);if(!inv)continue;
    const from=point(inv,origin),ray=vector(inv,direction);
    for(let at=0;at<part.indices.length;at+=3){
      const indices=Array.from(part.indices.subarray(at,at+3)),local=indices.map(i=>vertex(part,i,deform)),hit=rayHit(from,ray,...local,oil?.24:.16);if(!hit||best&&hit.t>=best.distance)continue;
      const world=local.map(p=>point(matrix,p)),normal=unit(cross(sub(world[1],world[0]),sub(world[2],world[0])));if(!normal||Math.abs(dot(normal,direction))<.08)continue;
      const normalSign=dot(normal,direction)<0?-1:1;if(normalSign<0)for(let k=0;k<3;k++)normal[k]*=-1;
      const center=origin.map((v,i)=>v+direction[i]*hit.t),requested=xyz(mark.tangent??{x:1,y:0,z:0}),projected=requested.map((v,i)=>v-normal[i]*dot(requested,normal));
      const tangent=unit(projected)??unit(sub(world[1],world[0])),across=cross(normal,tangent),length=clamp(mark.length??.015,.004,.086),width=oil?.006:material==='metal'?.00065:.0011;
      const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>barycentric(center.map((v,i)=>v+tangent[i]*x*length/2+across[i]*y*width/2),...world)),polygon=clipPatch(corners);
      if(polygon.length<3)continue;
      best={prepared:source.prepared,kind:source.kind,partIndex:pi,indices,polygon,normalSign,distance:hit.t,material:oil?'oil':material??(mark.body==='weapon'?'metal':'wood')};
    }
  }
  return best;
}
function currentSource(geometry,patch){
  if(patch.kind==='character')return geometry?.prepared===patch.prepared?{...geometry,kind:'character'}:null;
  const entries=Array.isArray(geometry?.equipment)?geometry.equipment:Object.values(geometry?.equipment??{});return entries?.find(e=>e.prepared===patch.prepared)??null;
}
function append(batch,patch,source,delta){
  const part=patch.prepared.parts[patch.partIndex],deform=patch.kind==='equipment'?source.transform:null,matrix=patch.kind==='equipment'?(source.transform?.matrix??source.matrix):source.matrices[patch.partIndex];
  if(!matrix||!Array.from(matrix).every(Number.isFinite))return;
  const triangle=patch.indices.map(i=>point(matrix,vertex(part,i,deform))),normal=unit(cross(sub(triangle[1],triangle[0]),sub(triangle[2],triangle[0])));if(!normal)return;
  if(patch.normalSign<0)for(let i=0;i<3;i++)normal[i]*=-1;
  const vertices=patch.polygon.map(([u,v])=>triangle[0].map((a,i)=>a*(1-u-v)+triangle[1][i]*u+triangle[2][i]*v+normal[i]*.00012));
  const n=delta?unit(vector(delta,normal)):normal;if(!n)return;
  for(let i=1;i<vertices.length-1;i++)for(const at of [0,i,i+1]){batch.p.push(...(delta?point(delta,vertices[at]):vertices[at]));batch.n.push(...n);}
}
const joints={mainShoulder:['mainUpper','mainShoulder'],mainElbow:['mainForearm','mainElbow'],wrist:['weapon','mainHand'],offShoulder:['offUpper','offShoulder'],offElbow:['offForearm','offElbow'],frontHip:['frontThigh','frontHip'],frontKnee:['frontShin','kneeF'],backHip:['backThigh','backHip'],backKnee:['backShin','kneeB']};
export function drawCombatWear(renderer,fighter,{depthOnly=false,geometry=null,onlyBodies=null,transform=null,owner=fighter,generation=null}={}){
  if(depthOnly||renderer.depthOnly||!fighter?.pose||!geometry||transform&&(transform.length!==16||!Array.from(transform).every(Number.isFinite)))return {marks:0,grease:0,draws:0};
  const equipment=Array.isArray(geometry.equipment)?geometry.equipment:Object.values(geometry.equipment??{}),prepareds=[geometry.prepared,...equipment.map(e=>e.prepared)];
  let cache=caches.get(owner);if(!cache||cache.generation!==generation||prepareds.length!==cache.prepareds.length||prepareds.some((p,i)=>p!==cache.prepareds[i])){cache={marks:new Map(),oil:new Map(),generation,prepareds,batches:{wood:{p:[],n:[]},metal:{p:[],n:[]},oil:{p:[],n:[]}}};caches.set(owner,cache);}
  const batches=cache.batches;for(const batch of Object.values(batches))batch.p.length=batch.n.length=0;
  const live=new Set();let marks=0,grease=0;
  for(const mark of (fighter.pose.surface?.marks??[]).slice(0,24)){
    if(!(mark.impulse>1e-5)||!bodyVisible(fighter.pose,mark.body,onlyBodies))continue;live.add(mark.id);
    const signature=JSON.stringify([mark.body,mark.key,mark.anchor??mark.position,mark.length]);let entry=cache.marks.get(mark.id);
    if(!entry||entry.signature!==signature){entry={signature,patch:project(mark,geometry)};cache.marks.set(mark.id,entry);}const patch=entry.patch;
    if(!patch)continue;const source=currentSource(geometry,patch);if(!source){cache.marks.delete(mark.id);continue;}append(batches[patch.material],patch,source,transform);marks++;
  }
  for(const id of cache.marks.keys())if(!live.has(id))cache.marks.delete(id);
  for(const [name,d] of Object.entries(joints)){
    const record=fighter.pose.joints?.[name]??{damage:0};if(record.detached||!bodyVisible(fighter.pose,d[0],onlyBodies)||!fighter.pose[d[1]])continue;
    const damage=Math.floor(clamp(record.damage||0,0,1)*5);let entry=cache.oil.get(name);
    if(!entry||entry.damage!==damage){entry={damage,patch:project({body:d[0],key:d[0]==='weapon'?'main-palm':d[0],position:fighter.pose[d[1]],normal:{x:0,y:0,z:1},tangent:{x:1,y:0,z:0},length:.012+.018*damage/5},geometry,true)};cache.oil.set(name,entry);}const patch=entry.patch;
    if(!patch)continue;const source=currentSource(geometry,patch);if(source){append(batches.oil,patch,source,transform);grease++;}
  }
  let draws=0;for(const [kind,material,color,opacity]of [['wood',0,0x503020,1],['metal',16,0xb7b9aa,1],['oil',19,0x302415,.18]]){
    const batch=batches[kind];if(!batch.p.length)continue;
    if(kind!=='oil'&&typeof renderer.flushDynamic==='function'){
      // This route uploads synchronously and never enters pending. Its owner
      // can safely reuse capacity; transparent oil retains an owned frame copy.
      if(!batch.storage||batch.storage.p.length<batch.p.length){const capacity=2**Math.ceil(Math.log2(batch.p.length));batch.storage={p:new Float32Array(capacity),n:new Float32Array(capacity)};batch.mesh=null;}
      batch.storage.p.set(batch.p);batch.storage.n.set(batch.n);
      if(!batch.mesh||batch.mesh.p.length!==batch.p.length)batch.mesh={p:batch.storage.p.subarray(0,batch.p.length),n:batch.storage.n.subarray(0,batch.n.length)};
      renderer.flushDynamic({mesh:batch.mesh,color,material,opacity});
    }else renderer.dynamicDraw({p:new Float32Array(batch.p),n:new Float32Array(batch.n)},color,material,opacity,-.2);draws++;
  }
  return {marks,grease,draws};
}
