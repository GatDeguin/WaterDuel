import test from 'node:test';
import assert from 'node:assert/strict';
import {OpticalDepth} from '../public/rendering/optical-depth.js';
function mock(){
 const resources=new Set(),calls=[];let fail=false;
 const gl=new Proxy({calls,resources,fail:()=>fail=true,FRAMEBUFFER_COMPLETE:1,FRAMEBUFFER:2,TEXTURE4:4,TEXTURE_2D:5,NONE:0,
 createFramebuffer(){const x={};resources.add(x);return x;},createTexture(){const x={};resources.add(x);return x;},deleteFramebuffer(x){resources.delete(x);},deleteTexture(x){resources.delete(x);},checkFramebufferStatus(){return fail?-1:1;},
 },{get(g,k){if(k in g)return g[k];return (...args)=>calls.push([k,...args]);}});return gl;
}
test('La profundidad posterior reserva sólo una textura, reutiliza tamaño y libera al redimensionar',()=>{
 const gl=mock(),d=new OpticalDepth(gl);assert.equal(d.ensure(300,200),true);assert.equal(gl.resources.size,2);assert.equal(d.bytes,240000);
 const texture=d.texture;assert.equal(d.ensure(300,200),true);assert.equal(d.texture,texture);
 assert.equal(d.ensure(600,400),true);assert.notEqual(d.texture,texture);assert.equal(gl.resources.size,2);d.dispose();assert.equal(gl.resources.size,0);
});
test('Fallar FBO queda registrado sin repetir reservas cada frame; un tamaño nuevo puede recuperar',()=>{
 const gl=mock(),d=new OpticalDepth(gl);gl.fail();assert.equal(d.ensure(10,10),false);assert.equal(gl.resources.size,0);const n=gl.calls.length;
 assert.equal(d.ensure(10,10),false);assert.equal(gl.calls.length,n);assert.match(d.error,/profundidad/);
});
test('Captura posterior desenlaza la textura antes de escribir, restaura destino y estado incluso tras error',()=>{
 const gl=mock(),d=new OpticalDepth(gl);d.ensure(10,10);gl.calls.length=0;const target={};
 assert.throws(()=>d.capture(()=>{throw Error('draw');},target),/draw/);
 const unbind=gl.calls.findIndex(x=>x[0]==='bindTexture'&&x[2]===null),write=gl.calls.findIndex(x=>x[0]==='bindFramebuffer'&&x[2]===d.framebuffer);
 assert.ok(unbind>=0&&unbind<write);assert.ok(gl.calls.some(x=>x[0]==='bindFramebuffer'&&x[2]===target));
 assert.equal(gl.calls.filter(x=>x[0]==='depthMask').at(-1)[1],false);assert.equal(gl.calls.filter(x=>x[0]==='clearDepth').at(-1)[1],1);
});
