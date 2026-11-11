import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,neutral} from '../public/engine.js';
test('El standby mueve el rig real y transporta agua y látex sin modificar controles ni pies',()=>{
  const a=new DuelEngine(),b=new DuelEngine();b.reducedMotion=true;
  const peaks=a.fighters.map(()=>({hand:0,head:0}));
  for(let i=0;i<300;i++){
    a.update(STEP);b.update(STEP);
    for(const [j,{pose}] of a.fighters.entries()){
      const fixed=b.fighters[j].pose,peak=peaks[j];
      peak.hand=Math.max(peak.hand,Math.hypot(pose.mainHand.x-fixed.mainHand.x,pose.mainHand.y-fixed.mainHand.y));
      peak.head=Math.max(peak.head,Math.hypot(pose.head.x-fixed.head.x,pose.head.y-fixed.head.y,pose.head.z-fixed.head.z));
    }
  }
  for(let i=0;i<2;i++){
    const f=a.fighters[i],fixed=b.fighters[i];
    assert.ok(peaks[i].hand>.001&&peaks[i].head>.005,'ambos muñecos mueven mano y cabeza en la secuencia');
    assert.deepEqual(f.controller,neutral());assert.equal(f.lunge,0);assert.equal(f.guard,false);
    assert.equal(f.fluid.origin.x,f.pose.head.x);assert.equal(f.fluid.origin.z,f.pose.head.z);
    assert.equal(f.baseX,fixed.baseX);assert.equal(f.rig.passive,false);
  }
});
