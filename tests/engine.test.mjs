import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,sweptEllipse,intersects2D} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';

test('La colisión continua detecta una perforación de punta entre frames',()=>{
  assert.equal(sweptEllipse({x:-2,y:0},{x:2,y:0},0,0,.4,.5),true);
  assert.equal(sweptEllipse({x:-2,y:1},{x:2,y:1},0,0,.4,.5),false);
});
test('Detecta cruce entre hojas metálicas',()=>{
  assert.equal(intersects2D({x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0}),true);
});
test('Una estocada válida revienta la cabeza y produce gotas y membrana',()=>{
  const events=[],g=new DuelEngine((evt,payload)=>events.push({evt,payload}));
  g.setMode('versus');g.start();
  let scored=false;
  for(let i=0;i<1800;i++){
    // Use the actual continuous right pad, including its wrist coupling. The
    // old periodic button recipe could remain stopped against physical wood.
    g.setControl(1,{...weaponGesture({x:1,y:.63}),lean:1});
    g.setControl(2,{mainX:-1,mainY:-1,offX:0,offY:-1,lean:0,thrust:false,guard:false});
    g.update(STEP);
    if(g.scores[0]>0){scored=true;break;}
  }
  assert.equal(scored,true);
  assert.equal(g.phase,'burst');
  assert.equal(g.fighters[1].globIntact,false);
  assert.ok(g.particles.every(p=>p.visualOnly&&p.volume===0&&p.r<=.007));
  assert.equal(g.shards.length,0,'latex fragments must come from the physical membrane');
  const victim=g.fighters[1],skin=victim.membrane.stats();
  assert.ok(skin.fractureEvents>0&&skin.nodes>162);
  assert.ok(Math.abs(skin.nodeMassSum-skin.mass)<1e-12);
  assert.ok(Math.abs(victim.fluid.retainedVolume+victim.fluid.releasedVolume-victim.fluid.initialVolume)<1e-12);
  assert.ok(events.some(x=>x.evt==='burst' && x.payload.winner===1));
  assert.equal(events.filter(x=>x.evt==='thrust').length,0,'el gesto continuo perfora sin ataques de temporizador');
});
test('La IA puede completar una partida sin trucos de resultado preasignado',()=>{
  const g=new DuelEngine();g.setMode('solo');g.start();
  for(let i=0;i<20000 && g.phase!=='matchover';i++){
    const t=i*STEP;
    g.setControl(1,{mainX:1,mainY:.62,offX:.7,offY:.5,lean:1,guard:false,thrust:t%(.63)<.08});
    g.update(STEP);
  }
  assert.equal(g.phase,'matchover');
  assert.ok(g.scores.includes(2));
});
test('Controles se saturan dentro del rango de movimiento permitido',()=>{
  const g=new DuelEngine();g.setControl(1,{mainX:900,mainY:-800,lean:300,offX:Infinity});
  assert.equal(g.fighters[0].controller.mainX,1);
  assert.equal(g.fighters[0].controller.mainY,-1);
  assert.equal(g.fighters[0].controller.lean,1);
  assert.equal(g.fighters[0].controller.offX,0);
});

test('Al finalizar el tiempo reglamentario hay muerte súbita, no victoria falsa',()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));
  g.mode='versus';g.phase='fight';g.elapsed=89.995;
  g.update(.01);
  assert.equal(g.phase,'fight');
  assert.equal(g.suddenDeath,true);
  assert.deepEqual(g.scores,[0,0]);
  assert.equal(g.fighters[0].globIntact,true);
  assert.equal(g.fighters[1].globIntact,true);
  assert.equal(events.filter(e=>e.name==='overtime').length,1);
  g.update(.04);
  assert.equal(events.filter(e=>e.name==='overtime').length,1);
});

test('Los inputs NaN y valores no finitos no alteran el control',()=>{
  const g=new DuelEngine();
  g.setControl(1,{offX:NaN,offY:Infinity,mainX:-Infinity,mainY:undefined,wrist:null});
  for(const k of ['offX','offY','mainX','mainY','wrist'])assert.equal(g.fighters[0].controller[k],0);
});
