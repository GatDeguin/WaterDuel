import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkshopEnvironment} from '../public/rendering/environment.js';
function context(fail=false){
  let next=0,bound=null,active=null;const attached=[],deleted=[],sizes=[];
  const gl={TEXTURE3:3,TEXTURE0:0,TEXTURE_CUBE_MAP:4,TEXTURE_CUBE_MAP_POSITIVE_X:10,RGBA8:20,RGBA:21,UNSIGNED_BYTE:22,
    LINEAR_MIPMAP_LINEAR:23,LINEAR:24,TEXTURE_MIN_FILTER:25,TEXTURE_MAG_FILTER:26,TEXTURE_WRAP_S:27,TEXTURE_WRAP_T:28,TEXTURE_WRAP_R:29,
    CLAMP_TO_EDGE:30,RENDERBUFFER:31,DEPTH_COMPONENT24:32,FRAMEBUFFER:33,DEPTH_ATTACHMENT:34,COLOR_ATTACHMENT0:35,FRAMEBUFFER_COMPLETE:36,COLOR_BUFFER_BIT:1,DEPTH_BUFFER_BIT:2,
    createTexture:()=>({id:++next}),createFramebuffer:()=>({id:++next}),createRenderbuffer:()=>({id:++next}),
    activeTexture:value=>{active=value;},bindTexture:(_target,value)=>{bound=value;},texImage2D:(...v)=>sizes.push(v.slice(3,5)),texParameteri(){},
    bindRenderbuffer(){},renderbufferStorage(){},bindFramebuffer(){},framebufferRenderbuffer(){},framebufferTexture2D:(_t,_a,face)=>attached.push(face),
    checkFramebufferStatus:()=>fail?0:36,viewport(){},clear(){},generateMipmap(){assert.ok(bound,'generate mips after binding the completed capture');},
    deleteTexture:v=>deleted.push(v),deleteFramebuffer:v=>deleted.push(v),deleteRenderbuffer:v=>deleted.push(v)};
  return {gl,attached,deleted,sizes,get bound(){return bound;},get active(){return active;}};
}
test('El entorno captura seis direcciones sin leer su attachment y sólo recaptura al cambiar arena o luz',()=>{
  const ctx=context(),env=new WorkshopEnvironment(ctx.gl,128),faces=[];
  assert.equal(env.capture('atelier:neutral',i=>{assert.equal(ctx.bound,null);faces.push(i);}),true);
  assert.deepEqual(faces,[0,1,2,3,4,5]);assert.deepEqual(ctx.sizes,Array.from({length:6},()=>[128,128]));
  assert.equal(env.capture('atelier:neutral',()=>assert.fail('same key must reuse capture')),false);
  assert.equal(env.capture('dojo:neutral',i=>faces.push(i)),true);assert.equal(faces.length,12);
  env.bind();assert.equal(ctx.bound,env.texture);assert.equal(ctx.active,ctx.gl.TEXTURE0);
  env.dispose();assert.equal(ctx.deleted.length,3);assert.equal(env.available,false);
});
test('Captura incompleta libera sus tres recursos y no reintenta por cada frame',()=>{
  const ctx=context(true),env=new WorkshopEnvironment(ctx.gl);assert.equal(env.capture('a',()=>assert.fail()),false);
  assert.match(env.error,/incompleta/);assert.equal(ctx.deleted.length,3);env.capture('b',()=>assert.fail());assert.equal(ctx.deleted.length,3);
});
