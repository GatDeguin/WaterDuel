import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,FOOTWORK,STEP,neutral} from '../public/engine.js';
import {HostSession} from '../public/host-session.js';

const separation=g=>g.fighters[1].baseX-g.fighters[0].baseX;
function assertOpening(g,boss=false){
  assert.equal(g.phase,'countdown');
  assert.equal(separation(g),boss?4.0:3.8);
  for(const f of g.fighters){
    assert.ok(Math.abs(f.baseX)<=FOOTWORK.arenaHalfWidth);
    assert.equal(f.baseVX,0);assert.equal(f.globIntact,true);
    assert.ok(Math.abs(f.pose.hip.x-f.baseX)<.25,'physical rig uses the opening placement');
  }
}
test('starting either mode separates every selected primary weapon before countdown',()=>{
  for(const mode of ['versus','solo'])for(const weapon of ['sword','spear','axe','maul']){
    const g=new DuelEngine();g.setMode(mode);g.setLoadout(1,{weapon});g.setLoadout(2,{weapon});
    g.start();assertOpening(g);
    const placement=g.fighters.map(f=>f.baseX);
    for(let i=0;i<24;i++)g.update(STEP);
    assert.deepEqual(g.fighters.map(f=>f.baseX),placement,'standby/countdown does not walk back into the old close range');
  }
});
test('the boss opening preserves room inside the arena and a readable start',()=>{
  const g=new DuelEngine();g.setDifficulty('boss');g.setLoadout(2,{weapon:'spear',defense:'long'});g.start();assertOpening(g,true);
  for(let i=0;i<456;i++){g.setControl(1,neutral());g.update(STEP);}
  assert.equal(g.fighters[0].globIntact,true,'a newly spawned player survives the readable opening');
  assert.ok(separation(g)>=FOOTWORK.minSeparation);
});
test('the next round, rematch and campaign encounter each apply the opening again',()=>{
  const g=new DuelEngine();g.setMode('versus');g.start();
  g.phase='fight';g.burst(g.fighters[1],g.fighters[0],g.fighters[0].pose.tip);
  // Round transition is a management fixture; water/collapse have independent physical tests.
  g.phaseClock=3.25;g.update(STEP);assertOpening(g);assert.equal(g.round,2);
  g.phase='matchover';g.start();assertOpening(g);
  const h=new HostSession({opponentSeed:83});let request=0;
  const command=(command,value)=>h.handleCommand({type:'command',requestId:++request,sentAt:Date.now(),command,...(value===undefined?{}:{value})});
  assert.equal(command('setExperience','campaign').ok,true);assert.equal(command('start').ok,true);assertOpening(h.game);
  h.game.phase='matchover';h.game.winner=1;h.game.onEvent('matchover',{winner:1});
  assert.equal(command('nextEncounter').ok,true);assertOpening(h.game,h.game.fighters[1].boss);
});

test('practice exercises retain their teaching placement instead of adopting the duel opening',()=>{
  const g=new DuelEngine();g.setScenario('practice');const reference=separation(g);g.start();
  assert.equal(g.phase,'countdown');assert.equal(separation(g),reference);assert.equal(reference,3.06);
});
