import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {firstWeaponContact,resolveWeaponBind} from '../public/physics/weapon-bind.js';

// This is the pre-optimization signed-total solver, not the obsolete bilateral
// contact model. Private module identity stays consistent for projected pairs.
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const relocate=(source,url,override={})=>source.replace(/from (['"])(\.[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${override[path]??new URL(path,url).href}${quote}`);
const rigSource=await readFile(new URL('../audit/articulated-rig-v4-rich-contact.js.txt',import.meta.url),'utf8');
const bindSource=await readFile(new URL('../audit/weapon-bind-v4-rich-contact.js.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(rigSource).digest('hex'),'45702bd92e9051034d9764feeb8097408df4796304a19a697ce5970a0812175f');
assert.equal(createHash('sha256').update(bindSource).digest('hex'),'f8db18e6ced60e58ddfb172588b5b5b863b9929a7b68597777828827047b8a3f');
const rigURL=data(relocate(rigSource,new URL('../public/physics/articulated-rig.js',import.meta.url)));
const {ArticulatedRig:RichRig}=await import(rigURL);
const {resolveWeaponBind:resolveRich}=await import(data(relocate(bindSource,new URL('../public/physics/weapon-bind.js',import.meta.url),{'./articulated-rig.js':rigURL})));
const state=r=>structuredClone({q:r.q,velocity:r.velocity,target:r.target,contacts:r.contacts,lastImpulse:r.lastImpulse,lastReaction:r.lastReaction,pose:r.pose()});

test('Compact trial omits copied diagnostic rows and exactly preserves 128 rich signed responses',()=>{
  let pairs=0;
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const posture of ['ground','descending','air','stop'])for(const impulse of [{x:0,y:.006},{x:0,y:-.006},{x:.004,y:0},{x:-.004,y:0},{x:.003,y:-.006},{x:-.003,y:.006},{x:.2,y:-.3},{x:-.2,y:.3}]){
    const current=new ArticulatedRig({dir,scale,gravity:0}),rich=new RichRig({dir,scale,gravity:0});
    for(const r of [current,rich]){
      if(posture==='descending'){r.velocity[1]=-.03;r.contacts[0].x+=.00001;}
      if(posture==='air'||posture==='stop')r.q[1]=1.85;
      if(posture==='stop')r.q[14]=r.limits[14][1];
    }
    const options={body:'frontFoot',point:current.pose().feet.front.center,normal:{x:.6,y:.8},impulse};
    const before=state(current),expected=rich.trialContactImpulse(options),full=current.trialContactImpulse(options),compact=current.trialContactImpulse({...options,compact:true});
    assert.deepEqual(full,expected,'default detailed API remains bit-exact');
    assert.equal(Object.hasOwn(compact,'constraints'),false,'compact must not allocate/return per-row diagnostic objects');
    const {constraints,...physical}=expected,{constraintSummary,...compactPhysical}=compact;
    assert.deepEqual(compactPhysical,physical);
    assert.deepEqual(constraintSummary,{minMultiplier:Math.min(...constraints.map(c=>c.multiplier)),minSlack:Math.min(...constraints.map(c=>c.slack)),maxComplementarity:Math.max(...constraints.map(c=>Math.abs(c.multiplier*c.slack)))});
    assert.deepEqual(state(current),before,'both query modes leave mechanics untouched');
    current.reactImpulse(options);rich.reactImpulse(options);assert.deepEqual(state(current),state(rich));pairs++;
  }
  assert.equal(pairs,128);
});

test('Compact runtime and archived rich solver produce identical real steel events and mechanics in 32 pairs',()=>{
  let pairs=0;
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const magnitude of [.02,.04,.06,.08])for(const slip of [-.035,.035]){
    const make=Type=>[new Type({dir,scale,baseX:-dir*1.53*scale,gravity:0}),new Type({dir:-dir,scale,baseX:dir*1.53*scale,gravity:0})];
    const current=make(ArticulatedRig),rich=make(RichRig);
    for(const rigs of [current,rich]){
      rigs[1].q[1]+=.025;for(const r of rigs)r.previousQ=r.q.slice();
      const c=firstWeaponContact(...rigs);assert.ok(c,'actual steel contact');const n=c.normal,t={x:-n.y,y:n.x};
      rigs[0].reactImpulse({body:'weapon',point:c.pointA,impulse:{x:n.x*magnitude+t.x*slip,y:n.y*magnitude+t.y*slip}});
      rigs[1].reactImpulse({body:'weapon',point:c.pointB,impulse:{x:-n.x*magnitude-t.x*slip,y:-n.y*magnitude-t.y*slip}});
    }
    assert.deepEqual(current.map(state),rich.map(state));
    const result=resolveWeaponBind(...current,{project:false,observeVelocities:true}),expected=resolveRich(...rich,{project:false,observeVelocities:true});
    assert.ok(result.impulse>0,'response is nonvacuous');
    assert.deepEqual(result,expected,'all contact/event metadata including iterations, energy and impulses');
    assert.deepEqual(current.map(state),rich.map(state),'q/v/targets/ground reactions/lastImpulse/pose');pairs++;
  }
  assert.equal(pairs,32);
});
