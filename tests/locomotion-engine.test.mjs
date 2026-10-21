import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,FOOTWORK} from '../public/engine.js';

test('el joystick humano conserva escala proporcional y la IA mantiene su controlador de distancia original',()=>{
  for(const mode of ['solo','versus'])for(const axis of [-.1,-.25,-.5]){
    const game=new DuelEngine();game.setMode(mode);game.phase='fight';
    for(let n=0;n<36;n++){
      for(const slot of [1,2])game.setControl(slot,{lean:axis});
      game.updateFootwork(STEP);
    }
    for(const f of game.fighters)assert.ok(Math.abs(f.baseVX-axis*f.dir*FOOTWORK.maxSpeed)<1e-10,'target proporcional sin reescalar la salida IA');
    const f=game.fighters[1],before=f.baseVX;
    game.setControl(2,{lean:0});game.updateFootwork(STEP);
    const brake=FOOTWORK.acceleration*(mode==='solo'?1:1.8);
    const expected=Math.sign(before)*Math.max(0,Math.abs(before)-brake*STEP);
    assert.ok(Math.abs(f.baseVX-expected)<1e-10,'frenado humano nuevo y respuesta IA original');
  }
});
