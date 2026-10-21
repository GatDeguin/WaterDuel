import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine} from '../public/engine.js';

const {musicDecision}=await import('../public/audio/music-state.js').catch(()=>({}));
function decision(game){
  assert.equal(typeof musicDecision,'function','musicDecision must export the modal state policy');
  return musicDecision(game);
}
const duel=(extra={})=>({phase:'fight',mode:'solo',scenario:'duel',scores:[0,0],bestOf:3,...extra});

test('preparation stays Lydian despite stale duel pressure',()=>{
  for(const phase of ['ready','countdown','unknown',undefined]){
    assert.deepEqual(decision(duel({phase,suddenDeath:true,scores:[0,1]})),{mode:'lydian',reason:'Preparación'});
  }
});

test('balanced play and solo leads stay Dorian',()=>{
  for(const game of [duel(),duel({scores:[1,0]}),duel({mode:'versus'}),{phase:'fight'}]){
    assert.deepEqual(decision(game),{mode:'dorian',reason:'Duelo'});
  }
});

test('solo disadvantage becomes Aeolian through the entire burst freeze',()=>{
  for(const phase of ['fight','burst'])for(const phaseClock of [0,.8,2.7,3.2]){
    assert.deepEqual(decision(duel({phase,phaseClock,winner:2,scores:[0,1]})),{mode:'aeolian',reason:'Desventaja'});
  }
});

test('versus pressure treats either player equally and respects the chosen match length',()=>{
  for(const scores of [[1,0],[0,1],[1,1],[2,1]]){
    assert.deepEqual(decision(duel({mode:'versus',scores})),{mode:'aeolian',reason:'Punto de partida'});
  }
  assert.deepEqual(decision(duel({mode:'versus',bestOf:5,scores:[1,1]})),{mode:'dorian',reason:'Duelo'});
  for(const scores of [[2,0],[0,2]]){
    assert.deepEqual(decision(duel({mode:'versus',bestOf:5,scores})),{mode:'aeolian',reason:'Punto de partida'});
  }
});

test('sudden death takes Phrygian priority over score pressure',()=>{
  for(const mode of ['solo','versus'])for(const phase of ['fight','burst']){
    assert.deepEqual(decision(duel({mode,phase,suddenDeath:true,scores:[0,1]})),{mode:'phrygian',reason:'Muerte súbita'});
  }
});

test('Phrygian boss escalation follows the actual enemy AI phase',()=>{
  const game=new DuelEngine();game.setDifficulty('boss');game.phase='fight';
  assert.deepEqual(decision(game),{mode:'dorian',reason:'Duelo'});
  game.scores=[1,0];game.updateAI(game.fighters[1],1/120);
  assert.equal(game.fighters[1].ai.phase,2);
  assert.deepEqual(decision(game),{mode:'phrygian',reason:'Jefe en fase avanzada'});
  game.phase='burst';
  assert.deepEqual(decision(game),{mode:'phrygian',reason:'Jefe en fase avanzada'});
  game.fighters[1].boss=false;
  assert.deepEqual(decision(game),{mode:'dorian',reason:'Duelo'});
  game.fighters[1].boss=true;game.mode='versus';
  assert.deepEqual(decision(game),{mode:'aeolian',reason:'Punto de partida'});
});

test('match results resolve old sudden death and boss pressure to victory or defeat',()=>{
  for(const [mode,winner,want] of [
    ['solo',1,{mode:'lydian',reason:'Victoria'}],
    ['solo',2,{mode:'aeolian',reason:'Derrota'}],
    ['versus',1,{mode:'lydian',reason:'Victoria'}],
    ['versus',2,{mode:'lydian',reason:'Victoria'}]
  ])assert.deepEqual(decision(duel({phase:'matchover',mode,winner,suddenDeath:true})),want);
  assert.deepEqual(decision(duel({phase:'matchover',winner:0})),{mode:'lydian',reason:'Preparación'});
});

test('practice and demonstrations do not invent competitive danger or defeat',()=>{
  for(const extra of [{scenario:'practice'},{demonstration:true}]){
    for(const phase of ['fight','burst']){
      assert.deepEqual(decision(duel({...extra,phase,scores:[0,7],suddenDeath:true})),{mode:'dorian',reason:'Duelo'});
    }
    assert.deepEqual(decision(duel({...extra,phase:'matchover',winner:2})),{mode:'lydian',reason:'Preparación'});
  }
});

test('malformed and partial input has safe neutral defaults',()=>{
  for(const game of [null,undefined,false,2,'fight',[],{}]){
    assert.deepEqual(decision(game),{mode:'lydian',reason:'Preparación'});
  }
  for(const scores of [null,{},[0],[NaN,1],[0,Infinity],[-1,1],['0',1],[1,,]])for(const mode of ['solo','versus']){
    assert.deepEqual(decision(duel({mode,scores})),{mode:'dorian',reason:'Duelo'});
  }
  assert.deepEqual(decision(duel({suddenDeath:'false',fighters:[null,{boss:true,ai:{phase:NaN}}]})),{mode:'dorian',reason:'Duelo'});
});

test('modal observation is pure and stable for frozen game snapshots',()=>{
  const game=Object.freeze(duel({scores:Object.freeze([0,1]),fighters:Object.freeze([null,Object.freeze({boss:false,ai:Object.freeze({phase:1})})])}));
  const before=JSON.stringify(game);
  for(let i=0;i<20;i++)assert.deepEqual(decision(game),{mode:'aeolian',reason:'Desventaja'});
  assert.equal(JSON.stringify(game),before);
});
