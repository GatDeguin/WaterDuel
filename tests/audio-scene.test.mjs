import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine} from '../public/engine.js';
import {FluidVolume} from '../public/physics/fluid.js';
import {TABLE_TOP,waterDropRadius} from '../public/physics/dimensions.js';
import {AudioScene} from '../public/audio/scene-audio.js';

const H=1/60;
const observer=()=>new AudioScene();
const game=()=>new DuelEngine();
const names=cues=>cues.map(c=>c.name);
function move(f,amount){
  f.pose.mainHand.x+=amount;f.pose.mainHand.y+=amount*.5;
  f.pose.mainElbow.y+=amount*.25;f.pose.head.x+=amount*.2;
  f.pose.tip.x+=amount*2;f.pose.tip.y+=amount;
}
function soundState(g){return JSON.stringify({fighters:g.fighters,particles:g.particles,phase:g.phase,scores:g.scores,clock:g.clock});}

test('stationary real engine state and visual-only particles stay silent',()=>{
  const g=game(),s=observer();assert.deepEqual(s.update(g,H),[]);
  for(let i=0;i<120;i++){
    g.particles=[{x:-1,y:TABLE_TOP,vy:-5,wet:true,age:i*H}];
    assert.deepEqual(s.update(g,H),[],'render glints must never become physical water impacts');
  }
});

test('observed motion produces wood, joints and air movement without mutating the engine',()=>{
  const g=game(),s=observer();s.update(g,H);move(g.fighters[0],.03);
  const before=soundState(g),cues=s.update(g,H);
  assert.ok(names(cues).includes('wood'));assert.ok(names(cues).includes('joint'));assert.ok(names(cues).includes('blade-swish'));
  assert.equal(soundState(g),before);
  for(const c of cues){assert.ok(Number.isFinite(c.x)&&c.x>=-4&&c.x<=4);assert.ok(Number.isFinite(c.intensity)&&c.intensity>0&&c.intensity<=1);}
});

test('motion gates use elapsed seconds with comparable cue density at 30 and 60 Hz',()=>{
  const run=hz=>{const g=game(),s=observer();s.update(g,1/hz);let count=0;
    for(let i=0;i<hz*3;i++){move(g.fighters[0],.7/hz);count+=s.update(g,1/hz).filter(c=>c.name==='wood').length;}return count;};
  const slow=run(30),fast=run(60);assert.ok(slow>=8&&slow<=20,`bounded wood density ${slow}`);
  assert.ok(Math.abs(slow-fast)<=2,`30Hz=${slow}, 60Hz=${fast}`);
});

test('reset, replacement fighters and pose teleports establish a silent baseline',()=>{
  const g=game(),s=observer();s.update(g,H);move(g.fighters[0],.03);s.update(g,H);
  s.reset();move(g.fighters[0],.03);assert.deepEqual(s.update(g,H),[]);
  g.resetRound();assert.deepEqual(s.update(g,H),[]);
  for(const p of Object.values(g.fighters[0].pose))if(p&&typeof p==='object'&&Number.isFinite(p.x))p.x+=9;
  assert.deepEqual(s.update(g,H),[]);assert.deepEqual(s.update(g,H),[]);
});

test('slosh follows changes of the actual contained-water surface',()=>{
  const g=game(),s=observer(),f=g.fighters[0];s.update(g,H);
  f.fluid.keepContained(f.pose.head,H,.18,.1);
  assert.ok(names(s.update(g,H)).includes('slosh'));
  for(let i=0;i<30;i++)assert.ok(!names(s.update(g,H)).includes('slosh'),'unchanged tilted water is not continuing motion');
});

test('latex tension requires rising measured edge stretch instead of a timer or stress ornament',()=>{
  const g=game(),s=observer(),f=g.fighters[0];s.update(g,H);
  f.balloon.stress=1;f.balloon.wave=1;assert.deepEqual(s.update(g,H),[]);
  const support=f.membrane.support;
  for(const p of f.membrane.nodes){p.x=support.x+(p.x-support.x)*1.10;p.y=support.y+(p.y-support.y)*1.10;p.z=support.z+(p.z-support.z)*1.10;}
  assert.ok(names(s.update(g,H)).includes('tension'));
});

test('jet follows positive hydraulic discharge and stops when discharge stops',()=>{
  const g=game(),s=observer(),f=g.fighters[0];s.update(g,H);
  f.fluid.beginLeak({head:f.pose.head,impact:{x:f.pose.head.x-.422,y:f.pose.head.y,z:0}});
  f.fluid.advanceLeak(H,{head:f.pose.head,apertureArea:.06,pressure:.8});
  assert.ok(f.fluid.leakDischarged>0);assert.ok(names(s.update(g,H)).includes('jet'));
  for(let i=0;i<30;i++)assert.ok(!names(s.update(g,H)).includes('jet'),'no scheduled jet after flow stops');
});

function fallingWater(count=1){
  const fluid=new FluidVolume(1,200),head={x:-1,y:1,z:0};fluid.keepContained(head,H);
  fluid.beginLeak({head,impact:{x:-1.422,y:1,z:0}});
  for(let i=0;i<count;i++){
    const p=fluid.particles[i];fluid.releaseParticle(p,i,{});
    p.x=-1+i*.002;p.y=TABLE_TOP+waterDropRadius(p.volume)+.02;p.z=0;p.vx=0;p.vy=-1.6;p.vz=0;
  }
  const g=game();g.fighters[0].fluid=fluid;return {g,fluid};
}

test('real free-parcel first floor contacts produce a drip or grouped splash exactly once',()=>{
  for(const [count,want] of [[1,'drip'],[30,'splash']]){
    const {g,fluid}=fallingWater(count),s=observer();s.update(g,H);let cues=[];
    for(let i=0;i<30;i++){fluid.step(1/120);cues.push(...s.update(g,1/120));}
    assert.ok(fluid.wetCount>0);assert.equal(cues.filter(c=>c.name===want).length,1,`physical ${want}`);
    for(let i=0;i<30;i++)assert.ok(!s.update(g,H).some(c=>c.name==='drip'||c.name==='splash'));
    s.reset();assert.deepEqual(s.update(g,H),[],'already wet parcels cannot replay their impact');
  }
});

test('missing data, invalid time and nonfinite measurements cannot generate unsafe cues',()=>{
  const s=observer();for(const value of [null,{}, {fighters:[]}, {fighters:[{}]}])assert.deepEqual(s.update(value,H),[]);
  const g=game();s.update(g,H);
  for(const dt of [NaN,Infinity,-1,0,undefined])assert.deepEqual(s.update(g,dt),[]);
  s.update(g,H);g.fighters[0].pose.mainHand.x=Infinity;g.fighters[0].fluid.leakDischarged=NaN;
  g.fighters[0].membrane.nodes[0].x=NaN;
  for(const c of s.update(g,1000)){assert.ok(Number.isFinite(c.x));assert.ok(Number.isFinite(c.intensity)&&c.intensity>=0&&c.intensity<=1);}
});

test('physical scans and emitted cue bursts remain bounded under oversized state',()=>{
  const g=game(),s=observer();
  for(const f of g.fighters){
    f.fluid.particles.length=100000;
    Object.defineProperty(f.fluid.particles,320,{get(){throw new Error('audio exceeded its parcel scan cap');}});
  }
  assert.doesNotThrow(()=>s.update(g,H));
  for(const f of g.fighters){move(f,.03);f.fluid.lastSlosh=.3;f.fluid.surfaceFrame.rotation=[1,.3,0,.3,1,0,0,0,1];f.fluid.leakDischarged=.002;f.fluid.leaking=true;}
  const cues=s.update(g,H);assert.ok(cues.length>0&&cues.length<=8);
});

test('pure world-space hand extension sounds a blade swish without angular change or thrust event',()=>{
  const g=game(),s=observer(),f=g.fighters[0],relative=f.pose.tip.x-f.pose.mainHand.x;s.update(g,H);
  f.pose.mainHand.x+=.025;f.pose.tip.x+=.025;
  assert.ok(Math.abs(f.pose.tip.x-f.pose.mainHand.x-relative)<1e-12);
  const before=soundState(g),cues=s.update(g,H),swish=cues.find(c=>c.name==='blade-swish');
  assert.ok(swish,'linear joystick extension must move air even when the blade vector is constant');
  assert.ok(Number.isFinite(swish.rate)&&swish.rate>=.7&&swish.rate<=1.4);
  assert.equal(soundState(g),before);
});

test('observed blade speed and physical weapon mass shape swish dynamics and pitch',()=>{
  const sample=(weapon,travel)=>{
    const g=game();assert.equal(g.setLoadout(1,{weapon,defense:'none'}),true);
    const s=observer(),f=g.fighters[0];s.update(g,H);f.pose.mainHand.x+=travel;f.pose.tip.x+=travel;
    return s.update(g,H).find(c=>c.name==='blade-swish');
  };
  const slow=sample('sword',.012),fast=sample('sword',.04),heavy=sample('maul',.04);
  assert.ok(slow&&fast&&heavy);assert.ok(fast.intensity>slow.intensity);assert.ok(fast.rate>slow.rate);
  assert.ok(heavy.intensity>fast.intensity);assert.ok(heavy.rate<fast.rate);
});

const steps=cues=>cues.filter(c=>c.name==='footstep-dry'||c.name==='footstep-wet');
test('stationary support stays silent even in puddles; only observed grounded sliding sounds dry or wet',()=>{
  for(const [wet,want] of [[0,'footstep-dry'],[.8,'footstep-wet']]){
    const g=game(),s=observer(),f=g.fighters[0];g.puddleStrength[0]=wet;s.update(g,H);
    for(let i=0;i<60;i++)assert.equal(steps(s.update(g,H)).length,0);
    let cues=[];for(let i=0;i<4;i++){f.pose.footF.x+=.025;cues.push(...s.update(g,H));}
    assert.equal(steps(cues).length,1);assert.equal(steps(cues)[0].name,want);
    assert.ok(Math.abs(steps(cues)[0].x-f.pose.footF.x)<.04);
    for(let i=0;i<60;i++)assert.equal(steps(s.update(g,H)).length,0,'no periodic step after movement stops');
  }
});

test('airborne foot motion stays silent until a measured landing at the physical standing height',()=>{
  const g=game(),s=observer(),f=g.fighters[0],support=f.rig.contacts.find(c=>c.key==='footF');
  s.update(g,H);support.stance=false;f.pose.footF.y=TABLE_TOP+.075+.09;
  assert.equal(steps(s.update(g,H)).length,0);
  f.pose.footF.x+=.12;assert.equal(steps(s.update(g,H)).length,0);
  f.pose.footF.y-=.05;assert.equal(steps(s.update(g,H)).length,0);
  support.stance=true;f.pose.footF.y=TABLE_TOP+.075;
  assert.deepEqual(steps(s.update(g,H)).map(c=>c.name),['footstep-dry']);
  support.stance=false;s.update(g,H);support.stance=true;
  assert.equal(steps(s.update(g,H)).length,0,'support flags without measured travel cannot fabricate another landing');
});

test('foot slide density uses distance and elapsed seconds consistently at 30 and 60 Hz',()=>{
  const run=hz=>{const g=game(),s=observer(),f=g.fighters[0];s.update(g,1/hz);let count=0;
    for(let i=0;i<hz*3;i++){f.pose.footF.x+=.4/hz;count+=steps(s.update(g,1/hz)).length;}return count;};
  const slow=run(30),fast=run(60);assert.ok(slow>=8&&slow<=20,`bounded physical slide density ${slow}`);
  assert.ok(Math.abs(slow-fast)<=2,`30Hz=${slow},60Hz=${fast}`);
});

test('foot-only teleports and observer reset discard travel instead of replaying steps',()=>{
  const g=game(),s=observer(),f=g.fighters[0];s.update(g,H);
  f.pose.footF.x+=.04;s.update(g,H);s.reset();f.pose.footF.x+=.04;
  assert.deepEqual(s.update(g,H),[]);assert.equal(steps(s.update(g,H)).length,0);
  f.pose.footF.x+=2;f.pose.mainHand.x+=.025;f.pose.tip.x+=.025;
  assert.deepEqual(s.update(g,H),[],'a foot-only discontinuity also discards coincident body movement');
  assert.deepEqual(s.update(g,H),[]);
});

test('a landing suppressed by the foot rate gate is discarded instead of delayed into a later tiny slide',()=>{
  const g=game(),s=observer(),f=g.fighters[0],support=f.rig.contacts.find(c=>c.key==='footF');s.update(g,H);
  f.pose.footF.x+=.07;assert.equal(steps(s.update(g,H)).length,1);
  support.stance=false;f.pose.footF.y+=.09;s.update(g,H);
  support.stance=true;f.pose.footF.y=TABLE_TOP+.075;assert.equal(steps(s.update(g,H)).length,0);
  for(let i=0;i<30;i++)assert.equal(steps(s.update(g,H)).length,0);
  f.pose.footF.x+=.002;assert.equal(steps(s.update(g,H)).length,0,'old airborne travel is not a new ground slide');
});
