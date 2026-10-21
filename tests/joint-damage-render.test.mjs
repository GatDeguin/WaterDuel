import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Renderer3D} from '../public/render3d.js';
import {DuelEngine} from '../public/engine.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms,detachedCharacterTransforms,prepareEquipment,equipmentTransform} from '../public/rendering/asset-rig.js';
import {drawDefense} from '../public/rendering/equipment.js';
import {bodyForBone,bodyVisible,jointMarks,rigidRenderer} from '../public/rendering/joint-damage.js';
import {captureReplayState,replayView} from '../public/replay.js';
import {SimulationPresentation} from '../public/simulation-presentation.js';

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const delta=(angle,x=0,y=0)=>{const m=identity(),c=Math.cos(angle),s=Math.sin(angle);m[0]=c;m[1]=s;m[4]=-s;m[5]=c;m[12]=x;m[13]=y;return m;};
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const near=(a,b)=>assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<2e-6,`${a} != ${b}`);
const clusters={mainShoulder:['mainUpper','mainForearm','weapon'],mainElbow:['mainForearm','weapon'],wrist:['weapon'],
  offShoulder:['offUpper','offForearm','offWeapon'],offElbow:['offForearm','offWeapon'],
  frontHip:['frontThigh','frontShin'],frontKnee:['frontShin'],backHip:['backThigh','backShin'],backKnee:['backShin']};
function fighter(weapon='sword',boss=false){const g=new DuelEngine();g.setMode('versus');g.setLoadout(1,{weapon,defense:weapon==='maul'?'none':'short'});g.fighters[0].boss=boss;return {g,f:g.fighters[0]};}
function fracture(f,joint='mainElbow',transform=identity()){
  const sourcePose=structuredClone(f.pose);delete sourcePose.joints;delete sourcePose.detached;
  const fragment={id:1,joint,bodies:clusters[joint].slice(),transform,sourcePose};
  f.pose={...f.pose,joints:{[joint]:{damage:1,detached:true}},detached:[fragment]};return fragment;
}
function recorder(){
  const r=Object.create(Renderer3D.prototype),calls=[];r.assetScene={characters:{},equipment:{}};r.assetPoseCache=new WeakMap();r.depthOnly=true;
  r.draw=(shape,matrix,color,material=0,opacity=1,wobble=0,wet=0)=>calls.push({shape,matrix:matrix.slice(),color,material,opacity,wobble,wet});
  return {r,calls};
}
function callBytes(c){return Buffer.concat([Buffer.from(JSON.stringify([c.shape,c.color,c.material,c.opacity,c.wobble,c.wet])),Buffer.from(c.matrix.buffer,c.matrix.byteOffset,c.matrix.byteLength)]);}
function digest(calls,unordered=false){const bytes=calls.map(callBytes);if(unordered)bytes.sort(Buffer.compare);const h=createHash('sha256');for(const data of bytes)h.update(data);return h.digest('hex');}
let preparedPromise;
const character=()=>preparedPromise??=readFile(new URL('../public/assets/characters/water-mannequin/v3/water-mannequin.glb',import.meta.url)).then(bytes=>prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))));

test('Healthy conserva payload procedural F32 aprobado 1.7, también mazo/jefe',async()=>{
  // Intentional 1.7 changes: three generic ground blobs are absent from depth
  // passes; maul fingers fit its .054 m handle. Shaders now bend the physical
  // blade, shade regional cloth wetness and integrate disjoint liquid paths.
  const expected=[['sword',false,218,'87b8f359b7fc0cb5ab6591669f4e6582d9430c8f7ac8c09a9bc0f47332ccfbd1'],['sword',true,248,'6ff1a96c13fc9c46b339b98f3d9a01971cd9c64d48984fd3e0682dd6e6bb4adc'],
    ['maul',false,226,'61bf9866981436b6ff1f7609ca24f5976a3b4247c8bed010ed44100d78c32ced'],['maul',true,256,'589391b22abc16cd1e788752942d1e39035ce534cd6ea1be5ee8d5f643afd5ba']];
  for(const [weapon,boss,count,sha]of expected){const {f}=fighter(weapon,boss),{r,calls}=recorder();r.drawPuppet(f,.5,{quality:'high'});assert.equal(calls.length,count);assert.equal(digest(calls),sha);}
  const source=await readFile(new URL('../public/render3d.js',import.meta.url),'utf8');
  assert.equal(createHash('sha256').update(source.slice(source.indexOf('const vert=`'),source.indexOf('function buildProgram('))).digest('hex'),'178065a1e4e30b754e730bda414c821a1f84403a3ccf5a497851ede5cc70ac49');
});

test('Cada hueso/palma sigue su cuerpo físico y las marcas sólo aparecen ante daño real',()=>{
  assert.equal(bodyForBone('upper_arm.R'),'mainUpper');assert.equal(bodyForBone('forearm.R'),'mainForearm');assert.equal(bodyForBone('hand.R'),'weapon');
  assert.equal(bodyForBone('forearm.L'),'offForearm');assert.equal(bodyForBone('hand.L'),'offForearm');assert.equal(bodyForBone('foot.R'),'frontShin');
  const {f}=fighter();assert.deepEqual(jointMarks(f.pose),[]);f.pose.joints={mainElbow:{damage:.6,detached:false}};
  const marks=jointMarks(f.pose);assert.equal(marks.length,1);assert.equal(marks[0].body,'mainForearm');assert.equal(marks[0].damage,.6);
  fracture(f);assert.equal(bodyVisible(f.pose,'mainUpper'),true);assert.equal(bodyVisible(f.pose,'mainForearm'),false);assert.equal(bodyVisible(f.pose,'weapon'),false);assert.deepEqual(jointMarks(f.pose),[]);
});

test('GLB separado conserva geometría al romper y sigue delta físico sin mover puertos del padre',async()=>{
  const prepared=await character(),{g}=fighter();
  for(const f of g.fighters){
    const before=characterTransforms(prepared,f),fragment=fracture(f),source=structuredClone(fragment.sourcePose);
    const atBreak=detachedCharacterTransforms(prepared,f,fragment);
    for(let i=0;i<before.length;i++)if(fragment.bodies.includes(bodyForBone(prepared.parts[i].boneName)))assert.deepEqual(atBreak[i],before[i]);else assert.equal(atBreak[i],null);
    fragment.transform=delta(.7,.4,-.3);const moved=detachedCharacterTransforms(prepared,f,fragment);
    for(let i=0;i<moved.length;i++)if(moved[i])for(const p of [[0,0,0],[.1,.2,-.1]])near(point(moved[i],p),point(fragment.transform,point(before[i],p)));
    assert.deepEqual(characterTransforms(prepared,f),before,'live endpoints are never overwritten for the detached child');assert.deepEqual(fragment.sourcePose,source);
  }
});

test('Fallback procedural conserva cada pieza exactamente una vez al romper, incluido mazo/jefe',()=>{
  for(const weapon of ['sword','maul'])for(const boss of [false,true])for(const joint of Object.keys(clusters)){
    const {f}=fighter(weapon,boss),healthy=recorder();healthy.r.drawPuppet(f,.5,{quality:'high'});fracture(f,joint);
    const broken=recorder();broken.r.drawPuppet(f,.5,{quality:'high'});
    assert.equal(broken.calls.length,healthy.calls.length,`${weapon}/${boss}/${joint}: no missing or duplicate body/equipment`);
    assert.equal(digest(broken.calls,true),digest(healthy.calls,true),`${weapon}/${boss}/${joint}: fracture identity must preserve the same geometry`);
  }
});

test('GLB live oculta huesos perdidos y el fragmento conserva arma una vez, también en sombras',async()=>{
  const prepared=await character(),{f}=fighter(),fragment=fracture(f),{r}=recorder(),calls=[];
  const characterGPU={parts:prepared.parts.map(p=>({material:p.material,count:p.indices.length})),materials:prepared.asset.materials};
  const swordGPU={parts:[{material:0,count:3}],materials:[]},shieldGPU={parts:[{material:0,count:3}],materials:[]};
  r.assetScene={characters:{mint:{prepared,gpu:characterGPU}},equipment:{sword:{gpu:swordGPU},short:{gpu:shieldGPU}}};
  r.assetPart=(model,part,matrix)=>calls.push({model,part,matrix});
  r.detailedPuppet(f);r.detailedEquipment(f,'sword');r.detailedEquipment(f,'short');r.drawDetachedPuppet(f,.5,{},true);
  assert.equal(calls.filter(c=>c.model===characterGPU).length,prepared.parts.length,'all character pieces have exactly one owner');
  assert.equal(calls.filter(c=>c.model===swordGPU).length,1);assert.equal(calls.filter(c=>c.model===shieldGPU).length,1);
  for(const part of characterGPU.parts)assert.equal(calls.filter(c=>c.part===part).length,1);
  assert.ok(fragment.bodies.includes('weapon'));
});

test('Escudos y daga reales siguen su cuerpo físico una vez, en GLB y fallback de ambos jugadores',async()=>{
  const prepared=await character(),pal={wood:0xa16c42,edge:0x78502f,light:0xc99e67,ivory:0xdfc49a,metal:0xd4af63,steel:0xa9b9b7,dark:0x106a62,leather:0x62442f,cloth:0x14866f};
  for(const defense of ['short','long','knife']){
    const bytes=await readFile(new URL(`../public/assets/equipment/workshop/v2/${defense}.glb`,import.meta.url));
    const equipment=prepareEquipment(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),defense);
    for(const slot of [1,2])for(const joint of ['offShoulder','offElbow']){
      const g=new DuelEngine();g.setMode('versus');g.setLoadout(slot,{weapon:'sword',defense});const f=g.fighters[slot-1];
      const healthy=recorder();healthy.r.drawProceduralPuppet(f,.5,pal);
      assert.equal(f.rig.damageJoint(joint,1).detached,true);g.refreshRigPose(f);
      const fragment=f.pose.detached[0],owner=defense==='knife'?'offWeapon':'offForearm';
      assert.ok(fragment.bodies.includes(owner));assert.equal(fragment.bodies.includes('offWeapon'),defense==='knife');
      const source={...f,pose:fragment.sourcePose},atBreak=recorder();
      atBreak.r.drawProceduralPuppet(f,.5,pal);atBreak.r.drawDetachedPuppet(f,.5,pal,false);
      assert.equal(digest(atBreak.calls,true),digest(healthy.calls,true),`${slot}/${defense}/${joint}: fallback union at fracture`);
      fragment.transform=delta(.4,.45,-.12);
      const expected=recorder();drawDefense(rigidRenderer(expected.r,fragment.transform),source,pal);
      const loose=recorder();loose.r.drawDetachedPuppet(f,.5,pal,false);
      const keys=loose.calls.map(call=>callBytes(call).toString('hex'));
      for(const call of expected.calls)assert.ok(keys.includes(callBytes(call).toString('hex')),`${slot}/${defense}/${joint}: fallback defense must move with fragment`);
      const {r}=recorder(),calls=[],characterGPU={parts:prepared.parts.map(p=>({material:p.material,count:p.indices.length})),materials:prepared.asset.materials};
      const defenseGPU={parts:equipment.parts.map(p=>({material:p.material,count:p.indices.length})),materials:[]};
      r.assetScene={characters:{[slot===1?'mint':'amber']:{prepared,gpu:characterGPU}},equipment:{[defense]:{gpu:defenseGPU}}};
      r.assetPart=(model,part,matrix)=>calls.push({model,part,matrix});
      r.detailedPuppet(f);r.detailedEquipment(f,defense);
      assert.equal(calls.filter(call=>call.model===defenseGPU).length,0,`${slot}/${defense}/${joint}: no live ghost defense`);
      r.drawDetachedPuppet(f,.5,pal,true);
      const transformed=[];rigidRenderer({assetPart:(_m,_p,matrix)=>transformed.push(matrix)},fragment.transform).assetPart(null,null,equipmentTransform(source,defense).matrix);
      const defenseCalls=calls.filter(call=>call.model===defenseGPU);assert.equal(defenseCalls.length,defenseGPU.parts.length);
      for(const call of defenseCalls)assert.deepEqual(call.matrix,transformed[0]);
      for(const part of characterGPU.parts)assert.equal(calls.filter(call=>call.part===part).length,1,'GLB body has one owner');
    }
  }
});

test('Proxy rígido transforma una sola vez las llamadas de geometría y nunca altera matrices fuente',()=>{
  const model=Float32Array.from(identity()),deltaMatrix=delta(.4,.7,-.1),calls=[];
  const r={draw:(_s,m)=>calls.push(m),assetPart:(_g,_p,m)=>calls.push(m)},proxy=rigidRenderer(r,deltaMatrix);
  proxy.draw('box',model);proxy.assetPart({}, {},model);for(const m of calls)near(point(m,[.3,.2,0]),point(deltaMatrix,[.3,.2,0]));
  assert.deepEqual(model,Float32Array.from(identity()));assert.throws(()=>rigidRenderer(r,[NaN]),/fragmento/i);
});

test('Replay copia daño, sourcePose y transform sin alias con física o vistas futuras',()=>{
  const {g,f}=fighter(),fragment=fracture(f,'wrist',delta(.2,.1,-.2)),frame=captureReplayState(g),view=replayView(frame);
  fragment.transform[12]=99;fragment.sourcePose.mainHand.x=99;f.pose.joints.wrist.damage=.1;
  assert.equal(frame.fighters[0].pose.joints.wrist.damage,1);assert.equal(view.fighters[0].pose.detached[0].transform[12],.1);
  assert.notEqual(view.fighters[0].pose.detached[0].sourcePose.mainHand.x,99);
  view.fighters[0].pose.detached[0].transform[12]=88;assert.equal(frame.fighters[0].pose.detached[0].transform[12],.1);
  assert.equal(replayView(frame).fighters[0].pose.detached[0].transform[12],.1);
});

test('Presentación burst interpola rotación rígida por ID y no mezcla fragmentos nacidos distintos',()=>{
  const {g,f}=fighter();g.phase='burst';const fragment=fracture(f),presentation=new SimulationPresentation();presentation.capture(g);
  fragment.transform=delta(Math.PI/2,1,-.2);presentation.capture(g);const half=presentation.view(g,.5).fighters[0].pose.detached[0].transform;
  assert.ok(Math.abs(Math.hypot(half[0],half[1])-1)<1e-10);assert.ok(Math.abs(half[0]*half[5]-half[1]*half[4]-1)<1e-10);assert.ok(Math.abs(half[12]-.5)<1e-10);
  fragment.id=2;fragment.transform=delta(Math.PI,.4,-.4);presentation.capture(g);const fresh=presentation.view(g,.1).fighters[0].pose.detached[0];
  assert.equal(fresh.id,2);assert.deepEqual(fresh.transform,fragment.transform);assert.notEqual(fresh.sourcePose,fragment.sourcePose);
});
