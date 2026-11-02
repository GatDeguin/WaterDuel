import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {getWeapon} from '../public/equipment.js';

function pilot(difficulty='normal'){
  const g=new DuelEngine();if(difficulty!=='normal')g.setDifficulty(difficulty);g.phase='fight';const f=g.fighters[1],w=getWeapon(f),hand=f.pose.mainHand,tip=f.pose.tip;
  const length=Math.hypot(tip.x-hand.x,tip.y-hand.y),pulse=w.length+w.lungeReach*Math.exp(-STEP*w.lungeDecay)+w.extension;
  let observation={head:{x:hand.x+(tip.x-hand.x)/length*pulse+f.dir*.04,y:hand.y+(tip.y-hand.y)/length*pulse,z:tip.z},
    headVisible:true,headVelocity:{vx:0,vy:0,vz:0},balloonSize:1,tip:null,tipVisible:false,armed:false,velocity:{vx:0,vy:0,vz:0},equipment:{weapon:'sword',defense:'short'}};
  f.perception.observe=()=>observation;
  Object.assign(f.ai,{initialized:true,state:'attack',time:0,duration:.23,cycle:0,pattern:'direct',aimY:.3,attackIssued:false});
  return {g,f,observation,step:()=>{g.clock+=STEP;g.updateAI(f,STEP);return {...f.controller};},observe:value=>{observation={...observation,...value};}};
}

test('a balanced preparation cannot consume its attack while the actual weapon is disengaging',()=>{
  const {g,f,step}=pilot(),pose=structuredClone(f.pose),q=[...f.rig.q];
  Object.assign(f.ai,{state:'windup',time:1.2,duration:.44,disengage:'withdraw',disengageTime:0});
  const c=step();assert.equal(f.ai.state,'windup');assert.equal(f.ai.attackIssued,false);assert.equal(c.thrust,false);
  assert.equal(f.ai.readyToThrust,true,'the observed reach can be ready while the withdrawal still owns the actuator');
  assert.deepEqual(f.pose,pose);assert.deepEqual([...f.rig.q],q);assert.deepEqual(g.scores,[0,0]);
});

test('a temporarily hidden target cancels the output without consuming the single attack intent',()=>{
  const {f,step,observe}=pilot();observe({headVisible:false});
  assert.equal(step().thrust,false);assert.equal(f.ai.attackIssued,false);
  observe({headVisible:true});assert.equal(step().thrust,true);assert.equal(f.ai.attackIssued,true);
  for(let i=0;i<8;i++)assert.equal(step().thrust,false,'one attack phase cannot issue duplicate pulses');
});

test('a same-tick blocked aim withdraws before the commitment latch and can later deliver exactly once',()=>{
  const {f,step,observe,observation}=pilot();
  Object.assign(f.ai,{blockedAimTime:.35,disengageCooldown:0});observe({head:{...observation.head,y:observation.head.y+1.3}});
  assert.equal(step().thrust,false);assert.equal(f.ai.disengage,'withdraw');assert.equal(f.ai.attackIssued,false);
  Object.assign(f.ai,{disengage:null,blockedAimTime:0,disengageCooldown:1.5});observe({head:observation.head});
  assert.equal(step().thrust,true);assert.equal(f.ai.attackIssued,true);assert.equal(step().thrust,false);
});

test('the balanced boss signals height early and releases that cue before settling its observed aim',()=>{
  const command=(pattern,time)=>{
    const x=pilot('boss');Object.assign(x.f.ai,{state:'windup',pattern,time,duration:1,aimY:.3});return x.step();
  };
  const high=command('high',.1),direct=command('direct',.1);
  assert.ok(high.mainY-direct.mainY>.1,'the early raised preparation must remain legible');
  const settledHigh=command('high',.8),settledDirect=command('direct',.8);
  assert.ok(Math.abs(settledHigh.mainY-settledDirect.mainY)<1e-12,'a permanent height cue cannot fight a saturated wrist');
  assert.ok(Math.abs(settledHigh.wrist-settledDirect.wrist)<1e-12);
  assert.equal(settledHigh.thrust,false);assert.equal(settledHigh.guard,false);
});

test('a committed cautious preparation keeps its available torso reach until the observed blade can thrust',()=>{
  for(const style of ['defender','counter']){
    const {g,f,step,observe}=pilot();g.aiStyle=style;
    const pose=structuredClone(f.pose),q=[...f.rig.q];
    observe({head:{x:f.pose.tip.x+f.dir*.5,y:f.pose.tip.y+.6,z:f.pose.tip.z}});
    Object.assign(f.ai,{state:'windup',time:.3,duration:1,committed:true,patience:3});
    const c=step();assert.equal(f.ai.readyToThrust,false);assert.ok(f.ai.projectedReach>1);
    assert.equal(c.lean,1,'short observed reach must not trim the committed torso actuator');
    assert.equal(c.thrust,false,'preparation still cannot bypass physical readiness');
    assert.deepEqual(f.pose,pose);assert.deepEqual([...f.rig.q],q);assert.deepEqual(g.scores,[0,0]);
    observe({tip:{...f.pose.head},tipVisible:true});
    assert.ok(step().lean<=-.5,'an observed dangerous point still overrides the approach');
  }
});

test('the boss keeps its authored torso reach while observed readiness is short and still yields to a dangerous point',()=>{
  const {g,f,step,observe}=pilot('boss'),pose=structuredClone(f.pose),q=[...f.rig.q];
  observe({head:{x:f.pose.tip.x+f.dir*.5,y:f.pose.tip.y+.6,z:f.pose.tip.z}});
  Object.assign(f.ai,{state:'windup',time:.3,duration:1,committed:false});
  const c=step();assert.equal(f.ai.readyToThrust,false);assert.ok(f.ai.projectedReach>1);
  assert.equal(c.lean,1,'a visibly unfinished boss preparation still needs its ordinary torso actuator');
  assert.equal(c.thrust,false);assert.deepEqual(f.pose,pose);assert.deepEqual([...f.rig.q],q);assert.deepEqual(g.scores,[0,0]);
  observe({tip:{...f.pose.head},tipVisible:true});assert.ok(step().lean<=-.5,'observed danger overrides the boss approach too');
});

test('the normal physical replay takes initiative and awards a point only through a real puncture',()=>{
  const events=[],g=new DuelEngine((name,data)=>{if(['burst','thrust','ai-state'].includes(name))events.push({name,data});});g.start();
  for(let i=0;i<3600&&!events.some(e=>e.name==='burst');i++){g.setControl(1,{lean:-1});g.update(STEP);}
  const bursts=events.filter(e=>e.name==='burst');assert.equal(bursts.length,1);
  assert.equal(bursts[0].data.winner,2);assert.equal(bursts[0].data.contact,true);assert.equal(bursts[0].data.demonstration,false);assert.ok(bursts[0].data.relativeSpeed>0);
  assert.deepEqual(g.scores,[0,1]);assert.equal(g.fighters[0].globIntact,false);assert.equal(g.fighters[1].globIntact,true);
  assert.ok(events.some(e=>e.name==='thrust'&&e.data.slot===2),'an attack state alone does not prove that a pulse reached the motor');
});
