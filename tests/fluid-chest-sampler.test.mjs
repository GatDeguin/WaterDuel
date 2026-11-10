import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {fluidSolidColliders} from '../public/physics/fluid-solids.js';

test('the synchronous fluid sampler matches native torso solids through body and arm depth history',()=>{
  for(const [dir,scale] of [[1,1],[-1,1.18]]){
    const rig=new ArticulatedRig({dir,scale});
    rig.previousQ=rig.q.slice();
    rig.q[0]+=.137;rig.q[1]+=.017;rig.q[2]-=.172;rig.q[3]+=.206;
    rig.projectBodyDepth(-.27);rig.projectWeaponDepth(.08);
    const sampled=[];
    const colliders=fluidSolidColliders([{rig}],1/120,{nativeChestSampler(value){
      const sample=ArticulatedRig.createNativeFluidChestSampler(value);
      assert.equal(typeof sample,'function');
      return (t,key)=>{sampled.push(key);return sample(t,key);};
    }});
    for(const key of ['chest-front','chest-back','mainUpper']){
      const collider=colliders.find(solid=>solid.key===key);
      for(const t of [.00001,.137,.5,.894,.99999])assert.deepEqual(collider.motionAt(t),rig.collisionSolidsAt(t,key)[0]);
    }
    assert.deepEqual(sampled,[...Array(5).fill('chest-front'),...Array(5).fill('chest-back')]);
  }
});

test('standalone fluid colliders read live history and an overridden rig keeps its own sampler',()=>{
  const rig=new ArticulatedRig();
  rig.previousQ=rig.q.slice();
  const defaultChest=fluidSolidColliders([{rig}]).find(solid=>solid.key==='chest-front');
  rig.q=rig.q.slice();rig.q[0]+=.18;
  assert.deepEqual(defaultChest.motionAt(.43),rig.collisionSolidsAt(.43,'chest-front')[0]);

  const original=rig.collisionSolidsAt,calls=[];
  rig.collisionSolidsAt=function(t,key){calls.push([t,key]);return original.call(this,t,key);};
  const customChest=fluidSolidColliders([{rig}],1/120,{nativeChestSampler:ArticulatedRig.createNativeFluidChestSampler})
    .find(solid=>solid.key==='chest-front');
  assert.deepEqual(customChest.motionAt(.43),original.call(rig,.43,'chest-front')[0]);
  assert.deepEqual(calls,[[0,undefined],[.43,'chest-front']]);
});
