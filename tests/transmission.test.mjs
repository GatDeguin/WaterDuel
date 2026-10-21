import test from 'node:test';
import assert from 'node:assert/strict';
import {SceneTransmission} from '../public/rendering/transmission.js';

function context({incomplete=false}={}){
  let serial=0,read=null,draw=null,active=30;const attachments=new Map(),boundTextures=new Map(),deleted=new Set(),trace=[];
  const gl={FRAMEBUFFER:1,READ_FRAMEBUFFER:2,DRAW_FRAMEBUFFER:3,TEXTURE_2D:4,COLOR_ATTACHMENT0:5,DEPTH_ATTACHMENT:6,
    RENDERBUFFER:7,FRAMEBUFFER_COMPLETE:8,RGBA8:9,RGBA:10,UNSIGNED_BYTE:11,DEPTH_COMPONENT24:12,DEPTH_COMPONENT:13,
    UNSIGNED_INT:14,LINEAR:15,NEAREST:16,TEXTURE_MIN_FILTER:17,TEXTURE_MAG_FILTER:18,TEXTURE_WRAP_S:19,TEXTURE_WRAP_T:20,
    CLAMP_TO_EDGE:21,TEXTURE0:30,TEXTURE1:31,TEXTURE2:32,COLOR_BUFFER_BIT:0x4000,DEPTH_BUFFER_BIT:0x100,
    createFramebuffer:()=>({kind:'fbo',id:++serial}),createTexture:()=>({kind:'texture',id:++serial}),createRenderbuffer:()=>({kind:'depth',id:++serial}),
    bindFramebuffer(target,value){if(target===1||target===2)read=value;if(target===1||target===3)draw=value;trace.push({op:'bind',target,value});},
    bindTexture(_target,value){boundTextures.set(active,value);},activeTexture(unit){active=unit;},
    framebufferTexture2D(_target,attachment,_type,value){if(!attachments.has(draw))attachments.set(draw,new Set());attachments.get(draw).add(value);},
    framebufferRenderbuffer(){},bindRenderbuffer(){},texImage2D(){},texParameteri(){},renderbufferStorage(){},
    checkFramebufferStatus:()=>incomplete?0:8,
    blitFramebuffer(...args){assert.notEqual(read,draw,'copy must read a different target');trace.push({op:'blit',read,draw,mask:args[8]});},
    deleteTexture:value=>deleted.add(value),deleteRenderbuffer:value=>deleted.add(value),deleteFramebuffer:value=>deleted.add(value)};
  return {gl,trace,deleted,assertSafeSampling(){for(const texture of boundTextures.values())assert.ok(!attachments.get(draw)?.has(texture),'cannot sample an active attachment');},get draw(){return draw;}};
}

test('La transmisión conserva profundidad para oclusión y lee una imagen separada de la composición',()=>{
  const ctx=context(),pass=new SceneTransmission(ctx.gl);assert.equal(pass.ensure(640,360),true);
  pass.begin();assert.equal(ctx.draw,pass.opaque.framebuffer);
  pass.prepare();assert.equal(ctx.draw,pass.composite.framebuffer);ctx.assertSafeSampling();
  assert.equal(ctx.trace.find(x=>x.op==='blit').mask,ctx.gl.COLOR_BUFFER_BIT|ctx.gl.DEPTH_BUFFER_BIT);
  pass.snapshot();ctx.assertSafeSampling();
  const layer=ctx.trace.filter(x=>x.op==='blit').at(-1);assert.equal(layer.read,pass.composite.framebuffer);assert.equal(layer.draw,pass.opaque.framebuffer);assert.equal(layer.mask,ctx.gl.COLOR_BUFFER_BIT);
  pass.present();assert.equal(ctx.draw,null);assert.equal(ctx.trace.at(-2).mask,ctx.gl.COLOR_BUFFER_BIT);
  pass.begin();ctx.assertSafeSampling();
  assert.equal(pass.bytes,640*360*16);
});

test('Redimensionar libera todos los attachments anteriores y no reserva otra vez para el mismo tamaño',()=>{
  const ctx=context(),pass=new SceneTransmission(ctx.gl);pass.ensure(320,200);
  const before=[pass.opaque.framebuffer,pass.opaque.color,pass.opaque.depth,pass.composite.framebuffer,pass.composite.color,pass.composite.depthBuffer];
  const unchanged=pass.opaque;pass.ensure(320,200);assert.equal(pass.opaque,unchanged);assert.equal(ctx.deleted.size,0);
  pass.ensure(640,480);assert.ok(before.every(x=>ctx.deleted.has(x)));assert.equal(ctx.deleted.size,6);
  pass.dispose();assert.equal(ctx.deleted.size,12);assert.equal(pass.available,false);assert.equal(pass.bytes,0);
});

test('Un framebuffer incompleto libera recursos y conserva un fallback explícito sin copiar targets inválidos',()=>{
  const ctx=context({incomplete:true}),pass=new SceneTransmission(ctx.gl);
  assert.equal(pass.ensure(320,200),false);assert.match(pass.error,/incompleto/);assert.equal(pass.begin(),false);assert.equal(pass.prepare(),false);
  pass.present();assert.equal(ctx.trace.filter(x=>x.op==='blit').length,0);assert.equal(ctx.deleted.size,3);
  pass.ensure(320,200);assert.equal(ctx.deleted.size,3,'do not retry a failed allocation each animation frame');
});

test('La presentación puede dibujar el postproceso al destino por defecto sin blit multisample',()=>{
  const ctx=context(),pass=new SceneTransmission(ctx.gl);pass.ensure(320,200);pass.begin();pass.prepare();
  let called=false;pass.present((color,w,h)=>{called=true;assert.equal(color,pass.composite.color);assert.equal(ctx.draw,null);assert.equal(w,320);assert.equal(h,200);ctx.assertSafeSampling();});
  assert.equal(called,true);assert.equal(ctx.trace.filter(x=>x.op==='blit').length,1);
});
test('El formato HDR usa RGBA16F para ambas imágenes y contabiliza su coste real',()=>{
  const ctx=context(),calls=[];ctx.gl.getExtension=()=>({});ctx.gl.RGBA16F=40;ctx.gl.HALF_FLOAT=41;ctx.gl.texImage2D=(...args)=>calls.push(args);
  const pass=new SceneTransmission(ctx.gl);assert.equal(pass.ensure(640,360),true);
  assert.equal(pass.format.hdr,true);assert.equal(calls.filter(c=>c[2]===40&&c[7]===41).length,2);
  assert.equal(pass.bytes,640*360*24);
});
