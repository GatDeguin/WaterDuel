import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,clamp} from '../public/engine.js';
import {SinglePlayerSession} from '../public/single-player.js';
import {ReplayRecorder,replayView} from '../public/replay.js';
import {weaponGesture} from '../public/joysticks.js';

test('Una perforación real completa los dos últimos objetivos antes de que el observador vea el paso',()=>{
 const s=new SinglePlayerSession();s.select('training');
 const g=new DuelEngine((name,data)=>s.event(name,data,g));g.aiEnabled=false;g.setScenario('practice');g.phase='fight';
 const run=(c,n,target=Infinity,observe=true)=>{for(let i=0;i<n&&s.view(g).progress<target;i++){g.setControl(1,c);g.update(STEP);if(observe)s.observe(g,STEP);}};
 // Keep the real blade lowered while learning distance. Walking a balloon
 // onto even a quiet tip is now a valid puncture, so it cannot isolate retreat.
 s.observe(g,STEP);run(weaponGesture({x:0,y:1}),96,1);run({},108,2);
 run({...weaponGesture({x:-1,y:-1}),lean:1},72,3);
 run({...weaponGesture({x:-1,y:-1}),lean:-1},144,4);
 run({...weaponGesture({x:-.9,y:.65}),lean:1},108,5);
 assert.equal(s.view(g).progress,5);
 assert.equal(g.phase,'fight');assert.deepEqual(g.scores,[0,0]);assert.ok(g.fighters.every(f=>f.globIntact));
 // No post-step observe call is allowed to credit the extension. The actual
 // collision event itself must advance both remaining objectives atomically.
 run({...weaponGesture({x:1,y:.63}),lean:1},216,7,false);
 assert.equal(g.scores[0],1,'a real legal puncture must occur');
 assert.equal(s.view(g).progress,7,'the phase change to burst must not hide the successful physical attack');
});

test('Las tres zonas de precisión pueden completarse mediante mandos, muñeca y contactos físicos',()=>{
 const s=new SinglePlayerSession();s.select('precision');const hits=[];
 const g=new DuelEngine((name,data)=>{
  const before=s.view(g).progress,target=name==='burst'?s.view(g).target:null;
  s.event(name,data,g);
  if(name==='burst')hits.push({...data,target,before,after:s.view(g).progress,clock:g.clock,
   error:Math.hypot(data.impact.x-target.x,data.impact.y-target.y,data.impact.z-target.z)});
 });g.setScenario('practice');g.aiEnabled=false;g.start();
 let lastFighter=null,stage='withdraw',wrist=.35,settled=0;
 for(let i=0;i<9600&&!s.view(g).completed;i++){
  if(g.phase==='fight'||g.phase==='countdown'){
   const f=g.fighters[0],target=s.view(g).target,hand=f.pose.mainHand;
   if(f!==lastFighter){lastFighter=f;stage='withdraw';wrist=.35;settled=0;}
   const desired=Math.atan2(target.y-hand.y,Math.max(.3,f.dir*(target.x-hand.x)));
   const actual=Math.atan2(f.pose.tip.y-hand.y,f.dir*(f.pose.tip.x-hand.x));
   const error=Math.atan2(Math.sin(desired-actual),Math.cos(desired-actual));
   // Prepare the real arm outside balloon reach, then let its finite motors
   // settle on the selected zone. The generic duel AI aims at the centre and
   // cannot supply the preparation state for the upper/lower precision zones.
   if(g.phase==='fight'){
    wrist=clamp(wrist+error*STEP*1.5,-1,1);
    if(stage==='withdraw'&&f.baseX<=-2.15){stage='extend';settled=0;}
    if(stage==='extend'){
     settled=Math.abs(error)<.025?settled+STEP:0;
     if(settled>=.25)stage='approach';
    }
   }
   const c=weaponGesture({x:stage==='withdraw'?-.6:.6,y:.8});c.wrist=wrist;
   const gap=Math.hypot(target.x-hand.x,target.y-hand.y)-Math.hypot(f.pose.tip.x-hand.x,f.pose.tip.y-hand.y);
   c.lean=stage==='withdraw'?-1:stage==='approach'&&Math.abs(error)<.035?clamp((gap+.06)*1.5,0,.35):0;
   g.setControl(1,c);
  }
  g.update(STEP);s.observe(g,STEP);
 }
 assert.equal(s.view(g).progress,3,`three legal targets required; ${hits.length} punctures were observed`);
 assert.ok(hits.length>=3);assert.ok(hits.every(hit=>hit.contact&&hit.winner===1&&hit.relativeSpeed>0&&!hit.demonstration));
 const credited=hits.filter(hit=>hit.after>hit.before);
 assert.deepEqual(credited.map(hit=>hit.before),[0,1,2],'each original zone must be credited by its own physical contact');
 assert.ok(credited.every(hit=>hit.target.radius===.13&&hit.error<=hit.target.radius),'capture the real marker and XYZ impact inside burst, before the next round');
});

test('Un atacante movido por los motores reales perfora el blanco, valida precisión y produce replay aislado',()=>{
  const objectives=new SinglePlayerSession(),recorder=new ReplayRecorder({sampleHz:10,beforeSeconds:.2,afterSeconds:.2,maxClips:1,maxBytes:8*1024*1024});
  objectives.select('precision');const events=[];
  const g=new DuelEngine((name,data)=>{objectives.event(name,data,g);recorder.event(name,data);if(name==='burst')events.push(data);});
  g.setScenario('practice');g.aiEnabled=false;g.start();
  // Exercise the public controller path and the actual coupled rig. No pose,
  // tip, membrane, score or contact is assigned by the test.
  let firstImpactAt=-1;
  for(let i=0;i<3600;i++){
    if(g.phase==='fight')g.updateAI(g.fighters[0],STEP);
    g.update(STEP);objectives.observe(g,STEP);recorder.record(g,STEP);
    if(events.length&&firstImpactAt<0)firstImpactAt=i;
    if(firstImpactAt>=0&&i-firstImpactAt>30)break;
  }
  assert.equal(events.length,1,'the legal controller must reach the neutral balloon');
  const impact=events[0];assert.equal(impact.contact,true);assert.equal(impact.demonstration,false);assert.equal(impact.winner,1);
  assert.ok(impact.relativeSpeed>0);assert.equal(g.fighters[1].membrane.punctured,true);
  assert.equal(objectives.view(g).progress,1,'the first central target must be physically reachable');
  const clips=recorder.clips;assert.equal(clips.length,1);assert.equal(clips[0].complete,true);
  const saved=clips[0].frames.at(-1),view=replayView(saved),score=g.scores.slice(),clock=g.clock;
  assert.equal(view.fighters[1].membrane.punctured,true);
  assert.ok(view.fighters[1].fluid.releasedParticles.length>0);
  view.fighters[1].fluid.particles[0].x=999;view.scores[0]=999;view.fighters[1].membrane.mesh().p[0]=999;
  assert.deepEqual(g.scores,score);assert.equal(g.clock,clock);assert.notEqual(saved.fighters[1].membrane.mesh.p[0],999);
  assert.ok(g.fighters[1].fluid.particles.every(p=>p.x!==999));
});
