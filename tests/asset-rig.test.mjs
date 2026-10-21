import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms,prepareEquipment,equipmentTransform,deformEquipmentPoint} from '../public/rendering/asset-rig.js';
import {DuelEngine} from '../public/engine.js';
import {WEAPONS} from '../public/equipment.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

const load=async path=>{const bytes=await fs.readFile(new URL(`../public/assets/${path}`,import.meta.url));return parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
const transform=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const xyz=p=>[p.x,p.y,p.z??0];
const near=(a,b,e=2e-5)=>assert.ok(Math.hypot(...a.map((x,i)=>x-b[i]))<e,`${a} != ${b}`);
const determinant=m=>m[0]*(m[5]*m[10]-m[6]*m[9])-m[4]*(m[1]*m[10]-m[2]*m[9])+m[8]*(m[1]*m[6]-m[2]*m[5]);
let characterPromise;
const character=()=>characterPromise??=load('characters/water-mannequin/v2/water-mannequin.glb').then(prepareCharacter);

test('El GLB v2 se divide por hueso/material y conserva UV sin su agua, látex o estoque de muestra',async()=>{
  const c=await character();
  assert.ok(c.parts.length>20&&c.parts.length<150);
  assert.ok(c.triangleCount>20000&&c.triangleCount<57014);
  assert.ok(c.excludedTriangles>0);
  for(const p of c.parts){
    assert.ok(!/Water|Latex|Preview_Rapier/i.test(p.nodeName));
    assert.equal(p.positions.length,p.normals.length);
    assert.equal(p.uv.length,p.positions.length/3*2);
    assert.ok(p.indices.every(i=>i<p.positions.length/3));
    assert.ok(p.positions.every(Number.isFinite)&&p.normals.every(Number.isFinite));
    assert.equal(p.indices.length%3,0);
    for(let v=0;v<p.normals.length;v+=3)assert.ok(Math.abs(Math.hypot(...p.normals.subarray(v,v+3))-1)<1e-5);
  }
});

test('Los pivotes v2 siguen al rig real de ambos jugadores sin reflexiones ni pose de Blender superpuesta',async()=>{
  const c=await character(),game=new DuelEngine();
  for(const f of game.fighters){
    const before=JSON.stringify(f.pose),matrices=characterTransforms(c,f);
    assert.equal(matrices.length,c.parts.length);
    for(let i=0;i<c.parts.length;i++){
      const p=c.parts[i],m=matrices[i];assert.ok(m.every(Number.isFinite));assert.ok(determinant(m)>0,`${p.boneName}: positive handedness`);
      if(p.targetStart)near(transform(m,p.anchorStart),xyz(f.pose[p.targetStart]));
      if(p.targetEnd&&!/^(forearm|shin)\./.test(p.boneName))near(transform(m,p.anchorEnd),xyz(f.pose[p.targetEnd]));
      if(p.socket==='Socket_MainHand')near(transform(m,p.anchorSocket),xyz(f.pose.mainHand));
      if(p.socket==='Socket_SecondaryHand')near(transform(m,p.anchorSocket),xyz(f.pose.offHand));
      if(p.socket==='Socket_Foot_R')near(transform(m,p.anchorSocket),[f.pose.footF.x,f.pose.footF.y-.075,f.pose.footF.z??0]);
      if(p.socket==='Socket_Foot_L')near(transform(m,p.anchorSocket),[f.pose.footB.x,f.pose.footB.y-.075,f.pose.footB.z??0]);
    }
    for(const suffix of ['R','L']){
      const fi=c.parts.findIndex(p=>p.boneName===`forearm.${suffix}`),hi=c.parts.findIndex(p=>p.boneName===`hand.${suffix}`);
      near(transform(matrices[fi],c.parts[fi].anchorEnd),transform(matrices[hi],[0,0,0]));
    }
    assert.equal(JSON.stringify(f.pose),before,'render never mutates physics');
  }
  game.setMode('versus');game.start();for(let i=0;i<81;i++)game.update(.04);assert.equal(game.phase,'fight');
  const f=game.fighters[0],a=characterTransforms(c,f);game.setControl(1,{mainX:.8,mainY:.8,offX:-.5,offY:.3,move:0,wrist:.4,thrust:false,guard:false});
  for(let i=0;i<60;i++)game.update(1/120);
  const b=characterTransforms(c,f);assert.ok(a.some((m,i)=>m.some((x,j)=>Math.abs(x-b[i][j])>.01)),'real simulation changes bone matrices');
});

test('Jefe usa sus propias inverseBindMatrices y su geometría de armadura, con pivotes finitos',async()=>{
  const c=prepareCharacter(await load('characters/water-mannequin/v2/water-mannequin-boss.glb'));
  const game=new DuelEngine();game.setDifficulty('boss');const f=game.fighters[1],matrices=characterTransforms(c,f);
  assert.ok(c.triangleCount>(await character()).triangleCount);
  assert.ok(c.parts.some(p=>/Burgundy/.test(p.nodeName)));
  for(let i=0;i<c.parts.length;i++){
    assert.ok(matrices[i].every(Number.isFinite));assert.ok(determinant(matrices[i])>0);
    const p=c.parts[i];if(p.targetStart)near(transform(matrices[i],p.anchorStart),xyz(f.pose[p.targetStart]));
  }
});

test('Preparación rechaza pesos mezclados y triángulos entre huesos en lugar de pegar una malla incorrecta',async()=>{
  const a=await load('characters/water-mannequin/v2/water-mannequin.glb');
  const p=a.primitives.find(p=>!/Water|Latex|Preview_Rapier/i.test(p.nodeName));
  const v=p.indices[0],old=Array.from(p.weights.slice(v*4,v*4+4));p.weights[v*4]=.5;p.weights[v*4+1]=.5;
  assert.throws(()=>prepareCharacter(a),/rigid|rígido|weight/i);p.weights.set(old,v*4);
  const b=await load('characters/water-mannequin/v2/water-mannequin.glb'),q=b.primitives.find(p=>!/Water|Latex|Preview_Rapier/i.test(p.nodeName));
  q.joints[q.indices[1]*4]=(q.joints[q.indices[0]*4]+1)%18;
  assert.throws(()=>prepareCharacter(b),/triangle|triángulo|joint|hueso/i);
});

test('Los siete GLB de equipo conservan materiales, UV y grips sobre poses reales; sin escudo es ausencia',async()=>{
  const game=new DuelEngine();
  for(const id of ['sword','spear','axe','maul','short','long','knife']){
    const prepared=prepareEquipment(await load(`equipment/workshop/${id}.glb`),id);assert.ok(prepared.parts.length>=6);
    for(const p of prepared.parts){assert.ok(p.positions.every(Number.isFinite));assert.equal(p.uv.length,p.positions.length/3*2);}
    game.setLoadout(1,{weapon:WEAPONS[id]?id:'sword',defense:WEAPONS[id]?'none':id});const f=game.fighters[0],t=equipmentTransform(f,id);
    near(transform(t.matrix,[0,0,0]),xyz(WEAPONS[id]?f.pose.mainHand:f.pose.offHand));assert.ok(determinant(t.matrix)>0);
    if(WEAPONS[id])near(transform(t.matrix,deformEquipmentPoint([0,WEAPONS[id].length,0],t)),xyz(f.pose.tip));
  }
  assert.equal(equipmentTransform(game.fighters[0],'none'),null);
});

test('El mazo mantiene ambos agarres en extensión y balanceo y traslada el cabezal sin estirarlo',async()=>{
  const game=new DuelEngine();game.setMode('versus');game.setLoadout(1,{weapon:'maul',defense:'none'});game.start();for(let i=0;i<81;i++)game.update(.04);assert.equal(game.phase,'fight');const f=game.fighters[0];
  game.setControl(1,{mainX:.7,mainY:.3,offX:0,offY:0,wrist:.4,thrust:true,guard:false,move:0});
  let maxExtension=0;for(let i=0;i<60;i++){
    game.update(1/120);const t=equipmentTransform(f,'maul');
    near(transform(t.matrix,deformEquipmentPoint([0,-.22,0],t)),xyz(f.pose.offGrip),2e-5);
    near(transform(t.matrix,deformEquipmentPoint([0,1.08,0],t)),xyz(f.pose.tip));
    const a=deformEquipmentPoint([0,.83,0],t),b=deformEquipmentPoint([0,1.08,0],t);near([b[1]-a[1]],[.25]);
    near(deformEquipmentPoint([0,-.22,0],t),[0,-.22,0]);assert.ok(determinant(t.matrix)>0);maxExtension=Math.max(maxExtension,t.extension);
  }
  assert.ok(maxExtension>.02,'physical thrust actually extended the shaft');
});

test('UV1 y color RGBA siguen la misma partición que cada vértice, y el equipo no pierde sus juegos UV',async()=>{
  const a=await load('characters/water-mannequin/v2/water-mannequin.glb');
  for(const p of a.primitives){
    const n=p.positions.length/3;p.uv=new Float32Array(n*2);p.uv1=new Float32Array(n*2);p.colors=new Float32Array(n*4);
    for(let v=0;v<n;v++){p.uv[v*2]=v;p.uv[v*2+1]=.5;p.uv1[v*2]=v*.25;p.uv1[v*2+1]=.75;p.colors.set([v*.125,.2,.3,.4],v*4);}
  }
  const c=prepareCharacter(a);for(const p of c.parts)for(let v=0;v<p.positions.length/3;v++){
    const sourceVertex=p.uv[v*2];assert.equal(p.uv1[v*2],sourceVertex*.25);assert.equal(p.uv1[v*2+1],.75);
    assert.equal(p.colors[v*4],sourceVertex*.125);assert.equal(p.colors[v*4+3],Math.fround(.4));
  }
  const e=await load('equipment/workshop/sword.glb');for(const p of e.primitives)p.colors=new Float32Array(p.positions.length/3*4).fill(.5);
  const prepared=prepareEquipment(e,'sword');for(let i=0;i<e.primitives.length;i++){
    assert.deepEqual(prepared.parts[i].uv,e.primitives[i].uv);assert.deepEqual(prepared.parts[i].uv1,e.primitives[i].uv1);assert.deepEqual(prepared.parts[i].colors,e.primitives[i].colors);
  }
});

test('La inverseBindMatrix ya contiene la relación mesh-node: no se aplica su traslación dos veces',()=>{
  const matrix=(x=0,y=0,z=0)=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]);
  const names=['pelvis','upper_arm.R','upper_arm.L','Socket_MainHand','Socket_SecondaryHand','head','chest'];
  const translations=[[0,.98,0],[.275,1.68,0],[-.275,1.68,0],[1.2,1.66,.2],[-1.03,1.71,.02],[.08,1.88,0],[0,1.39,0]];
  const asset={nodes:names.map((name,i)=>({name,worldMatrix:matrix(...translations[i])})),skins:[{joints:[6],inverseBindMatrices:matrix(5,-1.39,0)}],primitives:[{
    nodeName:'WD_Timber',nodeIndex:7,skinIndex:0,worldMatrix:matrix(5,0,0),material:0,positions:new Float32Array([.2,.3,.4,.5,.3,.4,.2,.6,.4]),
    normals:new Float32Array([0,0,1,0,0,1,0,0,1]),uv:new Float32Array([0,0,1,0,0,1]),indices:new Uint32Array([0,1,2]),
    joints:new Uint16Array(12),weights:new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0])
  }]};
  const c=prepareCharacter(asset);near(Array.from(c.parts[0].positions.subarray(0,3)),[5.2,.3-1.39,.4]);
  near(transform(asset.nodes[6].worldMatrix,c.parts[0].positions.subarray(0,3)),[5.2,.3,.4]);
});

test('El pecho y la placa del jefe presentan su frente +Z en ambos lados sin reflejarse ni mover la cadera',async()=>{
  const normal=await character(),boss=prepareCharacter(await load('characters/water-mannequin/v2/water-mannequin-boss.glb'));
  const game=new DuelEngine();game.setDifficulty('boss');
  for(const f of game.fighters){
    const c=f.boss?boss:normal,matrices=characterTransforms(c,f);
    const chest=c.bones.get('chest'),sourceWorld=chest.worldMatrix;
    // A source-world XY triangle has its front in +Z. Convert that triangle
    // through the authored chest rotation, then inspect its transformed face.
    const localX=[sourceWorld[0],sourceWorld[4],sourceWorld[8]],localY=[sourceWorld[1],sourceWorld[5],sourceWorld[9]];
    const indices=c.parts.map((p,i)=>p.boneName==='chest'?i:-1).filter(i=>i>=0);assert.ok(indices.length>0);
    for(const i of indices){
      const m=matrices[i],a=transform(m,[0,0,0]),b=transform(m,localX),d=transform(m,localY);
      const u=b.map((v,k)=>v-a[k]),v=d.map((value,k)=>value-a[k]);const frontZ=u[0]*v[1]-u[1]*v[0];
      assert.ok(frontZ>0,`${f.slot}: chest front must face +Z`);assert.ok(determinant(m)>0);
      near(transform(m,c.parts[i].anchorStart),xyz(f.pose.hip));
    }
    // Exchanging symmetric torso ports must not change the arms' authoritative
    // attachment points, nor turn a main-arm mesh into an off-arm mesh.
    for(const [bone,target] of [['upper_arm.R','mainShoulder'],['upper_arm.L','offShoulder']]){
      const i=c.parts.findIndex(p=>p.boneName===bone);near(transform(matrices[i],c.parts[i].anchorStart),xyz(f.pose[target]));
    }
  }
});

function minimumFootY(c,matrices,suffix){
  let minimum=Infinity;
  for(let i=0;i<c.parts.length;i++)if(c.parts[i].boneName===`foot.${suffix}`){
    const p=c.parts[i];for(let v=0;v<p.positions.length;v+=3)minimum=Math.min(minimum,transform(matrices[i],p.positions.subarray(v,v+3))[1]);
  }
  return minimum;
}

test('Las suelas v2 descansan sobre TABLE_TOP en ambos lados y variantes, sin hueco de 0.075 ni tobillo separado',async()=>{
  const boss=prepareCharacter(await load('characters/water-mannequin/v2/water-mannequin-boss.glb'));
  for(const c of [await character(),boss]){
    const game=new DuelEngine();if(c===boss)game.setDifficulty('boss');
    for(const f of game.fighters){
      const matrices=characterTransforms(c,f);
      for(const suffix of ['R','L']){
        const minimum=minimumFootY(c,matrices,suffix);assert.ok(Math.abs(minimum-TABLE_TOP)<3e-5,`${suffix} dir${f.dir}: sole ${minimum}, table ${TABLE_TOP}`);
        const si=c.parts.findIndex(p=>p.boneName===`shin.${suffix}`),fi=c.parts.findIndex(p=>p.boneName===`foot.${suffix}`);
        near(transform(matrices[si],c.parts[si].anchorEnd),transform(matrices[fi],[0,0,0]));
      }
    }
  }
});

test('El retarget de suela conserva la elevación real de un paso del rig y la unión espinilla-pie',async()=>{
  const c=await character(),game=new DuelEngine();game.setMode('versus');game.start();for(let i=0;i<81;i++)game.update(.04);
  game.setControl(1,{lean:1});let highest=0;
  for(let step=0;step<90;step++){
    game.update(1/120);const f=game.fighters[0],matrices=characterTransforms(c,f);
    for(const [suffix,foot] of [['R','footF'],['L','footB']]){
      const height=f.pose[foot].y-(TABLE_TOP+.075);highest=Math.max(highest,height);
      near([minimumFootY(c,matrices,suffix)],[TABLE_TOP+height],3e-5);
      const si=c.parts.findIndex(p=>p.boneName===`shin.${suffix}`),fi=c.parts.findIndex(p=>p.boneName===`foot.${suffix}`);
      near(transform(matrices[si],c.parts[si].anchorEnd),transform(matrices[fi],[0,0,0]));
    }
  }
  assert.ok(highest>.03,'the physical foot really rose during a commanded gait');
});
