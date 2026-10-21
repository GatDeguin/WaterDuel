import {balloonPalette,normalizeBalloonColor} from '../opponent-loadouts.js';

// Material choices are cached outside the live model: source GLB factors,
// texture bindings and shared GPU materials remain immutable between fighters.
const materialColors=new WeakMap();
const eligible=f=>f?.slot===2&&f.matchApronToBalloon===true;
const clothNames=new Set(['Mint_Woven_Sash','Boss_Burgundy_Woven_Cloth']);

/** Only the dyed fabric receives the color. Attached brass heraldry, trim and
 * buckles share the physical apron hinge, but retain their authored material. */
export function apronMaterialOverride(fighter,part,material){
  if(!eligible(fighter)||part?.accessory!=='apron'||part.boneName!=='pelvis'||!clothNames.has(material?.name)||!/Woven_(?:Sash|Cloth)$/.test(part.nodeName))return undefined;
  const base=material.baseColorFactor??material.pbrMetallicRoughness?.baseColorFactor;
  if(!(base?.length>=3)||!base.slice(0,3).every(v=>Number.isFinite(v)&&v>1e-8))return undefined;
  let colors=materialColors.get(material);if(!colors){colors=new Map();materialColors.set(material,colors);}
  const key=normalizeBalloonColor(fighter.balloonColor,fighter.slot);
  if(colors.has(key))return colors.get(key);
  const swatch=balloonPalette(fighter).balloon,linear=[swatch>>16&255,swatch>>8&255,swatch&255].map(v=>(v/255)**2.2);
  // Same hue as the balloon; dyed opaque cloth has a darker diffuse albedo.
  // The gamma matches the existing procedural balloon shader's palette input.
  const tint=Object.freeze(linear.map((v,i)=>.45*v/base[i]));
  const sourceSheen=material.sheenColor??material.extensions?.KHR_materials_sheen?.sheenColorFactor??[0,0,0];
  const sheenPeak=Math.max(0,...sourceSheen),peak=Math.max(...linear);
  const sheenColor=Object.freeze(linear.map(v=>sheenPeak*v/peak));
  const result=Object.freeze({tint,sheenColor});colors.set(key,result);return result;
}

export function apronProceduralColor(fighter,authoredColor){return eligible(fighter)?balloonPalette(fighter).balloon:authoredColor;}
