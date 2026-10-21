import test from 'node:test';
import assert from 'node:assert/strict';
import {AIPerception} from '../public/ai-perception.js';
import {DuelEngine,STEP} from '../public/engine.js';

function fixture(){
  const observer={dir:1,pose:{head:{x:-1,y:2,z:0}}};
  const target={dir:-1,globIntact:true,balloonSize:1,equipment:{weapon:'sword',defense:'short'},headVelocity:{vx:0,vy:0,vz:0},
    pose:{head:{x:1,y:2,z:0},tip:{x:.4,y:1.4,z:.17},offHand:{x:.4,y:1.3,z:.1}},previousTip:{x:.5,y:1.4,z:.17}};
  return {observer,target};
}
const bladeScreen={vertices:[{x:-.2,y:1.3},{x:.2,y:1.3},{x:.2,y:1.75},{x:-.2,y:1.75}],z:.12,depth:.25};
const headScreen={vertices:[{x:-.2,y:1.9},{x:.2,y:1.9},{x:.2,y:2.1},{x:-.2,y:2.1}],z:0,depth:.25};

test('una punta oculta conserva su última posición observada y no copia su pasado físico oculto',()=>{
  const sensor=new AIPerception(),{observer,target}=fixture(),first=sensor.observe(observer,target,.04);
  target.previousTip={x:9,y:9,z:9};
  const sensed=sensor.observe(observer,target,.04,{occluders:[bladeScreen]});
  assert.equal(sensed.tipVisible,false);assert.deepEqual(sensed.tip,first.tip);assert.deepEqual(sensed.previousTip,first.tip);
  assert.deepEqual(sensed.velocity,{vx:0,vy:0,vz:0});
});

test('una cabeza tapada no impide observar una punta visible a distinta altura y profundidad',()=>{
  const sensor=new AIPerception(),{observer,target}=fixture();sensor.observe(observer,target,.04);
  target.previousTip={...target.pose.tip};target.pose.tip={x:.2,y:1.4,z:.17};
  const sensed=sensor.observe(observer,target,.04,{occluders:[headScreen]});
  assert.equal(sensed.headVisible,false);assert.equal(sensed.tipVisible,true);assert.equal(sensed.tip.x,.2);assert.ok(sensed.velocity.vx<0);
  assert.equal(sensed.head.x,1,'la cabeza conserva la última observación propia');
});

test('el equipo que cambia detrás de un sólido no actualiza las tácticas hasta quedar visible',()=>{
  const sensor=new AIPerception(),{observer,target}=fixture(),first=sensor.observe(observer,target,.04);
  assert.equal(first.equipment.weapon,'sword');assert.equal(first.equipment.defense,'short');
  target.equipment={weapon:'spear',defense:'long'};target.previousTip={...target.pose.tip};
  const hidden=sensor.observe(observer,target,.04,{occluders:[bladeScreen]});
  assert.equal(hidden.equipment.weapon,'sword');assert.equal(hidden.equipment.defense,'short');
  const seen=sensor.observe(observer,target,.04);assert.equal(seen.equipment.weapon,'spear');assert.equal(seen.equipment.defense,'long');
});

test('la punta visible sin una cabeza conocida sólo publica amenaza y no una cabeza inventada',()=>{
  const sensor=new AIPerception(),{observer,target}=fixture();
  const sensed=sensor.observe(observer,target,.04,{occluders:[headScreen]});
  assert.ok(sensed);assert.equal(sensed.head,null);assert.equal(sensed.headVisible,false);assert.equal(sensed.tipVisible,true);
});

test('la memoria de una punta oculta caduca aunque la cabeza rival siga visible',()=>{
  const sensor=new AIPerception(),{observer,target}=fixture();sensor.observe(observer,target,.04);
  let sensed;for(let i=0;i<20;i++)sensed=sensor.observe(observer,target,.04,{occluders:[bladeScreen]});
  assert.equal(sensed.headVisible,true);assert.equal(sensed.tipVisible,false);assert.equal(sensed.tip,null);
  assert.ok(sensed.tipAge>.4);assert.equal(sensed.armed,false);
});

test('el piloto espera visibilidad antes de consumir un ataque preparado y después lo ejecuta',()=>{
  const g=new DuelEngine();g.setAIStyle('defender');g.phase='fight';const [target,observer]=g.fighters;
  const hand=observer.pose.mainHand,tip=observer.pose.tip,length=Math.hypot(tip.x-hand.x,tip.y-hand.y),pulse=1.02+.32*Math.exp(-STEP*7.8)+.1;
  target.pose.head={x:hand.x+(tip.x-hand.x)/length*pulse+observer.dir*.1,y:hand.y+(tip.y-hand.y)/length*pulse+.04,z:.025};
  let blocked=false;const original=observer.perception.observe.bind(observer.perception);
  const wall={vertices:[{x:-.2,y:0},{x:.2,y:0},{x:.2,y:4},{x:-.2,y:4}],z:0,depth:1};
  observer.perception.observe=(f,t,dt,options)=>original(f,t,dt,{...options,occluders:blocked?[wall]:[]});
  g.updateAI(observer,.04);Object.assign(observer.ai,{state:'windup',time:.6,duration:.44,attackIssued:false,initialized:true});
  blocked=true;g.updateAI(observer,.04);
  assert.equal(observer.ai.state,'windup');assert.equal(observer.ai.attackIssued,false);assert.equal(observer.controller.thrust,false);
  blocked=false;g.updateAI(observer,.04);
  assert.equal(observer.ai.state,'attack');assert.equal(observer.ai.attackIssued,true);assert.equal(observer.controller.thrust,true);
});
