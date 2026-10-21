import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,WATER_RIG_DENSITY} from '../public/engine.js';
const puncture=g=>{g.mode='versus';g.phase='fight';const[a,b]=g.fighters,h=b.pose.head;g.burst(b,a,{x:h.x-.422,y:h.y,z:.17});return b;};
test('La rotura descarga según abertura y soporte; el agua retenida sigue cargando al rig',()=>{
  const g=new DuelEngine(),f=puncture(g),initial=f.fluid.volume;
  assert.equal(f.fluid.releasedVolume,0,'a contact must not instantly release the bulk ledger');
  assert.equal(f.fluid.retainedVolume,initial);assert.ok(f.balloonMass>0);
  let sawReleased=false,sawRetained=false,peakOrificeCredit=0;
  for(let i=0;i<360;i++){
    g.update(STEP);const fluid=f.fluid,s=f.membrane.state;
    sawReleased ||= fluid.releasedVolume>0;sawRetained ||= fluid.retainedVolume>0&&fluid.releasedVolume>0;
    peakOrificeCredit=Math.max(peakOrificeCredit,fluid.leakState.budgetVolume);
    assert.ok(Math.abs(fluid.retainedVolume+fluid.releasedVolume-initial)<1e-12);
    assert.equal(fluid.particles.length,200);
    assert.ok(fluid.retainedVolume<=s.containmentCapacity+fluid.particleVolume+1e-10);
    assert.ok(Math.abs(f.balloonMass-fluid.retainedVolume*WATER_RIG_DENSITY)<1e-12);
    for(const p of fluid.releasedParticles)assert.ok([p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite));
  }
  assert.ok(sawReleased&&sawRetained);
  // The normal skin loses geometric support before the orifice credit reaches
  // one parcel. The stable-container fixture in water-support.test proves
  // positive orifice discharge; forcing a jet here would invent extra water.
  assert.ok(peakOrificeCredit>0&&peakOrificeCredit<f.fluid.particleVolume,'the normal fixture accrues subparcel flow before loss of support clears that unused credit');
  assert.ok(f.fluid.leakState.supportLossVolume>0,'retracting skin must release water it can no longer support');
  assert.ok(f.membrane.stats().fractureEvents>1);assert.equal(g.scores[0],1);
});
test('Calidad gráfica no cambia membrana, agua física, articulación ni resultado de la misma rotura',()=>{
  const a=new DuelEngine(),b=new DuelEngine();a.quality='eco';b.quality='ultra';const fa=puncture(a),fb=puncture(b);
  for(let i=0;i<120;i++){a.update(STEP);b.update(STEP);}
  assert.deepEqual(a.scores,b.scores);assert.deepEqual(fa.pose,fb.pose);
  assert.deepEqual(fa.membrane.mesh(),fb.membrane.mesh());
  assert.deepEqual(fa.fluid.particles,fb.fluid.particles);assert.equal(fa.fluid.retainedVolume,fb.fluid.retainedVolume);
  assert.ok(a.particles.length<b.particles.length||a.particles.length===0,'only decorative glints may vary');
});
test('El volumen y COM retenidos alimentan la inercia y la velocidad de la cabeza viene de la pose física',()=>{
  const g=new DuelEngine(),f=g.fighters[0],before={...f.pose.head};g.mode='versus';g.phase='fight';g.setControl(1,{lean:.8,mainY:.6});g.update(STEP);
  assert.equal(f.pose.dynamic,true);assert.deepEqual(f.pose,f.rig.pose());
  assert.ok(Math.abs(f.rig.waterLoad.mass-f.fluid.retainedVolume*WATER_RIG_DENSITY)<1e-12);assert.ok(f.rig.waterLoad.inertia>0);
  assert.ok(Math.abs(f.headVelocity.vx-Math.max(-8,Math.min(8,(f.pose.head.x-before.x)/STEP)))<1e-12);
  assert.ok(Math.abs(f.headVelocity.vy-Math.max(-8,Math.min(8,(f.pose.head.y-before.y)/STEP)))<1e-12);
});
