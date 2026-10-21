import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig,REFERENCE_STANCE} from '../public/physics/articulated-rig.js';
import {captureReplayState,replayView} from '../public/replay.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0));
function advance(g,f,n=120){for(let i=0;i<n;i++)g.updateFighter(f,STEP);return f.pose;}
function check(f){
  const p=f.pose,s=f.boss?1.18:1;
  assert.ok(p.neckPivot,'neck exports its existing .025 depth mounting offset');
  assert.ok(Math.abs(distance(p.neckPivot,p.head)-REFERENCE_STANCE.neck*s)<1e-8,'neck has one fixed spatial length');
  const d=f.rig.diagnostics();assert.ok(d.neckLateral&&Number.isFinite(d.neckLateral.inertia));
  assert.ok(Math.hypot(f.rig.q[12],d.neckLateral.angle)<=25*Math.PI/180+1e-8,'combined active neck cone');
  assert.ok(d.contacts.every(c=>c.error<.0002));assert.ok(d.coordinates.every(q=>Number.isFinite(q.position)&&q.position>=q.min-1e-8&&q.position<=q.max+1e-8));
}

test('Inclinación móvil desplaza la cabeza física XYZ en ambos lados y tamaños sin teleportarla',()=>{
  for(const boss of [false,true])for(const dir of [1,-1]){
    const g=new DuelEngine();if(boss)g.setDifficulty('boss');const f=g.fighters[boss?1:0];f.dir=dir;g.initializeRig(f);advance(g,f,60);
    const before={...f.pose.head};f.controller.headX=1;f.controller.headZ=1;
    advance(g,f,1);assert.ok(distance(before,f.pose.head)<.025,'motor must accelerate instead of assigning a requested position');
    advance(g,f);check(f);
    assert.ok(f.pose.head.x-before.x>.09,'positive headX means world +X for both players');
    assert.ok(f.pose.head.z-before.z>.14,'the actual collision/water/membrane center moves in Z');
    assert.ok(Math.abs(f.headVelocity.vz)>0);assert.equal(f.membrane.targetSupport.z,f.pose.head.z);
    assert.equal(f.fluid.origin.z,f.pose.head.z);assert.ok(f.fluid.retainedParticles.every(p=>Number.isFinite(p.z)));
    f.controller.headX=0;f.controller.headZ=0;advance(g,f,240);check(f);
    assert.ok(Math.abs(f.pose.head.z-before.z)<.004,'neck returns when input is released');
  }
});

test('El giro lateral comparte reloj fijo, usa masa e inercia observadas y su snapshot de replay es propio',()=>{
  const pose={neckYawTarget:.34,headBaseZ:.025};
  const a=new ArticulatedRig(),b=new ArticulatedRig(),heavy=new ArticulatedRig();
  for(const r of [a,b])r.setIntent(pose,{waterLoad:{mass:.2,inertia:.01,lateralInertia:.01}});
  heavy.setIntent(pose,{waterLoad:{mass:3,inertia:.2,lateralInertia:.7}});
  a.step(STEP);heavy.step(STEP);
  assert.ok(a.pose().head.z>heavy.pose().head.z,'retained water inertia changes acceleration');
  for(let i=1;i<240;i++)a.step(STEP);for(let i=0;i<60;i++)b.step(1/30);
  assert.deepEqual(a.pose().neckLateral,b.pose().neckLateral);assert.deepEqual(a.pose().head,b.pose().head);
  const g=new DuelEngine(),f=g.fighters[0];f.controller.headZ=-1;advance(g,f,90);
  const snapshot=captureReplayState(g),view=replayView(snapshot),z=f.pose.head.z;view.fighters[0].pose.neckLateral.angle=99;
  assert.notEqual(f.pose.neckLateral.angle,99);assert.equal(snapshot.fighters[0].pose.head.z,z);
  f.rig.collapse();for(let i=0;i<240;i++)f.rig.step(STEP);assert.equal(f.rig.diagnostics().neckLateral.motorTorque,0);
  assert.ok(Object.values(f.rig.pose().head).every(Number.isFinite));
  g.resetMatch();assert.equal(g.fighters[0].pose.neckLateral.angle,0);assert.equal(g.fighters[0].pose.head.z,.025);
});
