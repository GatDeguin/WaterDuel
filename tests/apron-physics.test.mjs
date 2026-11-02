import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DuelEngine,STEP} from '../public/engine.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {captureReplayState,replayView} from '../public/replay.js';
import {apronParentFrame,apronMatrix} from '../public/physics/apron.js';
import {deformApronGeometry} from '../public/rendering/apron-deform.js';
const load=async boss=>{const b=await fs.readFile(new URL(`../public/assets/characters/water-mannequin/v4/${boss?'water-mannequin-boss':'water-mannequin'}.glb`,import.meta.url));return prepareCharacter(parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));};
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
function minimum(prepared,f){
  const matrices=characterTransforms(prepared,f);let y=Infinity,bone='';
  for(let i=0;i<prepared.parts.length;i++){const p=deformApronGeometry(prepared.parts[i],f.pose.apron)??prepared.parts[i];for(let v=0;v<p.positions.length;v+=3){const value=point(matrices[i],p.positions.subarray(v,v+3))[1];if(value<y){y=value;bone=p.nodeName;}}}
  return {y,bone};
}
test('El faldón y su latón permanecen sobre la tarima tras 360/720 pasos de caída con todos los vértices entregados',async()=>{
  for(const boss of [false,true]){
    const prepared=await load(boss);
    for(const weapon of ['sword','maul'])for(const dir of [1,-1]){
      const game=new DuelEngine();if(boss)game.setDifficulty('boss');game.setLoadout(2,{weapon});const f=game.fighters[1];
      // Unit configuration exercises the same physical rig in both orientations;
      // it does not award a hit or alter any pose coordinates.
      f.dir=dir;game.initializeRig(f);const initialHip=f.pose.hip.y;f.rig.collapse();
      for(let step=1;step<=720;step++){
        f.rig.step(STEP);f.pose=f.rig.pose();
        if(step===360||step===720){const min=minimum(prepared,f);assert.ok(min.y>=TABLE_TOP-1e-5,`${boss}/${weapon}/${dir}/${step}: ${min.y} ${min.bone}`);}
      }
      assert.ok(f.pose.hip.y<initialHip-.40,'the accessory never holds the body upright');assert.ok(Number.isFinite(f.pose.apron.angle));
    }
  }
});

test('La heráldica sigue su panel del paño y su estado de replay no pertenece al solver',async()=>{
  const c=await load(true),g=new DuelEngine();g.setDifficulty('boss');const f=g.fighters[1];
  assert.equal(f.pose.apron.angle,0);f.rig.collapse();for(let i=0;i<360;i++)f.rig.step(STEP);f.pose=f.rig.pose();
  assert.ok(c.parts.some(p=>p.accessory==='apron'&&/Brass/.test(p.nodeName)));
  const matrices=characterTransforms(c,f),pIndex=c.parts.findIndex(p=>p.accessory==='apron'&&/Brass/.test(p.nodeName)),part=c.parts[pIndex];
  const geometry=deformApronGeometry(part,f.pose.apron),a=point(matrices[pIndex],geometry.positions.subarray(0,3)),b=point(matrices[pIndex],geometry.positions.subarray(3,6));
  const distance=Math.hypot(...a.map((v,i)=>v-b[i]));assert.ok(distance>0);
  const ca=point(part.apronFromBone,part.positions.subarray(0,3)),cb=point(part.apronFromBone,part.positions.subarray(3,6));
  assert.ok(Number.isInteger(part.apronPanel),'hem brass belongs to a cloth triangle');
  const cloth=f.pose.apron.cloth,[i,j,k]=cloth.triangles[part.apronPanel],[ra,rb,rc]=[i,j,k].map(v=>cloth.rest[v]);
  const expected=p=>{
    const ax=rb[0]-ra[0],ay=rb[1]-ra[1],bx=rc[0]-ra[0],by=rc[1]-ra[1],x=p[0]-ra[0],y=p[1]-ra[1],det=ax*by-ay*bx,u=(x*by-y*bx)/det,v=(ax*y-ay*x)/det;
    const raw=[0,1,2].map(axis=>cloth.directors[i][axis]*(1-u-v)+cloth.directors[j][axis]*u+cloth.directors[k][axis]*v),length=Math.hypot(...raw);
    return [0,1,2].map(axis=>cloth.positions[i][axis]*(1-u-v)+cloth.positions[j][axis]*u+cloth.positions[k][axis]*v+raw[axis]/length*(p[2]-ra[2])*1.18);
  };
  assert.ok(Math.hypot(...a.map((v,i)=>v-expected(ca)[i]))<1e-6);assert.ok(Math.hypot(...b.map((v,i)=>v-expected(cb)[i]))<1e-6);
  const saved=captureReplayState(g),view=replayView(saved);view.fighters[1].pose.apron.angle=999;assert.notEqual(f.pose.apron.angle,999);
  assert.deepEqual(saved.fighters[1].pose.apron,f.pose.apron);
});

test('El paño comparte reloj fijo y conserva el bind al inicializar antes de la caída',async()=>{
  const c=await load(true),a=new DuelEngine(),b=new DuelEngine();a.setDifficulty('boss');b.setDifficulty('boss');
  const fa=a.fighters[1],fb=b.fighters[1],before=characterTransforms(c,fa),expected=apronParentFrame(fa.pose,fa.dir,1.18,c.apron);
  for(let i=0;i<c.parts.length;i++)if(c.parts[i].accessory==='apron'){
    const part=c.parts[i],v=part.positions.subarray(0,3),actual=point(before[i],deformApronGeometry(part,fa.pose.apron).positions.subarray(0,3)),canon=point(part.apronFromBone,v);
    assert.ok(Math.hypot(...actual.map((x,k)=>x-point(expected,canon)[k]))<1e-6);
  }
  fa.rig.collapse();fb.rig.collapse();for(let i=0;i<240;i++){fa.rig.step(STEP);if(i%4===0)fb.rig.step(1/30);}
  assert.deepEqual(fa.rig.pose().apron,fb.rig.pose().apron);
});
