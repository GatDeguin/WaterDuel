import assert from 'node:assert/strict';

// Independent numerical oracle: no solver source, rotation-index tables, mass
// factorization, or analytical Jacobians are imported. Differentiate the public
// body positions/orientations, then assemble kinetic energy's quadratic form.
const H=2e-6;
const angleDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const close=(actual,expected,label)=>assert.ok(Number.isFinite(actual)&&Number.isFinite(expected)&&
  Math.abs(actual-expected)<=3e-8+3e-7*Math.abs(expected),`${label}: ${actual} != ${expected}`);
function sample(rig){
  const diagnostic=rig.diagnostics(),pose=rig.pose();
  return {diagnostic,bodies:new Map(diagnostic.bodies.map(body=>[body.name,{
    ...body,angle:pose.bodyFrames[body.name==='water'?'neck':body.name].angle
  }]))};
}

// Change the public query history without changing any simulation state. The
// last cached pose is intentionally not the current configuration afterwards.
export function evictKinematicCache(rig){
  const original=rig.q[0];
  try{rig.q[0]=original+.03125;rig.pose();}finally{rig.q[0]=original;}
}

// Generalized weight at a requested configuration is the gradient of potential
// energy. This uses only positions and a centered difference, never Jy or the
// runtime's feedforward calculations. The nominal water COM is 8 cm down the
// neck's public axis, independently of the actual sloshing COM.
export function numericalGoalWeight(rig){
  const saved=rig.q.slice(),result={dry:[],nominalWater:[]};
  const potential=()=>{
    const pose=rig.pose(),body=rig.diagnostics().bodies;
    return {dry:body.filter(b=>b.name!=='water').reduce((sum,b)=>sum+b.mass*b.center.y,0),
      nominalWater:rig.waterLoad.mass*(pose.head.y-.08*rig.scale*Math.sin(pose.bodyFrames.neck.angle))};
  };
  try{
    rig.q.set(rig.target);const goal=rig.q.slice();
    for(let i=0;i<goal.length;i++){
      rig.q[i]=goal[i]+H;const plus=potential();rig.q[i]=goal[i]-H;const minus=potential();rig.q[i]=goal[i];
      for(const key of Object.keys(result))result[key].push(rig.gravity*(plus[key]-minus[key])/(2*H));
    }
  }finally{rig.q.set(saved);}
  return result;
}

export function assertNumericalRig(rig,label='N16'){
  const q=rig.q.slice(),velocity=rig.velocity.slice(),n=q.length;
  assert.equal(n,16,`${label}/coordinates`);
  assert.equal(velocity.length,n,`${label}/velocity dimension`);
  const base=sample(rig),pairs=[];
  try{
    for(let i=0;i<n;i++){
      rig.q[i]=q[i]+H;const plus=sample(rig);
      rig.q[i]=q[i]-H;const minus=sample(rig);
      rig.q[i]=q[i];pairs.push({plus,minus});
    }
    const numerical=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1e-6:0));
    for(const body of base.bodies.values()){
      assert.ok(body.mass>0&&body.inertia>0,`${label}/${body.name}/positive body parameters`);
      const gradients=pairs.map(({plus,minus})=>{
        const a=plus.bodies.get(body.name),b=minus.bodies.get(body.name);
        assert.ok(a&&b,`${label}/${body.name}/stable topology under perturbation`);
        return {x:(a.center.x-b.center.x)/(2*H),y:(a.center.y-b.center.y)/(2*H),a:angleDifference(a.angle,b.angle)/(2*H)};
      });
      for(let i=0;i<n;i++)for(let j=0;j<n;j++)numerical[i][j]+=body.mass*(gradients[i].x*gradients[j].x+gradients[i].y*gradients[j].y)+body.inertia*gradients[i].a*gradients[j].a;

      // Track a material point using finite rotations about each perturbed COM.
      // Every basis velocity is checked, including both new ankle coordinates.
      for(const offset of [{x:0,y:0},{x:.037,y:-.023}]){
        const point={x:body.center.x+offset.x,y:body.center.y+offset.y};
        for(let i=0;i<n;i++){
          const located=s=>{const b=s.bodies.get(body.name),a=angleDifference(b.angle,body.angle);
            return {x:b.center.x+offset.x*Math.cos(a)-offset.y*Math.sin(a),y:b.center.y+offset.x*Math.sin(a)+offset.y*Math.cos(a)};};
          const a=located(pairs[i].plus),b=located(pairs[i].minus);
          rig.velocity.fill(0);rig.velocity[i]=1;
          const actual=rig.pointVelocity({body:body.name,point});
          assert.ok(actual,`${label}/${body.name}/point velocity exists`);
          close(actual.x,(a.x-b.x)/(2*H),`${label}/${body.name}/Jx[${i}]`);
          close(actual.y,(a.y-b.y)/(2*H),`${label}/${body.name}/Jy[${i}]`);
        }
      }
    }
    const actual=base.diagnostic.massMatrix;
    assert.equal(actual.length,n,`${label}/mass matrix rows`);
    const L=Array.from({length:n},()=>Array(n).fill(0));
    for(let i=0;i<n;i++){
      assert.equal(actual[i].length,n,`${label}/mass matrix columns`);
      for(let j=0;j<n;j++){
        close(actual[i][j],numerical[i][j],`${label}/M[${i},${j}]`);
        assert.equal(actual[i][j],actual[j][i],`${label}/matrix symmetry`);
      }
      // Strict Cholesky: no pivot floor can conceal a nonpositive eigenvalue.
      for(let j=0;j<=i;j++){
        let pivot=actual[i][j];for(let k=0;k<j;k++)pivot-=L[i][k]*L[j][k];
        if(i===j){assert.ok(pivot>0&&Number.isFinite(pivot),`${label}/SPD pivot ${i}`);L[i][j]=Math.sqrt(pivot);}
        else L[i][j]=pivot/L[j][j];
      }
    }
  }finally{rig.q.set(q);rig.velocity.set(velocity);}
  assert.deepEqual(rig.q,q,`${label}/numerical probe restores coordinates including signed zero`);
  assert.deepEqual(rig.velocity,velocity,`${label}/numerical probe restores velocity`);
}

export function assertFiniteRig(rig,label){
  for(const key of ['q','velocity','target','lastMotor','lastGravity']){
    assert.equal(rig[key].length,16,`${label}/${key}/dimension`);
    assert.ok(Array.from(rig[key]).every(Number.isFinite),`${label}/${key}/finite`);
  }
  assert.equal(rig.lastMotor[0],0,`${label}/no root X actuator`);
  assert.equal(rig.lastMotor[1],0,`${label}/no root Y actuator`);
  if(rig.passive)assert.ok(Array.from(rig.lastMotor).every(v=>v===0),`${label}/passive motors`);
  for(const contact of rig.diagnostics().contacts)assert.ok(Number.isFinite(contact.groundReaction)&&contact.groundReaction>=0,`${label}/unilateral support reaction`);
}

// Axis-aligned ellipsoid cross-section of the two balloon radii, evaluated
// only from public positions. It is not a copy of the coupled-contact solver.
export function headPenetration(a,b,radiiA,radiiB){
  const gapY=(b.y-a.y)/(radiiA.y+radiiB.y),gapZ=((b.z??0)-(a.z??0))/(radiiA.z+radiiB.z);
  const crossSection=1-gapY*gapY-gapZ*gapZ;
  return crossSection<=0?0:Math.max(0,Math.sqrt(crossSection)*(radiiA.x+radiiB.x)-Math.abs(b.x-a.x));
}
