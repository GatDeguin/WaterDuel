import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {materialSheen,sheenBrdf as brdf,sheenBaseScale as scale,SHEEN_GLSL} from '../public/rendering/sheen.js';
const N=[0,0,1],white=[1,1,1],direction=(mu,phi=0)=>[Math.sqrt(1-mu*mu)*Math.cos(phi),Math.sqrt(1-mu*mu)*Math.sin(phi),mu];

test('material sin sheen mantiene capa deshabilitada y defaults oficiales',()=>{
  const r=materialSheen({});assert.ok(r.color instanceof Float32Array);assert.deepEqual([...r.color],[0,0,0]);
  assert.equal(r.roughness,0);assert.equal(r.colorTexture,null);assert.equal(r.roughnessTexture,null);
});

test('boss real conserva sheen blanco y roughness .5 independiente del roughness base .74',async()=>{
  const bytes=await readFile(new URL('../public/assets/characters/water-mannequin/v2/water-mannequin-boss.glb',import.meta.url));
  const parsed=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const material=parsed.materials.find(m=>m.name==='Boss_Burgundy_Woven_Cloth');assert.ok(material);
  const r=materialSheen(material);assert.deepEqual([...r.color],white);assert.equal(r.roughness,.5);
  assert.ok(Math.abs(material.roughnessFactor-.74)<1e-6);assert.equal(r.colorTexture,null);
});

test('sheen conserva índices/UV y el factor lineal propio sin gamma adicional',()=>{
  const source={extensions:{KHR_materials_sheen:{sheenColorFactor:[.2,.4,.8],sheenRoughnessFactor:.3,
    sheenColorTexture:{index:2,texCoord:1},sheenRoughnessTexture:{index:3}}}};
  const r=materialSheen(source);assert.ok(Math.abs(r.color[1]-.4)<1e-7);assert.equal(r.roughness,.3);
  assert.equal(r.colorTexture.index,2);assert.equal(r.colorTexture.texCoord,1);assert.equal(r.roughnessTexture.index,3);
  assert.equal(r.roughnessTexture.texCoord,0);r.color[0]=1;assert.equal(source.extensions.KHR_materials_sheen.sheenColorFactor[0],.2);
});

test('sheen normaliza rango y rechaza factores no finitos y texturas inválidas',()=>{
  assert.deepEqual([...materialSheen({extensions:{KHR_materials_sheen:{sheenColorFactor:[-1,2,.5],sheenRoughnessFactor:2}}}).color],[0,1,.5]);
  for(const extension of [{sheenColorFactor:[NaN,0,0]},{sheenColorFactor:[0,0]},{sheenRoughnessFactor:Infinity},{sheenColorTexture:{index:-1}}]){
    assert.throws(()=>materialSheen({extensions:{KHR_materials_sheen:extension}}),/sheen/i);
  }
});

test('sheen color cero es no-op exacto, también a rasante y roughness cero',()=>{
  for(const r of [0,.5,1]){
    assert.deepEqual([...brdf(N,direction(.0001),direction(.0001),[0,0,0],r)],[0,0,0]);
    assert.equal(scale([0,0,0],.0001,.0001,r),1);
  }
});

test('Charlie/Neubelt da retrodispersión blanca finita al rasante y cero detrás',()=>{
  const normal=brdf(N,N,N,white,.5)[0],grazing=brdf(N,direction(.01),direction(.01),white,.5)[0];
  assert.equal(normal,0);assert.ok(grazing>normal&&grazing<4);
  for(const r of [0,.07,.2,.5,1])for(const nv of [.000001,.01,.5,1])for(const nl of [.000001,.1,1]){
    const sample=brdf(N,direction(nv),direction(nl,.3),white,r);
    assert.ok([...sample].every(x=>Number.isFinite(x)&&x>=0&&x<4));
    const s=scale(white,nv,nl,r);assert.ok(s>=0&&s<=1);
  }
  assert.deepEqual([...brdf(N,[0,0,-1],N,white,.5)],[0,0,0]);
  assert.deepEqual([...brdf(N,N,[0,0,-1],white,.5)],[0,0,0]);
});

test('sheen y escala de base son recíprocos, descontando NL incluido en la salida',()=>{
  const v=direction(.2),l=direction(.6,1.1),color=[.7,.3,.1];
  const a=brdf(N,v,l,color,.5),b=brdf(N,l,v,color,.5);
  for(let c=0;c<3;c++)assert.ok(Math.abs(a[c]/l[2]-b[c]/v[2])<1e-10);
  assert.equal(scale(color,v[2],l[2],.5),scale(color,l[2],v[2],.5));
});

test('energía hemisférica de sheen más base Lambert blanca permanece acotada',()=>{
  const n=64,p=128,weight=2*Math.PI/(n*p);
  for(const roughness of [0,.1,.25,.5,.75,1])for(const nv of [.001,.05,.3,1]){
    const V=direction(nv);let energy=0;
    for(let i=0;i<n;i++){const nl=(i+.5)/n;for(let j=0;j<p;j++){
      const L=direction(nl,(j+.5)*2*Math.PI/p);
      energy+=(brdf(N,V,L,white,roughness)[0]+scale(white,nv,nl,roughness)*nl/Math.PI)*weight;
    }}
    assert.ok(energy>=0&&energy<=1.015,`r=${roughness}, Nv=${nv}: energía=${energy}`);
  }
});

test('la compensación conserva contribución base frontal para el tejido blanco real',()=>{
  assert.ok(scale(white,1,1,.5)>.9,'no apagar difuso/base frontal por tener sheen blanco');
  assert.ok(scale(white,.01,.01,.5)<scale(white,1,1,.5));
  assert.equal(typeof SHEEN_GLSL,'string');assert.ok(SHEEN_GLSL.length>0);
});
