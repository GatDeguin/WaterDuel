import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AXE_REFERENCE_PINS,applyAxeFacingReference} from './fixtures/axe-facing-reference-layer.mjs';
const paths={gpu:'../audit/articulated-rig-gpu-burst-before.js',passive:'../audit/articulated-rig-passive-spikes-before.js',goal:'./fixtures/articulated-rig-pre-goal-y-only-1.7.4.js.txt'};
test('the equipment correction layer pins original reference bytes and changes only the import and two head centers',async()=>{
  for(const[id,path]of Object.entries(paths)){
    const original=await fs.readFile(new URL(path,import.meta.url),'utf8');
    assert.equal(createHash('sha256').update(original).digest('hex'),AXE_REFERENCE_PINS[id]);
    const patched=applyAxeFacingReference(original,id);
    const oldImport="import {normalizeLoadout,getWeapon,getDefense} from '../equipment.js';",newImport="import {normalizeLoadout,getWeapon,getDefense,equipmentAcrossSign} from '../equipment.js';";
    const newline=original.includes('\r\n')?'\r\n':'\n',added='      const across=weapon.headAcross*equipmentAcrossSign(weapon.id,this.dir);'+newline;
    assert.equal(patched.split(added).length-1,2);assert.equal(patched.split(newImport).length-1,1);
    const restored=patched.replace(newImport,oldImport).split(added).join('').replaceAll('p.tip.x+uy*across,y:p.tip.y-ux*across','p.tip.x+uy*weapon.headAcross,y:p.tip.y-ux*weapon.headAcross');
    assert.equal(restored,original,'all other reference bytes, including every solver equation, stay identical');
    assert.throws(()=>applyAxeFacingReference(original+' ',id),/SHA/);
    assert.throws(()=>applyAxeFacingReference(patched,id),/SHA/,'the layer cannot be applied twice');
  }
});
