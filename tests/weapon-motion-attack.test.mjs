import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
test('El joystick sostiene una intención física, sin repetir ataques de temporizador',()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));g.setMode('versus');g.phase='fight';
  const f=g.fighters[0];g.setControl(1,{mainX:1,mainY:.3,wrist:.195,attackHeld:true});
  const samples=[];for(let i=0;i<240;i++){g.updateFighter(f,STEP);if(i>120)samples.push(f.lunge);}
  assert.equal(events.filter(e=>e.name==='thrust').length,0,'no one-shot events from a held physical target');
  assert.ok(Math.min(...samples)>.99,'intención sostenida sin caídas periódicas');
  g.setControl(1,{});for(let i=0;i<120;i++)g.updateFighter(f,STEP);assert.ok(f.lunge<.001);
});
test('Una cabeza que se mueve sobre una punta quieta también encuentra el acero',()=>{
  for(const slot of [1,2]){
    const g=new DuelEngine();g.setMode('versus');g.phase='fight';
    const a=g.fighters[slot-1],b=g.fighters[2-slot],dir=a.dir;
    a.lunge=0;a.guard=true;a.previousTip={x:0,y:2.5,z:.17};a.pose={...a.pose,tip:{...a.previousTip}};
    b.previousHead={x:dir*.7,y:2.5,z:.025};b.pose={...b.pose,head:{x:0,y:2.5,z:.025}};
    g.detectHits();assert.equal(b.globIntact,false);assert.equal(g.winner,slot);
  }
});
