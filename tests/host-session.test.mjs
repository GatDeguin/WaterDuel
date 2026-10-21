import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {HostSession} from '../public/host-session.js';
import {STEP,neutral} from '../public/engine.js';
let id=0;
const command=(host,command,value)=>host.handleCommand({type:'command',requestId:++id,sentAt:Date.now(),command,...(value===undefined?{}:{value})});

test('PC conserva la escena a viewport completo y sólo admite los dos QR de esquina pedidos después por el usuario',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const body=html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').trim();
  const withoutInvitations=body.replace(/<aside\b[^>]*id="joinCodes"[^>]*>[\s\S]*?<\/aside>/i,'').trim();
  assert.match(withoutInvitations,/^<canvas\b[^>]*><\/canvas>$/);assert.doesNotMatch(body,/<(?:button|dialog|header|nav|input|select)\b/);
  const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(css,/position:\s*fixed/);assert.match(css,/width:\s*100%/);assert.match(css,/height:\s*100%/);
});

test('comandos válidos configuran sin asignar puntos; tipos inválidos no mutan',()=>{
  const h=new HostSession();
  for(const [key,value]of [['setMode','versus'],['setBestOf',5],['setDifficulty','expert'],['setArena','dojo'],['setQuality','eco'],['setCamera','detail'],['setLighting','neutral'],['setAudio',true],['setVolume',81]])assert.equal(command(h,key,value).ok,true,key);
  assert.deepEqual(h.game.scores,[0,0]);const view=h.menuState();
  assert.equal(view.bestOf,5);assert.equal(view.volume,81);assert.equal(view.camera,'detail');assert.equal(view.mode,'versus');
  assert.equal(command(h,'setVolume','90').ok,false);assert.equal(command(h,'setBestOf',99).ok,false);assert.equal(command(h,'win',1).ok,false);
  view.fighters[0].equipment.weapon='maul';view.scores[0]=9;assert.equal(h.game.loadouts[0].weapon,'sword');assert.deepEqual(h.game.scores,[0,0]);
});

test('ni un móvil puede cambiar reglas/equipo/cámara durante combate; reinicio explícito sí',()=>{
  const h=new HostSession();assert.equal(command(h,'start').ok,true);const before=h.menuState();
  for(const [key,value]of [['setMode','versus'],['setExperience','campaign'],['setBestOf',5],['setDifficulty','boss'],['setArena','dojo'],['setLoadout',{slot:1,weapon:'maul',defense:'none'}],['setCamera','detail']])assert.equal(command(h,key,value).ok,false,key);
  assert.equal(command(h,'start').ok,false);assert.equal(h.game.phase,'countdown');assert.deepEqual(h.game.scores,before.scores);
  assert.equal(command(h,'setQuality','eco').ok,true);assert.equal(command(h,'setAudio',true).ok,true);
  assert.equal(command(h,'reset').ok,true);assert.equal(h.game.phase,'ready');
});

test('experiencias conservan preferencias del duelo y ambos equipos al salir de escuela',()=>{
  const h=new HostSession();command(h,'setMode','versus');command(h,'setBestOf',5);command(h,'setDifficulty','expert');command(h,'setArena','midnight');
  const equipment=[{slot:1,weapon:'maul',defense:'none'},{slot:2,weapon:'axe',defense:'knife'}];
  equipment.forEach(value=>assert.equal(command(h,'setLoadout',value).ok,true));
  command(h,'setMode','solo');
  assert.equal(command(h,'setExperience','training').ok,true);assert.equal(h.menuState().trainingEquipmentLocked,true);
  assert.deepEqual(h.game.loadouts,[{weapon:'sword',defense:'short'},{weapon:'sword',defense:'short'}]);
  assert.equal(command(h,'setLoadout',equipment[0]).ok,false);
  command(h,'setMode','versus');assert.equal(h.sessionEquipment.locked,false);assert.deepEqual(h.game.loadouts,equipment.map(({slot,...item})=>item));
  command(h,'setMode','solo');assert.equal(h.sessionEquipment.locked,true);command(h,'setExperience','duel');
  assert.equal(h.game.bestOf,5);assert.equal(h.game.difficulty,'expert');assert.equal(h.game.arena,'midnight');
  assert.deepEqual(h.game.loadouts[0],{weapon:'maul',defense:'none'});assert.deepEqual(h.game.loadouts[1],h.individual.configuration().opponentLoadout);
  command(h,'setMode','versus');assert.deepEqual(h.game.loadouts,equipment.map(({slot,...item})=>item));
});

test('estado móvil procede del motor real y comienzo/revancha no desbloquean campaña',()=>{
  const storage=new Map();const h=new HostSession({storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
  command(h,'setExperience','campaign');assert.equal(command(h,'nextEncounter').ok,false);
  assert.equal(command(h,'setArena','midnight').ok,false);assert.equal(h.game.arena,'atelier');
  command(h,'start');h.update(STEP);const view=h.menuState();assert.equal(view.phase,'countdown');assert.equal(view.objective.progress,0);assert.equal(view.round,1);assert.deepEqual(view.scores,[0,0]);assert.equal(storage.size,0);
});

test('replay de un contacto real congela updates/observación/grabación y vuelve neutral sin mutar score',()=>{
  const h=new HostSession();command(h,'setExperience','practice');command(h,'start');
  for(let n=0;n<400;n++)h.update(STEP);
  for(let n=0;n<3600&&h.game.phase==='fight';n++){h.game.updateAI(h.game.fighters[0],STEP);h.update(STEP);}
  assert.equal(h.game.phase,'burst','el clip debe surgir de colisión, no inyección de evento');
  for(let n=0;n<150;n++)h.update(STEP);
  const clip=h.recorder.clips[0];assert.ok(clip?.frames.length);assert.equal(clip.event.contact,true);
  const before={clock:h.game.clock,elapsed:h.game.elapsed,scores:[...h.game.scores],bytes:h.recorder.bytes,progress:h.individual.objectiveIndex};
  assert.equal(command(h,'replayOpen',clip.id).ok,true);assert.equal(command(h,'setBestOf',5).ok,false);
  assert.equal(command(h,'replaySeek',.5).ok,true);assert.equal(command(h,'replaySpeed',.25).ok,true);
  for(let n=0;n<5;n++){h.update(STEP);const {scene,time}=h.renderState(.016);assert.equal(scene.replay,true);assert.ok(Number.isFinite(time));}
  assert.deepEqual({clock:h.game.clock,elapsed:h.game.elapsed,scores:[...h.game.scores],bytes:h.recorder.bytes,progress:h.individual.objectiveIndex},before);
  command(h,'replayClose');assert.equal(h.playback,null);assert.deepEqual(h.game.fighters[0].controller,neutral());h.update(STEP);assert.ok(h.game.clock>before.clock);
});
