import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} vs ${b}`);
const snapshot=r=>structuredClone({q:r.q,velocity:r.velocity,target:r.target,contacts:r.contacts,lastImpulse:r.lastImpulse,lastReaction:r.lastReaction,pose:r.pose(),motor:r.lastMotor,gravity:r.lastGravity});
function gaussian(M,b){
  const a=M.map((row,i)=>[...row,b[i]]),n=b.length;
  for(let i=0;i<n;i++){
    let k=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;[a[k],a[i]]=[a[i],a[k]];
    const pivot=a[i][i];assert.ok(Math.abs(pivot)>1e-12);for(let j=i;j<=n;j++)a[i][j]/=pivot;
    for(let k=0;k<n;k++)if(k!==i){const v=a[k][i];for(let j=i;j<=n;j++)a[k][j]-=v*a[i][j];}
  }return a.map(row=>row[n]);
}
// Independent COM/material-point/orientation differences reconstruct J and M;
// production massMatrix, pointVelocity, factor and constraint rows are not used.
function oracle(r){
  const q=r.q.slice(),h=2e-6,sample=()=>{const pose=r.pose();return {pose,bodies:r.diagnostics().bodies};},base=sample();
  const derivatives=[];
  try{for(let i=0;i<16;i++){
    r.q[i]=q[i]+h;const plus=sample();r.q[i]=q[i]-h;const minus=sample();r.q[i]=q[i];
    derivatives.push({point:['x','y'].map(axis=>(plus.pose.feet.front.center[axis]-minus.pose.feet.front.center[axis])/(2*h)),
      hull:base.pose.feet.front.hull.map((_,j)=>(plus.pose.feet.front.hull[j].y-minus.pose.feet.front.hull[j].y)/(2*h)),
      bodies:base.bodies.map((b,j)=>({x:(plus.bodies[j].center.x-minus.bodies[j].center.x)/(2*h),y:(plus.bodies[j].center.y-minus.bodies[j].center.y)/(2*h),
        angle:(plus.pose.bodyFrames[b.name].angle-minus.pose.bodyFrames[b.name].angle)/(2*h)}))});
  }}finally{r.q.set(q);}
  const M=Array.from({length:16},(_,i)=>Array.from({length:16},(_,j)=>i===j?1e-6:0));
  for(let b=0;b<base.bodies.length;b++)for(let i=0;i<16;i++)for(let j=0;j<16;j++){
    const p=derivatives[i].bodies[b],q=derivatives[j].bodies[b],body=base.bodies[b];M[i][j]+=body.mass*(p.x*q.x+p.y*q.y)+body.inertia*p.angle*q.angle;
  }
  return {M,J:[0,1].map(axis=>derivatives.map(d=>d.point[axis])),hull:base.pose.feet.front.hull.map((_,i)=>derivatives.map(d=>d.hull[i])),pose:base.pose,
    pointVelocity:v=>[0,1].map(axis=>dot(derivatives.map(d=>d.point[axis]),v)),energy:v=>.5*v.reduce((sum,value,i)=>sum+value*dot(M[i],v),0)};
}

test('N16 exposes an owned nonmutating signed-total contact impulse trial',()=>{
  const rig=new ArticulatedRig({gravity:0});
  assert.equal(typeof rig.trialContactImpulse,'function');
  const before=structuredClone({q:rig.q,velocity:rig.velocity,target:rig.target,contacts:rig.contacts,lastImpulse:rig.lastImpulse,lastReaction:rig.lastReaction});
  const trial=rig.trialContactImpulse({body:'frontFoot',point:rig.pose().feet.front.center,normal:{x:0,y:1},impulse:{x:.002,y:-.003}});
  assert.ok(trial&&trial.velocity.every(Number.isFinite));
  assert.deepEqual({q:rig.q,velocity:rig.velocity,target:rig.target,contacts:rig.contacts,lastImpulse:rig.lastImpulse,lastReaction:rig.lastReaction},before);
});

for(const dir of [-1,1])for(const scale of [1,1.18])test(`Signed grounded impulses share a reciprocal PSD active-set response: ${dir}/${scale}`,()=>{
  const rig=new ArticulatedRig({dir,scale,gravity:0}),reference=oracle(rig),point=rig.pose().feet.front.center,normal={x:0,y:1},tangent={x:-1,y:0};
  const before=snapshot(rig),totals=[{x:0,y:.006},{x:0,y:-.006},{x:.004,y:0},{x:-.004,y:0},{x:.003,y:-.006},{x:-.003,y:.006}];
  let released=0,compressed=0;
  for(const impulse of totals){
    const trial=rig.trialContactImpulse({body:'frontFoot',point,normal,impulse});
    assert.deepEqual(snapshot(rig),before,'trial leaves observable state untouched');
    assert.ok(trial.normal>=-1e-10&&trial.tangent>=-1e-10&&trial.normal*trial.tangent-trial.cross**2>=-1e-8,'W is PSD without a diagonal/cross clamp');
    for(const c of trial.constraints){assert.ok(c.multiplier>=0);assert.ok(c.slack>=-1e-7);assert.ok(Math.abs(c.multiplier*c.slack)<1e-7,'normal/stop complementarity');}
    for(const foot of trial.releasedFeet)assert.ok(!trial.footRows.some(row=>row.key===foot),'unloaded supports retain no tangential anchor');
    released+=trial.releasedFeet.length;compressed+=Object.values(trial.groundImpulses).filter(v=>v>1e-8).length;
    const independent=reference.pointVelocity(trial.velocity);near(independent[0],trial.pointVelocityAfter.x);near(independent[1],trial.pointVelocityAfter.y);
    for(let j=0;j<reference.hull.length;j++)assert.ok(dot(reference.hull[j],trial.velocity)>=Math.min(0,(TABLE_TOP-reference.pose.feet.front.hull[j].y)*120)-1e-7,'FD material sole velocity respects its own gap');
    const free=gaussian(reference.M,reference.J[0].map((v,i)=>v*impulse.x+reference.J[1][i]*impulse.y));
    near(reference.energy(trial.velocity),trial.energyAfter);assert.ok(trial.energyAfter<=reference.energy(free)+1e-8,'support projection cannot add kinetic energy to a rested legal state');
    const h=1e-5,columns=[];
    for(const axis of [normal,tangent]){
      const plus=rig.trialContactImpulse({body:'frontFoot',point,normal,impulse:{x:impulse.x+h*axis.x,y:impulse.y+h*axis.y}}),
        minus=rig.trialContactImpulse({body:'frontFoot',point,normal,impulse:{x:impulse.x-h*axis.x,y:impulse.y-h*axis.y}});
      assert.deepEqual(plus.activeSet,trial.activeSet);assert.deepEqual(minus.activeSet,trial.activeSet);
      assert.deepEqual(plus.releasedFeet,trial.releasedFeet);assert.deepEqual(minus.releasedFeet,trial.releasedFeet);
      const p=reference.pointVelocity(plus.velocity),m=reference.pointVelocity(minus.velocity);columns.push({x:(p[0]-m[0])/(2*h),y:(p[1]-m[1])/(2*h)});
    }
    near(columns[0].y,trial.normal,1e-7);near(-columns[1].x,trial.tangent,1e-7);
    near(columns[1].y,trial.cross,1e-7);near(-columns[0].x,trial.cross,1e-7);
    assert.equal(rig.reactImpulse({body:'frontFoot',point,impulse}),true);
    assert.deepEqual(rig.velocity,trial.velocity,'application uses the exact same initial velocity/gaps/total impulse');
    const actual=reference.pointVelocity(rig.velocity);near(actual[0],trial.pointVelocityAfter.x);near(actual[1],trial.pointVelocityAfter.y);
    rig.velocity.set(before.velocity);rig.contacts=structuredClone(before.contacts);rig.lastImpulse=before.lastImpulse;rig.lastReaction=before.lastReaction.slice();
  }
  assert.ok(released>0&&compressed>0,'signed corpus must load and unload real supports');
});

test('Trial outputs own their arrays, and initial velocity/anchor bias are shared with apply',()=>{
  const rig=new ArticulatedRig({gravity:0});rig.velocity[1]=-.03;rig.contacts[0].x+=.00001;
  const point=rig.pose().feet.front.center,options={body:'frontFoot',point,normal:{x:.6,y:.8},impulse:{x:.001,y:-.004}},before=snapshot(rig);
  const trial=rig.trialContactImpulse(options),expected=structuredClone(trial);
  trial.velocity.fill(999);trial.deltaVelocity.fill(999);trial.constraints[0].row.fill(999);trial.groundImpulses.footF=999;
  assert.deepEqual(snapshot(rig),before);assert.deepEqual(rig.trialContactImpulse(options),expected);
  rig.reactImpulse(options);assert.deepEqual(rig.velocity,expected.velocity);
});

test('Aerial trial has no ground support and a signed ankle stop releases its opposite direction',()=>{
  for(const dir of [-1,1]){
    const rig=new ArticulatedRig({dir,gravity:0});rig.q[1]=1.85;rig.q[14]=rig.limits[14][1];
    assert.ok(rig.diagnostics().minimumGroundY>TABLE_TOP+.2);
    const pose=rig.pose(),point=pose.feet.front.toe,a=pose.ankleF,impulse={x:-dir*(point.y-a.y)*.1,y:dir*(point.x-a.x)*.1};
    const blocked=rig.trialContactImpulse({body:'frontFoot',point,impulse}),free=rig.trialContactImpulse({body:'frontFoot',point,impulse:{x:-impulse.x,y:-impulse.y}});
    assert.ok(blocked.velocity[14]<=1e-7);assert.ok(free.velocity[14]<-1e-3);assert.ok(blocked.activeSet.length>free.activeSet.length);
    for(const trial of [blocked,free]){assert.deepEqual(trial.groundImpulses,{footF:0,footB:0});assert.equal(trial.footRows.length,0);}
  }
});
