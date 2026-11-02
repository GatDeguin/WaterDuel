import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioScene} from '../public/audio/scene-audio.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {DuelEngine,STEP} from '../public/engine.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

const H=1/60,steps=cues=>cues.filter(c=>c.name==='footstep-dry'||c.name==='footstep-wet');
function fixture(dir=1,scale=1,wet=0){
 const rig=new ArticulatedRig({dir,scale}),fighter={slot:1,dir,boss:scale>1.1,rig,pose:rig.pose(),equipment:{weapon:'sword',defense:'none'}};
 const game={fighters:[fighter],clock:0,puddleStrength:[wet,0]},audio=new AudioScene();
 const refresh=()=>{fighter.pose=rig.pose();return fighter.pose;};
 const observe=()=>{game.clock+=H;const q=Array.from(rig.q),pose=JSON.stringify(fighter.pose),cues=audio.update(game,H);assert.deepEqual(Array.from(rig.q),q);assert.equal(JSON.stringify(fighter.pose),pose);return steps(cues);};
 return {rig,fighter,game,audio,refresh,observe};
}

test('N16 feet hovering 10 mm above the table cannot sound a slide through stale stance anchors',()=>{
 for(const dir of [-1,1])for(const scale of [1,1.18]){
  const x=fixture(dir,scale);x.rig.q[1]+=.01;x.refresh();
  assert.ok(x.rig.contacts.every(c=>c.stance));assert.ok(Object.values(x.fighter.pose.feet).every(foot=>!foot.stance&&foot.support.y>TABLE_TOP+.009));
  x.observe();x.rig.q[0]+=.07*dir;x.refresh();assert.deepEqual(x.observe(),[]);
 }
});

test('N16 heel or toe support sounds a real ground slide even when rolling moves its centre away from the old anchor',()=>{
 for(const dir of [-1,1])for(const scale of [1,1.18])for(const [side,key,index]of [['front','footF',14],['back','footB',15]]){
  const x=fixture(dir,scale);x.rig.q[index]+=.4;x.refresh();x.rig.q[1]+=TABLE_TOP-x.fighter.pose.feet[side].support.y;x.refresh();
  const foot=x.fighter.pose.feet[side],anchor=x.rig.contacts.find(c=>c.key===key);
  assert.equal(foot.stance,true);assert.ok(Math.abs(foot.support.y-TABLE_TOP)<1e-9);assert.ok(Math.abs(x.fighter.pose[key].y-anchor.floor)>.018,'the fixture must exercise the obsolete centre-height rejection');
  x.observe();x.rig.q[0]+=.07*dir;x.refresh();const cues=x.observe();
  assert.ok(cues.some(cue=>cue.name==='footstep-dry'&&Math.abs(cue.x-x.fighter.pose[key].x)<1e-9),`${dir}/${scale}/${side}: the physically supported foot must remain audible`);
 }
});

test('N16 measured landings retain dry and wet selection without replaying stationary support or mutating physics',()=>{
 for(const [wet,name]of [[0,'footstep-dry'],[.8,'footstep-wet']]){
  const x=fixture(1,1,wet),baseY=x.rig.q[1];x.rig.q[1]+=.09;x.refresh();assert.ok(Object.values(x.fighter.pose.feet).every(foot=>!foot.stance));x.observe();
  x.rig.q[0]+=.07;x.refresh();assert.deepEqual(x.observe(),[]);
  x.rig.q[1]=baseY;x.refresh();assert.ok(Object.values(x.fighter.pose.feet).every(foot=>foot.stance));
  assert.deepEqual(x.observe().map(c=>c.name),[name,name]);for(let i=0;i<20;i++)assert.deepEqual(x.observe(),[]);
 }
});

test('present but missing, nonfinite or contradictory N16 support stays silent instead of falling back to legacy centres',()=>{
 const corrupt=[
  ()=>undefined,()=>null,()=>({}),()=>[],
  feet=>Object.fromEntries(Object.entries(feet).map(([side,foot])=>[side,{...foot,support:undefined}])),
  ...['x','y','z'].map(axis=>feet=>Object.fromEntries(Object.entries(feet).map(([side,foot])=>[side,{...foot,support:{...foot.support,[axis]:NaN}}]))),
  feet=>Object.fromEntries(Object.entries(feet).map(([side,foot])=>[side,{...foot,stance:'yes'}])),
  feet=>Object.fromEntries(Object.entries(feet).map(([side,foot])=>[side,{...foot,stance:false}])),
  ...[-.003,.003].map(offset=>feet=>Object.fromEntries(Object.entries(feet).map(([side,foot])=>[side,{...foot,support:{...foot.support,y:TABLE_TOP+offset}}])))
 ];
 for(const invalidate of corrupt){
  const x=fixture();x.fighter.pose.feet=invalidate(x.fighter.pose.feet);x.observe();x.rig.q[0]+=.07;x.refresh();x.fighter.pose.feet=invalidate(x.fighter.pose.feet);assert.deepEqual(x.observe(),[]);
 }
});

test('N16 detached feet cannot emit footsteps from their former parent coordinates',()=>{
 const x=fixture();assert.equal(x.rig.damageJoint('frontKnee',1).detached,true);assert.equal(x.rig.damageJoint('backKnee',1).detached,true);x.refresh();
 assert.ok(Object.values(x.fighter.pose.feet).every(foot=>!foot.stance));x.observe();
 for(let i=0;i<4;i++){x.rig.q[0]+=.07;x.refresh();assert.deepEqual(x.observe(),[]);}
});

test('actual N16 walking emits footsteps only from currently supported world-space feet',()=>{
 const game=new DuelEngine();game.setMode('versus');game.phase='fight';const audio=new AudioScene(),fighter=game.fighters[0];let count=0,airborne=false;
 audio.update(game,H);
 for(let tick=0;tick<180;tick++){
  game.setControl(1,{lean:-1});game.update(STEP);if(tick%2===0)continue;
  const before=JSON.stringify({pose:fighter.pose,q:Array.from(fighter.rig.q),scores:game.scores,clock:game.clock});
  const cues=steps(audio.update(game,H));assert.equal(JSON.stringify({pose:fighter.pose,q:Array.from(fighter.rig.q),scores:game.scores,clock:game.clock}),before);
  airborne||=Object.values(fighter.pose.feet).some(foot=>!foot.stance);
  for(const cue of cues){
   const actor=game.fighters.find(f=>Object.values(f.pose.feet).some(foot=>Math.abs(foot.center.x-cue.x)<1e-9&&Math.abs(foot.center.z-cue.z)<1e-9));assert.ok(actor);
   const foot=Object.values(actor.pose.feet).find(foot=>Math.abs(foot.center.x-cue.x)<1e-9&&Math.abs(foot.center.z-cue.z)<1e-9);
   assert.equal(foot.stance,true);assert.ok(Math.abs(foot.support.y-TABLE_TOP)<=.002);count++;
  }
 }
 assert.ok(airborne,'the real gait must exercise a lifted foot');assert.ok(count>0,'walking must remain audible');assert.deepEqual(game.scores,[0,0]);
});
