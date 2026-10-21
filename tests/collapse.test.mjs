import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {captureReplayState,replayView} from '../public/replay.js';
import {weaponGesture} from '../public/joysticks.js';

const sumY=rig=>{const d=rig.diagnostics(),mass=d.bodies.reduce((s,b)=>s+b.mass,0);return d.bodies.reduce((s,b)=>s+b.mass*b.center.y,0)/mass;};
test('El rig pierde el sostén y cae por gravedad, sin teleportar ni atravesar la tarima',()=>{
  const rig=new ArticulatedRig(),before=rig.pose(),com=sumY(rig);
  assert.equal(typeof rig.collapse,'function');assert.equal(rig.collapse(),true);assert.deepEqual(rig.pose().hip,before.hip,'release never teleports');
  for(let i=0;i<300;i++){
    rig.step(STEP);const d=rig.diagnostics();assert.ok(d.coordinates.every(q=>Number.isFinite(q.position)&&Number.isFinite(q.velocity)&&q.position>=q.min-1e-8&&q.position<=q.max+1e-8));
    assert.ok(d.minimumGroundY>=TABLE_TOP-.0003,`floor ${d.minimumGroundY}`);
  }
  assert.ok(rig.pose().hip.y<before.hip.y-.40,'pelvis really drops');assert.ok(sumY(rig)<com-.40,'dry mass COM really drops');
  assert.equal(rig.diagnostics().passive,true);assert.equal(rig.diagnostics().contacts.length,0,'feet are no longer pinned');
});

test('La caída física conserva el estado a 30/120 Hz y no añade muelles de sostén',()=>{
  const a=new ArticulatedRig(),b=new ArticulatedRig();a.collapse();b.collapse();
  for(let i=0;i<240;i++){a.step(STEP);if(i%4===0)b.step(1/30);}
  for(let i=0;i<a.q.length;i++){assert.ok(Math.abs(a.q[i]-b.q[i])<1e-9);assert.ok(Math.abs(a.velocity[i]-b.velocity[i])<1e-9);}
  assert.ok(a.diagnostics().motorTorque.every(v=>v===0),'no active motor torque survives');
});

test('Una perforación por controles desploma sólo al perdedor y conserva agua, látex, replay y reset',()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));g.setMode('versus');g.start();
  for(let i=0;i<1800&&!events.some(e=>e.name==='burst');i++){
    g.setControl(1,{...weaponGesture({x:1,y:.63}),lean:1});g.setControl(2,{mainX:-1,mainY:-1,offY:-1});g.update(STEP);
  }
  const burst=events.find(e=>e.name==='burst');assert.equal(burst?.data.contact,true);const loser=g.fighters[burst.data.loser-1],winner=g.fighters[burst.data.winner-1],start=loser.pose.hip.y;
  assert.equal(events.filter(e=>e.name==='thrust').length,0,'la perforación procede del gesto continuo del mando actual');
  assert.equal(loser.rig.diagnostics().passive,true);assert.equal(winner.rig.diagnostics().passive,false);
  for(let i=0;i<300;i++){g.update(STEP);assert.ok(Math.abs(loser.fluid.retainedVolume+loser.fluid.releasedVolume-loser.fluid.initialVolume)<1e-12);}
  assert.ok(loser.pose.hip.y<start-.40);assert.ok(loser.membrane.punctured);assert.equal(g.scores[burst.data.winner-1],1);
  const frame=captureReplayState(g),view=replayView(frame);assert.deepEqual(view.fighters[loser.slot-1].pose,loser.pose);view.fighters[loser.slot-1].pose.hip.y=999;assert.notEqual(loser.pose.hip.y,999);
  for(let i=0;i<150&&g.phase==='burst';i++)g.update(STEP);
  assert.equal(g.phase,'countdown');assert.equal(g.round,2);assert.ok(g.fighters.every(f=>!f.rig.diagnostics().passive&&f.globIntact),'the automatic next round restores active fresh rigs');
  g.resetMatch();assert.ok(g.fighters.every(f=>!f.rig.diagnostics().passive&&f.globIntact));
});

test('El peor caso de agua retenida y mazo mantiene tarima, límites y masa sin salto al desactivar el sostén',()=>{
  for(const difficulty of ['normal','boss'])for(const weapon of ['sword','maul']){
    const g=new DuelEngine();g.setDifficulty(difficulty);g.setLoadout(2,{weapon});const r=g.fighters[1].rig,before=r.pose().hip.y,com=sumY(r);
    assert.ok(r.waterLoad.mass>0);r.collapse();let min=Infinity,maxHip=before;
    for(let i=0;i<360;i++){
      r.step(STEP);const d=r.diagnostics();min=Math.min(min,d.minimumGroundY);maxHip=Math.max(maxHip,r.pose().hip.y);
      assert.ok(d.coordinates.every(q=>Number.isFinite(q.position)&&Number.isFinite(q.velocity)&&q.position>=q.min-1e-8&&q.position<=q.max+1e-8));
    }
    assert.ok(min>=TABLE_TOP-.0003,`${difficulty}/${weapon} floor ${min}`);assert.ok(maxHip<=before+.03,`${difficulty}/${weapon} levitated`);
    assert.ok(r.pose().hip.y<before-.40);assert.ok(sumY(r)<com-.35);assert.ok(r.diagnostics().motorTorque.every(v=>v===0));
  }
});
