import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareWorkshopLights} from '../public/rendering/workshop-lights.js';

const directory=new URL('../public/assets/environment/workshop/',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const decode=bytes=>parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const extensionBytes=await readFile(new URL('workshop-360.glb',directory));
const extension=decode(extensionBytes),contract=JSON.parse(await readFile(new URL('workshop-360.json',directory),'utf8'));
const historicalBytes=await readFile(new URL('workshop-runtime-v3.glb',directory)),historical=decode(historicalBytes);

test('the 360 workshop is a small self-contained static addition and preserves the protected v3 source',()=>{
 assert.equal(sha(historicalBytes),'1a947c7e2a5b2387e5a0db4cd55169445dad91d2a0fda59bac5c51c0751bb930');
 assert.equal(contract.protectedV3.sha256,sha(historicalBytes));assert.equal(contract.sha256,sha(extensionBytes));
 // Exact shared v3 maps cost 7.75 MB in transport but add no duplicate texture
 // residency. Retain those original maps rather than downsample nearby walls.
 assert.ok(extensionBytes.length<12*1024*1024,'extension download budget with exact shared PBR maps');
 assert.ok(extension.primitives.length<=18,'material-batched geometry, no per-prop draw calls');
 const triangles=extension.primitives.reduce((sum,p)=>sum+p.indices.length/3,0);
 assert.ok(triangles<50000);assert.equal(triangles,contract.triangles);
 assert.equal(extension.skins.length,0);assert.equal(extension.json.animations?.length??0,0);
 for(const part of extension.primitives){
  assert.match(part.nodeName,/^Workshop360_/);assert.ok(part.uv&&part.normals&&part.colors);
  assert.deepEqual([...part.worldMatrix],[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 }
 assert.deepEqual(extension.bounds,contract.bounds);
});

test('every extension material and embedded texture reuses the historical PBR source without re-encoding',()=>{
 const names=new Set(historical.materials.map(m=>m.name)),images=new Set(historical.images.map(i=>sha(i.bytes)));
 assert.ok(extension.materials.length>=8&&extension.materials.length<=18);
 const resolved=(material,asset)=>{
  const copy=JSON.parse(JSON.stringify(material));
  const visit=value=>{for(const [key,child]of Object.entries(value))if(child&&typeof child==='object'){
   if(key.endsWith('Texture')&&Number.isInteger(child.index)){const texture=asset.textures[child.index];child.index={imageSHA256:sha(asset.images[texture.source].bytes),sampler:asset.samplers[texture.sampler]};}
   else visit(child);
  }};visit(copy);return copy;
 };
 for(const material of extension.materials){
  assert.ok(names.has(material.name),material.name);
  assert.deepEqual(resolved(material,extension),resolved(historical.materials.find(m=>m.name===material.name),historical),'PBR factors, channel assignments, maps and samplers stay exact');
 }
 for(const image of extension.images)assert.ok(images.has(sha(image.bytes)),'exact image bytes allow SharedTextures reuse');
 assert.ok(extension.images.length>0,'the shipping asset must have its PBR maps, not flat material placeholders');
});

test('new face UVs stay within padded valid islands of the shared object atlases, never their black gaps',()=>{
 const patches=contract.materialReuse.atlasPatches;assert.ok(patches&&Object.keys(patches).length>=10,'atlas safety receipt');
 for(const part of extension.primitives){
  const material=extension.materials[part.material],patch=patches[material.name];
  if(!material.pbrMetallicRoughness?.baseColorTexture)continue;
  assert.ok(patch,material.name);assert.equal(patch.emptyPixels,0);assert.ok(patch.marginPixels>=2);
  const texture=extension.textures[material.pbrMetallicRoughness.baseColorTexture.index];assert.equal(sha(extension.images[texture.source].bytes),patch.sourceSHA256);
  const [u0,v0,u1,v1]=patch.gltfUVRect;
  for(let i=0;i<part.uv.length;i+=2)assert.ok(part.uv[i]>=u0-1e-6&&part.uv[i]<=u1+1e-6&&part.uv[i+1]>=v0-1e-6&&part.uv[i+1]<=v1+1e-6,`${part.nodeName} crosses atlas padding`);
 }
});

test('architecture encloses every horizontal view and leaves its declared camera volume free of new geometry',()=>{
 const {min,max}=contract.cameraInterior;
 assert.ok(min[0]<=-10&&max[0]>=10&&min[2]<=2.4&&max[2]>=14);
 const separated=(a,b,c)=>[0,1,2].some(axis=>Math.max(a[axis],b[axis],c[axis])<min[axis]||Math.min(a[axis],b[axis],c[axis])>max[axis]);
 const triangles=[];
 for(const part of extension.primitives)for(let t=0;t<part.indices.length;t+=3){
  const triangle=[0,1,2].map(j=>{const i=part.indices[t+j]*3;return [...part.positions.subarray(i,i+3)];});
  assert.ok(separated(...triangle),`${part.nodeName} cannot enter the camera's conservative empty box`);triangles.push(triangle);
 }
 const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const ray=(origin,direction)=>triangles.some(([a,b,c])=>{
  const ab=sub(b,a),ac=sub(c,a),h=cross(direction,ac),det=dot(ab,h);if(Math.abs(det)<1e-9)return false;
  const s=sub(origin,a),u=dot(s,h)/det;if(u<0||u>1)return false;
  const q=cross(s,ab),v=dot(direction,q)/det;if(v<0||u+v>1)return false;
  const distance=dot(ac,q)/det;return distance>.05&&distance<40;
 });
 for(let degree=0;degree<360;degree+=15){const angle=degree*Math.PI/180;assert.ok(ray([0,2,5],[Math.sin(angle),0,Math.cos(angle)]),`closed workshop at ${degree} degrees`);}
 assert.ok(ray([0,2,5],[0,1,0]),'the new ceiling closes the formerly empty roof');
 assert.ok(ray([10,2,8],[0,-1,0]),'the extended side aisle has a floor');
 assert.ok(ray([0,2,12],[0,-1,0]),'the front aisle has a floor');
 for(const id of ['front-wall','left-wall','right-wall','ceiling','floor-extension','left-return','right-return','storage-and-tools'])assert.ok(contract.elements.some(e=>e.id===id),id);
});

test('two optional front practicals fit the existing 24-light limit with matching authored frames',async()=>{
 const base=JSON.parse(await readFile(new URL('asset-contract-v3.json',directory),'utf8')),frames=JSON.parse(await readFile(new URL('light-directions.json',directory),'utf8'));
 assert.equal(contract.lighting.hints.length,2);assert.equal(contract.lightDirections.lights.length,2);
 const combined={...base,lighting:{...base.lighting,hints:[...base.lighting.hints,...contract.lighting.hints]}};
 const authored={...frames,lights:[...frames.lights,...contract.lightDirections.lights]};
 const result=prepareWorkshopLights(combined,'atelier',authored);assert.equal(result.count,24);
 assert.ok(contract.lighting.hints.every(light=>light.position[2]>contract.cameraInterior.max[2]));
});
