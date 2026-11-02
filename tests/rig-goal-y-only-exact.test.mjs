import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {DuelEngine,STEP} from '../public/engine.js';
import {applyAxeFacingReference} from './fixtures/axe-facing-reference-layer.mjs';
import {assertNumericalRig,assertFiniteRig,evictKinematicCache,numericalGoalWeight} from './fixtures/rig-v4-numerical-reference.mjs';

// N14 remains immutable provenance, not a physically invalid N16 trajectory
// oracle. N16 derivatives are checked numerically, independently of the solver.
const frozen=await fs.readFile(new URL('./fixtures/articulated-rig-pre-goal-y-only-1.7.4.js.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(frozen).digest('hex'),'11fd0cc7fb655b404b4e911f8adea509ef9d37a742c169f13dcd9eb496398d60');
const source=applyAxeFacingReference(frozen,'goal').replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_match,prefix,quote,specifier)=>prefix+quote+new URL(specifier,new URL('../public/physics/articulated-rig.js',import.meta.url)).href+quote);
const {ArticulatedRig:Baseline}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function fixture(weapon='sword',dir=1,scale=1){
  const game=new DuelEngine();game.setMode('versus');game.setLoadout(1,{weapon,defense:'knife'});
  const fighter=game.fighters[0];fighter.dir=dir;fighter.baseX=-dir*1.53;fighter.boss=scale>1;game.initializeRig(fighter);
  const original=fighter.rig,rig=new ArticulatedRig({dir,scale,baseX:fighter.baseX,pose:game.buildPose(fighter),flexibleWeapons:true,apronVariant:scale>1?'boss':'normal'});
  for(const[key,value]of Object.entries(original))if(!['apron','fragments'].includes(key))rig[key]=structuredClone(value);
  Object.assign(rig.apron,structuredClone(original.apron));
  if(rig.weaponFlex&&original.weaponFlex)Object.assign(rig.weaponFlex,original.weaponFlex);
  return rig;
}
const snapshot=rig=>({q:rig.q,velocity:rig.velocity,target:rig.target,water:rig.waterLoad,
  pose:rig.pose(),diagnostics:rig.diagnostics(),joints:rig.jointDamage,
  fragments:rig.fragments.map(fragment=>fragment.snapshot()),flex:rig.weaponFlex?{...rig.weaponFlex}:null});
// Both arguments use the current N16 runtime. This proves cache invariance,
// not historical N14 equivalence; assertNumericalRig supplies a separate oracle.
function assertCacheInvariant(before,current,label){
  assert.deepEqual(snapshot(current),snapshot(before),label);
  for(const key of['q','velocity','lastMotor','lastGravity']){
    assert.deepEqual(Buffer.from(current[key].buffer,current[key].byteOffset,current[key].byteLength),Buffer.from(before[key].buffer,before[key].byteOffset,before[key].byteLength),`${label}/${key}/Float64 bits`);
  }
  const a=before.diagnostics().massMatrix,b=current.diagnostics().massMatrix;
  for(let i=0;i<a.length;i++)assert.deepEqual(Buffer.from(Float64Array.from(b[i]).buffer),Buffer.from(Float64Array.from(a[i]).buffer),`${label}/mass matrix row ${i}`);
}

test('El fixture histórico conserva N14 y el rig V4 incorpora dos coordenadas de tobillo',()=>{
  assert.equal(new Baseline().q.length,14);
  const rig=fixture();assert.equal(rig.q.length,16);
  assert.deepEqual(rig.diagnostics().coordinates.slice(14).map(c=>c.name),['frontAnkle','backAnkle']);
  assertNumericalRig(rig,'initial N16');
});

test('El soporte Y-only N16 coincide con el gradiente numérico del peso al objetivo, incluso tras desprendimiento',()=>{
  for(const weapon of ['sword','spear','axe','maul'])for(const dir of [-1,1])for(const scale of [1,1.18])for(const detached of [false,true]){
    const loaded=fixture(weapon,dir,scale),zeroGravity=fixture(weapon,dir,scale);
    for(const rig of [loaded,zeroGravity]){
      rig.velocity.fill(0);rig.neckLateral.angle=0;rig.neckLateral.target=0;rig.neckLateral.velocity=0;
      // Isolate goal feedforward from the separate hip-to-foot weight actuator:
      // both soles start airborne; the engine's normal grounded runs stay above.
      rig.q[1]+=1;rig.target[1]+=1;
      rig.waterLoad={mass:1.4,offset:{x:.07,y:-.03},inertia:.06,lateralInertia:0,lateralOffset:0};
      rig.target[4]+=.11;rig.target[13]-=.07;rig.target[14]+=.06;rig.target[15]-=.04;
      if(detached)rig.damageJoint('offShoulder',1);
    }
    zeroGravity.gravity=0;
    const weight=numericalGoalWeight(loaded);
    loaded.step(STEP);zeroGravity.step(STEP);
    for(let i=0;i<16;i++){
      let expected=0;
      if([4,5,6,7,13].includes(i))expected=-weight.dry[i];
      if([2,3,12].includes(i))expected=-.85*weight.dry[i]-.65*weight.nominalWater[i];
      if(loaded.detachedCoordinates.has(i))expected=0;
      const actual=loaded.lastMotor[i]-zeroGravity.lastMotor[i];
      assert.ok(Math.abs(actual-expected)<=3e-7+3e-7*Math.abs(expected),`${weapon}/${dir}/${scale}/${detached}/motor gravity contribution ${i}: ${actual} != ${expected}`);
    }
  }
});

test('Invariancia de caché N16 con flexión, agua, daño y desprendimiento; matriz/J verificadas por oráculo numérico',()=>{
  for(const weapon of['sword','spear','axe','maul'])for(const dir of[-1,1])for(const scale of[1,1.18]){
    const before=fixture(weapon,dir,scale),current=fixture(weapon,dir,scale),base=before.target.slice();
    for(let tick=0;tick<32;tick++){
      for(const rig of[before,current]){
        rig.target[4]=base[4]+.08*Math.sin(tick*.11);rig.target[13]=base[13]+.04*Math.cos(tick*.08);
        rig.target[14]=base[14]+.025*Math.sin(tick*.13);rig.target[15]=base[15]-.025*Math.cos(tick*.13);
        if(tick===5&&rig.weaponFlex?.maximum){rig.weaponFlex.offset=.012*dir;rig.weaponFlex.previousOffset=-.008*dir;rig.weaponFlex.velocity=.05;}
        if(tick===8)rig.damageJoint('mainElbow',.35);
        if(tick===12){rig.waterLoad.mass*=.7;rig.waterLoad.offset.x+=.013;rig.waterLoad.inertia*=.9;}
        if(tick===20)rig.damageJoint('offShoulder',1);
        if(tick===26)rig.collapse();
        if(rig===before)evictKinematicCache(rig);else{rig.pose();rig.diagnostics();}
        rig.step(STEP);
      }
      assertCacheInvariant(before,current,`${weapon}/${dir}/${scale}/${tick}`);
      assertFiniteRig(current,`${weapon}/${dir}/${scale}/${tick}`);
      if([0,5,12,20,26,31].includes(tick))assertNumericalRig(current,`${weapon}/${dir}/${scale}/${tick}`);
      if(tick%8===0)for(const t of[0,.13,.5,1]){
        assert.deepEqual(current.collisionPanelsAt(t),before.collisionPanelsAt(t));
        assert.deepEqual(current.collisionSolidsAt(t),before.collisionSolidsAt(t));
      }
    }
    assert.equal(current.jointDamage.mainElbow.damage,.35);
    assert.equal(current.jointDamage.offShoulder.detached,true);
    assert.ok(current.fragments.length>0);
    assert.equal(current.passive,true);
  }
});

test('Invariancia de caché N16 para target alias de q/Array, ceros con signo y snapshots propios',()=>{
  for(const warmed of[false,true])for(const alias of['q','array']){
    const before=fixture(),current=fixture();
    for(const rig of[before,current]){
      if(warmed){rig.pose();rig.diagnostics();}
      rig.target=alias==='q'?rig.q:Array.from(rig.target);
      rig.q[2]=-0;rig.target[12]=-0;rig.waterLoad.offset.x=-0;
      rig.q[14]=-0;rig.target[15]=-0;
      assert.ok(Object.is(rig.q[2],-0)&&Object.is(rig.q[14],-0)&&Object.is(rig.target[12],-0)&&Object.is(rig.target[15],-0)&&Object.is(rig.waterLoad.offset.x,-0));
    }
    const held=current.pose(),heldCopy=structuredClone(held);
    for(let tick=0;tick<12;tick++){
      evictKinematicCache(before);
      before.step(STEP);current.step(STEP);assertCacheInvariant(before,current,`${warmed}/${alias}/${tick}`);
      assert.deepEqual(current.collisionPanels(),before.collisionPanels());
      if(alias==='q')assert.equal(current.target,current.q,'target keeps its q alias');
      else assert.ok(Array.isArray(current.target),'Array target is preserved');
      assert.ok(Object.is(current.waterLoad.offset.x,-0),'query/step preserves signed-zero water offset');
      assertFiniteRig(current,`${warmed}/${alias}/${tick}`);
      if(tick===11)assertNumericalRig(current,`${warmed}/${alias}`);
    }
    assert.deepEqual(held,heldCopy,'retained pose is owned by caller');
  }
});

test('Cambiar cargas y objetivos no vuelve parciales los snapshots públicos ni comparte sus datos',()=>{
  const before=fixture('maul',-1,1.18),current=fixture('maul',-1,1.18);
  const mutations=[rig=>{rig.target[4]+=.12;},rig=>{rig.waterLoad.mass=0;},rig=>{rig.waterLoad.mass=1.8;rig.waterLoad.offset.x+=.03;},
    rig=>{rig.waterLoad.offset.y-=.02;rig.waterLoad.inertia+=.03;},rig=>{rig.massScale*=1.03;rig.neckLateral.angle=.12;}];
  const oldPose=current.pose(),oldPoseCopy=structuredClone(oldPose),oldMatrix=current.diagnostics().massMatrix,oldMatrixCopy=structuredClone(oldMatrix);
  for(const mutate of mutations){
    mutate(before);mutate(current);evictKinematicCache(before);before.step(STEP);current.step(STEP);assertCacheInvariant(before,current,'mutable goal input');
    assertNumericalRig(current,'mutable goal input');assertFiniteRig(current,'mutable goal input');
    const exposed=current.pose();exposed.bodyFrames.mainForearm.origin.x=999;exposed.bodyFrames.weapon.angle=NaN;
    exposed.bodyFrames.frontFoot.center.x=999;exposed.bodyFrames.backFoot.angle=NaN;
    assert.deepEqual(current.pose(),before.pose());
    const exposedDiagnostic=current.diagnostics();exposedDiagnostic.massMatrix[14][15]=NaN;exposedDiagnostic.bodies[0].center.x=999;
    assert.deepEqual(current.diagnostics(),before.diagnostics(),'diagnostic matrices and COMs are caller owned');
  }
  assert.deepEqual(oldPose,oldPoseCopy);assert.deepEqual(oldMatrix,oldMatrixCopy);
});
