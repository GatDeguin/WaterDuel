import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {assertNumericalRig} from './fixtures/rig-v4-numerical-reference.mjs';

// Independent dynamics oracle. Only public body COMs, inertias and orientations
// are sampled; no production mass matrix, analytic J, factor or contact solver
// supplies an expected response. The 1e-6 diagonal is the documented numerical
// inertia already checked by rig-v4-numerical-reference, not a physical body.
const H=2e-6,NUMERICAL_INERTIA=1e-6;
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const add=(a,b)=>a.map((value,i)=>value+b[i]);
const scale=(a,value)=>a.map(x=>x*value);
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const near=(actual,expected,label,absolute=3e-8,relative=3e-6)=>assert.ok(
  Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=absolute+relative*Math.abs(expected),
  `${label}: ${actual} != ${expected}`
);
const vectorNear=(actual,expected,label)=>{
  assert.equal(actual.length,expected.length,label+'/dimension');
  for(let i=0;i<expected.length;i++)near(actual[i],expected[i],`${label}[${i}]`);
};

// Partial-pivot Gaussian elimination is intentionally different from the
// production Cholesky and Schur-complement implementations.
function solveGaussian(matrix,rhs){
  const n=rhs.length,a=matrix.map((row,i)=>[...row,rhs[i]]);
  for(let column=0;column<n;column++){
    let pivot=column;
    for(let row=column+1;row<n;row++)if(Math.abs(a[row][column])>Math.abs(a[pivot][column]))pivot=row;
    assert.ok(Number.isFinite(a[pivot][column])&&Math.abs(a[pivot][column])>1e-12,'independent system must be nonsingular');
    [a[column],a[pivot]]=[a[pivot],a[column]];
    for(let row=column+1;row<n;row++){
      const factor=a[row][column]/a[column][column];
      for(let j=column;j<=n;j++)a[row][j]-=factor*a[column][j];
    }
  }
  const solution=Array(n).fill(0);
  for(let row=n-1;row>=0;row--){
    let value=a[row][n];for(let j=row+1;j<n;j++)value-=a[row][j]*solution[j];
    solution[row]=value/a[row][row];
  }
  return solution;
}

function sample(rig){
  const pose=rig.pose(),bodies=rig.diagnostics().bodies;
  return new Map(bodies.map(body=>[body.name,{...body,angle:pose.bodyFrames[body.name==='water'?'neck':body.name].angle}]));
}
function numericalDynamics(rig,bodyName,point){
  const original=rig.q.slice(),base=sample(rig),target=base.get(bodyName),pairs=[],n=original.length;
  assert.ok(target,'impacted body is attached');
  const offset={x:point.x-target.center.x,y:point.y-target.center.y};
  const materialPoint=bodies=>{
    const current=bodies.get(bodyName),angle=current.angle-target.angle,c=Math.cos(angle),s=Math.sin(angle);
    return {x:current.center.x+c*offset.x-s*offset.y,y:current.center.y+s*offset.x+c*offset.y};
  };
  try{
    for(let i=0;i<n;i++){
      rig.q[i]=original[i]+H;const plus=sample(rig);
      rig.q[i]=original[i]-H;const minus=sample(rig);rig.q[i]=original[i];
      assert.deepEqual([...plus.keys()],[...base.keys()],'positive probe retains topology');
      assert.deepEqual([...minus.keys()],[...base.keys()],'negative probe retains topology');
      pairs.push({plus,minus});
    }
  }finally{rig.q.set(original);}
  const bodies=[...base.values()].map(body=>({...body,gradient:pairs.map(({plus,minus})=>{
    const a=plus.get(body.name),b=minus.get(body.name),angle=Math.atan2(Math.sin(a.angle-b.angle),Math.cos(a.angle-b.angle));
    return {x:(a.center.x-b.center.x)/(2*H),y:(a.center.y-b.center.y)/(2*H),angle:angle/(2*H)};
  })}));
  const matrix=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?NUMERICAL_INERTIA:0));
  for(const body of bodies)for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    const a=body.gradient[i],b=body.gradient[j];
    matrix[i][j]+=body.mass*(a.x*b.x+a.y*b.y)+body.inertia*a.angle*b.angle;
  }
  const jacobian={x:[],y:[]};
  for(const {plus,minus} of pairs){
    const a=materialPoint(plus),b=materialPoint(minus);
    jacobian.x.push((a.x-b.x)/(2*H));jacobian.y.push((a.y-b.y)/(2*H));
  }
  return {matrix,jacobian,bodies};
}
const generalizedImpulse=(jacobian,impulse)=>jacobian.x.map((value,i)=>value*impulse.x+jacobian.y[i]*impulse.y);
const kinetic=(matrix,velocity)=>.5*velocity.reduce((sum,value,i)=>sum+value*dot(matrix[i],velocity),0);
function momentum(bodies,velocity){
  return bodies.reduce((sum,body)=>{
    const vx=dot(body.gradient.map(g=>g.x),velocity),vy=dot(body.gradient.map(g=>g.y),velocity),omega=dot(body.gradient.map(g=>g.angle),velocity);
    sum.x+=body.mass*vx;sum.y+=body.mass*vy;sum.angular+=body.mass*(body.center.x*vy-body.center.y*vx)+body.inertia*omega;
    return sum;
  },{x:0,y:0,angular:0});
}
function airborne(dir,scaleValue,detached=false){
  const rig=new ArticulatedRig({dir,scale:scaleValue,gravity:0});rig.q[1]=1.8;
  for(const contact of rig.contacts)contact.stance=false;
  rig.waterLoad={mass:.9*scaleValue**3,offset:{x:.04,y:-.06},inertia:.055*scaleValue**5,lateralInertia:0,lateralOffset:0};
  if(detached)assert.equal(rig.damageJoint('offShoulder',1).detached,true);
  rig.previousQ=rig.q.slice();rig.velocity.fill(0);
  assert.ok(rig.diagnostics().minimumGroundY>TABLE_TOP+.1,'unconstrained impulse fixture must be entirely airborne');
  assert.ok(rig.diagnostics().coordinates.every(c=>c.position>c.min+.001&&c.position<c.max-.001),'fixture is away from joint stops');
  return rig;
}

test('N16 preserves every historical coordinate index and appends only the two ankles',()=>{
  const names=['baseX','baseY','pelvis','torso','mainShoulder','mainElbow','offShoulder','offElbow','frontHip','frontKnee','backHip','backKnee','neck','wrist','frontAnkle','backAnkle'];
  for(const dir of [-1,1]){
    const rig=new ArticulatedRig({dir});
    assert.deepEqual(rig.diagnostics().coordinates.map(c=>c.name),names);
    assert.equal(rig.q.length,names.length);assert.equal(rig.velocity.length,names.length);assert.equal(rig.target.length,names.length);
  }
});

test('N16 airborne impulses match an independent finite-difference M^-1 J^T p in both directions, sizes and attached topologies',()=>{
  for(const dir of [-1,1])for(const size of [1,1.18])for(const detached of [false,true])for(const body of ['weapon','frontFoot','backFoot']){
    const rig=airborne(dir,size,detached),b=rig.diagnostics().bodies.find(b=>b.name===body),point={x:b.center.x+dir*.027,y:b.center.y+.019};
    const oracle=numericalDynamics(rig,body,point),impulse={x:dir*.002,y:.003},generalized=generalizedImpulse(oracle.jacobian,impulse);
    const expected=solveGaussian(oracle.matrix,generalized),normal={x:impulse.x/Math.hypot(impulse.x,impulse.y),y:impulse.y/Math.hypot(impulse.x,impulse.y)};
    const normalRow=generalizedImpulse(oracle.jacobian,normal),inverseMass=dot(normalRow,solveGaussian(oracle.matrix,normalRow));
    near(rig.effectiveInverseMass({body,point,normal}),inverseMass,`${dir}/${size}/${detached}/${body}/effective inverse mass`);
    assert.equal(rig.reactImpulse({body,point,impulse}),true);
    vectorNear([...rig.velocity],expected,`${dir}/${size}/${detached}/${body}/delta v`);
    const energy=kinetic(oracle.matrix,[...rig.velocity]);
    near(energy,.5*dot(generalized,expected),`${body}/impulse work`);
    near(rig.diagnostics().kineticEnergy,energy,`${body}/reported kinetic energy`);
    const actual=momentum(oracle.bodies,[...rig.velocity]);
    near(actual.x+NUMERICAL_INERTIA*rig.velocity[0],impulse.x,`${body}/linear momentum X`);
    near(actual.y+NUMERICAL_INERTIA*rig.velocity[1],impulse.y,`${body}/linear momentum Y`);
    const virtualAngular=NUMERICAL_INERTIA*(-rig.q[1]*rig.velocity[0]+rig.q[0]*rig.velocity[1]+dir*rig.velocity[2]);
    near(actual.angular+virtualAngular,cross(point,impulse),`${body}/angular momentum about world origin`);
    if(detached){assert.ok(!oracle.bodies.some(b=>b.name==='offForearm'));assert.equal(rig.fragments.length,1);}
  }
});

function singleSoleContact(dir){
  const rig=new ArticulatedRig({dir,gravity:0});
  rig.q[11]=-1.6;rig.q[14]=.27-(rig.q[2]+rig.q[8]+rig.q[9]+Math.PI/2);
  for(const contact of rig.contacts)contact.stance=false;
  rig.q[1]+=TABLE_TOP-rig.pose().feet.front.support.y;rig.previousQ=rig.q.slice();rig.velocity.fill(0);
  const pose=rig.pose();
  near(pose.feet.front.support.y,TABLE_TOP,'sole fixture touches floor',1e-12,0);
  assert.ok(pose.feet.back.support.y>TABLE_TOP+.1,'the back foot must not participate');
  assert.ok(rig.diagnostics().minimumGroundY>=TABLE_TOP-1e-10,'all geometry starts above the floor');
  const lows=pose.feet.front.hull.filter(v=>v.y<=TABLE_TOP+1e-7);
  assert.equal(lows.length,1,'one scalar normal, not a flat multi-vertex support');
  return rig;
}

test('N16 single-sole contact follows an independent unilateral normal projection, dissipates impact energy and never adheres on separation',()=>{
  for(const dir of [-1,1])for(const sign of [-1,1]){
    const rig=singleSoleContact(dir),point={...rig.pose().feet.front.support};
    const oracle=numericalDynamics(rig,'frontFoot',point),impulse={x:dir*.0002*sign,y:-.001*sign};
    const free=solveGaussian(oracle.matrix,generalizedImpulse(oracle.jacobian,impulse)),row=oracle.jacobian.y;
    const response=solveGaussian(oracle.matrix,row),normalInverseMass=dot(row,response),normalSpeed=dot(row,free);
    assert.equal(Math.sign(normalSpeed),-sign,'fixture distinguishes approaching from separating contact');
    const lambda=Math.max(0,-normalSpeed/normalInverseMass),expected=add(free,scale(response,lambda));
    assert.equal(rig.reactImpulse({body:'frontFoot',point,impulse}),true);
    vectorNear([...rig.velocity],expected,`${dir}/${sign}/unilateral velocity`);
    const after=kinetic(oracle.matrix,[...rig.velocity]),before=kinetic(oracle.matrix,free);
    assert.ok(after<=before+1e-10,'the normal projection may not invent kinetic energy');
    near(after,before-.5*lambda*lambda*normalInverseMass,`${dir}/${sign}/normal impulse energy`);
    if(sign>0){assert.ok(lambda>0);near(dot(row,[...rig.velocity]),0,'approaching normal is stopped');}
    else{assert.equal(lambda,0);assert.ok(dot(row,[...rig.velocity])>0,'separating sole is free');vectorNear([...rig.velocity],free,'no adhesive impulse');}
  }
});

test('N16 finite-difference dynamics restores public state and agrees with the separate numerical geometry guard',()=>{
  const rig=airborne(-1,1.18,true),q=rig.q.slice(),velocity=rig.velocity.slice(),point={...rig.pose().tip};
  numericalDynamics(rig,'weapon',point);
  assert.deepEqual(rig.q,q);assert.deepEqual(rig.velocity,velocity);
  assertNumericalRig(rig,'independent impulse corpus');
  assert.deepEqual(rig.q,q);assert.deepEqual(rig.velocity,velocity);
});
