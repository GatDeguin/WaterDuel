import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine} from '../public/engine.js';
import {bodyForBone} from '../public/rendering/joint-damage.js';
import {contactShadows} from '../public/rendering/contact-shadows.js';
import {proceduralFootMesh} from '../public/rendering/physical-feet.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {drawCombatWear} from '../public/rendering/combat-wear.js';
test('Ownership de pie usa cuerpo nuevo y conserva el mapeo legacy sin feet',()=>{
  assert.equal(bodyForBone('foot.R'),'frontShin');assert.equal(bodyForBone('foot.L'),'backShin');
  assert.equal(bodyForBone('foot.R',{feet:{}}),'frontFoot');assert.equal(bodyForBone('foot.L',{feet:{}}),'backFoot');
});
test('Sombra nueva usa soporte físico y no resta altura proxy histórica',()=>{
  const f={pose:{footF:{x:99,y:TABLE_TOP+.08,z:.3},feet:{front:{support:{x:.4,y:TABLE_TOP+.02,z:.2}}}}};
  const [stamp]=contactShadows(f);assert.equal(stamp.x,.4);assert.equal(stamp.z,.2);
  assert.ok(Math.abs(stamp.gap-.02)<1e-10);
});
test('Fallback de ambos pies se extruye del mismo hull físico girado y profundidad',()=>{
  const f=new DuelEngine().fighters[0];f.rig.q[14]+=.15;f.rig.q[15]-=.2;const pose=f.rig.pose();
  for(const side of ['front','back']){
    const foot=pose.feet[side],mesh=proceduralFootMesh(foot);assert.ok(mesh.p.length>0);assert.equal(mesh.p.length,mesh.n.length);
    const expected=Math.min(...foot.hull.map(p=>p.y)),actual=Math.min(...Array.from(mesh.p).filter((_,i)=>i%3===1));
    assert.ok(Math.abs(expected-actual)<1e-6);assert.ok(mesh.n.every(Number.isFinite));
    const zs=Array.from(mesh.p).filter((_,i)=>i%3===2);assert.ok(Math.abs(Math.max(...zs)-Math.min(...zs)-foot.depth)<1e-6);
  }
});
test('Marcas de pie v4 siguen el cuerpo articulado; marcas legacy siguen la espinilla',()=>{
  for(const [bone,body,feet]of [['foot.R','frontFoot',{}],['foot.L','backFoot',{}],['foot.R','frontShin',undefined]]){
    const pose={...(feet?{feet}:{}),surface:{marks:[{id:1,body,key:body,position:{x:0,y:0,z:.18},normal:{x:0,y:0,z:1},tangent:{x:1,y:0,z:0},length:.02,impulse:.1}]}};
    const f={pose},geometry={pose,prepared:{parts:[{boneName:bone,material:0,positions:new Float32Array([-.2,-.2,.2,.2,-.2,.2,0,.2,.2]),indices:new Uint32Array([0,1,2])}],asset:{materials:[{pbrMetallicRoughness:{metallicFactor:0}}]}},matrices:[[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]]};
    const r=drawCombatWear({dynamicDraw:()=>{}},f,{geometry,includeOil:false});assert.equal(r.marks,1,body);
  }
});
