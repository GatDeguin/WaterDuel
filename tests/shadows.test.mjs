import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer3D} from '../public/render3d.js';
import {DuelEngine} from '../public/engine.js';
import {readFileSync} from 'node:fs';
import {prepareWorkshopLights} from '../public/rendering/workshop-lights.js';
let ShadowMap,shadowViewProjection,SHADOW_GLSL;
try{({ShadowMap,shadowViewProjection,SHADOW_GLSL}=await import('../public/rendering/shadows.js'));}
catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const map=gl=>{assert.equal(typeof ShadowMap,'function','falta la captura de sombra real');return new ShadowMap(gl);};

function context(){
  let id=0,fail=false,active=100,draw={id:'draw'},read={id:'read'},viewport=[17,19,960,540],depthMask=false,depthFunc=15,depthClear=.75,cullFace=19,colorMask=[true,false,true,false];
  const enabled=new Set([12,13]),resources=new Set(),bindings=new Map(),calls=[],draws=[],uniforms={};
  const constants={TEXTURE0:100,TEXTURE1:101,TEXTURE2:102,TEXTURE3:103,TEXTURE4:104,TEXTURE5:105,TEXTURE_2D:1,
    ACTIVE_TEXTURE:2,TEXTURE_BINDING_2D:3,DRAW_FRAMEBUFFER:4,READ_FRAMEBUFFER:5,FRAMEBUFFER:6,DRAW_FRAMEBUFFER_BINDING:7,READ_FRAMEBUFFER_BINDING:8,
    VIEWPORT:9,DEPTH_WRITEMASK:10,DEPTH_FUNC:11,BLEND:12,CULL_FACE:13,DEPTH_TEST:14,LEQUAL:15,DEPTH_CLEAR_VALUE:16,
    COLOR_WRITEMASK:17,CULL_FACE_MODE:18,BACK:19,FRONT:20,MAX_TEXTURE_SIZE:21,DEPTH_COMPONENT24:22,DEPTH_COMPONENT:23,UNSIGNED_INT:24,
    TEXTURE_MIN_FILTER:25,TEXTURE_MAG_FILTER:26,TEXTURE_WRAP_S:27,TEXTURE_WRAP_T:28,NEAREST:29,CLAMP_TO_EDGE:30,DEPTH_ATTACHMENT:31,
    NONE:0,FRAMEBUFFER_COMPLETE:32,DEPTH_BUFFER_BIT:256,COLOR_BUFFER_BIT:16384,COMPILE_STATUS:33,LINK_STATUS:34,FLOAT:35,TRIANGLES:36,
    TEXTURE_CUBE_MAP:37,TEXTURE_CUBE_MAP_POSITIVE_X:40,RGBA8:50,RGBA:51,UNSIGNED_BYTE:52,RENDERBUFFER:53,ARRAY_BUFFER:54,ELEMENT_ARRAY_BUFFER:55};
  const resource=kind=>{const value={id:++id,kind};resources.add(value);return value;};
  const gl=new Proxy({...constants,
    resources,calls,draws,uniforms,fail:()=>{fail=true;},recover:()=>{fail=false;},
    createTexture:()=>resource('texture'),createFramebuffer:()=>resource('framebuffer'),createRenderbuffer:()=>resource('renderbuffer'),
    createBuffer:()=>resource('buffer'),createShader:()=>resource('shader'),createProgram:()=>resource('program'),createVertexArray:()=>resource('vao'),
    deleteTexture:v=>resources.delete(v),deleteFramebuffer:v=>resources.delete(v),deleteRenderbuffer:v=>resources.delete(v),deleteBuffer:v=>resources.delete(v),
    deleteShader:v=>resources.delete(v),deleteProgram:v=>resources.delete(v),deleteVertexArray:v=>resources.delete(v),
    checkFramebufferStatus:()=>fail?-1:32,getShaderParameter:()=>true,getProgramParameter:()=>true,getShaderInfoLog:()=>'',getProgramInfoLog:()=>'',getExtension:()=>null,
    activeTexture:v=>{active=v;calls.push(['activeTexture',v]);},bindTexture:(target,v)=>{if(target===1)bindings.set(active,v);calls.push(['bindTexture',target,v,active]);},
    bindFramebuffer:(target,v)=>{if(target===4||target===6)draw=v;if(target===5||target===6)read=v;calls.push(['bindFramebuffer',target,v]);},
    getParameter:p=>{calls.push(['getParameter',p]);return p===2?active:p===3?bindings.get(active)??null:p===7?draw:p===8?read:p===9?viewport.slice():p===10?depthMask:p===11?depthFunc:p===16?depthClear:p===17?colorMask.slice():p===18?cullFace:p===21?2048:undefined;},
    viewport:(...v)=>{viewport=v;},depthMask:v=>{depthMask=v;},depthFunc:v=>{depthFunc=v;},clearDepth:v=>{depthClear=v;},colorMask:(...v)=>{colorMask=v;},cullFace:v=>{cullFace=v;},
    isEnabled:c=>enabled.has(c),enable:c=>enabled.add(c),disable:c=>enabled.delete(c),
    texImage2D:(...v)=>calls.push(['texImage2D',...v]),texParameteri:(...v)=>calls.push(['texParameteri',...v]),
    getUniformLocation:(_p,name)=>name,uniform1i:(n,v)=>{uniforms[n]=v;},uniform1f:(n,v)=>{uniforms[n]=v;},uniformMatrix4fv:(n,_t,v)=>{uniforms[n]=Array.from(v);},
    drawElements:()=>draws.push({framebuffer:draw,material:uniforms.uMaterial,depthPass:uniforms.uDepthPass,hasShadow:uniforms.uHasShadow,shadowRead:bindings.get(105)}),
    drawArrays:()=>draws.push({framebuffer:draw,material:uniforms.uMaterial,depthPass:uniforms.uDepthPass,hasShadow:uniforms.uHasShadow,shadowRead:bindings.get(105)}),
    drawElementsInstanced:()=>draws.push({framebuffer:draw,material:uniforms.uMaterial,depthPass:uniforms.uDepthPass,hasShadow:uniforms.uHasShadow,shadowRead:bindings.get(105)}),
  },{get(g,k){if(k in g)return g[k];return (...args)=>calls.push([k,...args]);}});
  return gl;
}
function state(gl){
  const textureActive=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE5);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.activeTexture(textureActive);
  return {draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),viewport:gl.getParameter(gl.VIEWPORT),active:textureActive,texture,
    mask:gl.getParameter(gl.DEPTH_WRITEMASK),func:gl.getParameter(gl.DEPTH_FUNC),clear:gl.getParameter(gl.DEPTH_CLEAR_VALUE),color:gl.getParameter(gl.COLOR_WRITEMASK),
    cull:gl.getParameter(gl.CULL_FACE_MODE),blend:gl.isEnabled(gl.BLEND),cullEnabled:gl.isEnabled(gl.CULL_FACE),depthEnabled:gl.isEnabled(gl.DEPTH_TEST)};
}

test('sombras reservan DEPTH24 por perfil y liberan ambos recursos al cambiar/disponer',()=>{
  const gl=context(),s=map(gl),initial=state(gl);
  for(const [quality,size]of [['eco',512],['high',1024],['ultra',1536]]){
    assert.equal(s.ensure(quality),true);assert.equal(s.size,size);assert.equal(s.bytes,size*size*4);assert.equal(gl.resources.size,2);
    const upload=gl.calls.filter(c=>c[0]==='texImage2D').at(-1);assert.deepEqual(upload.slice(3,6),[gl.DEPTH_COMPONENT24,size,size]);
    const tex=s.texture;s.ensure(quality);assert.equal(s.texture,tex);assert.deepEqual(state(gl),initial);
  }
  s.dispose();assert.equal(gl.resources.size,0);assert.equal(s.bytes,0);
});

test('FBO incompleto libera reservas y evita repetición hasta cambiar perfil',()=>{
  const gl=context(),s=map(gl);gl.fail();assert.equal(s.ensure('high'),false);assert.equal(gl.resources.size,0);const count=gl.calls.length;
  assert.equal(s.ensure('high'),false);assert.equal(gl.calls.length,count);assert.match(s.error,/sombra/i);
  gl.recover();assert.equal(s.ensure('eco'),true);s.dispose();assert.equal(gl.resources.size,0);
});
test('sombras estáticas en unidad13 restauran su textura y respetan presupuesto de media resolución',()=>{
  const gl=context();gl.TEXTURE13=113;const shadow=new ShadowMap(gl,{unit:13,resolutionScale:.5});
  gl.activeTexture(gl.TEXTURE13);const prior={fixture:'prior13'};gl.bindTexture(gl.TEXTURE_2D,prior);gl.activeTexture(gl.TEXTURE2);
  assert.equal(shadow.ensure('high'),true);assert.equal(shadow.size,512);
  shadow.bind();gl.activeTexture(gl.TEXTURE13);assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D),shadow.texture);gl.activeTexture(gl.TEXTURE2);
  shadow.capture(()=>{gl.activeTexture(gl.TEXTURE13);assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D),null);});
  assert.equal(gl.getParameter(gl.ACTIVE_TEXTURE),gl.TEXTURE2);gl.activeTexture(gl.TEXTURE13);assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D),shadow.texture);
  shadow.dispose();assert.equal(gl.resources.size,0);
});
test('las barreras opacas de las tres luces dominantes se capturan una vez y se renuevan al cambiar calidad',()=>{
  const gl=context();for(let i=13;i<=15;i++)gl['TEXTURE'+i]=100+i;
  globalThis.window={devicePixelRatio:1};const renderer=new Renderer3D({clientWidth:960,clientHeight:540,width:960,height:540,getContext:()=>gl}),game=new DuelEngine();
  const contract=JSON.parse(readFileSync(new URL('../public/assets/environment/workshop/asset-contract.json',import.meta.url))),frames=JSON.parse(readFileSync(new URL('../public/assets/environment/workshop/light-directions.json',import.meta.url)));
  renderer.assetScene.environment={lightingPresets:{atelier:prepareWorkshopLights(contract,'atelier',frames)}};
  renderer.drawArena=()=>renderer.box(0,.2,0,7.6,.2,3,0x885533);
  renderer.render(game,0);const count=()=>gl.draws.filter(draw=>renderer.staticShadows.some(map=>draw.framebuffer===map.framebuffer)).length;
  const first=count();assert.equal(first,3);renderer.render(game,.1);assert.equal(count(),first);
  assert.ok(renderer.stats.staticShadows.every(map=>map.available&&map.size===512));
  game.quality='eco';renderer.render(game,.2);assert.equal(count(),3);assert.ok(renderer.stats.staticShadows.every(map=>map.size===256));
  renderer.dispose();assert.equal(gl.resources.size,0);
});

test('paso de sombra desenlaza unidad5 antes de escribir y restaura todo el estado tras excepción',()=>{
  const gl=context(),s=map(gl);s.ensure('high');gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,s.texture);gl.activeTexture(gl.TEXTURE2);
  const before=state(gl);gl.calls.length=0;
  assert.throws(()=>s.capture(()=>{
    assert.equal(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),s.framebuffer);assert.equal(gl.getParameter(gl.DEPTH_WRITEMASK),true);
    assert.deepEqual(gl.getParameter(gl.COLOR_WRITEMASK),[false,false,false,false]);assert.equal(gl.isEnabled(gl.BLEND),false);
    throw Error('fixture draw');
  }),/fixture draw/);
  const unbind=gl.calls.findIndex(c=>c[0]==='bindTexture'&&c[2]===null&&c[3]===gl.TEXTURE5);
  const write=gl.calls.findIndex(c=>c[0]==='bindFramebuffer'&&c[2]===s.framebuffer);
  assert.ok(unbind>=0&&unbind<write);assert.deepEqual(state(gl),before);s.dispose();
});

test('frustum de lámpara contiene tablero y cabezas móviles sin singularidades',()=>{
  assert.equal(typeof shadowViewProjection,'function');const m=shadowViewProjection();
  for(const p of [[-3.8,.33,-1.3],[3.8,.33,1.3],[-2.5,3.5,0],[2.5,3.5,0],[0,.33,0]]){
    const q=[0,1,2,3].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);assert.ok(q.every(Number.isFinite)&&q[3]>0);
    for(let k=0;k<3;k++)assert.ok(Math.abs(q[k]/q[3])<=1,`stage point ${p} axis${k} outside frustum`);
  }
  assert.equal(typeof SHADOW_GLSL,'string');
});

test('renderer proyecta geometría opaca real sin agua/látex/colas y vuelve a iluminación sombreada',()=>{
  const gl=context();globalThis.window={devicePixelRatio:1};const canvas={clientWidth:960,clientHeight:540,width:960,height:540,getContext:()=>gl};
  const renderer=new Renderer3D(canvas),game=new DuelEngine();game.quality='high';renderer.render(game,0);
  assert.ok(renderer.shadows?.available,'el mapa de sombras debe estar integrado');
  const captures=gl.draws.filter(d=>d.framebuffer===renderer.shadows.framebuffer);
  assert.ok(captures.length>300,'arena y ambos muñecos proyectan geometría articulada');
  for(const d of captures){assert.equal(d.depthPass,1);assert.equal(d.hasShadow,0);assert.equal(d.shadowRead,null);assert.ok(![2,3,5,9,10,11,13,14,15,19].includes(d.material));}
  assert.ok(gl.draws.some(d=>d.framebuffer===renderer.transmission.opaque.framebuffer&&d.hasShadow===1));
  assert.equal(renderer.pending.length,0);assert.equal(renderer.depthOnly,false);assert.equal(renderer.stats.shadow.draws,captures.length);
  renderer.dispose();assert.equal(gl.resources.size,0);
});

test('el renderer dueño del contexto mantiene sombras y estado sin consultas GL síncronas entre cuadros',()=>{
  const gl=context();for(let i=13;i<=15;i++)gl['TEXTURE'+i]=100+i;
  globalThis.window={devicePixelRatio:1};const renderer=new Renderer3D({clientWidth:960,clientHeight:540,width:960,height:540,getContext:()=>gl}),game=new DuelEngine();
  const contract=JSON.parse(readFileSync(new URL('../public/assets/environment/workshop/asset-contract.json',import.meta.url))),frames=JSON.parse(readFileSync(new URL('../public/assets/environment/workshop/light-directions.json',import.meta.url)));
  renderer.assetScene.environment={lightingPresets:{atelier:prepareWorkshopLights(contract,'atelier',frames)}};
  renderer.drawArena=()=>renderer.box(0,.2,0,7.6,.2,3,0x885533);
  renderer.render(game,0);gl.calls.length=0;const priorDraws=gl.draws.length;
  renderer.render(game,.1);
  assert.equal(gl.calls.filter(c=>c[0]==='getParameter').length,0,'un cuadro caliente no consulta estado GPU');
  assert.ok(gl.draws.slice(priorDraws).some(d=>d.framebuffer===renderer.shadows.framebuffer&&d.depthPass===1&&d.shadowRead===null));
  assert.ok(gl.draws.slice(priorDraws).some(d=>d.framebuffer===renderer.transmission.opaque.framebuffer&&d.hasShadow===1));
  const final=state(gl);assert.equal(final.draw,null);assert.equal(final.read,null);assert.equal(final.mask,true);assert.equal(final.func,gl.LEQUAL);assert.equal(final.clear,1);assert.deepEqual(final.color,[true,true,true,true]);assert.equal(final.blend,true);assert.equal(final.cullEnabled,false);assert.equal(final.depthEnabled,true);
  renderer.dispose();assert.equal(gl.resources.size,0);
});
