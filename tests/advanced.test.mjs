import test from 'node:test';
import assert from 'node:assert/strict';
import {FluidVolume,HEAD_VOLUME} from '../public/physics/fluid.js';
import {latexMesh,buildFluidSurface} from '../public/physics/surfaces.js';
import {DuelEngine,STEP} from '../public/engine.js';
const finite=x=>Number.isFinite(x);
const h={x:0,y:2.4,z:0};
test('Fluido 3D — retiene volumen de líquido constante antes y después de perforar',()=>{
  const fluid=new FluidVolume(1,190);
  assert.ok(Math.abs(fluid.volume-HEAD_VOLUME)<1e-10);
  fluid.keepContained(h,STEP,.13,.45);
  assert.equal(fluid.released,false);
  assert.equal(fluid.release({head:h,impact:{x:.41,y:2.4,z:0},attackDir:1}),true);
  assert.equal(fluid.release({head:h,impact:h,attackDir:-1}),false);
  for(let i=0;i<210;i++)fluid.integrate(STEP);
  assert.equal(fluid.particles.length,190);
  assert.ok(Math.abs(fluid.volume-HEAD_VOLUME)<1e-10);
  assert.ok(fluid.wetCount>0,'una fracción del agua debe impactar contra el suelo');
  for(const p of fluid.particles)for(const c of ['x','y','z','vx','vy','vz'])assert.ok(finite(p[c]),c);
});
test('Globo pesado — la escala del jefe aumenta volumen según potencia cúbica',()=>{
  const f=new FluidVolume(2,260,1.16);
  assert.ok(Math.abs(f.volume-HEAD_VOLUME*1.16**3)<1e-8);
});
test('Membrana — perforación abre la piel y separa topología del tejido',()=>{
  const full=latexMesh(h,{time:1.05,quality:'high'}),tear=latexMesh(h,{burstAge:.33,tearAngle:.55,quality:'high'});
  assert.ok(full.p.length>tear.p.length);
  assert.equal(full.p.length,full.n.length);
  assert.equal(tear.p.length,tear.n.length);
  assert.ok(tear.p.some((v,i)=>Math.abs(v-full.p[i])>.05));
  assert.ok(tear.p.every(finite));
});
test('Malla líquida — genera una superficie 3D no vacía y sin vértices inválidos',()=>{
  const f=new FluidVolume(1,200);f.keepContained(h,STEP,0,0);f.release({head:h,impact:{x:.32,y:2.3,z:0},attackDir:1});
  for(let i=0;i<20;i++)f.integrate(STEP);
  const m=buildFluidSurface(f.particles,{quality:'eco'});
  assert.ok(m.p.length>90);
  assert.equal(m.p.length,m.n.length);
  assert.equal(m.p.length%9,0);
  assert.ok(m.p.every(finite));assert.ok(m.n.every(finite));
});
test('Boss en single player — cambios de cuerpo, dificultad y radio de globo coherentes',()=>{
  const g=new DuelEngine();g.setDifficulty('boss');g.resetRound();
  const boss=g.fighters[1],player=g.fighters[0];
  assert.equal(boss.boss,true);
  assert.ok(boss.balloonSize>1);
  assert.ok(boss.fluid.volume>player.fluid.volume);
  assert.ok(boss.pose.head.y>player.pose.head.y);
  g.setMode('versus');assert.equal(g.fighters[1].boss,false);
});
test('Estallido — agua coherente + aerosoles + látex conservan resultado de la ronda',()=>{
  const g=new DuelEngine();g.phase='fight';g.resetRound();
  const victim=g.fighters[1],attacker=g.fighters[0];
  const initialHip=victim.pose.hip.y;
  g.burst(victim,attacker,attacker.pose.tip);
  assert.equal(victim.globIntact,false);assert.equal(victim.fluid.released,true);
  assert.equal(g.scores[0],1);assert.equal(g.phase,'burst');
  assert.ok(g.particles.length<=16&&g.particles.every(p=>p.visualOnly));
  assert.ok(victim.membrane.stats().fractureEvents>0);
  assert.equal(g.shards.length,0);
  const volume=victim.fluid.volume;
  for(let i=0;i<100;i++)g.update(STEP);
  assert.equal(victim.fluid.volume,volume);
  assert.ok(victim.balloon.ruptureAge>0);
  assert.equal(victim.rig.diagnostics().passive,true);
  assert.ok(victim.pose.hip.y<initialHip-.01,'the physical pelvis falls instead of changing a cosmetic collapse parameter');
});
