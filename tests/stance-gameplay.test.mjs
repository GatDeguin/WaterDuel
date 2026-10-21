import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';

test('Desde el reposo de esgrima, el mando secundario positivo lleva la defensa al frente por los motores comunes',()=>{
  const game=new DuelEngine();game.setMode('versus');game.phase='fight';
  const original=game.fighters.map(f=>({...f.pose.offHand}));
  for(const f of game.fighters){
    assert.ok(f.dir*(f.pose.offHand.x-f.pose.offShoulder.x)<-.65,'el reposo conserva el brazo libre detrás');
    game.setControl(f.slot,{offX:1,offY:.8});
  }
  for(let i=0;i<180;i++)for(const f of game.fighters)game.updateFighter(f,STEP);
  for(const [i,f] of game.fighters.entries()){
    assert.ok(f.dir*(f.pose.offHand.x-original[i].x)>1.2,'el joystick debe recorrer desde atrás hasta delante');
    assert.ok(f.dir*(f.pose.offHand.x-f.pose.head.x)>.1,'la defensa puede quedar delante del globo');
    assert.equal(f.guard,false,'el movimiento positivo no debe activar guardia por sí mismo');
    assert.ok(f.pose.dynamic,'la postura sigue siendo resultado del multibody');
  }
});

test('La guardia de ambos jugadores alcanza una cobertura frontal sin cambiar la postura neutral ni estirar enlaces',()=>{
  const game=new DuelEngine();game.setMode('versus');game.phase='fight';
  for(const f of game.fighters)game.setControl(f.slot,{offX:.5,offY:1,guard:true});
  for(let i=0;i<180;i++)for(const f of game.fighters)game.updateFighter(f,STEP);
  for(const f of game.fighters){
    const p=f.pose;
    assert.equal(f.guard,true);assert.ok(f.dir*(p.offHand.x-p.head.x)>.1);
    assert.ok(Math.abs(p.offHand.y-p.head.y)<.3,'el broquel llega a la altura del globo');
    assert.ok(Math.abs(Math.hypot(p.offElbow.x-p.offShoulder.x,p.offElbow.y-p.offShoulder.y)-.48)<1e-8);
    assert.ok(Math.abs(Math.hypot(p.offHand.x-p.offElbow.x,p.offHand.y-p.offElbow.y)-.47)<1e-8);
  }
});
