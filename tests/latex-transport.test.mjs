import test from 'node:test';
import assert from 'node:assert/strict';
import {latexOptics,scatterRadiance} from '../public/rendering/optics.js';

test('La película estirada deja ver el agua interior sin dispersión lechosa dominante',()=>{
  const film=latexOptics([.13,.72,.61],.0045);
  assert.ok(film.transmittance.every(t=>t>.40),'la película fina conserva transmisión de fondo');
  assert.ok(film.transmittance[1]>film.transmittance[0],'el pigmento transmite más verde que rojo');
  const scatter=scatterRadiance(film,[1,1,1]);assert.ok(scatter.every((s,i)=>s<film.transmittance[i]*.2));
});

test('El látex pigmentado dispersa según espesor sin fabricar radiancia en oscuridad',()=>{
  const medium=latexOptics([.13,.72,.61],.00136);
  assert.ok(medium.scattering[1]>medium.scattering[0]*5);
  assert.ok(medium.transmittance.every(t=>t>0&&t<1));
  assert.deepEqual(scatterRadiance(medium,[0,0,0]),[0,0,0]);
  const light=scatterRadiance(medium,[1,1,1]);assert.ok(light[1]>light[0]*5);
  for(let i=0;i<3;i++)assert.ok(light[i]+medium.transmittance[i]<=1+1e-12,'single scattering must not create flux');
});
test('La película estirada transmite más y dispersa menos sin cambiar material al romperse',()=>{
  const tint=[.93,.54,.22],thin=latexOptics(tint,.0007),thick=latexOptics(tint,.002);
  const a=scatterRadiance(thin,[1,1,1]),b=scatterRadiance(thick,[1,1,1]);
  for(let i=0;i<3;i++){assert.ok(thin.transmittance[i]>thick.transmittance[i]);assert.ok(a[i]<b[i]);}
  const zero=latexOptics(tint,0);assert.deepEqual(zero.transmittance,[1,1,1]);assert.deepEqual(scatterRadiance(zero,[1,1,1]),[0,0,0]);
});
