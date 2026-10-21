import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine} from '../public/engine.js';
import {matchView} from '../public/match-view.js';

test('El HUD muestra tiempo restante y tiempo extra sin confundirlos con tiempo transcurrido',()=>{
  const game=new DuelEngine();
  assert.equal(matchView(game).clock,'01:30');
  game.elapsed=17.1;
  assert.equal(matchView(game).clock,'01:13');
  game.elapsed=90;game.suddenDeath=true;
  assert.equal(matchView(game).clock,'+00:00');
  assert.equal(matchView(game).clockLabel,'Tiempo extra');
  game.elapsed=155.8;
  assert.equal(matchView(game).clock,'+01:05');
});

test('Las barras reflejan guardia independiente del globo y los puntos reflejan rondas ganadas',()=>{
  const game=new DuelEngine();
  game.scores=[1,0];
  Object.assign(game.fighters[0],{guardEnergy:.42,guard:false,guardBroken:false});
  Object.assign(game.fighters[1],{guardEnergy:0,guard:false,guardBroken:true});
  const view=matchView(game);
  assert.equal(view.fighters[0].guardPercent,42);
  assert.equal(view.fighters[0].guardLabel,'GUARDIA');
  assert.deepEqual(view.fighters[0].wins,[true,false]);
  assert.equal(view.fighters[1].guardLabel,'AGOTADA');
  assert.deepEqual(view.fighters[1].wins,[false,false]);
  game.fighters[1].globIntact=false;
  assert.equal(matchView(game).fighters[0].guardPercent,42);
});

test('El resultado de empate no anuncia un ganador ni agrega una ronda',()=>{
  const game=new DuelEngine();
  game.phase='burst';game.round=2;game.winner=0;game.scores=[1,0];
  const view=matchView(game);
  assert.equal(view.burstTitle,'DOBLE PINCHAZO');
  assert.equal(view.burstSubtitle,'EMPATE · SE REPITE LA RONDA 02');
  assert.deepEqual(view.fighters[0].wins,[true,false]);
});

test('El nombre del jefe aparece como ganador real y no como Amber Ace',()=>{
  const game=new DuelEngine();
  game.setDifficulty('boss');
  game.phase='matchover';game.winner=2;game.scores=[0,2];
  const view=matchView(game);
  assert.equal(view.winnerName,'EL MAESTRO HIDRÁULICO');
  assert.equal(view.fighters[1].name,'EL MAESTRO HIDRÁULICO');
  assert.deepEqual(view.fighters[1].wins,[true,true]);
});

test('El anuncio deja ver el contacto y aparece después del primer instante del estallido',()=>{
  const game=new DuelEngine();
  game.phase='burst';game.winner=1;
  game.phaseClock=.1;
  assert.equal(matchView(game).showBurst,false);
  game.phaseClock=.6;
  assert.equal(matchView(game).showBurst,true);
  game.phase='fight';
  assert.equal(matchView(game).showBurst,false);
});
