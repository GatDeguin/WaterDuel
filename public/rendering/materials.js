// Linear-light material parameters shared by the shader and inspection tools.
// Metal colors come from the object palette; dielectric F0 comes from its IOR.
export const MATERIALS=Object.freeze([
  {name:'Roble aceitado',roughness:.36,metallic:0,ior:1.48,coat:.26},
  {name:'Latón mecanizado',roughness:.28,metallic:1,ior:1.5,coat:0},
  {name:'Membrana de látex',roughness:.13,metallic:0,ior:1.50,coat:0},
  {name:'Gota de agua',roughness:.045,metallic:0,ior:1.333,coat:0},
  {name:'Lino tejido',roughness:.91,metallic:0,ior:1.45,coat:0},
  {name:'Sombra de contacto',roughness:1,metallic:0,ior:1.5,coat:0},
  {name:'Emisión',roughness:1,metallic:0,ior:1.5,coat:0},
  {name:'Cuero curtido',roughness:.69,metallic:0,ior:1.47,coat:.04},
  {name:'Revoco mineral',roughness:.93,metallic:0,ior:1.5,coat:0},
  {name:'Agua liberada',roughness:.045,metallic:0,ior:1.333,coat:0},
  {name:'Látex desgarrado',roughness:.13,metallic:0,ior:1.50,coat:0},
  {name:'Vidrio de ventana',roughness:.07,metallic:0,ior:1.52,coat:0},
  {name:'Tablas barnizadas',roughness:.35,metallic:0,ior:1.48,coat:.72},
  {name:'Agua contenida',roughness:.045,metallic:0,ior:1.333,coat:0},
  {name:'Superficie libre',roughness:.027,metallic:0,ior:1.333,coat:0},
  {name:'Menisco',roughness:.025,metallic:0,ior:1.333,coat:0},
  {name:'Acero pulido',roughness:.17,metallic:1,ior:1.5,coat:0},
  {name:'Acero pavonado',roughness:.39,metallic:1,ior:1.5,coat:0},
  {name:'Bronce patinado',roughness:.48,metallic:.86,ior:1.5,coat:0},
  {name:'Película húmeda y ondas',roughness:.045,metallic:0,ior:1.333,coat:0},
].map(Object.freeze));
export function dielectricF0(ior){return ((ior-1)/(ior+1))**2;}
export function beerLambert(absorption,distance){return absorption.map(a=>Math.exp(-Math.max(0,a)*Math.max(0,distance)));}

// The textured assets already carry oriented grain, machining and weave maps.
// Calibrate those authored layers once at upload instead of painting another
// noisy procedural surface over every material. Keep colors, metallic F0 and
// all map/UV references intact; optical materials use their own model.
const finishedMaterials=new WeakSet();
const finishProfiles=Object.freeze({
  wood:{rough:.95,normal:.88,coat:.16,coatRough:.28},
  endgrain:{rough:1,normal:.9,coat:0,coatRough:0},
  brass:{rough:.94,normal:.84,coat:0,coatRough:0},
  patina:{rough:1,normal:.9,coat:0,coatRough:0},
  steel:{rough:.94,normal:.84,coat:0,coatRough:0},
  recessed:{rough:1,normal:.9,coat:0,coatRough:0},
  cloth:{rough:1,normal:.85,coat:0,coatRough:0},
  leather:{rough:1,normal:.9,coat:.025,coatRough:.42},
});
function finishFamily(name){
  if(/(?:^|[_ -])(?:latex|glass|window|lamp|water)(?:[_ -]|$)/.test(name))return null;
  if(/endgrain/.test(name))return 'endgrain';
  if(/wood|beech|walnut|oak/.test(name))return 'wood';
  if(/brass|bronze/.test(name))return /patina|tarnish|dark/.test(name)?'patina':'brass';
  if(/steel|iron/.test(name))return /recessed|blackened|dark|pavonado/.test(name)?'recessed':'steel';
  if(/canvas|woven|sash|linen|cloth/.test(name))return 'cloth';
  if(/leather|cuero/.test(name))return 'leather';
  return null;
}
/** Accepts the normalized AssetGPU material record, not a raw glTF material.
 * Returns the same object for unsupported/optical inputs and already finished
 * records. The copy is CPU-only and remains independent of wetness and wear. */
export function applyWorkshopFinish(material){
  if(!material||typeof material!=='object'||Array.isArray(material)||finishedMaterials.has(material)||typeof material.name!=='string')return material;
  if(material.transmission!==undefined&&(!Number.isFinite(material.transmission)||material.transmission>0))return material;
  if(material.emissiveFactor!=null){
    const emission=material.emissiveFactor;
    if((!Array.isArray(emission)&&!ArrayBuffer.isView(emission))||emission.length!==3||!Array.from(emission).every(Number.isFinite)||emission.some(value=>value>0))return material;
  }
  const profile=finishProfiles[finishFamily(material.name.toLowerCase())];if(!profile)return material;
  if(!['roughnessFactor','metallicFactor','ior','coat','coatRoughness'].every(key=>Number.isFinite(material[key])))return material;
  if(material.normalTexture&&(typeof material.normalTexture!=='object'||Array.isArray(material.normalTexture)||!Number.isFinite(material.normalTexture.scale??1)))return material;
  const out={...material,roughnessFactor:Math.min(1,Math.max(0,material.roughnessFactor*profile.rough)),
    coat:Math.min(1,Math.max(profile.coat,material.coat)),coatRoughness:Math.min(1,Math.max(profile.coatRough,material.coatRoughness))};
  if(material.normalTexture)out.normalTexture={...material.normalTexture,scale:(material.normalTexture.scale??1)*profile.normal};
  finishedMaterials.add(out);return out;
}
const scalar=n=>Number(n).toFixed(5);
export const MATERIAL_GLSL=`
const int MATERIAL_COUNT=${MATERIALS.length};
const vec4 MATERIAL_PARAMS[${MATERIALS.length}]=vec4[](
${MATERIALS.map(m=>`vec4(${[m.roughness,m.metallic,m.ior,m.coat].map(scalar).join(',')})`).join(',\n')});
`;
