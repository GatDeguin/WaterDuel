import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';

function runDuel(control,{stopAtWindupExit=false}={}){
  const events=[];
  const game=new DuelEngine((name,data)=>{
    if(name==='burst'||(name==='ai-state'||name==='thrust')&&data.slot===2){
      const {ai,rig}=game.fighters[1];
      events.push({name,data,time:game.elapsed,reach:ai.projectedReach,bodyDepth:rig.bodyDepth});
    }
  });
  game.start();
  for(let i=0;i<81;i++)game.update(.04);
  assert.equal(game.phase,'fight');
  const [player,opponent]=game.fighters;
  const initialTipZ=opponent.pose.tip.z;
  let bodyDepth=0,bladeDepth=0,playerDepth=0,firstDepthTime=null;
  let windup=null,exit=null;
  for(let i=0;i<8/STEP&&game.phase==='fight';i++){
    game.setControl(1,control);
    game.update(STEP);
    playerDepth=Math.min(playerDepth,player.rig.bodyDepth);
    const tipTravel=opponent.pose.tip.z-initialTipZ;
    if(Math.abs(opponent.rig.bodyDepth)>Math.abs(bodyDepth))bodyDepth=opponent.rig.bodyDepth;
    if(Math.abs(tipTravel)>Math.abs(bladeDepth))bladeDepth=tipTravel;
    if(firstDepthTime===null&&opponent.rig.bodyDepth<-.02)firstDepthTime=game.elapsed;
    windup??=events.find(e=>e.name==='ai-state'&&e.data.state==='windup');
    if(windup){
      exit??=events.find(e=>e.time>windup.time&&e.name==='ai-state'&&e.data.state!=='windup');
      if(stopAtWindupExit&&exit)break;
    }
  }
  return {game,events,windup,exit,bodyDepth,bladeDepth,playerDepth,firstDepthTime};
}

function assertPhysicalScore({game,events}){
  const thrusts=events.filter(e=>e.name==='thrust');
  assert.ok(thrusts.every(e=>e.reach<=1),'each AI thrust needs physical 3D reach');
  const burst=events.find(e=>e.name==='burst');
  if(!burst){
    assert.deepEqual(game.scores,[0,0]);
    return;
  }
  assert.equal(burst.data.contact,true);
  assert.equal(burst.data.demonstration,false);
  assert.ok(burst.data.relativeSpeed>0);
  assert.equal(burst.data.winner,2);
  assert.deepEqual(game.scores,[0,1]);
}

test('a neutral retreat stays in the blade plane and ends in physical contact',()=>{
  const result=runDuel({headZ:0,lean:-1});
  assert.equal(result.bodyDepth,0);
  assert.equal(result.bladeDepth,0);
  assert.equal(result.exit?.data.state,'attack');
  assert.ok(result.events.some(e=>e.name==='thrust'));
  assert.equal(result.game.phase,'burst');
  assertPhysicalScore(result);
});

test('the AI follows a visible tilted player with its body and blade before a reachable thrust',()=>{
  const result=runDuel({headZ:-1});
  assert.ok(result.playerDepth<-.25,'sustained tilt must displace the real target');
  assert.ok(result.bodyDepth<-.10&&result.bladeDepth<-.10,'the actual body and blade must follow into depth');
  assert.ok(result.windup&&result.firstDepthTime>=result.windup.time+result.windup.data.duration,
    'depth pursuit must follow the visible windup');
  assert.equal(result.exit?.data.state,'attack');
  assert.ok(result.events.some(e=>e.name==='thrust'&&e.bodyDepth<-.10));
  assert.equal(result.game.phase,'burst');
  assertPhysicalScore(result);
});

test('the AI exits windup when a sustained tilted retreat stays beyond its reach',()=>{
  const result=runDuel({headZ:-1,lean:-1},{stopAtWindupExit:true});
  assert.ok(result.playerDepth<-.25,'the player keeps dodging at the end of the retreat');
  assert.ok(result.windup,'the approaching AI starts a visible windup');
  assert.ok(result.bodyDepth<-.10&&result.bladeDepth<-.10,'the AI tries physical pursuit first');
  assert.ok(result.exit,'the AI must leave windup within eight seconds of the start of combat');
  assertPhysicalScore(result);
});
