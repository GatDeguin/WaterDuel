import test from 'node:test';
import assert from 'node:assert/strict';
import {parryContact} from '../public/engine.js';
import {DEFENSES} from '../public/equipment.js';

const pose=z=>({offHand:{x:0,y:0,z},shieldRadius:.30,shieldRadiusX:.30,shieldRadiusY:.30});
const sweep=z=>[{x:-.5,y:0,z},{x:.5,y:0,z}];
test('El broquel detrás del acero no concede una parada por compartir XY',()=>{
  assert.equal(parryContact(...sweep(.17),pose(-.08),DEFENSES.short),null);
  assert.ok(parryContact(...sweep(.17),pose(.10),DEFENSES.short));
});
test('El contacto entra al sólido en el mayor de los tiempos XY y Z',()=>{
  const p=pose(.10),a={x:-.4,y:0,z:0},b={x:.4,y:0,z:.3};
  const hit=parryContact(a,b,p,DEFENSES.short);
  assert.ok(hit);assert.ok(Math.abs(hit.t-.45)<1e-12);
  assert.ok(Math.abs(hit.point.z-.135)<1e-12);
  assert.equal(parryContact({x:-.4,y:0,z:0},{x:.4,y:0,z:.1},p,DEFENSES.short),null);
});
test('La daga sólo para cuando el acero atraviesa su plano físico inclinado',()=>{
  const p={offHand:{x:0,y:-.2,z:.10},defenseTip:{x:0,y:.22,z:.17}};
  assert.equal(parryContact(...sweep(.45),p,DEFENSES.knife),null);
  assert.ok(parryContact(...sweep(.13333333333),p,DEFENSES.knife));
});
