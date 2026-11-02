/** The authored GLB includes an optional rapier. Its images are not GPU
 * resources of the runtime character after that geometry has been excluded. */
const slots=['baseColorTexture','normalTexture','metallicRoughnessTexture','occlusionTexture','emissiveTexture','sheenColorTexture','sheenRoughnessTexture'];
export function characterResources(asset,parts){
  const materials=asset.materials??[],textures=asset.textures??[],images=asset.images??[];
  const usedMaterials=new Set(parts.map(part=>part.material)),usedTextures=new Set();
  const infos=material=>slots.flatMap(slot=>{const info=material?.[slot]??material?.pbrMetallicRoughness?.[slot];return info?[info]:[];});
  for(const i of usedMaterials)for(const info of infos(materials[i])){
    if(!Number.isInteger(info.index)||!textures[info.index])throw Error('Textura de personaje inválida.');usedTextures.add(info.index);
  }
  const indices=[...usedTextures].sort((a,b)=>a-b),textureMap=new Map(),unique=[],bySampler=new Map();
  for(const index of indices){
    const texture=textures[index],key=JSON.stringify([texture.source,texture.sampler??null]);
    if(!bySampler.has(key)){bySampler.set(key,unique.length);unique.push(texture);}
    textureMap.set(index,bySampler.get(key));
  }
  const imageIndices=[...new Set(unique.map(texture=>texture.source))].sort((a,b)=>a-b),imageMap=new Map(imageIndices.map((index,i)=>[index,i]));
  const remap=(material,used)=>{
    const out={...material};if(material.pbrMetallicRoughness)out.pbrMetallicRoughness={...material.pbrMetallicRoughness};
    for(const source of [out,out.pbrMetallicRoughness].filter(Boolean))for(const slot of slots)if(source[slot]){
      if(used)source[slot]={...source[slot],index:textureMap.get(source[slot].index)};else delete source[slot];
    }
    return out;
  };
  return {...asset,primitives:parts,materials:materials.map((m,i)=>remap(m,usedMaterials.has(i))),
    textures:unique.map(texture=>({...texture,source:imageMap.get(texture.source)})),images:imageIndices.map(i=>images[i])};
}
