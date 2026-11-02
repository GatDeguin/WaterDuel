import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig as Current} from '../public/physics/articulated-rig.js';
import {AXE_REFERENCE_PINS,applyAxeFacingReference} from './fixtures/axe-facing-reference-layer.mjs';
import {assertNumericalRig,assertFiniteRig,evictKinematicCache} from './fixtures/rig-v4-numerical-reference.mjs';

const frozen=await fs.readFile(new URL('../audit/articulated-rig-passive-spikes-before.js',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(frozen).digest('hex'),AXE_REFERENCE_PINS.passive);
const source=applyAxeFacingReference(frozen,'passive').replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_match,prefix,quote,specifier)=>prefix+quote+new URL(specifier,new URL('../public/physics/articulated-rig.js',import.meta.url)).href+quote);
const {ArticulatedRig:Historical}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.equal(new Historical().q.length,14,'the N14 historical oracle is preserved, never relabelled as N16');
const capture=r=>({q:r.q.slice(),velocity:r.velocity.slice(),pose:r.pose(),diagnostics:r.diagnostics(),panels:r.collisionPanels()});

// The paired Current instances test cache invariance only. Independent checks
// differentiate public geometry; no N14 trajectory equivalence is claimed.
for(const weapon of ['sword','spear','axe','maul'])test(`Invariancia de caché N16 activa/pasiva; matriz/J contra oráculo numérico: ${weapon}`,()=>{
  for(const boss of [false,true])for(const dir of [-1,1])for(const passive of [false,true]){
    const g=new DuelEngine();g.setDifficulty(boss?'boss':'normal');
    const f=g.fighters[boss?1:0];g.setLoadout(f.slot,{weapon,defense:weapon==='maul'?'none':'knife'});
    f.dir=dir;f.baseX=-dir*Math.abs(f.baseX);g.initializeRig(f);f.evasion={crouch:1,feint:0};
    const intent=g.buildPose(f),fields=Object.fromEntries(Object.entries(f.rig).filter(([key])=>key!=='apron').map(([key,value])=>[key,structuredClone(value)]));
    const rigs=[Current,Current].map(Type=>{
      const r=Object.assign(new Type({dir,scale:boss?1.18:1,apronVariant:boss?'boss':'normal'}),structuredClone(fields));
      Object.assign(r.apron,structuredClone(Object.fromEntries(Object.entries(f.rig.apron))));
      if(passive){r.collapse();r.velocity[0]=.09*dir;r.velocity[1]=-.3;}else r.setIntent(intent,{baseX:f.baseX});
      r.velocity[14]=.07*dir;r.velocity[15]=-.05*dir;
      return r;
    });
    for(let frame=0;frame<60;frame++){
      for(const r of rigs){
        r.waterLoad.mass=.9*(1-frame/60);r.waterLoad.offset.x=.02*Math.sin(frame*.1);
        if(!passive)r.intentBase=f.baseX+dir*.12*Math.sin(frame*.07);
        if(r===rigs[0])evictKinematicCache(r);else{r.pose();r.diagnostics();}
        r.step(STEP);
      }
      assert.deepEqual(capture(rigs[1]),capture(rigs[0]),`${boss}/${dir}/${passive}/${frame}`);
      for(const key of ['q','velocity','lastMotor','lastGravity'])assert.deepEqual(Buffer.from(rigs[1][key].buffer,rigs[1][key].byteOffset,rigs[1][key].byteLength),Buffer.from(rigs[0][key].buffer,rigs[0][key].byteOffset,rigs[0][key].byteLength),`${weapon}/${boss}/${dir}/${passive}/${frame}/${key}/bits`);
      assertFiniteRig(rigs[1],`${weapon}/${boss}/${dir}/${passive}/${frame}`);
      if([0,30,59].includes(frame))assertNumericalRig(rigs[1],`${weapon}/${boss}/${dir}/${passive}/${frame}`);
      if(frame%10===0)for(const t of [0,.37,1]){
        assert.deepEqual(rigs[1].collisionGeometryAt(t),rigs[0].collisionGeometryAt(t));
        assert.deepEqual(rigs[1].collisionSolidsAt(t),rigs[0].collisionSolidsAt(t));
      }
    }
  }
});
