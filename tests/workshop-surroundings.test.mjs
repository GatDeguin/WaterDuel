import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateWorkshopSurroundings,completeWorkshopLighting} from '../public/rendering/workshop-surroundings.js';
import {prepareWorkshopLights} from '../public/rendering/workshop-lights.js';
const contract=JSON.parse(await readFile(new URL('../public/assets/environment/workshop/asset-contract-v3.json',import.meta.url),'utf8'));
const frames=JSON.parse(await readFile(new URL('../public/assets/environment/workshop/light-directions.json',import.meta.url),'utf8'));
const extension=()=>({schemaVersion:1,stable:true,cameraInterior:{min:[-10.5,.7745,2.4],max:[10.5,6.9,14.3]},lighting:{hints:[-1,1].map(side=>({name:`360 room lamp ${side}`,type:'POINT',position:[side*10,4,12],scaledWatts:100,colorLinear:[1,.6,.3]}))},lightDirections:{lights:[-1,1].map(side=>({name:`360 room lamp ${side}`,type:'POINT',position:[side*10,4,12],radiusRuntime:.15}))}});

test('room lighting preserves every original emitter and uses only the two available slots',()=>{
  const extra=extension(),before=JSON.stringify({contract,frames,extra}),merged=completeWorkshopLighting(contract,frames,extra);
  for(const arena of ['atelier','midnight','dojo']){
    const original=prepareWorkshopLights(contract,arena,frames),completed=prepareWorkshopLights(merged.contract,arena,merged.frames);
    assert.equal(completed.count,24);assert.deepEqual(completed.names.slice(0,22),original.names);
    for(const field of ['positions','colors','directions'])assert.deepEqual(completed[field].slice(0,88),original[field].slice(0,88));
  }
  assert.equal(JSON.stringify({contract,frames,extra}),before);
});

test('an unverified room, invalid interior, excess fixtures or mismatched light positions cannot silently load',()=>{
  for(const edit of [s=>s.stable=false,s=>s.schemaVersion=9,s=>s.cameraInterior.max[0]=s.cameraInterior.min[0],s=>s.cameraInterior.min[1]=NaN]){const s=extension();edit(s);assert.throws(()=>validateWorkshopSurroundings(s));}
  const excess=extension();excess.lighting.hints.push(excess.lighting.hints[0]);excess.lightDirections.lights.push(excess.lightDirections.lights[0]);assert.throws(()=>completeWorkshopLighting(contract,frames,excess));
  const misplaced=extension();misplaced.lightDirections.lights[0].position[0]+=1;const merged=completeWorkshopLighting(contract,frames,misplaced);assert.throws(()=>prepareWorkshopLights(merged.contract,'atelier',merged.frames));
});
