import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../public/workshop-effects.js').catch(()=>({}));
const create=options=>{assert.equal(typeof module.WorkshopEffects,'function');return new module.WorkshopEffects({ambient:false,...options});};

test('Eventos físicos enrutan madera, metal, látex y niebla sin fabricar humo ni volumen de agua',()=>{
  const fx=create({seed:17}),data=Object.freeze({material:'wood',at:Object.freeze({x:1,y:2,z:.17}),normal:Object.freeze({x:-1,y:0,z:0}),impulse:.2,closingSpeed:1.3});
  fx.emit('material-contact',data);assert.ok(fx.particles.some(p=>p.kind==='wood'));
  const before=fx.particles.length;fx.emit('clang',{at:{x:0,y:2,z:.17},impulse:.15,closingSpeed:1});assert.ok(fx.particles.slice(before).every(p=>p.kind==='spark'));
  fx.emit('material-contact',{material:'latex',at:{x:0,y:2,z:.03},impulse:.03,closingSpeed:.5});assert.ok(fx.particles.some(p=>p.kind==='glint'));
  fx.emit('burst',{contact:true,impact:{x:0,y:2,z:.17}});assert.ok(fx.particles.some(p=>p.kind==='mist'));
  assert.ok(fx.particles.every(p=>p.visualOnly===true&&!('volume'in p)&&p.kind!=='smoke'));
  assert.equal(fx.emit('thrust',{at:{x:0,y:2,z:.17}}),0);assert.equal(fx.emit('material-contact',{...data,impulse:0}),0);
});

test('El ambiente tiene polvo junto a ventanas y humo sólo desde combustión configurada',()=>{
  const fx=create({ambient:true,seed:2});assert.ok(fx.particles.some(p=>p.kind==='dust'));assert.ok(!fx.particles.some(p=>p.kind==='smoke'));
  fx.configureEnvironment({combustionSources:[{kind:'bulb',x:0,y:4,z:-3},{kind:'oilLamp',x:-2.6,y:.95,z:-4.1}]});
  for(let i=0;i<240;i++)fx.step(1/120,i/120);
  const smoke=fx.particles.filter(p=>p.kind==='smoke');assert.ok(smoke.length>0);assert.ok(smoke.every(p=>p.source==='oilLamp'&&p.x< -2&&p.y<2&&p.z< -3));
  fx.configureEnvironment({combustionSources:[]});for(let i=0;i<600;i++)fx.step(1/120);assert.ok(!fx.particles.some(p=>p.kind==='smoke'));
});

test('Semilla y reloj fijo conservan partículas y snapshots a 30/120 Hz',()=>{
  const a=create({ambient:true,seed:83}),b=create({ambient:true,seed:83});
  for(const fx of [a,b])fx.emit('material-contact',{material:'wood',at:{x:.5,y:1.8,z:.2},normal:{x:1,y:0},impulse:.22,closingSpeed:2});
  for(let i=0;i<240;i++)a.step(1/120);for(let i=0;i<60;i++)b.step(1/30);
  assert.deepEqual(a.snapshot(),b.snapshot());const saved=a.snapshot(),old=saved.particles[0].x;a.particles[0].x=99;assert.equal(saved.particles[0].x,old);
  assert.ok(Object.values(saved).every(value=>typeof value!=='function'));
});

test('Pool, topes por tipo, TTL y lotes mantienen trabajo y memoria acotados con ráfagas',()=>{
  const fx=create({seed:9});for(let i=0;i<1000;i++){fx.emit('clang',{at:{x:0,y:2,z:0},impulse:.5,closingSpeed:3});fx.emit('burst',{contact:true,impact:{x:0,y:2,z:0}});}
  assert.ok(fx.particles.length<=module.EFFECT_LIMITS.total);assert.ok(fx.stats().created<=module.EFFECT_LIMITS.total);
  assert.ok(fx.step(8)<=15,'a stalled host never asks unbounded catch-up');assert.equal(fx.step(NaN),0);
  const batches=module.effectBatches(fx.particles);assert.ok(batches.length<=18);assert.ok(batches.every(b=>b.particles.length&&b.opacity>0&&b.opacity<=.8));
  for(let i=0;i<600;i++)fx.step(1/120);assert.equal(fx.particles.length,0);
  for(let i=0;i<100;i++)fx.emit('clang',{at:{x:0,y:2,z:0},impulse:.5,closingSpeed:3});assert.ok(fx.stats().created<=module.EFFECT_LIMITS.total);
});

test('Renderer encola lotes con profundidad y alpha sin alterar partículas ni capturas de sombra',async()=>{
  const {Renderer3D}=await import('../public/render3d.js'),r=Object.create(Renderer3D.prototype),fx=create();
  fx.emit('clang',{at:{x:0,y:2,z:.17},impulse:.2,closingSpeed:1});r.pending=[];r.stats={};r.depthOnly=true;
  assert.equal(typeof r.drawEffects,'function');r.drawEffects({effects:fx});assert.equal(r.pending.length,0);
  r.depthOnly=false;const before=fx.snapshot();r.drawEffects({effects:fx});assert.ok(r.pending.length>0);assert.ok(r.pending.every(p=>p.kind==='instance'&&p.particles.length));
  assert.deepEqual(fx.snapshot(),before);assert.ok(r.stats.effects.batches<=18);
});
