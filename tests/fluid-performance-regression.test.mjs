import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FluidVolume,HEAD_VOLUME} from '../public/physics/fluid.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {buildFluidSurface} from '../public/physics/surfaces.js';

// Frozen pre-optimization implementation is an executable comparison oracle.
// Timing is gated by the benchmark, never by a noisy unit-test timeout.
const baselineSource=readFileSync(new URL('../benchmarks/baselines/surfaces-round5.mjs',import.meta.url),'utf8');
const baseline=await import('data:text/javascript;base64,'+Buffer.from(baselineSource.replace("'./dimensions.js'",JSON.stringify(new URL('../public/physics/dimensions.js',import.meta.url).href))).toString('base64'));
const meshHash=values=>createHash('sha256').update(Buffer.from(new Float64Array(values).buffer)).digest('hex');
const domain={floor:TABLE_TOP,bounds:3.7,depth:1.31},head={x:0,y:2.4,z:0};
function compare(cloud,options){
 const before=baseline.buildFluidSurface(cloud,options),after=buildFluidSurface(cloud,options);
 assert.equal(after.p.length,before.p.length,'no triangle reduction');
 assert.equal(meshHash(after.p),meshHash(before.p),'every vertex remains bit-identical');
 assert.equal(meshHash(after.n),meshHash(before.n),'every normal remains bit-identical');
 assert.deepEqual(after.stats,before.stats,'same resolution, samples, budget and volume calibration');
 return after;
}
test('Optimizar superficies conserva exactamente cap, splash y volumen por perfil',()=>{
 const f=new FluidVolume(1,200);f.keepContained(head,1/120,0,0);
 for(const quality of ['eco','high','ultra'])compare(f.particles,{quality,domain});
 f.release({head,impact:{x:-.422,y:2.4,z:0},attackDir:1,thrust:.8});for(let i=0;i<24;i++)f.integrate(1/120);
 for(const quality of ['eco','high','ultra'])compare(f.particles,{quality,domain});
});
test('Las rutas de dominio, gotas remotas, presupuesto y almacenamiento disperso mantienen geometría',()=>{
 const volume=HEAD_VOLUME/200;
 for(const quality of ['eco','high','ultra']){
  compare([{x:3.7,y:TABLE_TOP+.024,z:1.31,volume}],{quality,domain});
  compare([{x:-3.7,y:.35,z:-1.31,volume},{x:3.7,y:3.292826086956522,z:1.1280434782608698,volume:volume/2}],{quality});
 }
 const extended=Array.from({length:200},(_,i)=>({x:-3.7+7.4*i/199,y:.35+2.95*i/199,z:-1.31+2.62*i/199,volume}));
 compare(extended,{quality:'high',domain});compare(extended,{quality:'high',domain,maxTriangles:7});
});
test('Cada reconstrucción usa posiciones actuales, sin devolver una malla anterior',()=>{
 const cloud=[{x:0,y:2,z:0,volume:HEAD_VOLUME/200}],options={quality:'high',domain};
 const first=compare(cloud,options);cloud[0].x=.27;
 const second=compare(cloud,options);assert.notEqual(meshHash(first.p),meshHash(second.p));
});
