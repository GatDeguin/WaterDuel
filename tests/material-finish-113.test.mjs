import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as materials from '../public/rendering/materials.js';

const finish=value=>{assert.equal(typeof materials.applyWorkshopFinish,'function','a load-time finish must exist for the actual textured assets');return materials.applyWorkshopFinish(value);};
const authored=(name,extra={})=>({name,roughnessFactor:.7,metallicFactor:0,ior:1.48,coat:0,coatRoughness:.1,transmission:0,
  normalTexture:{index:2,texCoord:1,scale:.45},baseColorFactor:[.3,.2,.1,1],...extra});

test('wood finish separates a satin varnish layer from open end grain without repainting the texture',()=>{
  const wood=authored('Beech_Wood_Grain'),end=authored('Endgrain_Joints');
  const finished=finish(wood),cut=finish(end);
  assert.ok(finished.coat>=.1&&finished.coat<=.25);
  assert.ok(finished.coatRoughness>=.2&&finished.coatRoughness<=.4);
  assert.equal(cut.coat,0,'open end grain never receives a varnish invented by the finish');
  assert.equal(finished.baseColorFactor,wood.baseColorFactor);
  assert.equal(finished.metallicFactor,wood.metallicFactor);
  assert.ok(finished.normalTexture.scale<wood.normalTexture.scale&&finished.normalTexture.scale>wood.normalTexture.scale*.75);
});

test('polished steel, brass and recessed metal retain their authored F0/color and distinct roughness',()=>{
  const steel=authored('WD_steel',{roughnessFactor:.32,metallicFactor:.94}),brass=authored('Satin_Brass',{roughnessFactor:.46,metallicFactor:1});
  const dark=authored('Recessed_Steel',{roughnessFactor:.5,metallicFactor:.8});
  const polished=finish(steel),warm=finish(brass),recessed=finish(dark);
  assert.ok(polished.roughnessFactor<steel.roughnessFactor);
  assert.ok(warm.roughnessFactor< brass.roughnessFactor);
  assert.equal(recessed.roughnessFactor,dark.roughnessFactor,'recesses keep their authored broader highlight');
  for(const [a,b]of [[steel,polished],[brass,warm],[dark,recessed]]){
    assert.equal(b.metallicFactor,a.metallicFactor);assert.equal(b.ior,a.ior);assert.equal(b.baseColorFactor,a.baseColorFactor);assert.equal(b.coat,0);
  }
});

test('textile microdetail is restrained while weave maps, sheen and UVs stay authored',()=>{
  const weave=Object.freeze({index:4,texCoord:1}),color=Object.freeze([.025,.12,.1]);
  const textile=authored('Mint_Woven_Sash',{metallicRoughnessTexture:weave,sheenColor:color,sheenRoughness:.82,sheenColorTexture:weave});
  const result=finish(textile);
  assert.equal(result.roughnessFactor,textile.roughnessFactor);assert.equal(result.coat,0);
  assert.equal(result.sheenColor,color);assert.equal(result.sheenRoughness,.82);assert.equal(result.sheenColorTexture,weave);
  assert.equal(result.metallicRoughnessTexture,weave);assert.equal(result.normalTexture.index,2);assert.equal(result.normalTexture.texCoord,1);
  assert.ok(result.normalTexture.scale<textile.normalTexture.scale);
});

test('finish is nonmutating and idempotent, preserves all map references and adds no GPU resources',()=>{
  const maps=Object.freeze({index:3,texCoord:1,extensions:Object.freeze({custom:'kept'})});
  const source=Object.freeze(authored('Workshop v2 PBR | walnut-smoke-and-worn-varnish',{
    normalTexture:Object.freeze({index:2,texCoord:1,scale:.4}),baseColorTexture:maps,metallicRoughnessTexture:maps,occlusionTexture:maps,
    emissiveTexture:maps,sheenColorTexture:maps,sheenRoughnessTexture:maps,extras:Object.freeze({proof:'authored'})}));
  const snapshot=JSON.stringify(source),first=finish(source),second=finish(first);
  assert.equal(second,first);assert.equal(JSON.stringify(source),snapshot);
  for(const key of ['baseColorTexture','metallicRoughnessTexture','occlusionTexture','emissiveTexture','sheenColorTexture','sheenRoughnessTexture','extras'])assert.equal(first[key],source[key]);
  assert.deepEqual(Object.keys(first).sort(),Object.keys(source).sort(),'only existing scalar properties are calibrated');
});

test('optical, emissive, unknown and nonfinite input never acquires an opaque finish',()=>{
  const inputs=[null,undefined,42,{},authored('Unknown finish'),authored('Mint_Latex_Transmission',{transmission:.97}),
    authored('Water_IOR_1.333',{transmission:1}),authored('Workshop v2 PBR | lamp-warm-tungsten-filament',{emissiveFactor:[1,.7,.3]}),
    authored('Beech_Wood_Grain',{roughnessFactor:NaN}),authored('WD_brass',{metallicFactor:Infinity}),
    authored('WD_steel',{normalTexture:{index:2,scale:NaN}}),authored('WD_steel',{emissiveFactor:42}),
    authored('Beech_Wood_Grain',{emissiveFactor:[0,NaN,0]}),authored('WD_leather',{normalTexture:'invalid'}),
    authored('Satin_Brass',{transmission:NaN})];
  for(const input of inputs)assert.equal(finish(input),input);
  for(const id of [2,3,9,10,13,14,15])assert.equal(materials.MATERIALS[id].metallic,0);
});

function glbMaterials(relative){const bytes=readFileSync(new URL(relative,import.meta.url));return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()).materials;}
test('published mannequin and 360 workshop names reach their intended material family without guessing from color',()=>{
  const actual=glbMaterials('../public/assets/characters/water-mannequin/v3/water-mannequin.glb');
  const room=glbMaterials('../public/assets/environment/workshop/workshop-360.glb');
  for(const name of ['Beech_Wood_Grain','Endgrain_Joints','Satin_Brass','Mint_Woven_Sash','Wrapped_Brown_Leather','Polished_Rapier_Steel']){
    assert.ok(actual.some(m=>m.name===name),name+' is a real authored material');
    const input=authored(name);assert.notEqual(finish(input),input);
  }
  for(const name of ['walnut-smoke-and-worn-varnish','oak-aged-endgrain-and-open-pores','canvas-waterduel-deep-forest','brass-tarnish-patina-polished-edges','steel-satin-machined-surface']){
    const raw=room.find(m=>m.name.endsWith(name));assert.ok(raw,name+' is present in the complete room');
    const input=authored(raw.name);assert.notEqual(finish(input),input);
  }
});

test('bounded authored parameters stay finite and in range across every finish',()=>{
  for(const name of ['Beech_Wood_Grain','Satin_Brass','WD_steel','Recessed_Steel','Mint_Woven_Sash','WD_leather']){
    for(const value of [0,.01,.2,.7,1]){
      const input=authored(name,{roughnessFactor:value,coat:value,coatRoughness:value});const out=finish(input);
      for(const field of ['roughnessFactor','coat','coatRoughness'])assert.ok(Number.isFinite(out[field])&&out[field]>=0&&out[field]<=1);
      assert.equal(out.metallicFactor,input.metallicFactor);assert.equal(out.ior,input.ior);
    }
  }
});
