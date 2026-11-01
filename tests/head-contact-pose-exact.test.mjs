import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';
import {AXE_REFERENCE_PINS,applyAxeFacingReference} from './fixtures/axe-facing-reference-layer.mjs';

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

test('scalar head points retain exact coupled contacts and complete rigs across tilt, scale, mirrors and limb damage',()=>{
  let cases=0,headEvents=0;
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const yaw of [-.3,0,.3]){
    const damage=yaw!==0,a=pair(ArticulatedRig,dir,scale,yaw,damage),b=pair(ReferenceRig,dir,scale,yaw,damage),options={headRadiiA:radii(scale),headRadiiB:radii(scale)};
    const actual=ArticulatedRig.resolvePair(...a,options),expected=ReferenceRig.resolvePair(...b,options);
    assert.deepEqual(actual,expected,`contacts ${dir}/${scale}/${yaw}`);
    assert.deepEqual(a.map(capture),b.map(capture),`rig states ${dir}/${scale}/${yaw}`);
    headEvents+=actual.events.filter(event=>event.material==='latex').length;cases++;
  }
  assert.equal(cases,12);assert.ok(headEvents>0,'the corpus must exercise physical balloon contact, not just separated heads');
});
