import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
const api=await import('../public/ai-perception.js').catch(()=>null);
const fighter=(x,dir=1)=>({dir,globIntact:true,balloonSize:1,equipment:{weapon:'sword',defense:'short'},pose:{head:{x,y:2,z:0},tip:{x:x+dir,y:1.9,z:.17}},previousTip:{x:x+dir-.01,y:1.9,z:.17},headVelocity:{vy:0}});
test('La IA observa a cadencia finita; no conoce cambios de punta ni globo entre muestras',()=>{
  assert.ok(api,'falta percepción por atención y visibilidad');
  const observer=fighter(-1),target=fighter(1,-1),sensor=new api.AIPerception();
  const first=sensor.observe(observer,target,.008,{difficulty:'rookie'});assert.ok(first&&first.visible);
  const prior=first.tip.x;target.pose.tip.x+=.4;target.pose.head.y+=.2;
  const stale=sensor.observe(observer,target,.008,{difficulty:'rookie'});assert.equal(stale.tip.x,prior);assert.equal(stale.head.y,2);
  for(let i=0;i<20;i++)sensor.observe(observer,target,.008,{difficulty:'rookie'});
  assert.equal(sensor.snapshot.tip.x,target.pose.tip.x);assert.equal(sensor.snapshot.head.y,target.pose.head.y);
});
test('El piloto integrado no actualiza su blanco oculto ni dispara al agotarse la memoria',()=>{
  const g=new DuelEngine();g.phase='fight';const [target,observer]=g.fighters;
  g.updateAI(observer,STEP);assert.ok(observer.perception?.snapshot,'el piloto debe usar el sensor real');
  const seen=observer.perception.snapshot.head.x;
  target.pose.head={x:observer.pose.head.x+observer.dir*-3,y:observer.pose.head.y,z:0};
  for(let i=0;i<80;i++){g.updateAI(observer,STEP);assert.equal(observer.controller.thrust,false);}
  assert.equal(observer.perception.snapshot.head.x,seen);assert.equal(observer.ai.attentionLost,true);
});
test('Fuera del cono y detrás de un sólido real pierde visión, conserva memoria limitada y no lee el futuro',()=>{
  assert.ok(api,'falta percepción por atención y visibilidad');
  const observer=fighter(-1),target=fighter(1,-1),sensor=new api.AIPerception();
  assert.ok(sensor.observe(observer,target,.04));
  target.pose.head.x=-3;target.pose.tip.x=-2;
  let seen;for(let i=0;i<3;i++)seen=sensor.observe(observer,target,.04);
  assert.equal(seen.visible,false);assert.equal(seen.head.x,1,'la cabeza oculta no actualiza la memoria');
  for(let i=0;i<20;i++)seen=sensor.observe(observer,target,.04);assert.equal(seen,null);
  const panel={vertices:[{x:-.1,y:1},{x:.1,y:1},{x:.1,y:3},{x:-.1,y:3}],z:0,depth:1};
  assert.equal(api.pointVisible(observer,{x:1,y:2,z:0},[panel]),false);
  assert.equal(api.pointVisible(observer,{x:1,y:2,z:2},[panel]),true,'una proyección XY no ocluye a distinta profundidad');
});
test('Memoria pertenece al sensor; reset no conserva un rival ni snapshots mutables externos',()=>{
  assert.ok(api,'falta percepción por atención y visibilidad');
  const sensor=new api.AIPerception(),observer=fighter(-1),target=fighter(1,-1);
  const seen=sensor.observe(observer,target,.008);target.pose.head.x=9;assert.equal(seen.head.x,1);
  sensor.reset();assert.equal(sensor.snapshot,null);assert.equal(sensor.elapsed,0);
});
test('Las tácticas responden a alcance, masa y cobertura observados sin cambiar equipamiento ni fabricar ataques',()=>{
  assert.ok(api,'faltan tácticas por loadout observado');
  const own={weapon:'sword',defense:'short'},neutral=api.loadoutTactics(own,own),spear=api.loadoutTactics(own,{weapon:'spear',defense:'none'}),maul=api.loadoutTactics(own,{weapon:'maul',defense:'none'}),shield=api.loadoutTactics(own,{weapon:'axe',defense:'long'});
  assert.equal(neutral.spacing,0);assert.notEqual(spear.spacing,maul.spacing);assert.notEqual(shield.aimBias,neutral.aimBias);
  assert.equal(own.weapon,'sword');for(const value of [neutral,spear,maul,shield])assert.ok(Object.values(value).filter(v=>typeof v==='number').every(Number.isFinite));
});
