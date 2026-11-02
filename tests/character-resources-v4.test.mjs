import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter} from '../public/rendering/asset-rig.js';
import {characterResources} from '../public/rendering/character-resources.js';
test('El personaje carga solo mapas de piezas visibles sin alterar material ni parser original',async()=>{
  const bytes=await readFile(new URL('../public/assets/characters/water-mannequin/v4/water-mannequin.glb',import.meta.url));
  const asset=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),prepared=prepareCharacter(asset);
  const before=structuredClone(asset.materials),gpu=characterResources(asset,prepared.parts);
  assert.equal(gpu.textures.length,3);assert.equal(gpu.images.length,3);assert.equal(gpu.primitives,prepared.parts);
  assert.deepEqual(asset.materials,before);assert.equal(asset.images.length,9);
  const slots=['baseColorTexture','normalTexture','metallicRoughnessTexture','occlusionTexture'];
  for(const part of prepared.parts)for(const slot of slots){
    const a=asset.materials[part.material][slot],b=gpu.materials[part.material][slot];if(!a)continue;
    assert.deepEqual(gpu.images[gpu.textures[b.index].source].bytes,asset.images[asset.textures[a.index].source].bytes);
    assert.equal(b.texCoord,a.texCoord);
  }
});
test('Slot de emisión/sheen conserva semántica y materiales sin mapas no inventan recursos',()=>{
  const asset={materials:[{baseColorFactor:[1,1,1,1]},{normalTexture:{index:2},sheenColorTexture:{index:0,texCoord:1}}],
    images:[{bytes:0},{bytes:1},{bytes:2}],textures:[{source:0},{source:1},{source:2}]};
  const gpu=characterResources(asset,[{material:1}]);assert.equal(gpu.textures.length,2);assert.equal(gpu.materials[1].normalTexture.index,1);
  assert.deepEqual(gpu.materials[1].sheenColorTexture,{index:0,texCoord:1});assert.deepEqual(gpu.materials[0],asset.materials[0]);
});
test('El GLB conserva tinte de tela y sheen de v3 además de los UV1 nuevos',async()=>{
  for(const name of ['water-mannequin','water-mannequin-amber','water-mannequin-boss']){
    const read=async version=>{const b=await readFile(new URL(`../public/assets/characters/water-mannequin/v${version}/${name}.glb`,import.meta.url));return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());};
    const a=await read(3),b=await read(4),old=a.materials.find(m=>/Woven/.test(m.name)),next=b.materials.find(m=>m.name===old.name);
    assert.deepEqual(next.pbrMetallicRoughness.baseColorFactor,old.pbrMetallicRoughness.baseColorFactor);
    assert.deepEqual(next.extensions.KHR_materials_sheen,old.extensions.KHR_materials_sheen);
    assert.equal(next.pbrMetallicRoughness.baseColorTexture.texCoord,1);
  }
});
