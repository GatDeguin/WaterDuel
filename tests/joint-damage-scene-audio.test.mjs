import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine} from '../public/engine.js';
import {AudioScene} from '../public/audio/scene-audio.js';

const H=1/60;
const names=cues=>cues.map(cue=>cue.name);
function fixture(slot=1,weapon='sword'){
  const game=new DuelEngine();game.setMode('versus');game.setLoadout(slot,{weapon,defense:'short'});
  return {game,f:game.fighters[slot-1],audio:new AudioScene()};
}
function detach(game,f,...joints){for(const joint of joints)assert.equal(f.rig.damageJoint(joint,1).detached,true);game.refreshRigPose(f);}

test('Disconnected parent arm and foot points cannot invent wood, hinge, blade or foot cues',()=>{
  for(const slot of [1,2]){
    const {game,f,audio}=fixture(slot);detach(game,f,'mainShoulder','offShoulder','frontKnee','backKnee');
    assert.equal(f.rig.contacts.length,0);audio.update(game,H);
    for(let i=0;i<5;i++){
      for(const key of ['mainElbow','mainHand','offElbow','offHand','tip','footF','footB']){f.pose[key].x+=.07;f.pose[key].y+=key.startsWith('foot')?0:.025;}
      assert.deepEqual(audio.update(game,H),[],`slot ${slot}: disconnected parent points are not physical motion`);
    }
  }
});

test('Detached physical weapon motion still moves air at its real point and source mass',()=>{
  for(const slot of [1,2])for(const weapon of ['sword','maul']){
    const {game,f,audio}=fixture(slot,weapon);detach(game,f,'wrist');audio.update(game,H);
    const fragment=f.rig.fragments.find(part=>part.bodyNames.includes('weapon'));
    fragment.x+=.03;
    const cues=audio.update(game,H),swish=cues.find(cue=>cue.name==='blade-swish');
    assert.ok(swish,`${slot}/${weapon}: a moving real fragment must sound`);
    const tip=fragment.worldPointAt(fragment.sourcePose.tip,1),speed=.03/H,mass=weapon==='maul'?.48:.16;
    assert.ok(Math.abs(swish.x-tip.x)<1e-12);
    assert.ok(Math.abs(swish.intensity-Math.min(1,.08+speed*.13*Math.sqrt(mass/.16)))<1e-12);
    assert.ok(Math.abs(swish.rate-(.88+Math.min(speed,8)*.055-Math.log2(mass/.16)*.09))<1e-12);
    assert.ok(!names(cues).includes('wood')&&!names(cues).includes('joint'),'rigid debris is not a working timber hinge');
  }
});

test('A fracture establishes a new blade baseline and missing fragment data stays silent',()=>{
  const {game,f,audio}=fixture();audio.update(game,H);detach(game,f,'mainElbow');
  f.rig.fragments[0].x+=.1;
  assert.ok(!names(audio.update(game,H)).includes('blade-swish'),'do not bridge attached and detached actors');
  f.rig.fragments.length=0;
  for(let i=0;i<3;i++){f.pose.mainHand.x+=.06;f.pose.tip.x+=.06;assert.ok(!names(audio.update(game,H)).includes('blade-swish'));}
});

test('Owned pose-only views exclude disconnected limbs without requiring a solver',()=>{
  const {game,f,audio}=fixture();detach(game,f,'mainShoulder','offShoulder','frontKnee','backKnee');
  delete f.rig;audio.update(game,H);
  for(const key of ['mainElbow','mainHand','offElbow','offHand','tip','footF','footB'])f.pose[key].x+=.08;
  assert.deepEqual(audio.update(game,H),[]);
});
