import test from 'node:test';
import assert from 'node:assert/strict';
import {characterIntent,resultIntent} from '../public/physics/character-intent.js';
import {DuelEngine,STEP} from '../public/engine.js';
const fighter=(overrides={})=>({slot:1,dir:1,globIntact:true,equipment:{weapon:'sword',defense:'none'},controller:{},
  baseVX:0,lean:0,evasion:{crouch:0,feint:0},pose:{detached:[]},...overrides});
const context=(overrides={})=>({phase:'fight',clock:1,phaseClock:1,dt:1/120,winner:0,round:1,...overrides});

test('La intención neutral no inventa movimiento ni un ataque',()=>{
  const f=fighter(),r=characterIntent(f,context());
  assert.equal(r.lean,0);assert.equal(r.freeHandX,0);assert.equal(r.freeHandY,0);
  assert.equal(r.feint,0);assert.equal(r.attack,false);
});
test('La masa real del equipo modula la preparación corporal sin cambiar el catálogo',()=>{
  const light=characterIntent(fighter({controller:{mainX:.8,mainY:.5,attackHeld:true}}),context());
  const heavy=characterIntent(fighter({equipment:{weapon:'maul',defense:'none'},controller:{mainX:.8,mainY:.5,attackHeld:true}}),context());
  assert.ok(heavy.load>light.load);assert.ok(Math.abs(heavy.lean)>Math.abs(light.lean));
  assert.equal(heavy.attack,false);assert.ok(Math.abs(heavy.lean)<=.065);
});
test('El lean humano completo tiene prioridad sobre la preparación automática del torso',()=>{
  for(const lean of [-1,1]){
    const r=characterIntent(fighter({controller:{mainX:-1,mainY:-1,lean,attackHeld:true}}),context());assert.equal(r.lean,0);
  }
  const a=characterIntent(fighter({controller:{mainX:.7,lean:0}}),context()),b=characterIntent(fighter({controller:{mainX:.7,lean:.5}}),context());
  assert.ok(Math.abs(b.lean)<Math.abs(a.lean));
});
test('La finta corporal procede de una reversión real del joystick y se amortigua',()=>{
  const f=fighter({controller:{mainX:.8,mainY:0,attackHeld:true}});
  let a=characterIntent(f,context());f.controller.mainX=-.8;
  let b=characterIntent(f,context(),a);assert.ok(b.feint>0);
  f.controller={};for(let i=0;i<240;i++)b=characterIntent(f,context(),b);
  assert.ok(b.feint<1e-5);assert.equal(b.attack,false);
});
test('Contrapeso solo para mano realmente libre, sin input y con miembro presente',()=>{
  const state={sample:{mainX:0,mainY:0,baseVX:0},balance:.05,feint:0};
  const free=characterIntent(fighter({baseVX:1}),context(),state);
  assert.notEqual(free.freeHandX,0);
  for(const overrides of [{equipment:{weapon:'sword',defense:'knife'}},{equipment:{weapon:'sword',defense:'short'}},
    {equipment:{weapon:'maul',defense:'none'}},{controller:{offX:.01}},
    {pose:{detached:[{bodies:['offForearm']}]}},{rig:{isBodyAttached:()=>false}}]){
    const r=characterIntent(fighter({baseVX:1,...overrides}),context(),state);
    assert.equal(r.freeHandX,0);assert.equal(r.freeHandY,0);
  }
});
test('Esquiva coordinada conserva amplitud acotada y no concede inmunidad',()=>{
  const a=characterIntent(fighter({evasion:{crouch:1,feint:1}}),context());
  assert.notEqual(a.lean,0);assert.ok(Math.abs(a.lean)<=.065);assert.equal(a.attack,false);
  assert.equal('invulnerable' in a,false);assert.equal('head' in a,false);
});
test('Jefe delibera la preparación a partir del mismo input y sin cambiar aperturas',()=>{
  const f=fighter({controller:{mainX:.8,mainY:.4}}),a=characterIntent(f,context());
  const b=characterIntent({...f,boss:true},context());assert.ok(b.recovery>a.recovery);
  assert.ok(Math.abs(b.lean)>Math.abs(a.lean));assert.equal('cooldown' in b,false);
});
test('Celebración solo del ganador resuelto y con reloj físico, sin ataque',()=>{
  const f=fighter();assert.equal(resultIntent(f,context()),null);
  assert.equal(resultIntent(f,context({phase:'burst',winner:2})),null);
  assert.equal(resultIntent(f,context({phase:'burst',winner:0})),null);
  assert.equal(resultIntent(f,context({phase:'burst',winner:1,phaseClock:.1})),null);
  const r=resultIntent(f,context({phase:'burst',winner:1,phaseClock:1}));
  assert.ok(r);assert.equal(r.thrust,false);assert.equal(r.attackHeld,false);assert.equal(r.guard,false);
  assert.ok(r.offY>0);assert.equal(resultIntent(f,context({phase:'countdown',winner:1})),null);
  const bow=resultIntent(fighter({equipment:{weapon:'maul',defense:'none'}}),context({phase:'matchover',winner:1,phaseClock:1}));
  assert.equal(bow.offX,0);assert.equal(bow.offY,0);assert.notEqual(bow.lean,0);
});
test('Input humano, movimiento reducido o caída cancelan adornos corporales de inmediato',()=>{
  const f=fighter({controller:{mainX:.7}}),s=characterIntent(f,context());
  assert.deepEqual(characterIntent(f,context({reducedMotion:true}),s).lean,0);
  for(const g of [fighter({globIntact:false}),fighter({rig:{passive:true}}),fighter({controller:{offY:.2}})])
    assert.equal(resultIntent(g,context({phase:'matchover',winner:1})),null);
  assert.equal(resultIntent(fighter(),context({phase:'matchover',winner:1,reducedMotion:true})),null);
});
test('Intenciones nuevas poseen sus muestras y rechazan valores no finitos',()=>{
  const f=fighter({controller:{mainX:Infinity,mainY:NaN},baseVX:Infinity}),a=characterIntent(f,context({dt:NaN}));
  for(const key of ['lean','freeHandX','freeHandY','feint','load','recovery'])assert.ok(Number.isFinite(a[key]));
  const b=characterIntent(f,context(),a);b.sample.mainX=9;assert.notEqual(a.sample.mainX,9);
});
test('El motor consume las intenciones y el ganador mueve el brazo después del resultado',()=>{
  const game=new DuelEngine(),f=game.fighters[0];
  assert.equal(game.setLoadout(1,{weapon:'sword',defense:'none'}),true);game.phase='fight';game.setControl(1,{mainX:.6,mainY:.3});
  game.updateFighter(f,STEP);assert.ok(f.bodyIntent&&Math.abs(f.bodyIntent.lean)>0);
  game.setControl(1,{});game.phase='burst';game.winner=1;game.phaseClock=1;
  const scores=game.scores.slice();for(let i=0;i<30;i++)game.updateFighter(f,STEP);
  assert.ok(f.offY>.05);assert.equal(f.wasThrust,false);assert.deepEqual(game.scores,scores);
  game.phase='countdown';game.winner=0;game.updateFighter(f,STEP);assert.equal(f.bodyIntent.lean,0);
});
