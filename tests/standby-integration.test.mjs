import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,neutral} from '../public/engine.js';
test('El standby mueve el rig real y transporta agua y látex sin modificar controles ni pies',()=>{
  const a=new DuelEngine(),b=new DuelEngine();b.reducedMotion=true;
  for(let i=0;i<300;i++){a.update(STEP);b.update(STEP);}
  for(let i=0;i<2;i++){
    const f=a.fighters[i],fixed=b.fighters[i];
    assert.ok(Math.hypot(f.pose.mainHand.x-fixed.pose.mainHand.x,f.pose.mainHand.y-fixed.pose.mainHand.y)>.001);
    assert.deepEqual(f.controller,neutral());assert.equal(f.lunge,0);assert.equal(f.guard,false);
    assert.equal(f.fluid.origin.x,f.pose.head.x);assert.equal(f.fluid.origin.z,f.pose.head.z);
    assert.equal(f.baseX,fixed.baseX);assert.equal(f.rig.passive,false);
  }
});
