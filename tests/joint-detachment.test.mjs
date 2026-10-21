import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ArticulatedRig,RIG_STEP} from '../public/physics/articulated-rig.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/rig-pre-joint-damage.json',import.meta.url)));
for(const frame of baseline.frames)frame.pose.apron.canonicalMatrix=new Float64Array(Object.values(frame.pose.apron.canonicalMatrix));
const finite=values=>values.every(Number.isFinite);

test('an intact rig retains every original coordinate, velocity, pose and collision panel',()=>{
  const rig=new ArticulatedRig({baseX:-1.53});rig.reactImpulse({body:'weapon',point:rig.pose().tip,impulse:{x:.05,y:.09}});
  for(let step=1;step<=24;step++){
    rig.step(RIG_STEP);const expected=baseline.frames.find(f=>f.step===step);if(!expected)continue;
    assert.deepEqual([...rig.q],expected.q);assert.deepEqual([...rig.velocity],expected.velocity);
    assert.deepEqual(rig.pose(),expected.pose);assert.deepEqual(rig.collisionPanels(),expected.panels);
  }
});

test('progressive joint damage is bounded, changes motor recovery, and rejects invalid values',()=>{
  const healthy=new ArticulatedRig(),damaged=new ArticulatedRig();
  assert.equal(typeof damaged.damageJoint,'function');
  assert.equal(damaged.damageJoint('wrist',.55).detached,false);
  assert.equal(damaged.pose().joints.wrist.damage,.55);
  assert.throws(()=>damaged.damageJoint('wrist',NaN),RangeError);
  assert.throws(()=>damaged.damageJoint('wrist',-.1),RangeError);
  assert.equal(damaged.damageJoint('not-a-joint',1).applied,false);
  for(const rig of [healthy,damaged])rig.reactImpulse({body:'weapon',point:rig.pose().tip,impulse:{x:0,y:.1}});
  for(let i=0;i<45;i++){healthy.step(RIG_STEP);damaged.step(RIG_STEP);}
  assert.ok(Math.abs(damaged.q[13]-damaged.target[13])>Math.abs(healthy.q[13]-healthy.target[13]),'weakened wrist has observable slower recovery');
  assert.ok(finite([...damaged.q,...damaged.velocity]));
  assert.equal(damaged.drainJointEvents().length,1);assert.equal(damaged.drainJointEvents().length,0);
});

test('a severed arm is continuous, owns its mass/weapon once, and disappears from every parent collision path',()=>{
  for(const joint of ['mainShoulder','mainElbow','wrist']){
    const rig=new ArticulatedRig(),before=rig.pose(),bodies=rig.diagnostics().bodies;
    rig.velocity[0]=.3;rig.velocity[4]=.4;rig.velocity[5]=-.2;rig.velocity[13]=.6;
    const result=rig.damageJoint(joint,1);assert.equal(result.detached,true);
    const pose=rig.pose(),fragment=pose.detached[0];assert.ok(fragment.bodies.includes('weapon'));
    assert.deepEqual(fragment.transform,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    assert.deepEqual(JSON.parse(JSON.stringify(fragment.sourcePose)),JSON.parse(JSON.stringify(before,(k,v)=>ArrayBuffer.isView(v)?Array.from(v):v)),'captured pose has no recursive damage/fragment fields');
    assert.throws(()=>{fragment.sourcePose.mainHand.x=999;},TypeError,'birth pose is deeply immutable, not a live rig alias');
    assert.equal(rig.isBodyAttached('weapon'),false);assert.equal(rig.pointVelocity({body:'weapon',point:before.tip}),null);
    for(const query of [()=>rig.collisionPanels(),()=>rig.collisionPanelsAt(.5),()=>rig.collisionGeometryAt(.5),()=>rig.collisionSolidsAt(.5)])
      assert.ok(query().every(p=>!fragment.bodies.includes(p.body)));
    for(const key of ['weapon','weapon-head','main-palm'])assert.deepEqual(rig.collisionSolidsAt(.5,key),[]);
    const liveMass=rig.diagnostics().bodies.reduce((s,b)=>s+b.mass,0),oldMass=bodies.reduce((s,b)=>s+b.mass,0);
    assert.ok(Math.abs(liveMass+rig.fragments[0].mass-oldMass)<1e-12);
    assert.equal(rig.damageJoint(joint,1).detached,true);assert.equal(rig.fragments.length,1,'one physical fragment per broken branch');
    assert.equal(rig.drainJointEvents().filter(e=>e.type==='joint-detach').length,1);
  }
});

test('detached compounds preserve linear/angular momentum and have finite floor contact with friction',()=>{
  const rig=new ArticulatedRig();rig.velocity[0]=.8;rig.velocity[1]=-.3;rig.velocity[4]=1;rig.velocity[5]=-.6;rig.velocity[13]=.7;
  rig.damageJoint('mainShoulder',1);const cluster=rig.fragments[0],receipt=cluster.birth;
  assert.ok(Math.abs(cluster.mass*cluster.vx-receipt.momentum.x)<1e-12);
  assert.ok(Math.abs(cluster.mass*cluster.vy-receipt.momentum.y)<1e-12);
  assert.ok(Math.abs(cluster.inertia*cluster.omega-receipt.angularMomentum)<1e-12);
  assert.ok(receipt.rigidKineticEnergy<=receipt.originalKineticEnergy+1e-12,'internal welding may dissipate relative motion, never invent energy');
  const firstY=cluster.y;for(let i=0;i<360;i++)rig.step(RIG_STEP);
  assert.ok(cluster.y<firstY-.1,'gravity moves the fragment independently');
  assert.ok(cluster.worldVertices().every(p=>p.y>=TABLE_TOP-1e-7),'no floor penetration');
  assert.ok(finite([cluster.x,cluster.y,cluster.angle,cluster.vx,cluster.vy,cluster.omega,...cluster.transform()]));
  assert.ok(cluster.floorContacts>0,'real vertices exercised the floor solver');
});

test('broken legs release the matching support, stop gait, and all supports lost allows falling',()=>{
  const rig=new ArticulatedRig(),before=rig.pose().hip.y;
  rig.damageJoint('frontKnee',1);assert.equal(rig.contacts.some(c=>c.key==='footF'),false);assert.equal(rig.contacts.length,1);
  rig.setIntent(rig.pose(),{baseX:.4});for(let i=0;i<12;i++)rig.step(RIG_STEP);assert.equal(rig.gait.swing,null);
  rig.damageJoint('backHip',1);assert.equal(rig.contacts.length,0);
  for(let i=0;i<90;i++)rig.step(RIG_STEP);
  assert.ok(rig.pose().hip.y<before-.1,'no hovering base balance after both supports are severed');
  assert.equal(rig.passive,false,'limb fracture does not award balloon loss/collapse');
});

test('maul grip release is persistent and equipment follows the correct severed branch',()=>{
  for(const joint of ['offShoulder','mainElbow']){
    const rig=new ArticulatedRig(),pose=rig.pose();pose.equipment={weapon:'maul',defense:'none'};pose.twoHanded=true;pose.gripOffset=.22;pose.weaponMass=.48;
    rig.setIntent(pose);rig.damageJoint(joint,1);assert.equal(rig.twoHanded,false);
    rig.setIntent(pose);assert.equal(rig.twoHanded,false,'fresh intended two-hand pose cannot heal the broken grip');
    assert.equal(rig.isBodyAttached('weapon'),joint==='offShoulder');
    assert.equal(rig.fragments[0].bodyNames.includes('weapon'),joint==='mainElbow');
  }
});

test('fragment transformAt and worldPointAt retain the whole caller STEP across substeps',()=>{
  const rig=new ArticulatedRig();rig.damageJoint('wrist',1);const fragment=rig.fragments[0],tip={...fragment.sourcePose.tip},before=fragment.transform();
  assert.equal(typeof fragment.transformAt,'function');
  fragment.vx=.8;fragment.omega=.6;rig.step(3*RIG_STEP);
  assert.deepEqual(fragment.transformAt(0),before,'previous belongs to start of the caller, not its last substep');
  assert.deepEqual(fragment.worldPointAt(tip,0),tip,'no teleport of the material tip at the previous endpoint');
  const m=fragment.transformAt(1),point=fragment.worldPointAt(tip,1);
  assert.ok(Math.abs(point.x-(m[0]*tip.x+m[4]*tip.y+m[12]))<1e-12);
  assert.ok(Math.abs(point.y-(m[1]*tip.x+m[5]*tip.y+m[13]))<1e-12);
  assert.equal(point.z,tip.z);assert.notDeepEqual(point,tip);
});

test('all nine breakable joints retain finite mass and matching collision masks in both directions and scales',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const joint of ['mainShoulder','mainElbow','wrist','offShoulder','offElbow','frontHip','frontKnee','backHip','backKnee']){
    const rig=new ArticulatedRig({dir,scale}),before=rig.diagnostics().bodies.reduce((sum,b)=>sum+b.mass,0);
    assert.equal(rig.damageJoint(joint,1).detached,true,joint);
    const fragment=rig.fragments[0],live=rig.diagnostics().bodies.reduce((sum,b)=>sum+b.mass,0);
    assert.ok(Math.abs(live+fragment.mass-before)<1e-12,joint+' accounts for all mass');
    for(const t of [0,.5,1])for(const panel of rig.collisionPanelsAt(t))assert.equal(fragment.bodyNames.includes(panel.body),false,joint+' old CCD surfaces retired');
    rig.step(RIG_STEP);assert.ok(finite([...rig.q,...rig.velocity,...fragment.transform()]),joint+' finite physical step');
  }
});

test('breaking the whole right arm removes its old wooden palm from firstTimberContact',()=>{
  const rig=new ArticulatedRig(),palm=rig.collisionPanels().find(p=>p.key==='main-palm'),n=palm.axes[1];
  const a={x:palm.center.x+n.x*.2,y:palm.center.y+n.y*.2,z:palm.z},b={x:palm.center.x-n.x*.2,y:palm.center.y-n.y*.2,z:palm.z};
  assert.ok(rig.firstTimberContact(a,b));rig.damageJoint('mainShoulder',1);assert.equal(rig.firstTimberContact(a,b),null);
  assert.equal(rig.damageJoint('mainElbow',1).applied,false,'a removed descendant cannot produce another body or mass');assert.equal(rig.fragments.length,1);
});
