import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms,detachedCharacterTransforms} from '../public/rendering/asset-rig.js';
import {DuelEngine} from '../public/engine.js';

const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const xyz=p=>[p.x,p.y,p.z??0];
const near=(a,b,e=2e-5)=>assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<e,`${a} != ${b}`);
const normalize=a=>{const length=Math.hypot(...a);return a.map(v=>v/length);};
const difference=(a,b)=>a.map((v,i)=>v-b[i]);
let preparedPromise;
const character=()=>preparedPromise??=readFile(new URL('../public/assets/characters/water-mannequin/v3/water-mannequin.glb',import.meta.url)).then(bytes=>prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))));
function radial(m,anchor,axis){
  const sample=anchor.map((v,i)=>v+[.047,.031,.019][i]),d=difference(point(m,sample),point(m,anchor)),along=d.reduce((s,v,i)=>s+v*axis[i],0);
  return {along,radius:Math.sqrt(Math.max(0,d.reduce((s,v)=>s+v*v,0)-along*along))};
}

test('la mano GLB adapta su sección al mango manteniendo socket y longitud en ambos lados',async()=>{
  const c=await character(),g=new DuelEngine(),index=c.parts.findIndex(p=>p.boneName==='hand.R'),part=c.parts[index];
  for(const f of g.fighters){
    const base=characterTransforms(c,{...f,equipment:{weapon:'sword',defense:'short'}})[index],axis=normalize(difference(xyz(f.pose.tip),xyz(f.pose.mainHand)));
    const reference=radial(base,part.anchorSocket,axis);
    for(const [weapon,radius] of [['sword',.045],['spear',.039],['axe',.048],['maul',.054]]){
      const m=characterTransforms(c,{...f,equipment:{weapon,defense:'none'}})[index],actual=radial(m,part.anchorSocket,axis);
      near(point(m,part.anchorSocket),xyz(f.pose.mainHand));assert.ok(Math.abs(actual.radius/reference.radius-radius/.045)<1e-5,weapon);
      assert.ok(Math.abs(actual.along-reference.along)<1e-6,'el largo de dedos/agarre no se estira con el diámetro');
    }
  }
});

test('la mano secundaria se cierra sobre la daga sin perder su socket físico',async()=>{
  const c=await character(),g=new DuelEngine();g.setLoadout(1,{weapon:'sword',defense:'knife'});const f=g.fighters[0],index=c.parts.findIndex(p=>p.boneName==='hand.L'),part=c.parts[index];
  const knife=characterTransforms(c,f)[index],base=characterTransforms(c,{...f,equipment:{weapon:'sword',defense:'none'}})[index];
  const knifeAxis=normalize(difference(xyz(f.pose.defenseTip),xyz(f.pose.offHand))),baseAxis=normalize(difference(xyz(f.pose.offHand),xyz(f.pose.offElbow)));
  near(point(knife,part.anchorSocket),xyz(f.pose.offHand));
  assert.ok(Math.abs(radial(knife,part.anchorSocket,knifeAxis).radius/radial(base,part.anchorSocket,baseAxis).radius-.038/.045)<1e-5);
});

test('la mano adaptada conserva su agarre en el miembro separado y no muta la pose',async()=>{
  const c=await character(),g=new DuelEngine();g.setLoadout(1,{weapon:'spear',defense:'knife'});const f=g.fighters[0];
  f.rig.damageJoint('wrist',1);f.pose=f.rig.pose();const fragment=f.pose.detached.find(d=>d.bodies.includes('weapon'));
  assert.ok(fragment);const before=structuredClone(f.pose),matrices=detachedCharacterTransforms(c,f,fragment),index=c.parts.findIndex(p=>p.boneName==='hand.R');
  near(point(matrices[index],c.parts[index].anchorSocket),point(fragment.transform,xyz(fragment.sourcePose.mainHand)));
  assert.deepEqual(f.pose,before);
});
