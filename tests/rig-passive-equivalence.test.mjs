import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig as Current} from '../public/physics/articulated-rig.js';

const temporary=new URL(`../public/physics/.passive-exact-baseline-${process.pid}.mjs`,import.meta.url);
await fs.writeFile(temporary,await fs.readFile(new URL('../audit/articulated-rig-passive-spikes-before.js',import.meta.url),'utf8'));
const {ArticulatedRig:Before}=await import(temporary.href);
test.after(async()=>fs.unlink(temporary));
const capture=r=>({q:r.q.slice(),velocity:r.velocity.slice(),pose:r.pose(),diagnostics:r.diagnostics(),panels:r.collisionPanels()});

for(const weapon of ['sword','spear','axe','maul'])test(`Las cachés y asignaciones conservan cada paso activo y pasivo del baseline: ${weapon}`,()=>{
  for(const boss of [false,true])for(const dir of [-1,1])for(const passive of [false,true]){
    const g=new DuelEngine();g.setDifficulty(boss?'boss':'normal');
    const f=g.fighters[boss?1:0];g.setLoadout(f.slot,{weapon,defense:weapon==='maul'?'none':'knife'});
    f.dir=dir;f.baseX=-dir*Math.abs(f.baseX);g.initializeRig(f);f.evasion={crouch:1,feint:0};
    const intent=g.buildPose(f),fields=Object.fromEntries(Object.entries(f.rig).filter(([key])=>key!=='apron').map(([key,value])=>[key,structuredClone(value)]));
    const rigs=[Before,Current].map(Type=>{
      const r=Object.assign(new Type({dir,scale:boss?1.18:1,apronVariant:boss?'boss':'normal'}),structuredClone(fields));
      Object.assign(r.apron,structuredClone(Object.fromEntries(Object.entries(f.rig.apron))));
      if(passive){r.collapse();r.velocity[0]=.09*dir;r.velocity[1]=-.3;}else r.setIntent(intent,{baseX:f.baseX});
      return r;
    });
    for(let frame=0;frame<60;frame++){
      for(const r of rigs){
        r.waterLoad.mass=.9*(1-frame/60);r.waterLoad.offset.x=.02*Math.sin(frame*.1);
        if(!passive)r.intentBase=f.baseX+dir*.12*Math.sin(frame*.07);
        r.step(STEP);
      }
      assert.deepEqual(capture(rigs[1]),capture(rigs[0]),`${boss}/${dir}/${passive}/${frame}`);
      if(frame%10===0)for(const t of [0,.37,1]){
        assert.deepEqual(rigs[1].collisionGeometryAt(t),rigs[0].collisionGeometryAt(t));
        assert.deepEqual(rigs[1].collisionSolidsAt(t),rigs[0].collisionSolidsAt(t));
      }
    }
  }
});
