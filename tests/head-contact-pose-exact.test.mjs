import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';
import {AXE_REFERENCE_PINS,applyAxeFacingReference} from './fixtures/axe-facing-reference-layer.mjs';
import {assertNumericalRig,evictKinematicCache,headPenetration} from './fixtures/rig-v4-numerical-reference.mjs';

const frozen=await fs.readFile(new URL('./fixtures/articulated-rig-pre-goal-y-only-1.7.4.js.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(frozen).digest('hex'),AXE_REFERENCE_PINS.goal);
const rigURL=new URL('../public/physics/articulated-rig.js',import.meta.url),source=applyAxeFacingReference(frozen,'goal')
  .replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_match,prefix,quote,specifier)=>prefix+quote+new URL(specifier,rigURL).href+quote);
const {ArticulatedRig:ReferenceRig}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const radii=scale=>Object.fromEntries(Object.entries(BALLOON_RADII).map(([axis,value])=>[axis,value*scale]));
function pair(Type,dir=1,scale=1,yaw=0,damage=false){
  return [dir,-dir].map((side,i)=>{
    const rig=new Type({dir:side,scale,baseX:-side*1.35,gravity:0});
    if(damage)rig.damageJoint(i?'offShoulder':'mainElbow',i?1:.35);
    rig.q[3]=-.88;rig.q[12]=-.20;rig.neckLateral.angle=i?-yaw:yaw;
    rig.previousQ=rig.q.slice();rig.velocity[0]=side*.15;return rig;
  });
}
const capture=rig=>({q:rig.q.slice(),velocity:rig.velocity.slice(),target:rig.target.slice(),pose:rig.pose(),diagnostics:rig.diagnostics()});

test('head collision checks do not build public poses or request presentation snapshots',()=>{
  const rigs=pair(ArticulatedRig),counts=[0,0];
  for(const [i,rig] of rigs.entries()){const original=rig.pose;rig.pose=function(...args){counts[i]++;return original.apply(this,args);};}
  ArticulatedRig.resolvePair(...rigs,{headRadiiA:radii(1),headRadiiB:radii(1)});
  assert.deepEqual(counts,[0,0],'internal head tests use their existing state instead of presentation poses');
});

test('Head contacts: N16 cache invariance; independent numerical/ellipsoid oracles; historical N14 initial geometry only',()=>{
  let cases=0,headEvents=0;
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const yaw of [-.3,0,.3]){
    const damage=yaw!==0,a=pair(ArticulatedRig,dir,scale,yaw,damage),b=pair(ArticulatedRig,dir,scale,yaw,damage),historical=pair(ReferenceRig,dir,scale,yaw,damage),options={headRadiiA:radii(scale),headRadiiB:radii(scale)};
    for(let i=0;i<a.length;i++){
      // N14 and N16 share these upper-body coordinates; the constructor's leg
      // stance is not an oracle for the new ankles or coupled impulse response.
      assert.equal(historical[i].q.length,14);historical[i].q.set(a[i].q.subarray(0,14));
      assert.deepEqual(a[i].pose().head,historical[i].pose().head,`historical head geometry ${dir}/${scale}/${yaw}/${i}`);
      assertNumericalRig(a[i],`head corpus precontact ${dir}/${scale}/${yaw}/${i}`);
      evictKinematicCache(b[i]);
    }
    const actual=ArticulatedRig.resolvePair(...a,options),expected=ArticulatedRig.resolvePair(...b,options);
    assert.deepEqual(actual,expected,`N16 cache-invariant contacts ${dir}/${scale}/${yaw}`);
    assert.deepEqual(a.map(capture),b.map(capture),`N16 cache-invariant rig states ${dir}/${scale}/${yaw}`);
    for(const rig of a){
      assert.equal(rig.q.length,16);assert.ok([...rig.q,...rig.velocity].every(Number.isFinite));
      assertNumericalRig(rig,`head corpus postcontact ${dir}/${scale}/${yaw}`);
    }
    const penetration=headPenetration(a[0].pose().head,a[1].pose().head,options.headRadiiA,options.headRadiiB),heads=actual.contacts.filter(c=>c.head);
    assert.equal(heads.length,penetration>0?1:0,'reported head contact agrees with public ellipsoid geometry');
    if(heads.length)assert.ok(Math.abs(heads[0].penetration-penetration)<1e-12,'reported head penetration matches geometric cross-section');
    for(const event of actual.events){
      assert.ok(Number.isFinite(event.impulse)&&event.impulse>0,'every emitted impulse is finite and positive');
      assert.ok(Number.isFinite(event.closingSpeed)&&event.closingSpeed>0,'impulse opposes an approaching contact');
      assert.ok(Number.isFinite(event.peakClosingSpeed)&&event.peakClosingSpeed>=event.closingSpeed);
      if(event.material==='latex'){
        assert.equal(event.keyA,'head');assert.equal(event.keyB,'head');
        assert.ok(headPenetration(event.pointA,event.pointB,options.headRadiiA,options.headRadiiB)>0,'latex impulse requires overlapping ellipsoid cross-sections');
        assert.equal(event.normal.y,0);assert.equal(event.normal.x,Math.sign(event.pointB.x-event.pointA.x)||1);
        assert.equal(event.at.x,(event.pointA.x+event.pointB.x)/2);assert.equal(event.at.y,(event.pointA.y+event.pointB.y)/2);
      }
    }
    headEvents+=actual.events.filter(event=>event.material==='latex').length;cases++;
  }
  assert.equal(cases,12);assert.ok(headEvents>0,'the corpus must exercise physical balloon contact, not just separated heads');
});
