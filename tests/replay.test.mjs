import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';

const replay = await import('../public/replay.js').catch(()=>null);

test('La repetición conserva el equipo del contacto aunque cambie la selección actual',()=>{
  const game=new DuelEngine();
  game.fighters[0].equipment={weapon:'axe',defense:'knife'};
  game.fighters[1].equipment={weapon:'maul',defense:'none'};
  const frame=replay.captureReplayState(game);
  game.fighters[0].equipment.weapon='spear';
  const view=replay.replayView(frame);
  assert.deepEqual(view.fighters[0].equipment,{weapon:'axe',defense:'knife'});
  assert.deepEqual(view.fighters[1].equipment,{weapon:'maul',defense:'none'});
  view.fighters[0].equipment.defense='long';
  assert.equal(frame.fighters[0].equipment.defense,'knife');
  assert.equal(game.fighters[0].equipment.defense,'knife');
});

test('El recorder guarda 20 Hz antes y después de un contacto, sin eventos directos ni demo',()=>{
  assert.equal(typeof replay?.ReplayRecorder,'function','falta biblioteca acotada de contactos');
  const game=new DuelEngine(),recorder=new replay.ReplayRecorder();
  recorder.record(game,0);
  for(let i=0;i<40;i++){game.clock+=.05;recorder.record(game,.05);}
  assert.equal(recorder.event('burst',{winner:1,impact:{x:1,y:2,z:.17}}),false);
  assert.equal(recorder.event('burst',{contact:true,demonstration:true,winner:1}),false);
  assert.equal(recorder.pending,false);assert.equal(recorder.clips.length,0);
  const event={contact:true,winner:1,loser:2,score:[1,0],impact:{x:1,y:2,z:.17},relativeSpeed:2.5};
  assert.equal(recorder.event('burst',event),true);assert.equal(recorder.pending,true);
  event.impact.x=99;event.score[0]=99;
  game.clock+=.05;recorder.record(game,.05);
  for(let i=0;i<24;i++){game.clock+=.05;recorder.record(game,.05);}
  assert.equal(recorder.pending,false);assert.equal(recorder.clips.length,1);
  const clip=recorder.clips[0];
  assert.equal(clip.frames.length,65);assert.ok(Math.abs(clip.duration-3.2)<1e-10);
  assert.ok(Math.abs(clip.eventTime-clip.startTime-2)<1e-10);
  assert.deepEqual(clip.event.impact,{x:1,y:2,z:.17});assert.deepEqual(clip.event.score,[1,0]);
  assert.equal(clip.event.relativeSpeed,2.5);assert.equal(clip.complete,true);
  assert.ok(recorder.bytes>clip.bytes);assert.ok(recorder.bytes<=64*1024*1024);
  assert.deepEqual(game.scores,[0,0]);
});

test('Captura propia incluye látex y agua del motor real, sin conservar solver mutable',()=>{
  assert.equal(typeof replay?.captureReplayState,'function','falta la captura visual del motor');
  const game=new DuelEngine(),frame=replay.captureReplayState(game);
  assert.ok(frame.fighters[0].membrane.mesh.p instanceof Float32Array);
  assert.ok(frame.fighters[0].membrane.mesh.optics instanceof Float32Array);
  assert.ok(frame.fighters[0].fluid.particles.data instanceof Float32Array);
  const originalX=frame.fighters[0].pose.head.x;
  game.fighters[0].pose.head.x+=10;
  game.fighters[0].fluid.particles[0].x+=20;
  game.fighters[0].membrane.nodes[0].x+=30;
  assert.equal(frame.fighters[0].pose.head.x,originalX);
  assert.notEqual(frame.fighters[0].fluid.particles.data[0],game.fighters[0].fluid.particles[0].x);
  assert.equal('rig' in frame.fighters[0],false);
});

test('La vista reproduce superficie, partículas y malla nativa y sus cambios no alcanzan frame ni motor',()=>{
  assert.equal(typeof replay?.replayView,'function','falta adaptador para Renderer3D');
  const game=new DuelEngine();game.quality='ultra';game.cameraMode='detail';game.lightingMode='neutral';
  game.sparkAt(.2,.3,.4);game.rings.push({x:1,y:.27,z:.5,r:.1,age:.3,ttl:2,color:2});
  const frame=replay.captureReplayState(game),view=replay.replayView(frame),f=view.fighters[0],saved=frame.fighters[0];
  assert.equal(view.quality,'ultra');assert.equal(view.cameraMode,'detail');assert.equal(view.lightingMode,'neutral');
  assert.equal(f.fluid.releasedParticles.length,0);assert.equal(f.fluid.retainedParticles.length,200);
  assert.equal(f.fluid.retainedVolume,game.fighters[0].fluid.retainedVolume);
  assert.deepEqual(f.fluid.surfaceFrame,game.fighters[0].fluid.surfaceFrame);
  assert.deepEqual(f.membrane.mesh().p,saved.membrane.mesh.p);
  assert.deepEqual(f.membrane.mesh().optics,saved.membrane.mesh.optics);
  assert.equal(f.membrane.nodes[0].x,saved.membrane.knot.x);
  assert.equal(view.spark.length,13);assert.equal(view.rings.length,1);assert.equal(view.rings[0].color,2);
  f.pose.head.x=77;f.fluid.particles[0].x=88;f.membrane.mesh().p[0]=99;f.fluid.surfaceFrame.rotation[0]=42;view.scores[0]=9;
  assert.notEqual(saved.pose.head.x,77);assert.notEqual(saved.fluid.particles.data[0],88);assert.notEqual(saved.membrane.mesh.p[0],99);
  assert.notEqual(saved.fluid.surfaceFrame.rotation[0],42);assert.deepEqual(game.scores,[0,0]);assert.deepEqual(frame.scores,[0,0]);
  assert.equal(replay.replayView(frame).fighters[0].membrane.mesh().p[0],saved.membrane.mesh.p[0]);
});

test('El máximo de clips y bytes expulsa grabaciones completas y clear libera la biblioteca',()=>{
  const game=new DuelEngine(),recorder=new replay.ReplayRecorder({beforeSeconds:0,afterSeconds:0,maxClips:3});
  for(let i=0;i<5;i++){
    recorder.newMatch();recorder.event('burst',{contact:true,winner:1,relativeSpeed:i});recorder.record(game,0);
    assert.ok(recorder.bytes<=recorder.maxBytes);
  }
  assert.deepEqual(recorder.clips.map(c=>c.id),[3,4,5]);
  const perClip=recorder.clips[0].bytes;
  const bounded=new replay.ReplayRecorder({beforeSeconds:0,afterSeconds:0,maxBytes:perClip+64});
  for(let i=0;i<4;i++){
    bounded.newMatch();bounded.event('burst',{contact:true,winner:1,relativeSpeed:i});bounded.record(game,0);
    assert.ok(bounded.bytes<=bounded.maxBytes);assert.equal(bounded.clips.length,1);assert.equal(bounded.clips[0].frames.length,1);
  }
  assert.equal(bounded.clips[0].id,4);
  bounded.clear();assert.equal(bounded.bytes,0);assert.equal(bounded.pending,false);assert.deepEqual(bounded.clips,[]);
});

test('Presupuestos diminutos y dt inválido no guardan clips vacíos ni inventan tiempo',()=>{
  const game=new DuelEngine(),tiny=new replay.ReplayRecorder({maxBytes:100});
  tiny.record(game,0);assert.equal(tiny.bytes,0);
  assert.equal(tiny.event('burst',{contact:true,winner:1}),false);assert.equal(tiny.pending,false);assert.equal(tiny.clips.length,0);
  const recorder=new replay.ReplayRecorder({beforeSeconds:0,afterSeconds:0});
  for(const dt of [-1,NaN,Infinity,undefined])assert.equal(recorder.record(game,dt),false);
  assert.equal(recorder.bytes,0);recorder.event('burst',{contact:true,draw:true,winner:0});recorder.record(game,0);
  assert.equal(recorder.clips[0].duration,0);assert.equal(recorder.clips[0].frames.length,1);assert.equal(recorder.clips[0].event.draw,true);
  assert.throws(()=>new replay.ReplayRecorder({sampleHz:0}),RangeError);
  assert.throws(()=>new replay.ReplayRecorder({maxBytes:65*1024*1024}),RangeError);
});

test('Un payload nulo o no objetual se rechaza sin abortar el recorder',()=>{
  const recorder=new replay.ReplayRecorder();
  for(const value of [null,undefined,false,'burst',12])assert.equal(recorder.event('burst',value),false);
  assert.equal(recorder.pending,false);assert.equal(recorder.bytes,0);
});

test('Cadencia a120 Hz y pausas entre partidas conservan biblioteca y descartan el pendiente',()=>{
  const game=new DuelEngine(),recorder=new replay.ReplayRecorder({beforeSeconds:.5,afterSeconds:.1});
  let captures=0;
  for(let i=0;i<120;i++)captures+=Number(recorder.record(game,STEP));
  assert.equal(captures,20);
  recorder.event('burst',{contact:true,winner:2});
  for(let i=0;i<14;i++)recorder.record(game,STEP);
  assert.equal(recorder.clips.length,1);
  const id=recorder.clips[0].id;recorder.event('burst',{contact:true,winner:1});
  assert.equal(recorder.pending,true);recorder.newMatch();
  assert.equal(recorder.pending,false);assert.equal(recorder.clips[0].id,id);
  recorder.event('burst',{contact:true,winner:1});
  for(let i=0;i<14;i++)recorder.record(game,STEP);
  assert.equal(recorder.clips.length,2);assert.ok(recorder.clips[1].duration<=.101);
});

test('Un contacto detectado por el motor conserva ruptura y agua posterior, sin cambiar el resultado al reproducir',()=>{
  const recorder=new replay.ReplayRecorder({beforeSeconds:.35,afterSeconds:.4});let verified=0;
  // Engine already emits contact in R8. The fallback labels the independently
  // observed detectHits burst fixture on older revisions; it never runs a demo.
  const game=new DuelEngine((name,data)=>{
    if(name==='burst'){
      verified++;
      const impact=game.fighters[data.loser-1]?.fluid.impact;
      recorder.event(name,{...data,contact:true,impact:data.impact??impact});
    }
  });
  game.setMode('versus');game.phase='fight';
  for(let i=0;i<1200&&!recorder.clips.length;i++){
    const t=i*STEP;
    game.setControl(1,{mainX:1,mainY:.63,offX:.2,offY:.3,lean:1,thrust:t%.55<.1});
    game.setControl(2,{mainX:-1,mainY:-1,offY:-1,lean:0});
    game.update(STEP);recorder.record(game,STEP);
  }
  assert.equal(verified,1);assert.equal(recorder.clips.length,1);
  const clip=recorder.clips[0],before=clip.frames[0],after=clip.frames.at(-1),score=game.scores.slice();
  assert.equal(before.fighters[1].globIntact,true);assert.equal(after.fighters[1].globIntact,false);
  assert.equal(after.fighters[1].membrane.punctured,true);
  assert.ok(after.fighters[1].fluid.releasedVolume>0);
  assert.ok(after.fighters[1].membrane.mesh.optics.length>0);
  const view=replay.replayView(after),fluid=view.fighters[1].fluid;
  assert.ok(fluid.releasedParticles.length>0);assert.ok(fluid.retainedVolume<fluid.initialVolume);
  assert.ok(Math.abs(fluid.retainedVolume+fluid.releasedVolume-fluid.initialVolume)<1e-12);
  for(const frame of clip.frames)replay.replayView(frame);
  assert.deepEqual(game.scores,score);assert.equal(game.phase,'burst');
});
