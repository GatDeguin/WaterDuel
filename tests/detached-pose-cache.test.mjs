import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DetachedPoseMatrixCache} from '../public/rendering/detached-pose-cache.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms,detachedCharacterTransforms} from '../public/rendering/asset-rig.js';
import {DuelEngine} from '../public/engine.js';
import {captureReplayState,replayView} from '../public/replay.js';
import {SimulationPresentation} from '../public/simulation-presentation.js';

const joints=['mainShoulder','mainElbow','wrist','offShoulder','offElbow','frontHip','frontKnee','backHip','backKnee'];
const models=new Map();
async function entry(version=3,boss=false,slot=1){
  const key=`${version}/${boss}/${slot}`;
  if(!models.has(key))models.set(key,readFile(new URL(`../public/assets/characters/water-mannequin/v${version}/water-mannequin${boss?'-boss':slot===2?'-amber':''}.glb`,import.meta.url))
    .then(bytes=>({prepared:prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)))})));
  return models.get(key);
}
function source(f,fragment){return {...f,pose:fragment.sourcePose,equipment:fragment.sourcePose.equipment??f.equipment};}
function actualFragment(g,f,joint){assert.equal(f.rig.damageJoint(joint,1).detached,true);g.refreshRigPose(f);return f.pose.detached[0];}
function bytes(matrices){return matrices.map(matrix=>matrix===null?null:Buffer.from(matrix.buffer,matrix.byteOffset,matrix.byteLength).toString('hex'));}

test('Matrices de fuente: bytes F32 exactos para GLB v2/v3, nueve fracturas, ambos lados y jefe',async()=>{
  const cache=new DetachedPoseMatrixCache();let combinations=0;
  for(const version of [2,3])for(const boss of [false,true]){
    for(const slot of [1,2])for(const joint of joints){
      const asset=await entry(version,boss,slot);
      const g=new DuelEngine();g.setMode('versus');const f=g.fighters[slot-1];f.boss=boss;if(boss)g.initializeRig(f);
      const fragment=actualFragment(g,f,joint),s=source(f,fragment),expected=characterTransforms(asset.prepared,s);
      const first=cache.get(asset,s,fragment);assert.deepEqual(bytes(first),bytes(expected));
      const copy=structuredClone(fragment),copySource=source(f,copy),second=cache.get(asset,copySource,copy);
      assert.equal(second,first,'fresh sourcePose ownership must not force another matrix reconstruction');
      copy.transform[12]+=.3;copy.transform[13]-=.1;
      assert.deepEqual(bytes(detachedCharacterTransforms(asset.prepared,copySource,copy,second)),bytes(detachedCharacterTransforms(asset.prepared,copySource,copy)));
      combinations++;
    }
  }
  assert.equal(combinations,72);
});

test('Firma exacta invalida pivotes, dirección, tamaño, equipo, dos manos y matriz de falda',async()=>{
  const asset=await entry(),g=new DuelEngine(),f=g.fighters[0],fragment=actualFragment(g,f,'mainElbow'),cache=new DetachedPoseMatrixCache();
  const reference=source(f,fragment),initial=cache.get(asset,reference,fragment);
  const mutate=[s=>{s.pose.mainHand.x+=.01;},s=>{s.pose.tip.z+=.1;},s=>{s.pose.offHand.y+=.1;},s=>{s.pose.footB.z+=.1;},
    s=>{s.dir=-1;},s=>{s.boss=true;},s=>{s.balloonSize=1.3;},s=>{s.equipment={weapon:'maul',defense:'none'};},
    s=>{s.equipment={weapon:'sword',defense:'knife'};s.pose.defenseTip={x:.2,y:1.1,z:.05};},s=>{s.pose.twoHanded=true;},
    s=>{s.pose.apron.canonicalMatrix[12]+=.1;},s=>{s.pose.apron.variant='other';s.pose.apron.angle=.4;}];
  for(const change of mutate){
    const s={...reference,pose:structuredClone(reference.pose)};change(s);const got=cache.get(asset,s,fragment);
    assert.notEqual(got,initial);assert.deepEqual(bytes(got),bytes(characterTransforms(asset.prepared,s)));
    assert.deepEqual(bytes(initial),bytes(characterTransforms(asset.prepared,reference)),'source matrices cannot be modified by a later pose');
  }
  const swapped={...asset,prepared:await entry(2).then(x=>x.prepared)};assert.notEqual(cache.get(swapped,reference,fragment),initial);
});

test('Mutar una fuente de igual identidad o intercambiar prepared no devuelve matrices antiguas',async()=>{
  const asset={...await entry()},g=new DuelEngine(),f=g.fighters[1],fragment=structuredClone(actualFragment(g,f,'wrist')),s=source(f,fragment),cache=new DetachedPoseMatrixCache();
  const original=cache.get(asset,s,fragment);s.pose.mainHand.x+=.123;
  const edited=cache.get(asset,s,fragment);assert.notEqual(edited,original);assert.deepEqual(bytes(edited),bytes(characterTransforms(asset.prepared,s)));
  asset.prepared=(await entry(2)).prepared;
  const swapped=cache.get(asset,s,fragment);assert.notEqual(swapped,edited);assert.deepEqual(bytes(swapped),bytes(characterTransforms(asset.prepared,s)));
});

test('Cada componente de los pivotes se valida; las marcas y color no congelan la presentación',async()=>{
  const asset=await entry(),g=new DuelEngine(),f=g.fighters[0],fragment=actualFragment(g,f,'wrist'),reference=source(f,fragment),cache=new DetachedPoseMatrixCache();
  const points=['hip','mainShoulder','offShoulder','mainElbow','offElbow','mainHand','offHand','tip','frontHip','backHip','kneeF','kneeB','footF','footB','shoulder','head'];
  const initial=cache.get(asset,reference,fragment);
  for(const point of points)for(const axis of ['x','y','z']){
    const s={...reference,pose:structuredClone(reference.pose)};s.pose[point][axis]=(s.pose[point][axis]??0)+.037;
    const got=cache.get(asset,s,fragment);assert.notEqual(got,initial,`${point}.${axis}`);
    assert.deepEqual(bytes(got),bytes(characterTransforms(asset.prepared,s)),`${point}.${axis}`);
  }
  const s={...reference,balloonColor:'#ff3311',pose:structuredClone(reference.pose)};
  s.pose.joints={wrist:{damage:.3,detached:false}};
  const a=cache.get(asset,reference,fragment),b=cache.get(asset,s,fragment);assert.equal(a,b,'materials and damage are rendered after frozen transforms');
  const exotic={...reference,pose:structuredClone(reference.pose)};
  exotic.pose.head=Object.assign([reference.pose.head.x,reference.pose.head.y,reference.pose.head.z],reference.pose.head);
  const e1=cache.get(asset,exotic,fragment);exotic.pose.head.x+=.4;const e2=cache.get(asset,exotic,fragment);
  assert.notEqual(e1,e2);assert.deepEqual(bytes(e2),bytes(characterTransforms(asset.prepared,exotic)));
});

test('Una caché acotada expulsa y clear no retiene matrices de una ronda anterior',async()=>{
  const asset=await entry(),g=new DuelEngine(),f=g.fighters[0],fragment=actualFragment(g,f,'wrist'),s=source(f,fragment),cache=new DetachedPoseMatrixCache({maxEntries:2});
  const first=cache.get(asset,s,fragment);cache.get(asset,s,{...fragment,id:'second'});cache.get(asset,s,{...fragment,id:'third'});
  const reloaded=cache.get(asset,s,fragment);assert.notEqual(reloaded,first);assert.deepEqual(bytes(reloaded),bytes(first));
  cache.clear();assert.notEqual(cache.get(asset,s,fragment),reloaded);
  assert.throws(()=>new DetachedPoseMatrixCache({maxEntries:0}),/maxEntries/);
});

test('Interpolación y replay siguen siendo snapshots propios; la fuente estable reutiliza matrices',async()=>{
  const asset=await entry(),g=new DuelEngine(),f=g.fighters[0],fragment=actualFragment(g,f,'mainElbow'),cache=new DetachedPoseMatrixCache();
  g.phase='burst';const presentation=new SimulationPresentation();presentation.capture(g);fragment.transform[12]=.4;presentation.capture(g);
  const a=presentation.view(g,.2).fighters[0],fa=a.pose.detached[0],ma=cache.get(asset,source(a,fa),fa);
  const b=presentation.view(g,.8).fighters[0],fb=b.pose.detached[0],mb=cache.get(asset,source(b,fb),fb);
  assert.notEqual(fa.sourcePose,fb.sourcePose);assert.equal(ma,mb);assert.notEqual(fa.transform[12],fb.transform[12]);
  const frame=captureReplayState(g),r1=replayView(frame).fighters[0],r2=replayView(frame).fighters[0],rf1=r1.pose.detached[0],rf2=r2.pose.detached[0];
  assert.equal(cache.get(asset,source(r1,rf1),rf1),cache.get(asset,source(r2,rf2),rf2));
  rf1.sourcePose.mainHand.x=99;rf1.transform[12]=99;
  assert.notEqual(rf2.sourcePose.mainHand.x,99);assert.notEqual(frame.fighters[0].pose.detached[0].transform[12],99);
  assert.deepEqual(bytes(cache.get(asset,source(r2,rf2),rf2)),bytes(characterTransforms(asset.prepared,source(r2,rf2))));
  g.resetRound();assert.equal(g.fighters[0].pose.detached,undefined);
});
