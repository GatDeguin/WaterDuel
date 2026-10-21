import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {DuelEngine,STEP} from '../public/engine.js';

// This independently frozen implementation supplies the complete Jacobians
// for the requested configuration, before the private Y-only optimization.
const frozen=await fs.readFile(new URL('./fixtures/articulated-rig-pre-goal-y-only-1.7.4.js.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(frozen).digest('hex'),'11fd0cc7fb655b404b4e911f8adea509ef9d37a742c169f13dcd9eb496398d60');
const source=frozen.replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_match,prefix,quote,specifier)=>prefix+quote+new URL(specifier,new URL('../public/physics/articulated-rig.js',import.meta.url)).href+quote);
const {ArticulatedRig:Baseline}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function fixture(Type,weapon='sword',dir=1,scale=1){
  const game=new DuelEngine();game.setMode('versus');game.setLoadout(1,{weapon,defense:'knife'});
  const fighter=game.fighters[0];fighter.dir=dir;fighter.baseX=-dir*1.53;fighter.boss=scale>1;game.initializeRig(fighter);
  const original=fighter.rig,rig=new Type({dir,scale,baseX:fighter.baseX,pose:game.buildPose(fighter),flexibleWeapons:true,apronVariant:scale>1?'boss':'normal'});
  for(const[key,value]of Object.entries(original))if(!['apron','fragments'].includes(key))rig[key]=structuredClone(value);
  Object.assign(rig.apron,structuredClone(original.apron));
  if(rig.weaponFlex&&original.weaponFlex)Object.assign(rig.weaponFlex,original.weaponFlex);
  return rig;
}
const snapshot=rig=>({q:rig.q,velocity:rig.velocity,target:rig.target,water:rig.waterLoad,
  pose:rig.pose(),diagnostics:rig.diagnostics(),joints:rig.jointDamage,
  fragments:rig.fragments.map(fragment=>fragment.snapshot()),flex:rig.weaponFlex?{...rig.weaponFlex}:null});
function exact(before,current,label){
  assert.deepEqual(snapshot(current),snapshot(before),label);
  for(const key of['q','velocity','lastMotor','lastGravity']){
    assert.deepEqual(Buffer.from(current[key].buffer,current[key].byteOffset,current[key].byteLength),Buffer.from(before[key].buffer,before[key].byteOffset,before[key].byteLength),`${label}/${key}/Float64 bits`);
  }
  const a=before.diagnostics().massMatrix,b=current.diagnostics().massMatrix;
  for(let i=0;i<a.length;i++)assert.deepEqual(Buffer.from(Float64Array.from(b[i]).buffer),Buffer.from(Float64Array.from(a[i]).buffer),`${label}/mass matrix row ${i}`);
}

test('El soporte del objetivo conserva las trayectorias y contactos exactos con flexión, agua, daño y desprendimiento',()=>{
  for(const weapon of['sword','spear','axe','maul'])for(const dir of[-1,1])for(const scale of[1,1.18]){
    const before=fixture(Baseline,weapon,dir,scale),current=fixture(ArticulatedRig,weapon,dir,scale),base=before.target.slice();
    for(let tick=0;tick<32;tick++){
      for(const rig of[before,current]){
        rig.target[4]=base[4]+.08*Math.sin(tick*.11);rig.target[13]=base[13]+.04*Math.cos(tick*.08);
        if(tick===5&&rig.weaponFlex?.maximum){rig.weaponFlex.offset=.012*dir;rig.weaponFlex.previousOffset=-.008*dir;rig.weaponFlex.velocity=.05;}
        if(tick===8)rig.damageJoint('mainElbow',.35);
        if(tick===12){rig.waterLoad.mass*=.7;rig.waterLoad.offset.x+=.013;rig.waterLoad.inertia*=.9;}
        if(tick===20)rig.damageJoint('offShoulder',1);
        if(tick===26)rig.collapse();
        rig.step(STEP);
      }
      exact(before,current,`${weapon}/${dir}/${scale}/${tick}`);
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

test('Un objetivo que aliasa q y los objetivos Array conservan el caché completo y los ceros con signo',()=>{
  for(const warmed of[false,true])for(const alias of['q','array']){
    const before=fixture(Baseline),current=fixture(ArticulatedRig);
    for(const rig of[before,current]){
      if(warmed){rig.pose();rig.diagnostics();}
      rig.target=alias==='q'?rig.q:Array.from(rig.target);
      rig.q[2]=-0;rig.target[12]=-0;rig.waterLoad.offset.x=-0;
    }
    for(let tick=0;tick<12;tick++){
      before.step(STEP);current.step(STEP);exact(before,current,`${warmed}/${alias}/${tick}`);
      assert.deepEqual(current.collisionPanels(),before.collisionPanels());
    }
  }
});

test('Cambiar cargas y objetivos no vuelve parciales los snapshots públicos ni comparte sus datos',()=>{
  const before=fixture(Baseline,'maul',-1,1.18),current=fixture(ArticulatedRig,'maul',-1,1.18);
  const mutations=[rig=>{rig.target[4]+=.12;},rig=>{rig.waterLoad.mass=0;},rig=>{rig.waterLoad.mass=1.8;rig.waterLoad.offset.x+=.03;},
    rig=>{rig.waterLoad.offset.y-=.02;rig.waterLoad.inertia+=.03;},rig=>{rig.massScale*=1.03;rig.neckLateral.angle=.12;}];
  const oldPose=current.pose(),oldPoseCopy=structuredClone(oldPose),oldMatrix=current.diagnostics().massMatrix,oldMatrixCopy=structuredClone(oldMatrix);
  for(const mutate of mutations){
    mutate(before);mutate(current);before.step(STEP);current.step(STEP);exact(before,current,'mutable goal input');
    const exposed=current.pose();exposed.bodyFrames.mainForearm.origin.x=999;exposed.bodyFrames.weapon.angle=NaN;
    assert.deepEqual(current.pose(),before.pose());
  }
  assert.deepEqual(oldPose,oldPoseCopy);assert.deepEqual(oldMatrix,oldMatrixCopy);
});
