import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareWorkshopAir,sampleWorkshopAir} from '../public/workshop-air.js';
import {WorkshopEffects} from '../public/workshop-effects.js';
import {prepareWorkshopMotion,splitWorkshopMotionAsset,environmentPartMatrix} from '../public/rendering/workshop-motion.js';
import {parseGLB} from '../public/rendering/glb.js';
const contract=JSON.parse(readFileSync(new URL('../public/assets/environment/workshop/asset-contract-v3.json',import.meta.url)));
const bytes=readFileSync(new URL('../public/assets/environment/workshop/workshop-runtime-v3.glb',import.meta.url));
const asset=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const zero={x:0,y:0,z:0},at=(fan,t,dx=0)=>({x:fan.pivot[0]+dx,y:fan.pivot[1],z:fan.pivot[2]+t});

test('El campo usa pivote/eje reales del rotor y queda nulo detrás, lejos o con ventilador parado',()=>{
 const fan=prepareWorkshopAir(contract.fanRotor);assert.deepEqual(fan.pivot,contract.fanRotor.pivot);assert.deepEqual(fan.axis,contract.fanRotor.axis);
 const local=sampleWorkshopAir(fan,at(fan,1),1);assert.ok(local.z>0&&local.z<=fan.speed);assert.equal(local.x,0);assert.equal(local.y,0);
 assert.deepEqual(sampleWorkshopAir(fan,at(fan,-.01)),zero);assert.deepEqual(sampleWorkshopAir(fan,at(fan,fan.range+.1)),zero);
 assert.deepEqual(sampleWorkshopAir(fan,at(fan,1,20)),zero);assert.deepEqual(sampleWorkshopAir(null,at(fan,1)),zero);
 assert.deepEqual(sampleWorkshopAir(prepareWorkshopAir({...contract.fanRotor,angularSpeed:0}),at(fan,1)),zero);
 assert.throws(()=>prepareWorkshopAir({...contract.fanRotor,axis:[0,0,0]}),/eje|axis/i);
});

test('La velocidad tiene caída espacial continua y permanece acotada en el tiempo',()=>{
 const fan=prepareWorkshopAir(contract.fanRotor),near=sampleWorkshopAir(fan,at(fan,1),0),far=sampleWorkshopAir(fan,at(fan,fan.range*.8),0);
 assert.ok(near.z>far.z);assert.ok(far.z>0);
 for(let t=0;t<20;t+=.13){const v=sampleWorkshopAir(fan,at(fan,1),t);assert.ok(Number.isFinite(v.z)&&Math.hypot(v.x,v.y,v.z)<=fan.speed+1e-12);}
 const a=sampleWorkshopAir(fan,at(fan,fan.range-1e-6)),b=sampleWorkshopAir(fan,at(fan,fan.range+1e-6));assert.ok(Math.abs(a.z-b.z)<1e-10);
});

function aerosols(withFan,local=true){
 const fx=new WorkshopEffects({ambient:false,seed:19,fanRotor:withFan?contract.fanRotor:null}),air=prepareWorkshopAir(contract.fanRotor),p=at(air,local?1:-1);
 fx.particles=['dust','smoke','wood','spark','mist','glint'].map((kind,i)=>({kind,source:'prepared',...p,vx:.01,vy:.02,vz:.01,r0:.005,r:.005,alpha:1,age:0,ttl:10,phase:i,visualOnly:true}));
 for(const p of fx.particles)fx.counts[p.kind]++;
 return fx;
}
test('Sólo polvo/humo dentro del flujo cambian, conservando conteos y sin parcelas de agua',()=>{
 const a=aerosols(true),b=aerosols(false);for(let i=0;i<60;i++){a.step(1/60);b.step(1/60);}
 assert.deepEqual(a.stats().counts,b.stats().counts);assert.equal(a.particles.length,b.particles.length);
 for(const p of a.particles){const q=b.particles.find(v=>v.kind===p.kind);if(['dust','smoke'].includes(p.kind))assert.ok(p.z>q.z+.01);else assert.deepEqual(p,q);assert.ok(!('volume'in p));}
 const c=aerosols(true,false),d=aerosols(false,false);for(let i=0;i<60;i++){c.step(1/60);d.step(1/60);}assert.deepEqual(c.snapshot(),d.snapshot());
});

test('El aire no cambia la secuencia aleatoria ni la independencia de dt del reloj fijo',()=>{
 const a=aerosols(true),b=aerosols(true);for(let i=0;i<120;i++)a.step(1/120);for(let i=0;i<30;i++)b.step(1/30);
 assert.deepEqual(a.snapshot(),b.snapshot());assert.equal(a.state,b.state);
});

test('Separar paños conserva exactamente cada triángulo/atributo y mantiene las varillas estáticas',()=>{
 const motion=prepareWorkshopMotion(contract,asset.primitives),split=splitWorkshopMotionAsset(asset,motion);
 assert.equal(motion.pennants.length,4);assert.ok(motion.dynamicNames.size>1);
 const coverage=new Map(asset.primitives.map(p=>[p.nodeName,new Uint8Array(p.indices.length/3)]));
 for(const part of split.primitives){
  const original=asset.primitives.find(p=>p.nodeName===(part.sourceNodeName??part.nodeName));assert.ok(original);
  const triangles=part.sourceTriangles??Array.from({length:part.indices.length/3},(_,i)=>i);
  for(let t=0;t<triangles.length;t++){
   const source=triangles[t];coverage.get(original.nodeName)[source]++;
   for(let c=0;c<3;c++)for(const [name,width]of [['positions',3],['normals',3],['uv',2],['uv1',2],['colors',4]])if(original[name]){
    const old=original.indices[source*3+c],now=part.indices[t*3+c];for(let k=0;k<width;k++)assert.equal(part[name][now*width+k],original[name][old*width+k]);
   }
  }
 }
 assert.ok([...coverage.values()].every(counts=>counts.every(n=>n===1)));
 assert.equal(split.primitives.reduce((n,p)=>n+p.indices.length,0),asset.primitives.reduce((n,p)=>n+p.indices.length,0));
 for(const p of split.primitives.filter(p=>motion.dynamicNames.has(p.nodeName)&&p.nodeName!==motion.name))assert.ok(!p.sourceNodeName.includes('Brass'));
});

const world=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]);
test('Banderines siguen varilla fija y límites reales de mesa/piso; detrás del ventilador no oscilan',()=>{
 const motion=prepareWorkshopMotion(contract,asset.primitives),split=splitWorkshopMotionAsset(asset,motion);
 for(const flag of motion.pennants){
  const part=split.primitives.find(p=>flag.names.includes(p.nodeName));assert.ok(part);
  const first=environmentPartMatrix(part,motion,0),later=environmentPartMatrix(part,motion,1);
  if(flag.id.startsWith('rear-'))assert.deepEqual(later,part.worldMatrix);
  if(flag.id==='apron-left')assert.notDeepEqual(later,part.worldMatrix);
  for(let time=0;time<12;time+=.25){
   const matrix=environmentPartMatrix(part,motion,time),pivot=world(matrix,flag.pivot);
   for(let k=0;k<3;k++)assert.ok(Math.abs(pivot[k]-flag.pivot[k])<2e-6,'rod hinge does not translate');
   for(const p of flag.corners){const q=world(matrix,p);for(const plane of flag.planes)assert.ok(q[plane.axis]>=plane.minimum-2e-6,`${flag.id}: measured clearance is retained`);}
  }
  assert.ok(first.every(Number.isFinite));
 }
});

test('Detener ventilador devuelve paños al reposo y el split no toca el asset original',()=>{
 const stopped={...contract,fanRotor:{...contract.fanRotor,angularSpeed:0}},motion=prepareWorkshopMotion(stopped,asset.primitives);
 const original=asset.primitives.map(p=>({p,indices:p.indices,positions:p.positions,first:p.positions[0]}));
 const split=splitWorkshopMotionAsset(asset,motion);
 for(const part of split.primitives.filter(p=>motion.dynamicNames.has(p.nodeName)&&p.nodeName!==motion.name)){
  assert.equal(environmentPartMatrix(part,motion,10),part.worldMatrix);
  assert.equal(environmentPartMatrix(part,motion,10,{staticCapture:true}),part.worldMatrix,'a stationary cloth still casts static shadows');
 }
 for(const {p,indices,positions,first}of original){assert.equal(p.indices,indices);assert.equal(p.positions,positions);assert.equal(p.positions[0],first);}
});
