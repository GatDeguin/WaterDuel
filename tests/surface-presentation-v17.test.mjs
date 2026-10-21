import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine} from '../public/engine.js';
import {SimulationPresentation} from '../public/simulation-presentation.js';
import {drawCombatWear} from '../public/rendering/combat-wear.js';

const mark=(id,body,x)=>({id,body,key:body,position:{x,y:0,z:.18},normal:{x:0,y:0,z:1},tangent:{x:1,y:0,z:0},
  length:.015,impulse:.1,age:0,anchor:{local:{x,y:0,z:.18},normal:{x:0,y:0,z:1}}});
function captures(previous,current){
  const game=new DuelEngine(),view=new SimulationPresentation();game.phase='burst';
  game.fighters[0].pose={surface:{marks:previous}};view.capture(game);
  game.fighters[0].pose={surface:{marks:current}};view.capture(game);
  return {game,view};
}

test('La lista acotada de marcas interpola por identidad y mantiene discretos los descriptores de contacto',()=>{
  const previous=[mark(1,'weapon',1),mark(2,'torso',2)],current=[mark(2,'torso',20),mark(3,'mainForearm',3)],{game,view}=captures(previous,current);
  const marks=view.view(game,.25).fighters[0].pose.surface.marks;
  assert.deepEqual(marks.map(m=>m.id),[2,3]);assert.deepEqual(marks.map(m=>m.body),['torso','mainForearm']);
  assert.equal(marks[0].position.x,6.5,'la marca conservada usa su propia posición anterior, aunque cambió de índice');
  assert.deepEqual(marks[1],current[1],'una marca recién nacida no hereda el contacto anterior de otro cuerpo');
  for(let i=0;i<marks.length;i++){assert.deepEqual(marks[i].anchor,current[i].anchor);assert.notEqual(marks[i].anchor,current[i].anchor);}
  marks[0].anchor.local.x=999;marks[1].position.x=999;
  assert.equal(current[0].anchor.local.x,20);assert.equal(current[1].position.x,3);
  assert.deepEqual(view.view(game,.8).fighters[0].pose.surface.marks.map(m=>m.anchor),current.map(m=>m.anchor));
});

test('El triángulo de una marca nueva se proyecta una vez al variar alpha entre capturas',()=>{
  const {game,view}=captures([mark(1,'mainForearm',-.01)],[mark(2,'mainForearm',.01)]),indices=new Uint32Array([0,1,2]);let reads=0;
  const part={boneName:'forearm.R',material:0,positions:new Float32Array([-.2,-.2,.2,.2,-.2,.2,0,.2,.2])};
  Object.defineProperty(part,'indices',{get(){reads++;return indices;}});
  const prepared={parts:[part],asset:{materials:[{pbrMetallicRoughness:{metallicFactor:0}}]}},matrices=[new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])],owner={},renderer={dynamicDraw(){}};
  const first=drawCombatWear(renderer,view.view(game,.1).fighters[0],{owner,geometry:{prepared,matrices}});
  assert.equal(first.marks,1);assert.ok(reads>0);reads=0;
  for(const alpha of [.2,.4,.6,.8,.95])assert.equal(drawCombatWear(renderer,view.view(game,alpha).fighters[0],{owner,geometry:{prepared,matrices}}).marks,1);
  assert.equal(reads,0,'IDs/anclas interpolados invalidarían la proyección en cada RAF');
});
