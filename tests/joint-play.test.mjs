import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';

const api=await import('../public/physics/joint-play.js').catch(()=>null);
test('La holgura deja intacta una articulación sana y aumenta de forma continua con daño',()=>{
  assert.ok(api,'falta la holgura física progresiva');
  assert.equal(api.jointPlayAngle(0),0);
  assert.ok(api.jointPlayAngle(.3)>0);
  assert.ok(api.jointPlayAngle(.85)>api.jointPlayAngle(.3));
  assert.ok(api.jointPlayAngle(.85)<.15);
  assert.equal(api.jointPlayAngle(NaN),0);
});
test('Una articulación dañada tiene zona libre sin inventar desplazamiento, velocidad ni energía',()=>{
  assert.ok(api,'falta la holgura física progresiva');
  const r=new ArticulatedRig({gravity:0});r.damageJoint('mainElbow',.7);
  const q=r.q.slice(),v=r.velocity.slice(),play=api.jointPlayAngle(.7);
  r.target[5]=r.q[5]+play*.5;api.applyJointPlay(r);
  assert.equal(r.target[5],r.q[5],'dentro de la holgura el motor no aprieta');
  assert.deepEqual(r.q,q);assert.deepEqual(r.velocity,v);
  r.target[5]=r.q[5]+.4;api.applyJointPlay(r);
  assert.ok(Math.abs(r.target[5]-(r.q[5]+.4-play))<1e-12,'fuera de ella el motor recupera autoridad desde el borde');
});
test('La holgura es simétrica y no vuelve a accionar coordenadas separadas o pasivas',()=>{
  assert.ok(api,'falta la holgura física progresiva');
  const r=new ArticulatedRig({gravity:0});r.damageJoint('wrist',.6);
  const d=api.jointPlayAngle(.6),origin=r.q[13];
  r.target[13]=origin-.3;api.applyJointPlay(r);assert.ok(Math.abs(r.target[13]-(origin-.3+d))<1e-12);
  r.damageJoint('wrist',.4);r.target[13]=.2;api.applyJointPlay(r);assert.equal(r.target[13],.2);
  r.passive=true;r.target[5]=.8;api.applyJointPlay(r);assert.equal(r.target[5],.8);
});
