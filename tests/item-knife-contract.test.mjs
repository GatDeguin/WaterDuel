import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLoadout,WEAPONS} from '../public/equipment.js';
import {normalizeMenuCommand,sanitizeMenuState} from '../public/remote-menu.js';
import {DuelEngine} from '../public/engine.js';
import {captureReplayState,replayView} from '../public/replay.js';
import {HostSession} from '../public/host-session.js';

const command=value=>({type:'command',requestId:1,sentAt:1,command:'setLoadout',value});

test('agarre inverso es dato canónico exclusivo del cuchillo y defaults antiguos conservan su forma',()=>{
 assert.deepEqual(normalizeLoadout({weapon:'sword',defense:'knife',knifeGrip:'reverse'}),{weapon:'sword',defense:'knife',knifeGrip:'reverse'});
 assert.deepEqual(normalizeLoadout({weapon:'sword',defense:'knife',knifeGrip:'normal'}),{weapon:'sword',defense:'knife'});
 assert.deepEqual(normalizeLoadout({weapon:'axe',defense:'knife'}),{weapon:'axe',defense:'knife'});
 assert.deepEqual(normalizeLoadout({weapon:'spear',defense:'long',knifeGrip:'reverse'}),{weapon:'spear',defense:'long'});
 assert.deepEqual(normalizeLoadout({weapon:'maul',defense:'knife',knifeGrip:'reverse'}),{weapon:'maul',defense:'none'});
 assert.deepEqual(normalizeLoadout(null),{weapon:'sword',defense:'short'});
 assert.equal(Object.hasOwn(WEAPONS,'knife'),false);
});

test('wire valida agarre opcional y DTO conserva solo la elección canónica',()=>{
 const value={slot:2,weapon:'sword',defense:'knife',knifeGrip:'reverse'};
 assert.deepEqual(normalizeMenuCommand(command(value)).value,value);
 for(const knifeGrip of ['wrong',null,7,{},['reverse']])assert.equal(normalizeMenuCommand(command({...value,knifeGrip})),null);
 assert.deepEqual(normalizeMenuCommand(command({...value,knifeGrip:'normal'})).value,{slot:2,weapon:'sword',defense:'knife'});
 const state=sanitizeMenuState({fighters:[{equipment:value},{equipment:{weapon:'maul',defense:'knife',knifeGrip:'reverse'}}]});
 assert.deepEqual(state.fighters[0].equipment,{weapon:'sword',defense:'knife',knifeGrip:'reverse'});
 assert.deepEqual(state.fighters[1].equipment,{weapon:'maul',defense:'none'});
});

test('motor rechaza agarres desconocidos y guarda selección invertida durante reinicios',()=>{
 const g=new DuelEngine();g.setMode('versus');
 for(const slot of [1,2]){
  assert.equal(g.setLoadout(slot,{weapon:'sword',defense:'knife',knifeGrip:'reverse'}),true);
  assert.equal(g.loadouts[slot-1].knifeGrip,'reverse');
  assert.equal(g.fighters[slot-1].equipment.knifeGrip,'reverse');
  assert.equal(g.setLoadout(slot,{weapon:'sword',defense:'knife',knifeGrip:'wrong'}),false);
 }
 g.resetRound();assert.ok(g.fighters.every(f=>f.equipment.knifeGrip==='reverse'));
 g.resetMatch();assert.ok(g.fighters.every(f=>f.equipment.knifeGrip==='reverse'));
 g.phase='fight';assert.equal(g.setLoadout(1,{weapon:'sword',defense:'knife',knifeGrip:'normal'}),false);
});

test('replay conserva agarre propio aunque el equipo actual se cambie después',()=>{
 const g=new DuelEngine();g.setMode('versus');g.setLoadout(1,{weapon:'axe',defense:'knife',knifeGrip:'reverse'});
 const frame=captureReplayState(g);g.setLoadout(1,{weapon:'maul',defense:'none'});
 const view=replayView(frame);assert.equal(view.fighters[0].equipment.knifeGrip,'reverse');
 assert.equal(view.fighters[0].pose.equipment.knifeGrip,'reverse');
 view.fighters[0].equipment.knifeGrip='normal';assert.equal(frame.fighters[0].equipment.knifeGrip,'reverse');
});

test('un equipo completo normal borra el agarre inverso anterior, mientras un cambio parcial de arma lo conserva',()=>{
 const g=new DuelEngine();g.setLoadout(1,{weapon:'sword',defense:'knife',knifeGrip:'reverse'});
 g.setLoadout(1,{weapon:'axe'});assert.equal(g.loadouts[0].knifeGrip,'reverse');
 const normal=normalizeMenuCommand(command({slot:1,weapon:'axe',defense:'knife',knifeGrip:'normal'})).value;
 assert.equal(g.setLoadout(1,normal),true);assert.deepEqual(g.loadouts[0],{weapon:'axe',defense:'knife'});
});

test('salir de cuchillo elimina técnica y collider; el préstamo de Escuela restaura solo la elección propia',()=>{
 const g=new DuelEngine();g.setLoadout(1,{weapon:'axe',defense:'knife',knifeGrip:'reverse'});
 g.setLoadout(1,{defense:'long'});assert.deepEqual(g.loadouts[0],{weapon:'axe',defense:'long'});
 assert.equal(g.fighters[0].pose.defenseTip,undefined);
 assert.equal(g.fighters[0].rig.defenseLength,0);
 const h=new HostSession({opponentSeed:26});let requestId=1;
 const send=(name,value)=>h.handleCommand({type:'command',command:name,...(value===undefined?{}:{value}),requestId:requestId++,sentAt:Date.now()});
 send('setMode','versus');send('setLoadout',{slot:1,weapon:'sword',defense:'knife',knifeGrip:'reverse'});
 send('setLoadout',{slot:2,weapon:'axe',defense:'knife',knifeGrip:'reverse'});
 send('setMode','solo');assert.equal(h.game.loadouts[1].knifeGrip,undefined,'la configuración del rival no hereda el agarre manual');
 send('setExperience','training');assert.ok(h.game.loadouts.every(loadout=>loadout.knifeGrip===undefined));
 send('setMode','versus');assert.ok(h.game.loadouts.every(loadout=>loadout.defense==='knife'&&loadout.knifeGrip==='reverse'));
 send('setLoadout',{slot:2,weapon:'maul',defense:'none'});send('reset');
 assert.deepEqual(h.game.loadouts[1],{weapon:'maul',defense:'none'});
});

test('ids de equipo deben ser strings: arrays y objetos no se convierten a nombres válidos',()=>{
 const g=new DuelEngine();
 for(const [key,values]of [['weapon',[['axe'],{toString:()=> 'axe'},7]],['defense',[['knife'],{toString:()=> 'knife'},null]]]){
  for(const value of values){
   const bad={weapon:'sword',defense:'short',[key]:value};
   assert.equal(normalizeMenuCommand(command({slot:1,...bad})),null);
   assert.equal(g.setLoadout(1,bad),false);
   assert.deepEqual(normalizeLoadout(bad),{weapon:'sword',defense:'short'});
  }
 }
});
