import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {BALLOON_RADII,TABLE_TOP} from '../public/physics/dimensions.js';

// Component isolation, deliberately outside the product's starting separation:
// airborne, zero gravity, prescribed lean and a 2% initial head overlap. Nothing
// is removed from either rig, and no controller or collision method is stubbed.
function isolatedPair(dir,scale){
  const rigs=[dir,-dir].map(side=>{
    const rig=new ArticulatedRig({dir:side,scale,gravity:0});
    rig.q[1]=1.85;rig.q[3]=-.65;rig.q[12]=-.15;
    // Fold the main arm back toward its shoulder and point the blade upward.
    rig.q[4]=-2.9;rig.q[5]=2.8;rig.q[13]=Math.PI/4;
    rig.velocity.fill(0);rig.velocity[0]=side*.15;
    return rig;
  });
  const halfGap=.98*BALLOON_RADII.x*scale;
  for(const rig of rigs)rig.q[0]+=-rig.dir*halfGap-rig.pose().head.x;
  return rigs;
}
const ratio=(a,b,scale)=>Math.hypot(...['x','y','z'].map(axis=>(b[axis]-a[axis])/(2*BALLOON_RADII[axis]*scale)));
// Differentiate public head positions along qdot; no production Jacobian or
// pointVelocity participates in this velocity oracle.
function headVelocity(rig){
  const q=rig.q.slice(),h=1e-6;
  try{
    for(let i=0;i<q.length;i++)rig.q[i]=q[i]+h*rig.velocity[i];const plus=rig.pose().head;
    for(let i=0;i<q.length;i++)rig.q[i]=q[i]-h*rig.velocity[i];const minus=rig.pose().head;
    return Object.fromEntries(['x','y','z'].map(axis=>[axis,(plus[axis]-minus[axis])/(2*h)]));
  }finally{rig.q.set(q);}
}
function woodOverlap(a,b){
  if(Math.abs(a.z-b.z)>=(a.depth+b.depth)/2)return false;
  for(const polygon of [a,b])for(let i=0;i<polygon.vertices.length;i++){
    const p=polygon.vertices[i],q=polygon.vertices[(i+1)%polygon.vertices.length],n={x:p.y-q.y,y:q.x-p.x};
    const project=panel=>panel.vertices.map(v=>v.x*n.x+v.y*n.y),A=project(a),B=project(b);
    if(Math.max(...A)<=Math.min(...B)||Math.max(...B)<=Math.min(...A))return false;
  }
  return true;
}
function assertIsolated(rigs){
  for(const rig of rigs){
    const d=rig.diagnostics();assert.equal(rig.q.length,16);
    assert.ok(d.minimumGroundY>TABLE_TOP+.2,'all collider geometry is airborne');
    assert.equal(d.selfContacts.length,0,'self collision must not repair this fixture');
    assert.ok(Object.values(rig.pose().feet).every(foot=>!foot.stance&&foot.groundReaction===0));
  }
  for(const a of rigs[0].collisionPanels())for(const b of rigs[1].collisionPanels()){
    // Blade/blade contacts are outside the timber solve; retain the real blades.
    if(a.body==='weapon'&&b.body==='weapon'&&a.material!=='wood'&&b.material!=='wood')continue;
    assert.equal(woodOverlap(a,b),false,`isolated heads require separated timber: ${a.key}/${b.key}`);
  }
}

for(const dir of [-1,1])for(const scale of [1,1.18])test(`N16 isolated head contact separates real ellipsoids and arrests closing: dir=${dir}, scale=${scale}`,()=>{
  const rigs=isolatedPair(dir,scale),[a,b]=rigs,initial=rigs.map(r=>r.pose().head),beforeQ=rigs.map(r=>r.q.slice());
  assertIsolated(rigs);
  const beforeRatio=ratio(...initial,scale),normal=Math.sign(initial[1].x-initial[0].x);
  assert.ok(Math.abs(beforeRatio-.98)<1e-12,'the deliberate initial overlap is nonvacuous');
  const beforeVelocity=rigs.map(headVelocity),closingBefore=(beforeVelocity[0].x-beforeVelocity[1].x)*normal;
  assert.ok(closingBefore>.29,'heads initially approach at the prescribed relative speed');
  const radii=Object.fromEntries(Object.entries(BALLOON_RADII).map(([axis,value])=>[axis,value*scale]));
  const result=ArticulatedRig.resolvePair(a,b,{headRadiiA:radii,headRadiiB:radii});
  const final=rigs.map(r=>r.pose().head),afterRatio=ratio(...final,scale),afterVelocity=rigs.map(headVelocity);
  const closingAfter=(afterVelocity[0].x-afterVelocity[1].x)*normal;
  assert.ok(afterRatio>=1-1e-8,`independent ellipsoid ratio after solve: ${afterRatio}`);
  assert.ok(afterRatio<1.001,'a small penetration must not cause an unbounded correction');
  assert.ok(rigs.some((r,j)=>r.q.some((value,i)=>Math.abs(value-beforeQ[j][i])>1e-6)),'the solver must apply a real position correction');
  assert.equal(result.events.length,1,'only the isolated head pair may produce an impulse');
  const [impact]=result.events;
  assert.equal(impact.material,'latex');assert.equal(impact.keyA,'head');assert.equal(impact.keyB,'head');
  assert.ok(impact.impulse>0&&Number.isFinite(impact.impulse));
  assert.ok(closingAfter<closingBefore-.2&&closingAfter<1e-3,`closing speed ${closingBefore} -> ${closingAfter}`);
  assert.equal(result.contacts.length,0);assertIsolated(rigs);
});
