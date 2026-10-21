import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
test('El motor configura y conserva el ejercicio únicamente durante práctica preparada',()=>{
  const g=new DuelEngine();assert.equal(typeof g.setTrainingDrill,'function');
  assert.equal(g.setTrainingDrill({kind:'moving'}),false);g.setScenario('practice');
  assert.equal(g.setTrainingDrill({kind:'moving'}),true);g.resetRound();assert.equal(g.trainingDrill.kind,'moving');
  assert.equal(g.setTrainingDrill({kind:'inventado'}),false);g.phase='fight';assert.equal(g.setTrainingDrill(null),false);
  g.phase='ready';assert.equal(g.setScenario('duel'),true);assert.equal(g.trainingDrill,null);
});
test('El blanco móvil usa motores reales sin habilitar IA, fabricar ataques ni puntuar',()=>{
  const g=new DuelEngine();g.setScenario('practice');assert.equal(typeof g.setTrainingDrill,'function');
  g.setTrainingDrill({kind:'moving'});g.aiEnabled=false;g.phase='fight';const before={...g.fighters[1].pose.head};
  for(let i=0;i<90;i++)g.update(STEP);const f=g.fighters[1];
  assert.ok(Math.hypot(f.pose.head.x-before.x,f.pose.head.y-before.y,(f.pose.head.z??0)-(before.z??0))>.01);
  assert.equal(f.controller.thrust,false);assert.ok(f.rig.q.every(Number.isFinite));assert.deepEqual(g.scores,[0,0]);
});
