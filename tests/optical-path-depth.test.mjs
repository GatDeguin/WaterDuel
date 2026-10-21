import test from 'node:test';
import assert from 'node:assert/strict';
import * as optics from '../public/rendering/optics.js';
import * as depth from '../public/rendering/optical-depth.js';
import {buildFluidSurface} from '../public/physics/surfaces.js';
const crossings=[{depth:2,frontFacing:true},{depth:3,frontFacing:false},{depth:8,frontFacing:true},{depth:9,frontFacing:false}];
test('El recorrido suma dos volúmenes y excluye cinco unidades de aire entre ellos',()=>{
 assert.equal(typeof optics.opticalPathLength,'function');
 assert.equal(optics.opticalPathLength(crossings),2);
 assert.equal(optics.opticalPathLength([...crossings].reverse()),2,'la suma no depende del orden raster');
});
test('La integración recorta contra opacos y planos de vista sin llenar espacio vacío',()=>{
 assert.equal(optics.opticalPathLength(crossings,{opaqueDepth:5}),1);
 assert.equal(optics.opticalPathLength(crossings,{opaqueDepth:2.25}),.25);
 assert.equal(optics.opticalPathLength(crossings,{opaqueDepth:1}),0);
 assert.equal(optics.opticalPathLength(crossings,{near:2.5}),1.5);
 assert.equal(optics.opticalPathLength(crossings,{far:8.5}),1.5);
 assert.equal(optics.opticalPathLength([]),0);
});
test('El oráculo atraviesa interfaces trianguladas del agua física, no una caja envolvente',()=>{
 const mesh=buildFluidSurface([{x:0,y:0,z:2,volume:.001},{x:0,y:0,z:8,volume:.001}]),hits=[];
 const origin=[.013,.007,0],direction=[0,0,1],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 for(let i=0;i<mesh.p.length;i+=9){const a=mesh.p.slice(i,i+3),b=mesh.p.slice(i+3,i+6),c=mesh.p.slice(i+6,i+9),e=b.map((v,k)=>v-a[k]),f=c.map((v,k)=>v-a[k]),h=cross(direction,f),det=dot(e,h);if(Math.abs(det)<1e-12)continue;const s=origin.map((v,k)=>v-a[k]),u=dot(s,h)/det;if(u<0||u>1)continue;const q=cross(s,e),v=dot(direction,q)/det;if(v<0||u+v>1)continue;const distance=dot(f,q)/det;if(distance>0)hits.push({depth:distance,frontFacing:dot(cross(e,f),direction)<0});}
 hits.sort((a,b)=>a.depth-b.depth);assert.equal(mesh.stats.components,2);assert.equal(hits.length,4);
 const material=hits[1].depth-hits[0].depth+hits[3].depth-hits[2].depth,path=optics.opticalPathLength(hits);
 assert.ok(Math.abs(path-material)<1e-12);assert.ok(path>0);assert.ok(hits[3].depth-hits[0].depth>path+5);
});
function context(supported=true){
 const resources=new Set(),calls=[];
 return new Proxy({resources,calls,FRAMEBUFFER_COMPLETE:1,FRAMEBUFFER:2,TEXTURE4:4,TEXTURE0:0,TEXTURE_2D:5,RG32F:6,RG:7,FLOAT:8,COLOR_ATTACHMENT0:9,
  getExtension:()=>supported?{}:null,createFramebuffer(){const x={};resources.add(x);return x;},createTexture(){const x={};resources.add(x);return x;},deleteFramebuffer:x=>resources.delete(x),deleteTexture:x=>resources.delete(x),checkFramebufferStatus:()=>1,
 },{get(target,key){if(key in target)return target[key];return (...args)=>calls.push([key,...args]);}});
}
test('La pasada de recorridos reserva RG32F, no requiere capas por componente y restaura blending',()=>{
 assert.equal(typeof depth.OpticalPathDepth,'function');const gl=context(),d=new depth.OpticalPathDepth(gl);
 assert.equal(d.ensure(300,200),true);assert.equal(d.bytes,300*200*12);assert.equal(gl.resources.size,4);assert.ok(d.frontTexture);
 const allocation=gl.calls.find(c=>c[0]==='texImage2D');assert.equal(allocation[3],gl.RG32F);
 const target={};assert.throws(()=>d.capture(()=>{throw Error('draw');},target),/draw/);
 assert.ok(gl.calls.some(c=>c[0]==='bindFramebuffer'&&c[2]===target));assert.ok(gl.calls.some(c=>c[0]==='blendFunc'));
 d.dispose();assert.equal(gl.resources.size,0);
});
test('Sin float blending se declara no disponible y no se reserva un envelope sustituto',()=>{
 const gl=context(false),d=new depth.OpticalPathDepth(gl);assert.equal(d.ensure(10,10),false);assert.equal(gl.resources.size,0);
 assert.match(d.error,/float/i);assert.equal(d.capture(()=>assert.fail('no draw'),null),false);
});
test('La interfaz próxima incluye salidas para un observador dentro del volumen',()=>{
 const gl=context(),d=new depth.OpticalPathDepth(gl);d.ensure(10,10);const passes=[];
 d.capture(pass=>{passes.push(pass);if(pass==='front')assert.equal(gl.calls.filter(c=>c[0]==='disable'||c[0]==='enable').at(-1)[0],'disable');},{});
 assert.deepEqual(passes,['front','sum']);assert.equal(d.passes,2);
 assert.equal(optics.opticalPathLength([{depth:3,frontFacing:false}],{near:.1,far:64}),2.9);
});
