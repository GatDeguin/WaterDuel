import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../public/host-session.js';
import {STEP,neutral} from '../public/engine.js';
import {captureReplayState} from '../public/replay.js';
let serial=0;
const command=(host,name,value)=>host.handleCommand({type:'command',requestId:++serial,sentAt:Date.now(),command:name,...(value===undefined?{}:{value})});
const status=loading=>({loading,ready:0,total:11,names:[],errors:[],gpuBytesApprox:0});

test('carga pendiente rechaza iniciar en el host y no consume una cuenta atrás invisible',()=>{
  const events=[],h=new HostSession({onEvent:name=>events.push(name)});h.assetStatus=status(true);
  const before={clock:h.game.clock,phase:h.game.phase,phaseClock:h.game.phaseClock,bytes:h.recorder.bytes};
  const result=command(h,'start');assert.equal(result.ok,false);assert.match(result.message,/carg|prepar/i);
  for(let n=0;n<30;n++)h.update(STEP);
  assert.deepEqual({clock:h.game.clock,phase:h.game.phase,phaseClock:h.game.phaseClock,bytes:h.recorder.bytes},before);
  assert.equal(events.includes('start'),false);assert.equal(events.includes('countdown'),false);
  assert.equal(command(h,'setQuality','eco').ok,true);assert.equal(command(h,'setMode','versus').ok,true);assert.equal(command(h,'reset').ok,true);
  h.assetStatus=status(false);assert.equal(command(h,'start').ok,true);h.update(STEP);assert.equal(h.game.phase,'countdown');assert.equal(h.game.phaseClock,STEP);
});

test('siguiente actividad se bloquea antes de consumir progreso mientras carga la escena',()=>{
  const h=new HostSession();command(h,'setExperience','training');
  // Policy fixture only: a completed activity, not evidence of physical play.
  h.individual.objectiveIndex=7;assert.equal(h.individual.view(h.game).nextAction,'repeat');
  h.assetStatus=status(true);const before=JSON.stringify(h.menuState().objective);
  const result=command(h,'nextEncounter');assert.equal(result.ok,false);assert.match(result.message,/carg|prepar/i);
  assert.equal(JSON.stringify(h.menuState().objective),before);assert.equal(h.game.phase,'ready');
  h.assetStatus=status(false);assert.equal(command(h,'nextEncounter').ok,true);assert.equal(h.game.phase,'countdown');
});

test('pausar por carga congela simulación, progreso y grabación y elimina controles retenidos',()=>{
  const h=new HostSession();command(h,'start');for(let n=0;n<4;n++)h.update(STEP);
  h.game.setControl(1,{mainX:1,lean:1,thrust:true,attackHeld:true,headX:1});
  const before={clock:h.game.clock,phaseClock:h.game.phaseClock,elapsed:h.game.elapsed,bytes:h.recorder.bytes,progress:h.individual.objectiveIndex};
  h.assetStatus=status(true);for(let n=0;n<40;n++)h.update(.04);
  assert.deepEqual({clock:h.game.clock,phaseClock:h.game.phaseClock,elapsed:h.game.elapsed,bytes:h.recorder.bytes,progress:h.individual.objectiveIndex},before);
  assert.deepEqual(h.game.fighters[0].controller,neutral());h.assetStatus=status(false);h.update(STEP);
  assert.ok(Math.abs(h.game.clock-before.clock-STEP)<1e-12,'retoma un paso; no recupera el tiempo oculto');
  assert.deepEqual(h.game.fighters[0].controller,neutral());
});

test('replay no consume posición mientras el renderer está cargando',()=>{
  const h=new HostSession(),a=captureReplayState(h.game),b=captureReplayState(h.game);a.time=0;b.time=1;
  // Visual clock fixture: no claim of a recorded contact.
  h.playback={clip:{frames:[a,b],duration:1,startTime:0},time:.2,paused:false,index:-1,view:null};
  h.assetStatus=status(true);for(let n=0;n<8;n++)h.renderState(.1);
  assert.equal(h.playback.time,.2);h.assetStatus=status(false);h.renderState(.1);assert.equal(h.playback.time,.25);
});

test('headless sin estado de assets y carga terminada con fallback conservan inicio normal',()=>{
  const headless=new HostSession();assert.equal(command(headless,'start').ok,true);headless.update(STEP);assert.equal(headless.game.clock,STEP);
  const fallback=new HostSession();fallback.assetStatus={...status(false),errors:['Se usa representación procedural.']};
  assert.equal(command(fallback,'start').ok,true);fallback.update(STEP);assert.equal(fallback.game.clock,STEP);
});

test('fallo fatal del renderer bloquea inicio y tiempo hasta recuperar presentación',()=>{
  const h=new HostSession();h.rendererError='La arena 3D no está disponible';
  assert.equal(command(h,'start').ok,false);h.update(STEP);assert.equal(h.game.clock,0);
  h.rendererError='';assert.equal(command(h,'start').ok,true);h.update(STEP);assert.equal(h.game.clock,STEP);
});
