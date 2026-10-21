// CPU microbenchmark, not a GPU/frame-rate or industrial-fluid validation.
// Run the same command before/after: node benchmarks/fluid.mjs [label]
import {performance} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {FluidVolume,HEAD_VOLUME} from '../public/physics/fluid.js';
import {buildFluidSurface,latexMesh,containedWaterMesh} from '../public/physics/surfaces.js';
import {BALLOON_RADII,TABLE_TOP,WATER_DROP_UNIT_VOLUME,waterDropRadius} from '../public/physics/dimensions.js';
const head={x:0,y:2.4,z:0},impact={x:-BALLOON_RADII.x,y:2.4,z:0};
const domain={floor:TABLE_TOP,bounds:3.7,depth:1.31};
const create=(count=200)=>{
  const f=new FluidVolume(1,count);f.keepContained(head,1/120,0,0);
  f.release({head,impact,attackDir:1,thrust:.8});return f;
};
const centroid=f=>f.particles.reduce((c,p)=>c.map((v,i)=>v+p[['x','y','z'][i]]/f.count),[0,0,0]);
const percentile=(a,q)=>a.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(a.length*q)-1)];
const measure=fn=>{const samples=[];for(let i=0;i<7;i++){const t=performance.now();fn();if(i>1)samples.push(performance.now()-t);}return {medianMs:percentile(samples,.5),p95Ms:percentile(samples,.95)};};
const volumeOf=mesh=>{let volume=0;const p=mesh.p;for(let i=0;i<p.length;i+=9)volume+=(p[i]*(p[i+4]*p[i+8]-p[i+5]*p[i+7])+p[i+1]*(p[i+5]*p[i+6]-p[i+3]*p[i+8])+p[i+2]*(p[i+3]*p[i+7]-p[i+4]*p[i+6]))/6;return volume;};
const closedEdges=mesh=>{const edges=new Map();for(let i=0;i<mesh.p.length;i+=9){const keys=[0,3,6].map(k=>mesh.p.slice(i+k,i+k+3).map(x=>(Math.abs(x)<5e-8?0:x).toFixed(7)).join(','));for(const [a,b]of [[0,1],[1,2],[2,0]]){const key=[keys[a],keys[b]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}}return [...edges.values()].filter(count=>count!==2).length;};
const contained= [200,260].map(count=>({count,...measure(()=>{const f=new FluidVolume(1,count);for(let i=0;i<120;i++)f.keepContained(head,1/120,.12*Math.sin(i/13),i/120);})}));
const capAndRelease=['eco','high','ultra'].map(quality=>{
  const f=new FluidVolume(1,200);f.keepContained(head,1/120,0,0);
  let cap;const timing=measure(()=>{cap=containedWaterMesh(head,{quality,frame:f.surfaceFrame});});
  let free;const freeTiming=measure(()=>{free=buildFluidSurface(f.particles,{quality,domain});});
  const half=buildFluidSurface(f.particles.map(p=>({...p,volume:p.volume/2})),{quality,domain});
  return {quality,ledger:f.volume,cap:{...timing,triangles:cap.p.length/9,volume:volumeOf(cap),relativeVolumeError:volumeOf(cap)/f.volume-1,nonManifoldEdges:closedEdges(cap)},
    freeAtIdenticalPositions:{...freeTiming,triangles:free.p.length/9,volume:volumeOf(free),relativeVolumeError:volumeOf(free)/f.volume-1,ratioToCap:volumeOf(free)/volumeOf(cap),nonManifoldEdges:closedEdges(free),...free.stats},
    halfVolumeAtIdenticalPositions:{volume:volumeOf(half),ratioToFull:volumeOf(half)/volumeOf(free),...half.stats}};
});
const sloshRelease=(()=>{
 const make=previous=>{const f=new FluidVolume(1,200);f.keepContained(head,1/120,previous,0);f.keepContained(head,1/120,0,0);return f;};
 const a=make(.003),b=make(-.003),beforeDelta=a.stats().momentum.x-b.stats().momentum.x;
 const timing=measure(()=>{for(let i=0;i<100;i++){const f=make(.003);f.release({head,impact,attackDir:1});}});
 for(const f of [a,b])f.release({head,impact,attackDir:1});
 return {fixture:'same final cap, previous slosh +/-.003 -> 0 at 1/120 s',callsPerTimingSample:100,...timing,
  momentumDifferenceBefore:beforeDelta,momentumDifferenceAfter:a.stats().momentum.x-b.stats().momentum.x,
  momentumDifferenceError:a.stats().momentum.x-b.stats().momentum.x-beforeDelta,
  maxPostVelocityDifference:Math.max(...a.particles.map((p,i)=>Math.hypot(p.vx-b.particles[i].vx,p.vy-b.particles[i].vy,p.vz-b.particles[i].vz)))};
})();
const integration=[200,260].map(count=>({count,...measure(()=>{const f=create(count);for(let i=0;i<120;i++)f.integrate(1/120);})}));
const snapshot=create();for(let i=0;i<24;i++)snapshot.integrate(1/120);
const surface=['eco','high','ultra'].map(quality=>{
  let mesh;const timing=measure(()=>{mesh=buildFluidSurface(snapshot.particles,{quality,domain});});
  return {quality,...timing,triangles:mesh.p.length/9,volume:volumeOf(mesh),nonManifoldEdges:closedEdges(mesh),...mesh.stats};
});
const contactSurface=['eco','high','ultra'].map(quality=>{
  const drop={x:3.7,y:TABLE_TOP+.024,z:1.31,volume:HEAD_VOLUME/200},mesh=buildFluidSurface([drop],{quality,domain});
  return {quality,volume:volumeOf(mesh),relativeVolumeError:volumeOf(mesh)/drop.volume-1,nonManifoldEdges:closedEdges(mesh),
   minY:Math.min(...mesh.p.filter((_,i)=>i%3===1)),maxX:Math.max(...mesh.p.filter((_,i)=>i%3===0)),maxZ:Math.max(...mesh.p.filter((_,i)=>i%3===2)),...mesh.stats};
});
const coarse=create(),fine=create();for(let i=0;i<30;i++)coarse.integrate(1/30);for(let i=0;i<120;i++)fine.integrate(1/120);
const a=centroid(coarse),b=centroid(fine);
const membrane=latexMesh(head,{time:0});let inward=0;
for(let i=0;i<membrane.p.length;i+=3)if((membrane.p[i]-head.x)*membrane.n[i]+(membrane.p[i+1]-head.y)*membrane.n[i+1]+membrane.p[i+2]*membrane.n[i+2]<0)inward++;
const spread=snapshot.particles.map((p,i)=>({...p,x:p.x*.17+(i%2?3.35:-3.35),y:2+(p.y-2.4)*.17,z:p.z*.17}));
const spreadMesh=buildFluidSurface(spread,{quality:'ultra'}),xs=spreadMesh.p.filter((_,i)=>i%3===0);
const arbiterCloud=[{x:-3.7,y:.35,z:-1.31},{x:3.7,y:3.292826086956522,z:1.1280434782608698}];
const sparseCoverage=['eco','high','ultra'].map(quality=>{const mesh=buildFluidSurface(arbiterCloud,{quality});return {quality,triangles:mesh.p.length/9,rightDropPresent:mesh.p.some((v,i)=>i%3===0&&v>3.4),...mesh.stats};});
const options={burstAge:.12,impact,localImpact:snapshot.localImpact};
const tearA=latexMesh(head,options),tearB=latexMesh({...head,y:2},options);
let tearTranslationError=0;for(let i=0;i<tearA.p.length;i++)tearTranslationError=Math.max(tearTranslationError,Math.abs(tearB.p[i]-tearA.p[i]-(i%3===1?-.4:0)));
const report={label:process.argv[2]||'current',node:process.version,
  methodology:{clock:'node:perf_hooks performance.now',warmupSamples:2,measuredSamples:5,units:'milliseconds, world units cubed',scope:'CPU only; no browser, GPU or FPS measurement',meshVolume:'signed tetrahedra against origin; edges matched to 1e-7 world units',continuityFixture:'same 200 contained particle positions at slosh=0, t=0; p.volume is then halved without moving any particle'},
  contained,capAndRelease,sloshRelease,integration,surface,contactSurface,
  discreteFallback:{description:'Per-particle closed polyhedral proxy; overlapping proxies do not guarantee a continuum union volume',templateUnitVolume:WATER_DROP_UNIT_VOLUME,
   radius:waterDropRadius(HEAD_VOLUME/200),relativePerParticleTemplateVolumeError:WATER_DROP_UNIT_VOLUME*waterDropRadius(HEAD_VOLUME/200)**3/(HEAD_VOLUME/200)-1},
  regression:{coarseElapsed:coarse.elapsed,fineElapsed:fine.elapsed,centroidDifference:Math.hypot(...a.map((v,i)=>v-b[i])),
    relativeVolumeError:Math.abs(fine.volume-HEAD_VOLUME)/HEAD_VOLUME,inwardLatexFraction:inward/(membrane.p.length/3),
    spreadSurfaceMinX:Math.min(...xs),spreadSurfaceMaxX:Math.max(...xs),sparseCoverage,tearTranslationError}};
const json=JSON.stringify(report,null,2);console.log(json);
const outputAt=process.argv.indexOf('--output');if(outputAt>=0){const path=resolve(process.argv[outputAt+1]);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,json+'\n');}
