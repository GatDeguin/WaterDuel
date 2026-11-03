import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';

function burstGame(){
  const game=new DuelEngine();game.mode='versus';game.phase='fight';
  const [attacker,victim]=game.fighters,h=victim.pose.head;
  game.burst(victim,attacker,{x:h.x-.422,y:h.y,z:.17});
  return game;
}
function observePhysicalSteps(game){
  const steps=[];const actual=game.updateWater;
  game.updateWater=function(dt){steps.push({dt,clock:this.clock});return actual.call(this,dt);};
  return steps;
}

test('La explosión avanza en tiempo real con 120 pasos físicos por segundo',()=>{
  const game=burstGame(),steps=observePhysicalSteps(game);
  for(let i=0;i<120;i++)game.update(STEP);
  assert.equal(steps.length,120,'un segundo real contiene un segundo físico, sin cámara lenta');
  assert.ok(steps.every(s=>Math.abs(s.dt-STEP)<1e-14));
  assert.ok(Math.abs(game.phaseClock-1)<1e-12);assert.deepEqual(game.scores,[1,0]);
  assert.ok(Math.abs(game.fighters[1].balloon.ruptureAge-1)<1e-12);
  const f=game.fighters[1].fluid;
  assert.ok(Math.abs(f.retainedVolume+f.releasedVolume-f.initialVolume)<1e-12);
});

test('El reloj físico conserva el remanente entre actualizaciones irregulares en tiempo real',()=>{
  const game=burstGame(),steps=observePhysicalSteps(game);
  for(let i=0;i<40;i++)game.update(1/30);
  assert.equal(steps.length,160,'4/3 segundos reales contienen 160 pasos de 1/120 s');
  game.update(STEP/2);
  assert.equal(steps.length,160,'medio paso queda pendiente y no sobreintegra');
  assert.ok(Math.abs(game.burstStepClock.remainder-STEP/2)<1e-12);
  game.update(STEP/2);
  assert.equal(steps.length,161);assert.ok(steps.every(s=>Math.abs(s.dt-STEP)<1e-14));
  assert.ok(Math.abs(game.fighters[1].balloon.ruptureAge-161*STEP)<1e-12);
});

test('El mismo segundo de rotura a 30, 60 y 120 actualizaciones produce el mismo estado físico',()=>{
  const clocks=[];
  const games=[30,60,120].map(hz=>{const g=burstGame(),steps=observePhysicalSteps(g);for(let i=0;i<hz;i++)g.update(1/hz);clocks.push(steps.map(s=>s.clock));return g;});
  assert.deepEqual(clocks[0],clocks[2]);assert.deepEqual(clocks[1],clocks[2]);
  const reference=games[2];
  for(const game of games.slice(0,2)){
    assert.deepEqual(game.scores,reference.scores);
    for(let i=0;i<2;i++){
      const a=game.fighters[i],b=reference.fighters[i];
      assert.deepEqual(a.pose,b.pose);assert.deepEqual(a.fluid.particles,b.fluid.particles);
      assert.deepEqual(a.membrane.nodes,b.membrane.nodes);
    }
  }
});

test('El cambio de round consume el residuo físico del mundo viejo y reinicia sin deuda',()=>{
  const game=burstGame(),loser=game.fighters[1],steps=observePhysicalSteps(game);
  while(game.phase==='burst')game.update(STEP);
  const actual=steps.reduce((sum,s)=>sum+s.dt,0);
  assert.ok(Math.abs(actual-game.clock)<1e-12);
  assert.ok(Math.abs(loser.balloon.ruptureAge-actual)<1e-12);
  assert.equal(game.phase,'countdown');assert.equal(game.burstStepClock.remainder,0);
  assert.equal(game.presentation.current,null);assert.notEqual(game.fighters[1],loser);
  const oldAge=loser.balloon.ruptureAge;game.update(STEP);
  assert.equal(loser.balloon.ruptureAge,oldAge);assert.equal(game.fighters[1].balloon.ruptureAge,-1);
});

test('Tiempo cero no ejecuta ni avanza un solver y el nuevo round descarta sólo el mundo anterior',()=>{
  const game=burstGame(),steps=observePhysicalSteps(game);game.update(0);
  assert.equal(steps.length,0);
  game.update(STEP);game.update(0);assert.equal(steps.length,1);
  game.resetMatch();const current=game.fighters[1];
  game.update(STEP);assert.equal(steps.length,2);assert.equal(steps[1].dt,STEP);
  assert.equal(current.balloon.ruptureAge,-1);assert.equal(current.globIntact,true);
});
