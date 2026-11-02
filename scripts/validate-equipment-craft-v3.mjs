/** Read-only baseline audit plus reports confined to the v3 artifact namespace. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BASE=path.join(ROOT,'public/assets/equipment/workshop/v2');
const OUT=path.join(ROOT,'public/assets/equipment/workshop/v3');
const SOURCE=path.join(ROOT,'docs/assets/equipment/v3');
const ids=['sword','spear','axe','maul','short','long','knife'];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const relative=absolute=>path.relative(ROOT,absolute).split(path.sep).join('/');
function readGLB(file){
  const data=fs.readFileSync(file);
  assert.equal(data.readUInt32LE(0),0x46546c67,file);assert.equal(data.readUInt32LE(4),2);
  assert.equal(data.readUInt32LE(8),data.length);
  const n=data.readUInt32LE(12);assert.equal(data.readUInt32LE(16),0x4e4f534a);
  const g=JSON.parse(data.subarray(20,20+n).toString('utf8'));
  const p=20+n;assert.equal(data.readUInt32LE(p+4),0x004e4942);
  const binary=data.subarray(p+8,p+8+data.readUInt32LE(p));
  assert.ok(g.buffers[0].byteLength<=binary.length);assert.equal(g.buffers.length,1);
  return {g,binary,data};
}
const components={5120:[1,'readInt8'],5121:[1,'readUInt8'],5122:[2,'readInt16LE'],5123:[2,'readUInt16LE'],5125:[4,'readUInt32LE'],5126:[4,'readFloatLE']};
const dimensions={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
function accessor(asset,index){
  const a=asset.g.accessors[index],v=asset.g.bufferViews[a.bufferView];
  assert.ok(a&&v);assert.equal(v.buffer??0,0);
  const [bytes,method]=components[a.componentType],dim=dimensions[a.type],stride=v.byteStride??bytes*dim;
  const begin=(v.byteOffset??0)+(a.byteOffset??0);
  assert.ok(begin+(a.count-1)*stride+bytes*dim<=(v.byteOffset??0)+v.byteLength,'accessor exceeds view');
  return Array.from({length:a.count},(_,i)=>Array.from({length:dim},(_,j)=>asset.binary[method](begin+i*stride+j*bytes)));
}
function primitiveAudit(asset){
  let triangles=0;
  for(const view of asset.g.bufferViews)assert.ok((view.byteOffset??0)+view.byteLength<=asset.binary.length);
  for(const mesh of asset.g.meshes)for(const p of mesh.primitives){
    assert.equal(p.mode??4,4);const positions=accessor(asset,p.attributes.POSITION),indices=accessor(asset,p.indices).flat();
    assert.equal(indices.length%3,0);assert.ok(indices.every(i=>i>=0&&i<positions.length));
    assert.ok(positions.every(p=>p.length===3&&p.every(Number.isFinite)));
    triangles+=indices.length/3;
  }
  return triangles;
}
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function multiply(a,b){const o=Array(16).fill(0);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)o[j*4+i]+=a[k*4+i]*b[j*4+k];return o;}
function matrix(node){
  if(node.matrix)return node.matrix;
  const [x,y,z,w]=node.rotation??[0,0,0,1],s=node.scale??[1,1,1],t=node.translation??[0,0,0];
  return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,
    (2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,
    (2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
}
function worldMatrices(g){
  const result=[];
  function walk(index,parent){result[index]=multiply(parent,matrix(g.nodes[index]));for(const child of g.nodes[index].children??[])walk(child,result[index]);}
  for(const index of g.scenes[g.scene??0].nodes)walk(index,identity());return result;
}
function bounds(asset){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],world=worldMatrices(asset.g);
  for(let i=0;i<asset.g.nodes.length;i++){
    const node=asset.g.nodes[i],m=world[i];if(node.mesh===undefined||!m)continue;
    for(const p of asset.g.meshes[node.mesh].primitives)for(const v of accessor(asset,p.attributes.POSITION)){
      const transformed=[0,1,2].map(k=>m[k]*v[0]+m[k+4]*v[1]+m[k+8]*v[2]+m[k+12]);
      transformed.forEach((q,k)=>{min[k]=Math.min(min[k],q);max[k]=Math.max(max[k],q);});
    }
  }
  return {min,max};
}
const reports=[];
for(const id of ids){
  const old=readGLB(path.join(BASE,id+'.glb')),next=readGLB(path.join(OUT,id+'.glb'));
  const before=primitiveAudit(old),after=primitiveAudit(next);
  assert.deepEqual(next.binary.subarray(0,old.binary.length),old.binary,id+' original BIN prefix');
  for(const key of ['bufferViews','accessors','meshes'])assert.deepEqual(next.g[key].slice(0,old.g[key].length),old.g[key],id+' original '+key);
  for(const key of ['materials','images','textures','samplers','skins','animations','extensionsUsed','extensionsRequired'])assert.deepEqual(next.g[key],old.g[key],id+' unchanged '+key);
  const originalMaterialNames=new Set(old.g.materials.map(m=>m.name));
  for(const mesh of next.g.meshes.slice(old.g.meshes.length))for(const p of mesh.primitives){
    assert.ok(Number.isInteger(p.material),id+' new craft primitive needs explicit material');
    const material=next.g.materials[p.material];
    assert.ok(material&&originalMaterialNames.has(material.name)&&material.name.startsWith('WD_'),id+' original PBR material required');
    assert.ok(!/placeholder|CraftExport|CraftMat/i.test(material.name),id+' temporary export material leaked');
  }
  const oldWorld=worldMatrices(old.g),newWorld=worldMatrices(next.g),sockets=[];
  for(let i=0;i<old.g.nodes.length;i++){
    const a=old.g.nodes[i],b=next.g.nodes[i];
    const {children:oldChildren,...oldProperties}=a,{children:newChildren,...newProperties}=b;
    assert.deepEqual(newProperties,oldProperties,id+' original node '+i);
    assert.deepEqual((b.children??[]).slice(0,(a.children??[]).length),a.children??[]);
    assert.deepEqual(newWorld[i],oldWorld[i],id+' original world transform '+i);
    if(a.name?.startsWith('Socket_'))sockets.push({name:a.name,position:[oldWorld[i][12],oldWorld[i][13],oldWorld[i][14]]});
  }
  assert.ok(sockets.length>=2);
  for(const n of next.g.nodes.slice(old.g.nodes.length)){assert.equal(n.extras?.collision,false);assert.equal(n.extras?.craftLayerV3,true);assert.ok(!/collider/i.test(n.name??''));}
  assert.ok(after<=before*1.15+1,id+' triangle budget');assert.ok(after<25000,id+' detailed tier');
  assert.ok(next.data.length<=old.data.length*1.25,id+' byte budget');
  const a=bounds(old),b=bounds(next),change=[0,1,2].map(i=>Math.max(Math.abs(a.min[i]-b.min[i]),Math.abs(a.max[i]-b.max[i])));
  assert.ok(change.every(d=>d<=.001),id+' significant decorative bounds expansion '+JSON.stringify(change));
  assert.ok(change[1]<=1e-6,id+' functional reach must remain exact');
  for(const image of next.g.images??[]){
    assert.equal(image.mimeType,'image/png');const view=next.g.bufferViews[image.bufferView],start=view.byteOffset??0;
    assert.equal(next.binary.subarray(start,start+8).toString('hex'),'89504e470d0a1a0a');
    assert.ok(next.binary.readUInt32BE(start+16)<=512&&next.binary.readUInt32BE(start+20)<=512);
  }
  reports.push({id,parseable:true,original_binary_prefix_preserved:true,original_nodes_accessors_materials_unchanged:true,
    new_primitives_explicit_original_pbr_materials:true,
    craft_materials:[...new Set(next.g.meshes.slice(old.g.meshes.length).flatMap(m=>m.primitives.map(p=>next.g.materials[p.material].name)))],
    sockets,triangles_v2:before,triangles:after,triangle_growth_pct:(after/before-1)*100,
    bytes_v2:old.data.length,bytes:next.data.length,byte_growth_pct:(next.data.length/old.data.length-1)*100,
    bounds_glb:b,bounds_expansion_m:change,new_textures:0,new_colliders:false,sha256:hash(next.data)});
}
const baseline=JSON.parse(fs.readFileSync(path.join(OUT,'source-baseline-sha256.json'),'utf8'));
for(const [file,digest] of Object.entries(baseline))assert.equal(hash(fs.readFileSync(path.join(ROOT,file))),digest,'baseline immutable '+file);
assert.ok(fs.statSync(path.join(SOURCE,'workshop-craft-v3.blend')).size>1000);
const proofPath=path.join(OUT,'roundtrip-proof.json');
const proof=fs.existsSync(proofPath)?JSON.parse(fs.readFileSync(proofPath,'utf8')):null;
if(!process.argv.includes('--no-render')){
  assert.ok(proof,'real GLB proof missing');assert.equal(proof.detail_count,11);
  for(const asset of reports)assert.equal(proof.asset_sha256?.[asset.id],asset.sha256,'preview source GLB hash '+asset.id);
  for(const id of ids)assert.ok(fs.statSync(path.join(OUT,'previews',id+'-maker-detail.png')).size>1000);
}
const report={version:3,date:'2026-11-02',passed:true,assets:reports,baselines_preserved:Object.keys(baseline).length,
  runtime_modified:false,new_colliders:false,roundtrip:proof,limits:{triangle_growth:.15,glb_growth:.25,decorative_bounds_m:.001,texture_max:512}};
fs.writeFileSync(path.join(OUT,'validation.json'),JSON.stringify(report,null,2)+'\n');
const files=[];
function collect(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const target=path.join(folder,entry.name);if(entry.isDirectory())collect(target);else if(entry.name!=='delivery-sha256.json')files.push(target);}}
collect(OUT);collect(SOURCE);files.push(fileURLToPath(import.meta.url),path.join(ROOT,'scripts/create-equipment-craft-v3.py'));
const seal=files.sort().map(file=>({file:relative(file),bytes:fs.statSync(file).size,sha256:hash(fs.readFileSync(file))}));
fs.writeFileSync(path.join(OUT,'delivery-sha256.json'),JSON.stringify({version:3,algorithm:'SHA-256',files:seal},null,2)+'\n');
console.log(JSON.stringify({passed:true,assets:reports.map(({id,triangles,triangle_growth_pct,byte_growth_pct,bounds_expansion_m})=>({id,triangles,triangle_growth_pct,byte_growth_pct,bounds_expansion_m})),baselines_preserved:Object.keys(baseline).length,sealed_files:seal.length},null,2));
