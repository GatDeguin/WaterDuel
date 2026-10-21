import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {SurfaceState} from '../public/physics/surface-state.js';

test('Una copia de coordenadas públicas no activa modos físicos que el constructor receptor no pidió',()=>{
  const source=new ArticulatedRig({gravity:0,flexibleWeapons:true});
  source.weaponFlex.offset=.02;source.weaponFlex.previousOffset=.01;
  const fields=structuredClone(Object.fromEntries(Object.entries(source).filter(([key])=>key!=='apron')));
  const target=Object.assign(new ArticulatedRig({gravity:0}),fields);
  assert.equal(target.flexibleWeapons,false);assert.equal(target.weaponFlex,null);
  assert.equal(target.pose().weaponCurve,undefined);
  assert.doesNotThrow(()=>target.step(1/120));
  assert.equal(source.flexibleWeapons,true);assert.ok(source.weaponFlex.energy()>0);
});

test('La extensión visual opt-in de pose es autoritativa, propia y no cambia una pose sin extensión',()=>{
  const state=new SurfaceState();let clock=0;
  const rig=new ArticulatedRig({gravity:0,surfaceSnapshot:(pose,owner)=>state.snapshot(pose,clock,owner)});
  const before=rig.pose();state.record(before,{body:'mainUpper',key:'mainUpper',point:{...before.mainElbow},normal:{x:0,y:1,z:0},impulse:.2,time:0});
  const a=rig.pose(),b=rig.pose();assert.equal(a.surface.marks.length,1);assert.deepEqual(a,b);
  a.surface.marks[0].anchor.local.x=999;a.surface.marks[0].position.x=999;
  assert.deepEqual(rig.pose(),b,'el consumidor no modifica el historial ni otra captura');
  rig.q[0]+=.1;clock=.5;
  const moved=rig.pose().surface.marks[0];assert.ok(Math.abs(moved.position.x-b.surface.marks[0].position.x-.1)<1e-12);assert.equal(moved.age,.5);
  const legacy=new ArticulatedRig({gravity:0});assert.equal(legacy.pose().surface,undefined);
  assert.equal(Object.values(rig).some(value=>typeof value==='function'),false,'la fuente de la extensión no forma parte del estado mecánico copiable');
});
