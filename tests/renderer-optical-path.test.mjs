import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer3D} from '../public/render3d.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {DuelEngine} from '../public/engine.js';

function context(floatBlend=true){
 let resourceId=0,vao=null,framebuffer=null,active=100,depthWrite=true;
 const uniforms={},bindings=new Map(),sources=[],draws=[],uploads=[],calls=[],resources=new Set();
 const make=kind=>{const r={id:++resourceId,kind};resources.add(r);return r;};
 const constants={TEXTURE0:100,TEXTURE1:101,TEXTURE2:102,TEXTURE3:103,TEXTURE4:104,TEXTURE5:105,TEXTURE_2D:1,
  FRAMEBUFFER:2,FRAMEBUFFER_COMPLETE:3,COLOR_ATTACHMENT0:4,DEPTH_ATTACHMENT:5,DEPTH_COMPONENT24:6,DEPTH_COMPONENT:7,UNSIGNED_INT:8,
  RG32F:9,RG:10,FLOAT:11,COLOR_BUFFER_BIT:16384,DEPTH_BUFFER_BIT:256,BLEND:12,DEPTH_TEST:13,CULL_FACE:14,
  LESS:15,LEQUAL:16,ONE:17,SRC_ALPHA:18,ONE_MINUS_SRC_ALPHA:19,FUNC_ADD:20,VERSION:21,COLOR_CLEAR_VALUE:22,
  ARRAY_BUFFER:23,DYNAMIC_DRAW:24,TRIANGLES:25,NONE:0};
 const gl=new Proxy({...constants,uniforms,bindings,sources,draws,uploads,calls,resources,
  getExtension:name=>name==='EXT_color_buffer_float'||name==='EXT_float_blend'&&floatBlend?{}:null,
  getParameter:p=>{calls.push(['getParameter',p]);return p===21?'WebGL 2.0':p===22?[.024,.035,.043,1]:undefined;},
  createBuffer:()=>make('buffer'),createVertexArray:()=>make('vao'),createTexture:()=>make('texture'),createFramebuffer:()=>make('framebuffer'),
  createShader:()=>make('shader'),createProgram:()=>make('program'),createRenderbuffer:()=>make('renderbuffer'),
  deleteBuffer:r=>resources.delete(r),deleteVertexArray:r=>resources.delete(r),deleteTexture:r=>resources.delete(r),deleteFramebuffer:r=>resources.delete(r),
  deleteShader:r=>resources.delete(r),deleteProgram:r=>resources.delete(r),deleteRenderbuffer:r=>resources.delete(r),
  checkFramebufferStatus:()=>3,getShaderParameter:()=>true,getProgramParameter:()=>true,
  shaderSource:(_s,source)=>sources.push(source),getUniformLocation:(_p,name)=>name,
  uniform1i:(n,v)=>{uniforms[n]=v;},uniform1f:(n,v)=>{uniforms[n]=v;},uniformMatrix4fv:(n,_t,v)=>{uniforms[n]=Array.from(v);},
  uniform2f:(n,a,b)=>{uniforms[n]=[a,b];},
  activeTexture:u=>{active=u;calls.push(['activeTexture',u]);},bindTexture:(_t,texture)=>{bindings.set(active,texture);calls.push(['bindTexture',active,texture]);},
  bindFramebuffer:(_t,v)=>{framebuffer=v;calls.push(['bindFramebuffer',v]);},bindVertexArray:v=>{vao=v;},
  depthMask:v=>{depthWrite=v;calls.push(['depthMask',v]);},viewport:(...v)=>calls.push(['viewport',...v]),
  enable:c=>calls.push(['enable',c]),disable:c=>calls.push(['disable',c]),blendFunc:(...v)=>calls.push(['blendFunc',...v]),
  bufferSubData:(_t,_o,data,offset,count)=>uploads.push(Array.from(data).slice(offset,offset+count)),
  drawArrays:()=>draws.push({vao,framebuffer,depthWrite,uniforms:{...uniforms,uModel:uniforms.uModel?.slice()}}),
 },{get(g,k){if(k in g)return g[k];return (...args)=>calls.push([k,...args]);}});
 return gl;
}
function scene(floatBlend=true){
 const gl=context(floatBlend),r=new Renderer3D({getContext:()=>gl});r.width=64;r.height=32;
 r.opticalDepth.ensure(64,32);r.transmission.available=true;r.transmission.composite={framebuffer:{id:'composite'}};
 gl.draws.length=0;gl.uploads.length=0;gl.calls.length=0;
 return {r,gl};
}
const mesh=components=>({p:[0,1,0,1,1,0,0,2,0],n:[0,0,1,0,0,1,0,0,1],stats:{components},offset:{x:.2,y:-.1,z:.05}});

test('Dos componentes usan front+sum+color con idéntica malla/offset y una sola subida',()=>{
 const {r,gl}=scene(),m=mesh(2);r.dynamicDraw(m,0xffffff,9);r.flush();
 assert.equal(gl.draws.length,3);assert.equal(gl.uploads.length,2);
 assert.equal(gl.draws[0].framebuffer,r.opticalPathDepth.frontFramebuffer);assert.equal(gl.draws[1].framebuffer,r.opticalPathDepth.framebuffer);
 assert.equal(gl.draws[2].framebuffer,r.transmission.composite.framebuffer);
 assert.deepEqual(gl.draws.map(d=>d.uniforms.uOpticalSum),[0,1,0]);assert.equal(gl.draws[2].uniforms.uOpticalPath,1);
 assert.deepEqual(gl.draws.map(d=>d.vao),[r.dynamic.vao,r.dynamic.vao,r.dynamic.vao]);
 for(const d of gl.draws){assert.ok(Math.abs(d.uniforms.uModel[12]-.2)<1e-7);assert.ok(Math.abs(d.uniforms.uModel[13]+.1)<1e-7);}
 assert.equal(r.stats.opticalPath.passes,2);assert.equal(r.stats.opticalPath.meshes,1);assert.equal(r.opticalPathDepth.bytes,64*32*12);
 assert.equal(gl.bindings.get(gl.TEXTURE2),r.opticalPathDepth.frontTexture);assert.equal(gl.bindings.get(gl.TEXTURE4),r.opticalPathDepth.texture);
 assert.equal(gl.uniforms.uDepthPass,0);assert.equal(gl.uniforms.uOpticalSum,0);
 assert.deepEqual(gl.calls.filter(c=>c[0]==='blendFunc').at(-1),['blendFunc',gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA]);
 const firstFront=gl.calls.findIndex(c=>c[0]==='bindFramebuffer'&&c[1]===r.opticalPathDepth.frontFramebuffer);
 assert.ok(gl.calls.slice(firstFront).some(c=>c[0]==='disable'&&c[1]===gl.CULL_FACE));
});

test('Un componente mantiene sólo prepass legacy y no reserva float target',()=>{
 const {r,gl}=scene();r.dynamicDraw(mesh(1),0xffffff,9);r.flush();
 assert.equal(gl.draws.length,2);assert.equal(gl.uploads.length,2);assert.equal(r.opticalPathDepth.bytes,0);
 assert.equal(r.opticalPathDepth.frontTexture,null);assert.equal(gl.draws[0].framebuffer,r.opticalDepth.framebuffer);assert.equal(gl.draws[1].uniforms.uOpticalPath,0);
});

test('Sin EXT_float_blend conserva depth legacy y diagnóstico explícito sin quitar geometría',()=>{
 const {r,gl}=scene(false);r.dynamicDraw(mesh(2),0xffffff,9);r.flush();
 assert.equal(gl.draws.length,2);assert.equal(gl.uploads.length,2);assert.equal(gl.draws[1].uniforms.uOpticalPath,0);
 assert.equal(r.stats.opticalPath.fallbacks,1);assert.match(r.stats.opticalPath.error,/float/i);assert.equal(r.stats.opticalPath.accuracy,'envelope approximation');
 assert.equal(r.opticalPathDepth.bytes,0);
});

test('La reutilización de las tres pasadas no oculta mutaciones en el siguiente cuadro',()=>{
 const {r,gl}=scene(),m=mesh(2);r.dynamicDraw(m,0xffffff,9);r.flush();m.p[0]=.125;
 gl.draws.length=0;gl.uploads.length=0;r.dynamicDraw(m,0xffffff,9);r.flush();
 assert.equal(gl.draws.length,3);assert.equal(gl.uploads.length,2);assert.equal(gl.uploads[0][0],.125);
});

test('Shader integra interfaces reales y Beer sólo en nearest a dos caras, preservando posteriores',()=>{
 const {gl}=scene(),fragment=gl.sources.find(s=>s.includes('uHasOpticalDepth'));
 assert.ok(fragment.indexOf('if(uOpticalSum)')<fragment.indexOf('if(uDepthPass'),'signed sum precedes ordinary depth branch');
 assert.ok(/opticalPathSample\(opticalViewDistance\(gl_FragCoord.z\),gl_FrontFacing/.test(fragment),'sum uses rasterized interface depth and real winding');
 assert.ok(/floor\(texture\(uOpticalFront,uv\).r\*16777215.0\+\.5\)==floor\(gl_FragCoord.z\*16777215.0\+\.5\)/.test(fragment),'nearest compares DEPTH24 bins rather than a wide epsilon');
 assert.ok(/nearestOptical\?opticalPathSum/.test(fragment),'only nearest interface gets summed Beer length');
 assert.ok(/!uOpticalPath&&!gl_FrontFacing/.test(fragment),'new mode preserves rear geometry');
 assert.ok(/!nearestOptical\?interfaceOpacity/.test(fragment),'further interfaces retain their fractional alpha');
});

test('El integrador óptico usa near/far reales incluso cuando el encuadre estrecho supera64',()=>{
 const {r,gl}=scene();r.canvas.clientWidth=100;r.canvas.clientHeight=1000;globalThis.window={devicePixelRatio:1};
 r.render(new DuelEngine(),0);assert.ok(r.stats.camera.far>64);assert.deepEqual(gl.uniforms.uOpticalPlanes,[.1,r.stats.camera.far]);
 const fragment=gl.sources.find(s=>s.includes('uOpticalSum'));
 assert.ok(/opticalPathSum\(texture\(uOpticalDepth,uv\).rg,uOpticalPlanes.x/.test(fragment),'clipped camera-inside correction uses actual near plane');
});

test('Renderer reemplaza el blob base por suelas físicas y evita decals en pases de profundidad',()=>{
 const r=Object.create(Renderer3D.prototype),calls=[];
 Object.assign(r,{depthOnly:false,detailedPuppet:()=>true,detailedEquipment:()=>true,drawDetachedPuppet(){},drawJointMarks(){},sphere:(...args)=>calls.push(args)});
 const f={slot:1,baseX:19,pose:{head:{x:0,y:2,z:0},footF:{x:-.7,y:TABLE_TOP+.075,z:.29},footB:{x:.6,y:TABLE_TOP+.075,z:-.22}},
  fluid:{retainedVolume:0},globIntact:false,balloon:{ruptureAge:2}};
 r.drawPuppet(f,0,{});const decals=calls.filter(c=>c[7]===5);assert.equal(decals.length,2);assert.deepEqual(decals.map(c=>c[0]),[-.7,.6]);
 calls.length=0;r.depthOnly=true;r.drawPuppet(f,0,{});assert.equal(calls.filter(c=>c[7]===5).length,0);
});
