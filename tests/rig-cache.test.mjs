import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';

const fresh=rig=>Object.assign(new ArticulatedRig(),Object.fromEntries(Object.keys(rig).filter(k=>k!=='apron').map(k=>[k,structuredClone(rig[k])])));
test('Cinemática y masa cacheadas se invalidan con cada entrada mecánica, incluso agua modificada in situ',()=>{
  const rig=new ArticulatedRig();
  rig.waterLoad={mass:1.5,offset:{x:.02,y:-.07},inertia:.09,lateralInertia:.1,lateralOffset:0};
  const mutations=[r=>r.q[4]-=.03,r=>r.q=r.q.slice(),r=>r.swordLength+=.04,r=>r.scale=1.1,r=>r.dir=-1,
    r=>r.massScale=1.2,r=>r.weaponMass=.42,r=>{r.twoHanded=true;r.gripOffset=.22;},r=>r.defenseLength=.34,
    r=>r.defenseRestAngle=.13,r=>r.wristRestAngle-=.04,r=>r.neckLateral.angle=.12,
    r=>r.waterLoad.mass+=.3,r=>r.waterLoad.offset.x+=.03,r=>r.waterLoad.offset.y-=.02,r=>r.waterLoad.inertia+=.05];
  for(const mutate of mutations){
    rig.pose();rig.diagnostics();mutate(rig);const cold=fresh(rig);
    assert.deepEqual(rig.pose(),cold.pose());
    assert.deepEqual(rig.diagnostics().massMatrix,cold.diagnostics().massMatrix);
    assert.deepEqual(rig.collisionPanels(),cold.collisionPanels());
  }
});

test('Los frames expuestos por pose son propios y no corrompen el siguiente contacto ni la cinemática',()=>{
  const rig=new ArticulatedRig(),before=rig.pose(),panels=rig.collisionPanels(),exposed=rig.pose();
  exposed.bodyFrames.mainForearm.origin.x=999;exposed.bodyFrames.weapon.angle=NaN;exposed.bodyFrames.torso.center.y=-999;
  assert.deepEqual(rig.pose(),before);assert.deepEqual(rig.collisionPanels(),panels);
});
