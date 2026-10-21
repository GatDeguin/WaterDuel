import test from 'node:test';
import assert from 'node:assert/strict';
import {MATERIALS,dielectricF0,beerLambert} from '../public/rendering/materials.js';
test('Agua y látex son dieléctricos con reflectancia normal física y metales distinguibles',()=>{
  assert.ok(Math.abs(dielectricF0(MATERIALS[13].ior)-.02037)<.0001);
  assert.ok(Math.abs(dielectricF0(MATERIALS[2].ior)-.04)<1e-12);
  for(const i of [2,3,9,10,13,14,15])assert.equal(MATERIALS[i].metallic,0);
  assert.notEqual(MATERIALS[1].roughness,MATERIALS[16].roughness);
  assert.notEqual(MATERIALS[17].roughness,MATERIALS[18].roughness);
  for(const m of MATERIALS)assert.ok(m.roughness>0&&m.roughness<=1&&m.metallic>=0&&m.metallic<=1);
});
test('La absorción conserva energía, depende de grosor y compone dos trayectos',()=>{
  const a=[1.8,.2,.05],one=beerLambert(a,.4),two=beerLambert(a,.8),zero=beerLambert(a,0);
  assert.deepEqual(zero,[1,1,1]);
  for(let i=0;i<3;i++){assert.ok(two[i]>0&&two[i]<one[i]&&one[i]<=1);assert.ok(Math.abs(one[i]**2-two[i])<1e-12);}
  assert.ok(one[0]<one[2]);
});
