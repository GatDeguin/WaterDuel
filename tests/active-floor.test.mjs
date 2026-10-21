import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DuelEngine,STEP} from '../public/engine.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';

const character=async boss=>{
  const bytes=await fs.readFile(new URL(`../public/assets/characters/water-mannequin/v2/water-mannequin${boss?'-boss':''}.glb`,import.meta.url));
  return prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
};

test('La postura baja conserva suelo y apoyos también en los vértices GLB de ambos sentidos y tamaños',async()=>{
  for(const boss of [false,true]){
    const c=await character(boss);
    for(const dir of [-1,1]){
      const g=new DuelEngine();g.setDifficulty(boss?'boss':'normal');g.phase='fight';
      const f=g.fighters[boss?1:0];f.dir=dir;f.baseX=-dir*Math.abs(f.baseX);g.initializeRig(f);
      for(let i=0;i<90;i++)g.updateFighter(f,STEP);
      const hip=f.pose.hip.y,feet=[{...f.pose.footF},{...f.pose.footB}];
      for(let frame=0;frame<180;frame++){
        g.setControl(f.slot,{bodyY:-1});g.updateFighter(f,STEP);
        const d=f.rig.diagnostics();assert.ok(d.minimumGroundY>=TABLE_TOP-.0003,`proxy boss${boss} dir${dir} frame${frame}`);
        assert.ok(d.contacts.every(c=>c.error<.0002),'apoyos dentro del mismo solver');
        if(frame%15!==0&&frame!==179)continue;
        const matrices=characterTransforms(c,f);
        for(let i=0;i<c.parts.length;i++){
          const part=c.parts[i],m=matrices[i];
          if(!/^(shin|thigh|foot)\./.test(part.boneName))continue;
          for(let v=0;v<part.positions.length;v+=3){
            const y=m[1]*part.positions[v]+m[5]*part.positions[v+1]+m[9]*part.positions[v+2]+m[13];
            assert.ok(y>=TABLE_TOP-1e-5,`${part.boneName} boss${boss} dir${dir} frame${frame}: ${y}`);
          }
        }
      }
      assert.ok(f.pose.hip.y<hip-.20,'la envolvente no impide la postura solicitada');
      for(const [i,key]of ['footF','footB'].entries()){
        assert.ok(Math.abs(f.pose[key].x-feet[i].x)<.0002);
        assert.ok(Math.abs(f.pose[key].y-feet[i].y)<.0002);
      }
    }
  }
});

test('El impacto unilateral de suelo sin gravedad no crea energía ni tensión hacia la tarima',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const r=new ArticulatedRig({dir,scale,gravity:0});r.collapse();r.velocity[1]=-.8;
    const before=r.diagnostics().kineticEnergy;r.step(STEP);const after=r.diagnostics();
    assert.ok(after.minimumGroundY>=TABLE_TOP-.0003);
    assert.ok(after.kineticEnergy<=before+1e-8,`${before} -> ${after.kineticEnergy}`);
    assert.ok(after.motorTorque.every(t=>t===0));
    assert.ok(after.coordinates.every(q=>Number.isFinite(q.position)&&Number.isFinite(q.velocity)));
  }
});
