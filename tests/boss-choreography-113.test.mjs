import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {getWeapon} from '../public/equipment.js';
import {weaponGesture} from '../public/joysticks.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';

function pilot({slot=2,phase=2,weapon='maul'}={}){
  const transitions=[],g=new DuelEngine((name,data)=>{if(name==='ai-state')transitions.push({...data,time:g.clock});});
  g.setDifficulty('boss');g.setAIStyle('boss');g.setLoadout(slot,{weapon,defense:'none'});g.phase='fight';g.scores[0]=phase===2?1:0;
  const f=g.fighters[slot-1];f.boss=true;
  const hand=f.pose.mainHand,tip=f.pose.tip,length=Math.hypot(tip.x-hand.x,tip.y-hand.y),w=getWeapon(f);
  const pulse=(w.length+w.lungeReach*Math.exp(-STEP*w.lungeDecay)+w.extension)*1.05;
  const head={x:hand.x+(tip.x-hand.x)/length*pulse+f.dir*.08,y:hand.y+(tip.y-hand.y)/length*pulse,z:tip.z};
  // A decision fixture supplies only a stationary observed head and no threat.
  // It cannot move the actor; whole-engine collisions are checked separately.
  f.perception.observe=()=>({head,headVisible:true,headVelocity:{vx:0,vy:0,vz:0},balloonSize:1,tip:null,tipVisible:false,armed:false,velocity:{vx:0,vy:0,vz:0},equipment:{weapon:'sword',defense:'short'}});
  const step=()=>{g.clock+=STEP;g.updateAI(f,STEP);return f.controller;};
  const at=(state,time,cycle=0,duration=.9)=>Object.assign(f.ai,{initialized:true,state,time,cycle,duration,attackIssued:false,pattern:['withdraw-high','draw-low','false-high','overhead'][cycle],aimY:.4});
  return {g,f,step,at,transitions};
}

test('boss phase two visibly withdraws before signaling high and low preparations in either direction',()=>{
  for(const slot of [1,2])for(const weapon of ['maul','sword','spear','axe']){
    const x=pilot({slot,weapon}),pose=structuredClone(x.f.pose),q=[...x.f.rig.q],scores=[...x.g.scores];
    x.at('windup',0,0);const withdraw={...x.step()};
    assert.ok(withdraw.mainX<0,'the hand must first collect the weapon instead of extending into the opponent');
    assert.equal(withdraw.thrust,false);assert.equal(withdraw.guard,false);
    x.at('windup',.30,0);const high={...x.step()};
    x.at('windup',.30,1);const low={...x.step()};
    assert.ok(high.mainY-low.mainY>.65,'high and low cues must survive aim correction');
    assert.ok(high.mainX<.4&&low.mainX<.4,'the weapon remains collected while its cue changes height');
    x.at('windup',.85,0);const settle={...x.step()};assert.equal(settle.mainX,1);
    assert.equal(settle.thrust,false);assert.equal(settle.guard,false);
    for(const c of [withdraw,high,low,settle])for(const key of ['mainX','mainY','wrist','lean'])assert.ok(Number.isFinite(c[key])&&Math.abs(c[key])<=1);
    assert.deepEqual(x.f.pose,pose);assert.deepEqual([...x.f.rig.q],q);assert.deepEqual(x.g.scores,scores);
  }
});

test('boss phase two authors four distinct preparations and keeps an exposed recovery of at least 1.27 seconds',()=>{
  const x=pilot(),patterns=[];
  for(let cycle=0;cycle<4;cycle++){
    x.at('observe',2,cycle,.62);x.step();patterns.push(x.f.ai.pattern);
    assert.ok(['windup','feint'].includes(x.f.ai.state));
    assert.ok(x.f.ai.duration>=.32,'every signal is deliberate rather than an instant follow-up');
    x.at('attack',.25,cycle,.23);x.step();
    assert.equal(x.f.ai.state,'recover');assert.ok(x.f.ai.duration>=1.27);
    assert.equal(x.f.controller.guard,false);assert.equal(x.f.controller.thrust,false);assert.ok(x.f.controller.lean>0);
  }
  assert.equal(new Set(patterns).size,4);assert.deepEqual(patterns,['withdraw-high','draw-low','false-high','overhead']);
});

test('phase two still has complete windups and emits one thrust per attack phase without reading hidden rival controls',()=>{
  const a=pilot({weapon:'sword'}),b=pilot({weapon:'sword'}),pose=structuredClone(a.f.pose);let thrusts=0;
  b.g.setControl(1,{mainX:1,mainY:1,lean:1,wrist:1,thrust:true,guard:true});
  for(let i=0;i<1900;i++){
    const ca=a.step(),cb=b.step();assert.deepEqual(ca,cb);thrusts+=Number(ca.thrust);
    if(a.f.ai.state!=='attack'){assert.equal(ca.thrust,false);if(a.f.ai.state==='recover')assert.equal(ca.guard,false);}
  }
  const attacks=a.transitions.filter(e=>e.state==='attack');assert.ok(attacks.length>=3);assert.equal(thrusts,attacks.length);
  for(let i=0;i<a.transitions.length;i++)if(a.transitions[i].state==='attack'){
    assert.equal(a.transitions[i-1].state,'windup');assert.ok(a.transitions[i].time-a.transitions[i-1].time>=.7);
  }
  assert.deepEqual(a.f.pose,pose);
});

test('the first phase and both opening guards retain their original state, timing and neutral approach',()=>{
  for(const phase of [1,2]){
    const x=pilot({phase,weapon:'maul'});
    for(let i=0;i<120;i++){
      x.step();assert.equal(x.f.ai.state,'observe');assert.equal(x.f.ai.duration,1.35);
      assert.deepEqual([x.f.controller.mainX,x.f.controller.mainY,x.f.controller.wrist,x.f.controller.lean,x.f.controller.thrust],[-.45,-.25,-.35,0,false]);
    }
  }
  const x=pilot({phase:1,weapon:'sword'});
  Object.assign(x.f.ai,{initialized:true,state:'observe',time:2,duration:.62,cycle:0,pattern:'direct'});x.step();
  assert.equal(x.f.ai.pattern,'high');assert.equal(x.f.ai.state,'windup');assert.ok(Math.abs(x.f.ai.duration-.87)<1e-12);
  Object.assign(x.f.ai,{state:'attack',time:.24,duration:.23,pattern:'high'});x.step();assert.equal(x.f.ai.duration,1.27);
});

test('the ordinary two-hand solver turns the high and low signals into different visible maul trajectories',()=>{
  const tips=[];
  for(const [cycle,pattern] of [[0,'withdraw-high'],[1,'draw-low']]){
    const g=new DuelEngine();g.setDifficulty('boss');g.setAIStyle('boss');g.setLoadout(2,{weapon:'maul',defense:'none'});g.phase='fight';g.scores[0]=1;
    const f=g.fighters[1];Object.assign(f.ai,{initialized:true,state:'windup',time:0,cycle,duration:.94,attackIssued:false,pattern,aimY:.4});
    // Start at a preparation boundary; all 45 subsequent ticks use the game's
    // own AI, joints, coupled grip, water load, collisions and fixed step.
    for(let n=0;n<45;n++)g.update(STEP);
    assert.equal(g.phase,'fight');assert.deepEqual(g.scores,[1,0]);assert.equal(f.ai.state,'windup');
    assert.equal(f.controller.thrust,false);assert.equal(f.equipment.defense,'none');tips.push({...f.pose.tip});
  }
  assert.ok(tips[0].y-tips[1].y>.12,'a different command alone is not proof of a different rendered weapon path');
});

test('the two-handed second-phase maul still punctures only through ordinary swept physical contact',()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data,time:g.elapsed}));
  g.setDifficulty('boss');g.setAIStyle('boss');g.setLoadout(2,{weapon:'maul',defense:'none'});g.phase='fight';
  g.scores[0]=1; // Phase-selection fixture; the next point must come from the solver.
  for(let i=0;i<3600&&g.phase==='fight';i++){g.setControl(1,{lean:-1});g.update(STEP);}
  const bursts=events.filter(e=>e.name==='burst');assert.equal(bursts.length,1);
  assert.equal(bursts[0].data.contact,true);assert.equal(bursts[0].data.demonstration,false);assert.equal(bursts[0].data.winner,2);
  assert.ok(bursts[0].data.relativeSpeed>0);assert.deepEqual(g.scores,[1,1]);assert.equal(g.fighters[0].globIntact,false);
  assert.ok(events.some(e=>e.name==='ai-state'&&e.data.phase===2&&e.data.pattern==='withdraw-high'&&e.data.state==='windup'));
});

test('a real parry and counterattack can puncture the second-phase boss during its exposed recovery',()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data,time:g.elapsed}));
  g.setDifficulty('boss');g.setAIStyle('boss');g.phase='fight';g.scores[0]=1;
  let parried=false,recovered=false,window=null;
  for(let i=0;i<3000&&g.phase==='fight';i++){
    const player=g.fighters[0],boss=g.fighters[1];g.updateAI(player,STEP);
    parried||=events.some(e=>e.name==='clang'&&e.data.defender===1);recovered||=parried&&boss.ai.state==='recover';
    if(!parried)g.setControl(1,{...player.controller,mainX:-1,mainY:-1,wrist:-1,thrust:false,lean:-1});
    else if(!recovered)g.setControl(1,{...player.controller,thrust:false});
    else g.setControl(1,{...weaponGesture({x:1,y:.85}),lean:0});
    if(parried){
      const head=player.pose.head,tip=boss.pose.tip;
      const danger=Math.hypot((tip.x-head.x)/BALLOON_RADII.x,(tip.y-head.y)/BALLOON_RADII.y,((tip.z??.17)-(head.z??.025))/BALLOON_RADII.z)<1.5;
      // Stay close enough in depth for the boss's committed stroke. Guard in
      // a crouch, then stand and close the gap when the point moves away.
      g.setControl(1,!recovered||danger?{...player.controller,mainX:1,mainY:.85,wrist:.55,thrust:false,attackHeld:false,
        guard:true,offX:.3,offY:1,lean:-1,headX:1,headZ:-.2,bodyY:-1}:
        {...weaponGesture({x:1,y:.55}),lean:1,headX:1,headZ:-.25,bodyY:0});
    }
    for(const key of ['offX','offY','mainX','mainY','lean','wrist','headX','headZ','bodyY'])assert.ok(Math.abs(player.controller[key]??0)<=1);
    g.update(STEP);if(g.scores[0]===2){window={state:boss.ai.state,time:boss.ai.time,duration:boss.ai.duration};break;}
  }
  assert.equal(parried,true);assert.equal(recovered,true);assert.deepEqual(g.scores,[2,0]);
  const burst=events.find(e=>e.name==='burst');assert.equal(burst.data.winner,1);assert.equal(burst.data.contact,true);assert.equal(burst.data.demonstration,false);
  assert.equal(window.state,'recover');assert.ok(window.time>0&&window.time<=window.duration);assert.ok(window.duration>=1.27);
});
