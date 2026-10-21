import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../public/host-session.js';
import {STEP} from '../public/engine.js';

let sequence=0;
const command=(h,command,value)=>h.handleCommand({type:'command',requestId:++sequence,sentAt:Date.now(),command,...(value===undefined?{}:{value})});

test('el menú remoto prepara cada ejercicio, su objetivo y el equipo físico correcto',()=>{
  for(const kind of ['parry','moving','depth']){
    const h=new HostSession({opponentSeed:1});assert.equal(command(h,'setExperience',kind).ok,true);
    assert.equal(h.game.scenario,'practice');assert.equal(h.game.trainingDrill.kind,kind);assert.equal(h.menuState().experience,kind);
    const objective=h.menuState().objective;assert.equal(objective.kind,kind);assert.equal(objective.progress,0);assert.ok(objective.total>=2);assert.ok(objective.instruction.length>20);
    assert.deepEqual(h.game.loadouts[1],{weapon:'sword',defense:'none'});assert.equal(h.menuState().trainingEquipmentLocked,kind==='depth');
    if(kind==='depth')assert.deepEqual(h.game.loadouts[0],{weapon:'sword',defense:'none'});
    assert.deepEqual(h.game.scores,[0,0]);assert.equal(command(h,'nextEncounter').ok,false);
  }
});

test('alternar todos los ejercicios y Versus conserva los dos equipos y preferencias originales',()=>{
  const h=new HostSession({opponentSeed:1});command(h,'setMode','versus');
  command(h,'setBestOf',5);command(h,'setDifficulty','expert');command(h,'setArena','dojo');
  const original=[{weapon:'maul',defense:'none'},{weapon:'spear',defense:'long'}];
  for(let i=0;i<2;i++)assert.equal(command(h,'setLoadout',{slot:i+1,...original[i]}).ok,true);
  command(h,'setMode','solo');
  for(const kind of ['depth','training','parry','moving','precision','practice','depth','duel']){
    assert.equal(command(h,'setExperience',kind).ok,true);assert.equal(h.individual.view(h.game).progress,0);
    if(!['training','depth'].includes(kind))assert.deepEqual(h.game.loadouts[0],original[0]);
    if(['training','depth'].includes(kind))assert.equal(command(h,'setLoadout',{slot:1,weapon:'axe'}).ok,false);
    assert.equal(command(h,'setMode','versus').ok,true);assert.deepEqual(h.game.loadouts,original,kind);assert.equal(h.sessionEquipment.locked,false);assert.equal(h.game.trainingDrill,null);
    assert.equal(command(h,'setMode','solo').ok,true);
  }
  assert.equal(h.game.bestOf,5);assert.equal(h.game.difficulty,'expert');assert.equal(h.game.arena,'dojo');
});

test('los tres ejercicios arrancan desde el mismo comando móvil y publican sus marcadores sin puntuar',()=>{
  for(const kind of ['parry','moving','depth']){
    const h=new HostSession();command(h,'setExperience',kind);assert.equal(command(h,'start').ok,true);assert.equal(h.game.phase,'countdown');
    for(let i=0;i<400;i++){
      h.game.setControl(1,{mainY:-.8,wrist:-.7,headZ:kind==='depth'?-1:0});h.update(STEP);
    }
    assert.equal(h.game.phase,'fight');assert.deepEqual(h.game.scores,[0,0]);assert.equal(h.menuState().objective.completed,false);
    const {scene}=h.renderState();assert.equal(scene.mode,'solo');
    assert.equal(h.game.precisionTarget!==null,kind==='moving');
    assert.equal(command(h,'setExperience','duel').ok,false,'cambiar experiencia requiere salir del combate');
    assert.equal(command(h,'reset').ok,true);assert.equal(command(h,'setExperience','duel').ok,true);assert.equal(h.game.trainingDrill,null);
  }
});
