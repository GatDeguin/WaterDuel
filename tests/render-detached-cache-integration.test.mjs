import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Renderer3D} from '../public/render3d.js';
import {DetachedPoseMatrixCache} from '../public/rendering/detached-pose-cache.js';
import {DuelEngine} from '../public/engine.js';
import {SimulationPresentation} from '../public/simulation-presentation.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter} from '../public/rendering/asset-rig.js';

const frozen=await readFile(new URL('../audit/water-matrices-1.5.1/baseline/render3d.js',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(frozen).digest('hex'),'f2108ec4e006c1814287f78f5e619e6eb6fa1eca594166134b5c33594eb6753c');
const baseURL=new URL('../public/render3d.js',import.meta.url);
const baseline=await import('data:text/javascript;base64,'+Buffer.from(frozen.replace(/from (['"])(\.[^'"]+)\1/g,
  (_match,_quote,path)=>'from '+JSON.stringify(new URL(path,baseURL).href))).toString('base64'));

function recorder(Type,entry){
  const r=Object.create(Type.prototype),calls=[];
  r.assetScene={characters:{mint:entry,amber:entry,boss:entry}};
  r.detailedEquipment=()=>true;r.drawJointMarks=()=>{};
  r.assetPart=(_gpu,part,matrix,material)=>calls.push({part:entry.gpu.parts.indexOf(part),
    matrix:Buffer.from(matrix.buffer,matrix.byteOffset,matrix.byteLength).toString('hex'),material});
  return {r,calls};
}

test('El dibujado real reutiliza matrices entre vistas propias sin cambiar ningún payload GLB',async()=>{
  for(const boss of [false,true]){
    const bytes=await readFile(new URL(`../public/assets/characters/water-mannequin/v3/water-mannequin${boss?'-boss':''}.glb`,import.meta.url));
    const prepared=prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
    const entry={prepared,gpu:{parts:prepared.parts.map(p=>({material:p.material,count:p.indices.length})),materials:prepared.asset.materials}};
    for(const slot of [1,2])for(const joint of ['mainShoulder','mainElbow','wrist','offShoulder','offElbow','frontHip','frontKnee','backHip','backKnee']){
      const g=new DuelEngine();g.setMode('versus');const f=g.fighters[slot-1];f.boss=boss;g.initializeRig(f);
      assert.equal(f.rig.damageJoint(joint,1).detached,true);g.refreshRigPose(f);g.phase='burst';
      const fragment=f.pose.detached[0],presentation=new SimulationPresentation();presentation.capture(g);
      fragment.transform[12]=.2;presentation.capture(g);
      const current=recorder(Renderer3D,entry),previous=recorder(baseline.Renderer3D,entry),physical=structuredClone(f.pose);
      for(const alpha of [.1,.5,.9]){
        const view=presentation.view(g,alpha).fighters[slot-1];
        current.r.drawDetachedPuppet(view,.5,{},true);previous.r.drawDetachedPuppet(view,.5,{},true);
      }
      assert.deepEqual(current.calls,previous.calls,`${boss}/${slot}/${joint}: all matrices/materials/parts retain their bytes and order`);
      assert.ok(current.r.detachedPoseCache instanceof DetachedPoseMatrixCache,'the actual renderer must use the value-aware cache');
      assert.deepEqual(f.pose,physical,'rendering never mutates physical fragment or sourcePose');
    }
  }
});
