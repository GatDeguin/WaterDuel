import test from 'node:test';
import assert from 'node:assert/strict';
import {jointDamageTraces} from '../public/rendering/joint-damage.js';
import {drawJointDamageWear} from '../public/rendering/combat-wear.js';
import {DuelEngine} from '../public/engine.js';
import {readFile} from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
const I=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const fixture=damage=>{
  const pose={mainElbow:{x:0,y:0,z:0},mainHand:{x:0,y:.5,z:0},joints:{mainElbow:{damage,detached:false}},detached:[]};
  const part={boneName:'forearm.R',material:0,positions:new Float32Array([-.2,-.1,.2,.2,-.1,.2,0,.8,.2]),indices:new Uint32Array([0,1,2])};
  return {fighter:{pose},geometry:{prepared:{parts:[part],asset:{materials:[{pbrMetallicRoughness:{metallicFactor:0}}]}},matrices:[I()]}};
};
test('Lectura por etapas del daño real y sin trazas de una unión desprendida',()=>{
  assert.equal(jointDamageTraces(fixture(0).fighter.pose).length,0);
  const a=jointDamageTraces(fixture(.2).fighter.pose),b=jointDamageTraces(fixture(.6).fighter.pose),c=jointDamageTraces(fixture(.9).fighter.pose);
  assert.equal(a.length,1);assert.equal(b.length,2);assert.equal(c.length,2);
  assert.ok(a[0].length<b[0].length&&b[0].width<c[0].width);
  const f=fixture(.9).fighter;f.pose.joints.mainElbow.detached=true;assert.equal(jointDamageTraces(f.pose).length,0);
});
test('Las grietas se proyectan sobre triángulos reales y siguen su hueso sin rayas Z flotantes',()=>{
  const {fighter,geometry}=fixture(.9),draws=[],owner={};
  const renderer={dynamicDraw:(...v)=>draws.push(v)};
  const before=structuredClone(fighter.pose),a=drawJointDamageWear(renderer,fighter,{geometry,owner});
  assert.ok(a.marks>0);assert.equal(draws.length,1);
  for(let i=2;i<draws[0][0].p.length;i+=3)assert.ok(Math.abs(draws[0][0].p[i]-.20012)<1e-6);
  const initial=draws[0][0].p.slice();geometry.matrices[0][12]=1;draws.length=0;
  drawJointDamageWear(renderer,fighter,{geometry,owner});assert.equal(draws.length,1);
  assert.ok(Math.abs(draws[0][0].p[0]-initial[0]-1)<1e-6);assert.deepEqual(fighter.pose,before);
});
test('Sin geometría/intersección/daño o en profundidad no se inventa una grieta',()=>{
  const {fighter,geometry}=fixture(.9),draws=[],r={dynamicDraw:(...a)=>draws.push(a)};
  drawJointDamageWear(r,fighter,{geometry,depthOnly:true});assert.equal(draws.length,0);
  geometry.prepared.parts[0].positions.fill(9);drawJointDamageWear(r,fighter,{geometry,owner:{}});assert.equal(draws.length,0);
  assert.equal(drawJointDamageWear(r,fighter,{geometry:null}).marks,0);
});
test('Lectura de daño en GLB real no duplica la grasa existente de una pose sana',async()=>{
  const b=await readFile(new URL('../public/assets/characters/water-mannequin/v4/water-mannequin.glb',import.meta.url));
  const prepared=prepareCharacter(parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))),f=new DuelEngine().fighters[0];
  const geometry={prepared,matrices:characterTransforms(prepared,f)},draws=[];
  const result=drawJointDamageWear({dynamicDraw:(...a)=>draws.push(a)},f,{geometry});
  assert.deepEqual(result,{marks:0,grease:0,draws:0});assert.equal(draws.length,0);
  f.pose.joints={mainElbow:{damage:.9,detached:false}};const damaged=drawJointDamageWear({dynamicDraw:(...a)=>draws.push(a)},f,{geometry});
  assert.equal(damaged.grease,0);assert.ok(damaged.marks>0);
});
test('Muñeca marca su palma real en ambos sentidos y no busca madera a lo largo de la hoja',async()=>{
  const b=await readFile(new URL('../public/assets/characters/water-mannequin/v4/water-mannequin.glb',import.meta.url));
  const prepared=prepareCharacter(parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));
  for(const f of new DuelEngine().fighters){
    f.pose.joints={wrist:{damage:.9,detached:false}};
    const result=drawJointDamageWear({dynamicDraw:()=>{}},f,{geometry:{prepared,matrices:characterTransforms(prepared,f)}});
    assert.equal(result.marks,2,`palma J${f.slot}`);assert.equal(result.grease,0);
  }
});
