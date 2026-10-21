import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';

for(const slot of [1,2])for(const weapon of ['sword','spear'])test(`IA ${weapon} J${slot} alinea la punta real y alcanza a un rival pasivo con controles físicos`,()=>{
  const bursts=[],game=new DuelEngine((name,data)=>{if(name==='burst')bursts.push(data);});
  game.setMode('versus');game.aiEnabled=false;
  game.setLoadout(slot,{weapon,defense:'none'});game.setLoadout(3-slot,{weapon:'sword',defense:'none'});game.start();
  for(let n=0;n<400;n++)game.update(STEP);
  for(let n=0;n<3600&&game.phase==='fight';n++){game.updateAI(game.fighters[slot-1],STEP);game.update(STEP);}
  assert.equal(bursts.length,1,'debe surgir una perforación, sin asignar puntos por plazo');
  assert.equal(bursts[0].winner,slot,'el piloto debe alcanzar sin caminar ciegamente contra la espada pasiva');
  assert.equal(bursts[0].contact,true);assert.equal(bursts[0].demonstration,false);
  assert.equal(game.fighters[2-slot].membrane.punctured,true);
  assert.equal(game.fighters[slot-1].globIntact,true);
});
