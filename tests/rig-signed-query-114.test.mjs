import test from 'node:test';
import assert from 'node:assert/strict';
import {collisionModules,collisionPair,resolveCollisionPair,rigState} from './fixtures/rig-collision-reference-114.mjs';
// Keep the default-trial rig frozen, but share the corrected contact algorithm
// so cache equivalence never requires reproducing an embedded compound bug.
const {reference,candidate}=await collisionModules({fixedContactReference:true});
const inputs=[{x:0,y:0},{x:0,y:.006},{x:0,y:-.006},{x:.004,y:0},{x:-.004,y:0},{x:.003,y:-.006},{x:-.003,y:.006},{x:.2,y:-.3},{x:-.2,y:.3},{x:9,y:-9}];

test('immutable contact-query API exists without replacing default trial or react semantics',()=>{
  const r=new candidate.ArticulatedRig({gravity:0});
  assert.equal(typeof r.createContactImpulseQuery,'function','native reusable snapshot API');
  assert.equal(typeof candidate.ArticulatedRig.createNativeContactQuery,'function','optional captured-native factory on the class');
  const point=r.pose().feet.front.center,query=r.createContactImpulseQuery({body:'frontFoot',point,normal:{x:.6,y:.8}});
  assert.ok(candidate.ArticulatedRig.createNativeContactQuery(r,{body:'frontFoot',point,normal:{x:.6,y:.8}}));
  assert.ok(Object.isFrozen(query));assert.equal(typeof query.trial,'function');
  assert.throws(()=>{query.trial=null;},TypeError);
  assert.equal(r.createContactImpulseQuery({body:'missing',point,normal:{x:1,y:0}}),null);
  assert.equal(r.createContactImpulseQuery({body:'frontFoot',point,normal:{x:0,y:0}}),null);
  assert.equal(query.trial({impulse:{x:NaN,y:0}}),null);
});

test('prepared batches equal the complete 1.13 default rich/compact API for mirrors/sizes/support layouts and signed impulses',()=>{
  let cases=0;
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const posture of ['ground','descending','air','stop']){
    const a=new reference.ArticulatedRig({dir,scale,gravity:0}),b=new candidate.ArticulatedRig({dir,scale,gravity:0});
    for(const r of [a,b]){
      if(posture==='descending'){r.velocity[1]=-.03;r.contacts[0].x+=.00001;}
      if(posture==='air'||posture==='stop')r.q[1]=1.85;
      if(posture==='stop')r.q[14]=r.limits[14][1];
    }
    const options={body:'frontFoot',point:a.pose().feet.front.center,normal:{x:.6,y:.8}},query=b.createContactImpulseQuery(options),before=rigState(b);
    for(const impulse of inputs)for(const compact of [false,true]){
      const expected=a.trialContactImpulse({...options,impulse,compact});
      assert.deepEqual(b.trialContactImpulse({...options,impulse,compact}),expected,'default API remains exactly 1.13');
      assert.deepEqual(query.trial({impulse,compact}),expected,`${dir}/${scale}/${posture}/${JSON.stringify(impulse)}/${compact}`);
      cases++;
    }
    assert.deepEqual(rigState(b),before,'query preparation and every trial leave live mechanics untouched');
  }
  assert.equal(cases,320);
});

test('snapshot owns its inputs, survives all later rig mutations and returns independent rich/compact outputs',()=>{
  const r=new candidate.ArticulatedRig({gravity:0}),point={...r.pose().feet.front.center},normal={x:.6,y:.8};
  const options={body:'frontFoot',point,normal},query=r.createContactImpulseQuery(options),impulse={x:.003,y:-.006};
  const expected=query.trial({impulse}),compact=query.trial({impulse,compact:true});
  const first=query.trial({impulse});first.velocity[0]=999;first.deltaVelocity[0]=998;first.generalized[0]=997;
  first.pointVelocityBefore.x=996.5;first.pointVelocityAfter.x=996;first.groundImpulses.footF=995;first.constraints[0].row[0]=994;first.constraints[0].slack=993;
  first.activeSet.push(999);first.releasedFeet.push('fake');first.footRows.push({index:999,key:'fake'});first.constraintImpulses.push(999);
  const other=query.trial({impulse,compact:true});other.constraintSummary.minSlack=992;other.velocity[0]=991;other.pointVelocityBefore.x=990;
  point.x+=.4;normal.x=-.9;
  r.q[0]+=.08;r.q[13]+=.04;r.velocity[0]=.12;r.velocity[1]=-.02;r.velocity[14]=.15;
  r.contacts[0].stance=false;r.contacts[0].x+=.05;r.contacts[1].vx=-.014;r.limits[14][1]-=.1;
  r.depth.ankleF+=.015;r.depth.offHand=.08;r.waterLoad={mass:1.1,offset:{x:.04,y:-.05},inertia:.07,lateralInertia:.06,lateralOffset:.025};
  assert.deepEqual(query.trial({impulse}),expected,'old snapshot ignores later q/velocity/contacts/limits/depth/water/input mutations');
  assert.deepEqual(query.trial({impulse,compact:true}),compact);
  const freshOptions={body:'frontFoot',point:r.pose().feet.front.center,normal:{x:.6,y:.8}},fresh=r.createContactImpulseQuery(freshOptions);
  const current=r.trialContactImpulse({...freshOptions,impulse});assert.deepEqual(fresh.trial({impulse}),current);assert.notDeepEqual(current,expected);
  r.damageJoint('frontKnee',1);
  assert.deepEqual(query.trial({impulse}),expected,'detachment cannot retroactively mutate a frozen query');
  assert.equal(r.createContactImpulseQuery(freshOptions),null,'new queries obey changed topology');
});

test('layout/projector cache keys retain exact released-foot and active-row order across alternating total impulses',()=>{
  let activeStates=new Set(),releasedStates=new Set();
  for(const dir of [-1,1]){
    const r=new candidate.ArticulatedRig({dir,gravity:0});r.velocity[1]=-.025;r.contacts[0].x+=.00001;
    const options={body:'frontFoot',point:r.pose().feet.front.center,normal:{x:.6,y:.8}},q=r.createContactImpulseQuery(options);
    for(const impulse of [...inputs,...inputs.slice().reverse(),...inputs]){
      const actual=q.trial({impulse}),expected=r.trialContactImpulse({...options,impulse});assert.deepEqual(actual,expected);
      activeStates.add(actual.activeSet.join(','));releasedStates.add(actual.releasedFeet.join(','));
    }
  }
  assert.ok(activeStates.size>1,'impulses actually choose different unilateral active sets');
  assert.ok(releasedStates.size>1,'both loaded and released foot layouts are exercised');
});

test('native optimization eligibility rejects own/prototype method overrides and keeps measured fallback behavior',()=>{
  const native=candidate.ArticulatedRig.prototype;
  for(const name of ['trialContactImpulse','reactImpulse','pointVelocity','createContactImpulseQuery']){
    const rigs=collisionPair(candidate,{sweep:false}),r=rigs[0],original=r[name];let calls=0;
    r[name]=function(...args){calls++;return original.apply(this,args);};
    assert.equal(candidate.ArticulatedRig.createNativeContactQuery(r,{body:'weapon',point:r.pose().tip,normal:{x:1,y:0}}),null,name+' override');
    const result=candidate.bind.resolveWeaponBind(...rigs,{project:false});assert.ok(result.at,'real steel contact exercises fallback');
    if(name==='trialContactImpulse')assert.ok(calls>0,'the override is called rather than bypassed');
  }
  const prior=native.trialContactImpulse;
  try{native.trialContactImpulse=function(...args){return prior.apply(this,args);};const r=new candidate.ArticulatedRig();assert.equal(candidate.ArticulatedRig.createNativeContactQuery(r,{point:r.pose().tip}),null,'captured constants survive prototype changes');}
  finally{native.trialContactImpulse=prior;}
  assert.equal(candidate.ArticulatedRig.createNativeContactQuery({trialContactImpulse:prior},{}),null,'duck typed legacy is never presumed native');
});

test('32 real native weapon pairs retain their full four-step trace against the frozen default rig with the same corrected contact algorithm',()=>{
  assert.equal(reference.ArticulatedRig.createNativeContactQuery,undefined,'the independent frozen reference cannot use the new snapshot cache');
  let pairs=0,contacts=0,friction=0;
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const weapon of ['sword','spear','axe','maul'])for(const grip of ['normal','reverse']){
    const spec={dir,scale,weapon,grip,flex:true,sweep:true},a=collisionPair(reference,spec),b=collisionPair(candidate,spec);
    for(let tick=0;tick<4;tick++){
      const old=resolveCollisionPair(reference,a),now=resolveCollisionPair(candidate,b);assert.deepEqual(now,old,`${JSON.stringify(spec)}/${tick}`);
      contacts+=!!old.contact?.at;friction+=Math.abs(old.contact?.frictionImpulse??0)>1e-6;
      for(let i=0;i<2;i++){a[i].step(1/120);b[i].step(1/120);assert.deepEqual(rigState(b[i]),rigState(a[i]),'complete post-step state');}
    }
    pairs++;
  }
  assert.equal(pairs,32);assert.ok(contacts>0&&friction>0,'real steel contacts and nonzero friction are non-vacuous');
});
