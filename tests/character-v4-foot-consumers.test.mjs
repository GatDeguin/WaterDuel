import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {fluidSolidColliders} from '../public/physics/fluid-solids.js';
import {JointImpactDamage} from '../public/physics/joint-impact.js';
import {bodyAttached} from '../public/physics/limb-state.js';

test('v4 fluid foot proxies track only their actual ancestor coordinates and include both ankle DOFs',()=>{
  const r=new ArticulatedRig();r.previousQ=r.q.slice();r.q[14]+=.2;r.q[15]-=.1;r.q[12]+=.3;
  const proxies=fluidSolidColliders([{rig:r}]);
  for(const [side,angle] of [['front',.2],['back',.1]]){
    const p=proxies.find(p=>p.body===side+'Foot');assert.ok(p);assert.ok(Math.abs(p.motion.angleRate-angle)<1e-12,'unrelated neck motion must not enter foot ancestry');
    for(const t of [0,.25,.5,.75,1]){
      const s=p.motionAt(t);for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])for(const axis of ['x','y','z']){
        const v=s.center[axis]+s.axes[0][axis]*s.half[0]*x+s.axes[1][axis]*s.half[1]*y+s.axes[2][axis]*s.half[2]*z;
        assert.ok(v>=p.bounds.min[axis]-1e-9&&v<=p.bounds.max[axis]+1e-9);
      }
    }
  }
});
test('v4 foot impacts inherit their knee damage episode without adding ankle damage',()=>{
  const a={slot:1,rig:new ArticulatedRig()},b={slot:2,rig:new ArticulatedRig({dir:-1})};a.pose=a.rig.pose();b.pose=b.rig.pose();
  for(const [body,key] of [['frontFoot','frontKnee'],['backFoot','backKnee']]){
    const damage=new JointImpactDamage(),contact={source:'body',a,b,bodyA:body,bodyB:'torso',keyA:body,keyB:'chest-front',pointA:a.pose[body==='frontFoot'?'footF':'footB'],pointB:b.pose.hip,normal:{x:1,y:0,z:0},impulse:.3,closingSpeed:2};
    const changes=damage.process([contact],0);assert.equal(changes.length,1);assert.equal(changes[0].joint,key);assert.ok(changes[0].amount>0&&changes[0].amount<=.25);
    assert.deepEqual(damage.process([{...contact,bodyA:body==='frontFoot'?'frontShin':'backShin'}],.01),[],'shin and foot share one existing knee episode');
  }
});
test('v4 replay topology releases feet with their original leg chains',()=>{
  for(const [body,joints] of [['frontFoot',['frontHip','frontKnee']],['backFoot',['backHip','backKnee']]]){
    assert.equal(bodyAttached({pose:{}},body),true);
    for(const joint of joints)assert.equal(bodyAttached({pose:{joints:{[joint]:{detached:true,damage:1}}}},body),false);
  }
});
