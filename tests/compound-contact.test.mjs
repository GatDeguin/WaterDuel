import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {resolveWeaponBind,weaponBindManifold} from '../public/physics/weapon-bind.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

test('La captura profunda original se resuelve aislada aunque ready ya prepare contactos de acero',async()=>{
  const bytes=await fs.readFile(new URL('../audit/weapon-bind-contact-fixture.json',import.meta.url));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'78b028557aae816a24098e96362ab87b4d6779363be4d0e9b8a2d4852be7501a','el fixture profundo original no se sustituye por un inicio ya separado');
  const f=JSON.parse(bytes,(_key,value)=>value?.$typed?new globalThis[value.$typed](value.data):value);
  const [a,b]=f.rigs.map(state=>Object.assign(new ArticulatedRig(),structuredClone(state)));
  const original=[a,b].map(r=>({target:r.target.slice(),water:structuredClone(r.waterLoad),length:r.swordLength}));
  const steel=resolveWeaponBind(a,b,{dt:f.dt,project:false});assert.ok(steel.at);
  const manifold=()=>weaponBindManifold(a,b,steel);
  const result=ArticulatedRig.resolvePair(a,b,{headRadiiA:f.headRadiiA,headRadiiB:f.headRadiiB,extraContacts:manifold});
  for(const c of [...result.contacts,...manifold()])assert.ok(c.penetration<.001,`${c.keyA}/${c.keyB}: ${c.penetration}`);
  for(const [i,r]of [a,b].entries()){
    const d=r.diagnostics();assert.ok(d.contacts.every(c=>c.error<.0002));
    assert.ok(d.minimumWeaponY>=TABLE_TOP-1e-5);
    assert.ok(d.coordinates.every(c=>Number.isFinite(c.position)&&Number.isFinite(c.velocity)&&c.position>=c.min-1e-8&&c.position<=c.max+1e-8));
    assert.deepEqual(r.target,original[i].target);assert.deepEqual(r.waterLoad,original[i].water);assert.equal(r.swordLength,original[i].length);
  }
});
