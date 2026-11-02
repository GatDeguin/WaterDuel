import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig,REFERENCE_STANCE} from '../public/physics/articulated-rig.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {FOOT_SHAPES} from '../public/physics/foot-geometry.js';
import {readFile} from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {captureReplayState,replayView} from '../public/replay.js';
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const run=(r,seconds,dt=1/120)=>{for(let t=0;t<seconds-1e-9;t+=dt)r.step(dt);};
const transform=(m,p)=>({x:m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],y:m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],z:m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]});
const gaussian=(matrix,rhs)=>{
  const a=matrix.map((row,i)=>[...row,rhs[i]]),n=rhs.length;
  for(let i=0;i<n;i++){
    let pivot=i;for(let k=i+1;k<n;k++)if(Math.abs(a[k][i])>Math.abs(a[pivot][i]))pivot=k;[a[i],a[pivot]]=[a[pivot],a[i]];
    const scale=a[i][i];assert.ok(Math.abs(scale)>1e-12);for(let j=i;j<=n;j++)a[i][j]/=scale;
    for(let k=0;k<n;k++)if(k!==i){const scale=a[k][i];for(let j=i;j<=n;j++)a[k][j]-=scale*a[i][j];}
  }return a.map(row=>row[n]);
};
test('v4 appends physical ankle coordinates, rotates sole and preserves shin length',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const r=new ArticulatedRig({dir,scale}),before=r.pose();
    assert.equal(r.q.length,16);assert.ok(before.feet?.front?.matrix);
    r.q[14]+=.23;const p=r.pose();
    assert.ok(dist(before.feet.front.toe,p.feet.front.toe)>.02);
    assert.ok(dist(before.ankleF,p.ankleF)<1e-12);
    assert.ok(Math.abs(dist(p.kneeF,p.ankleF)-REFERENCE_STANCE.shin*scale)<1e-12);
    assert.equal(p.feet.front.matrix.length,16);
    assert.ok(r.diagnostics().bodies.some(b=>b.name==='frontFoot'&&b.mass>0&&b.inertia>0));
  }
});
test('v4 aerial foot follows motor intent and receives no ground reaction',()=>{
  const r=new ArticulatedRig({gravity:0}),p=r.pose();
  r.contacts[0].stance=false;r.contacts[0].y+=.15;
  r.step(1/120);const q=r.pose();
  assert.ok(q.feet?.front);assert.equal(q.feet.front.groundReaction,0);
  assert.ok(Math.abs(q.footF.y-r.contacts[0].y)>.001,'swing target must not be imposed as a constraint');
});
test('v4 foot ownership follows shin detachment without ankle damage class',()=>{
  const r=new ArticulatedRig();
  assert.equal(r.damageJoint('frontAnkle',1).applied,false);
  r.damageJoint('frontKnee',1);
  assert.equal(r.isBodyAttached('frontFoot'),false);
  assert.ok(r.detachedCoordinates.has(14));
  assert.ok(!r.collisionPanels().some(p=>p.body==='frontFoot'));
});
test('v4 foot matrix, convex collision, Jacobian and CCD use the same achieved hinge',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const r=new ArticulatedRig({dir,scale,gravity:0});r.previousQ=r.q.slice();r.q[14]+=.3;
    const p=r.pose(),foot=p.feet.front,shape=FOOT_SHAPES[scale>1.1?'boss':'normal'].front,panel=r.collisionPanels().find(p=>p.body==='frontFoot');
    assert.ok(Math.abs(panel.axes[0].x*panel.axes[1].x+panel.axes[0].y*panel.axes[1].y)<1e-12,'first two axes retain the orthogonal fluid/detached OBB contract');
    for(let i=0;i<shape.hull.length;i++){
      const expected=transform(foot.matrix,[...shape.hull[i],(shape.minZ+shape.maxZ)/2]);
      assert.ok(dist(expected,panel.vertices[i])<1e-12);assert.ok(dist(expected,foot.hull[i])<1e-12);
      assert.ok(Math.abs(expected.z-foot.hull[i].z)<1e-12);
    }
    assert.deepEqual(r.collisionGeometryAt(.5,'frontFoot'),r.collisionGeometryAt(.5).filter(p=>p.key==='frontFoot'));
    r.velocity[14]=.3;const velocity=r.pointVelocity({body:'frontFoot',point:foot.toe}),eps=1e-7;
    r.q[14]+=eps*.3;const next=r.pose().feet.front.toe;
    assert.ok(Math.abs((next.x-foot.toe.x)/eps-velocity.x)<1e-7);assert.ok(Math.abs((next.y-foot.toe.y)/eps-velocity.y)<1e-7);
    const before=r.pose();before.feet.front.matrix.fill(NaN);before.feet.front.hull[0].y=-999;
    assert.ok(r.pose().feet.front.matrix.every(Number.isFinite));assert.ok(r.pose().feet.front.hull[0].y>0);
  }
});
test('v4 ankle coordinates 14 and 15 sweep known convex contours and reject a separated depth layer',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const [side,suffix,index] of [['front','F',14],['back','B',15]]){
    const r=new ArticulatedRig({dir,scale,gravity:0}),start=r.pose(),shape=FOOT_SHAPES[scale>1.1?'boss':'normal'][side],ankle=start['ankle'+suffix];
    r.previousQ=r.q.slice();r.q[index]+=.3;
    const probeX=shape.halfWidth+.005,probe={x:ankle.x+dir*probeX*scale,y:ankle.y-.07*scale,z:start.feet[side].center.z};
    const inside=t=>{const a=.3*t,x=probeX*Math.cos(a)-.07*Math.sin(a),y=-probeX*Math.sin(a)-.07*Math.cos(a);
      return shape.hull.every((p,i)=>{const q=shape.hull[(i+1)%shape.hull.length];return (q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0])>=0;});};
    assert.equal(inside(0),false);assert.equal(inside(1),true);let low=0,high=1;
    for(let i=0;i<50;i++){const mid=(low+high)/2;if(inside(mid))high=mid;else low=mid;}
    const hit=r.firstTimberContact(probe,probe);assert.equal(hit?.body,side+'Foot');assert.ok(Math.abs(hit.t-high)<.001,`${hit.t} vs independently measured ${high}`);
    const separated={...probe,z:probe.z+2};assert.equal(r.firstTimberContact(separated,separated),null);
    for(const t of [0,.25,.5,.75,1]){
      const polygon=r.collisionGeometryAt(t,side+'Foot')[0],angle=.3*t;
      for(let i=0;i<shape.hull.length;i++){const [x,y]=shape.hull[i];assert.ok(dist(polygon.vertices[i],{x:ankle.x+dir*scale*(x*Math.cos(angle)-y*Math.sin(angle)),y:ankle.y+scale*(x*Math.sin(angle)+y*Math.cos(angle))})<1e-12);}
    }
  }
});
test('v4 replay owns both foot frames and geometry; historical poses without feet remain historical',()=>{
  const r=new ArticulatedRig(),game={scores:[0,0],fighters:[{dir:1,boss:false,pose:r.pose(),equipment:r.equipment,fluid:{particles:[]}}]};
  const frame=captureReplayState(game),expected=structuredClone(frame.fighters[0].pose.feet),view=replayView(frame);
  game.fighters[0].pose.feet.front.matrix.fill(999);game.fighters[0].pose.feet.back.toe.x=999;
  view.fighters[0].pose.feet.front.hull[0].y=999;view.fighters[0].pose.feet.back.matrix.fill(999);
  assert.deepEqual(frame.fighters[0].pose.feet,expected);assert.deepEqual(replayView(frame).fighters[0].pose.feet,expected);
  const legacy=structuredClone(frame);delete legacy.fighters[0].pose.feet;delete legacy.fighters[0].pose.ankleF;delete legacy.fighters[0].pose.ankleB;
  const oldView=replayView(legacy);assert.equal(oldView.fighters[0].pose.feet,undefined);assert.deepEqual(oldView.fighters[0].pose.footF,legacy.fighters[0].pose.footF);assert.deepEqual(game.scores,[0,0]);
});
test('v4 delivered normal and boss foot meshes share the exact physical sole during roll in both directions',async()=>{
  for(const boss of [false,true]){
    const raw=await readFile(new URL(`../public/assets/characters/water-mannequin/v4/water-mannequin${boss?'-boss':''}.glb`,import.meta.url)),c=prepareCharacter(parseGLB(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)));
    for(const dir of [-1,1]){
      const r=new ArticulatedRig({dir,scale:boss?1.18:1});r.q[14]+=.3;r.q[15]-=.2;
      const pose=r.pose(),matrices=characterTransforms(c,{pose,dir,boss,equipment:r.equipment});
      for(const [suffix,side] of [['R','front'],['L','back']]){
        let min=Infinity;for(let i=0;i<c.parts.length;i++)if(c.parts[i].boneName==='foot.'+suffix){const p=c.parts[i];for(let k=0;k<p.positions.length;k+=3)min=Math.min(min,transform(matrices[i],p.positions.subarray(k,k+3)).y);}
        assert.ok(Math.abs(min-pose.feet[side].support.y)<2e-5,`${boss}/${dir}/${side}: visible ${min}, physical ${pose.feet[side].support.y}`);
      }
    }
  }
});
test('v4 no free-base motor or unilateral ground reaction can support an airborne body',()=>{
  const r=new ArticulatedRig({gravity:0});r.q[1]+=.4;
  for(const c of r.contacts){c.stance=false;c.y+=.4;}
  r.step(1/120);const d=r.diagnostics();
  assert.equal(d.motorTorque[0],0);assert.equal(d.motorTorque[1],0);
  for(const foot of Object.values(r.pose().feet)){assert.equal(foot.stance,false);assert.equal(foot.groundReaction,0);assert.ok(foot.support.y>TABLE_TOP+.2);}
});
test('v4 N16 foot impulse and energy agree with a finite-difference material Jacobian and independent Gaussian solve',()=>{
  for(const dir of [-1,1]){
    const r=new ArticulatedRig({dir,gravity:0});r.q[1]+=.4;r.contacts=[];
    const q=r.q.slice(),point=r.pose().feet.back.toe,impulse={x:dir*.003,y:.005},eps=1e-6,j=[];
    for(let i=0;i<16;i++){
      r.q[i]=q[i]+eps;const plus=r.pose().feet.back.toe;r.q[i]=q[i]-eps;const minus=r.pose().feet.back.toe;r.q[i]=q[i];
      j.push(((plus.x-minus.x)*impulse.x+(plus.y-minus.y)*impulse.y)/(2*eps));
    }
    const expected=gaussian(r.diagnostics().massMatrix,j),energy=.5*expected.reduce((sum,v,i)=>sum+v*j[i],0);
    r.reactImpulse({body:'backFoot',point,impulse});
    for(let i=0;i<16;i++)assert.ok(Math.abs(r.velocity[i]-expected[i])<1e-7,`coordinate ${i}`);
    assert.ok(Math.abs(r.diagnostics().kineticEnergy-energy)<1e-10);
  }
});
test('v4 transfers COM toward the remaining support before releasing a foot',()=>{
  const r=new ArticulatedRig(),p=r.pose(),intent=structuredClone(p),com=()=>{const b=r.diagnostics().bodies;return b.reduce((sum,b)=>sum+b.mass*b.center.x,0)/b.reduce((sum,b)=>sum+b.mass,0);};
  const initial=com();for(const v of Object.values(intent))if(v&&typeof v.x==='number')v.x+=.3;
  r.setIntent(intent,{baseX:.3,baseVX:.2});run(r,.1);
  assert.ok(r.contacts.every(c=>c.stance));assert.ok(com()<initial-.001,'transfer must precede release toward the back support');
  run(r,.1);assert.ok(r.contacts.some(c=>!c.stance));
});
test('v4 walking has real landing windows and airborne intervals, never a vacuous all-air support check',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const r=new ArticulatedRig({dir,scale}),intent=r.pose();for(const v of Object.values(intent))if(v&&typeof v.x==='number')v.x+=dir*.3;
    r.setIntent(intent,{baseX:dir*.3,baseVX:dir*.2});let supported=0,air=0,landings=0,wasAir=false;
    for(let frame=0;frame<180;frame++){
      r.step(1/120);const feet=Object.values(r.pose().feet);
      const close=feet.some(f=>Math.min(...f.hull.map(p=>p.y))<=TABLE_TOP+.002&&f.groundReaction>0);
      if(close)supported++;
      const flying=feet.some(f=>Math.min(...f.hull.map(p=>p.y))>TABLE_TOP+.02);
      if(flying)air++;if(wasAir&&!flying&&close)landings++;wasAir=flying;
      assert.ok(feet.every(f=>Math.min(...f.hull.map(p=>p.y))>=TABLE_TOP-1e-6));
    }
    assert.ok(supported>120,`${dir}/${scale}: requires a real support in most frames (${supported})`);
    assert.ok(air>10&&landings>=1,`${dir}/${scale}: flight ${air}, landings ${landings}`);
  }
});
test('v4 real impulse gives bounded damped recovery, no spontaneous vibration or damage, and identical clocks',()=>{
  const idle=new ArticulatedRig({gravity:0});run(idle,.25);assert.ok(idle.diagnostics().kineticEnergy<1e-15);
  const a=new ArticulatedRig({gravity:0}),b=new ArticulatedRig({gravity:0});
  for(const r of [a,b])r.reactImpulse({body:'weapon',point:r.pose().tip,impulse:{x:.02,y:.06}});
  const initial=a.diagnostics().kineticEnergy;assert.ok(initial>0);run(a,.8,1/30);run(b,.8);
  assert.deepEqual(a.q,b.q);assert.deepEqual(a.velocity,b.velocity);
  assert.ok(a.diagnostics().kineticEnergy<initial*.05);assert.deepEqual(a.jointDamage,{});
});
test('v4 supports legal water mass in both directions and sizes, then releases only the severed leg',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const r=new ArticulatedRig({dir,scale}),p=r.pose();r.setIntent(p,{waterLoad:{mass:1.77642*scale**3,center:{x:p.head.x,y:p.head.y-.08*scale},referenceHead:p.head}});
    run(r,.5);assert.ok(r.diagnostics().minimumGroundY>=TABLE_TOP-1e-6);
    assert.ok(r.pose().head.y>p.head.y-.2*scale);assert.ok(Object.values(r.pose().feet).some(f=>f.groundReaction>0));
    r.damageJoint('frontHip',1);run(r,.5);
    assert.ok(r.q.every(Number.isFinite)&&r.velocity.every(Number.isFinite));assert.equal(r.pose().feet.front.groundReaction,0);
    assert.ok(!r.diagnostics().bodies.some(b=>b.name==='frontFoot'));assert.ok(r.diagnostics().bodies.some(b=>b.name==='backFoot'));
  }
});
