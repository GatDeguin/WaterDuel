import {prepareWorkshopLights} from './workshop-lights.js';
import {completeWorkshopLighting,validateWorkshopSurroundings} from './workshop-surroundings.js';

const ARENAS=new Set(['atelier','midnight','dojo']);
const samePosition=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===3&&b.length===3&&a.every((v,i)=>Number.isFinite(v)&&Number.isFinite(b[i])&&Math.abs(v-b[i])<=1e-5);
const label=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);
const boundedArray=(value,length,max)=>Array.isArray(value)&&value.length===length&&value.every(n=>Number.isFinite(n)&&n>=0&&n<=max);

function validateOverrides(preset){
  const overrides=preset.materialOverrides;
  if(!Array.isArray(overrides)||overrides.length!==(preset.variant==='night'?2:0))throw Error('Preset v4: cantidad de materiales incompatible.');
  const names=new Set();
  for(const entry of overrides){
    if(!label(entry?.materialName)||names.has(entry.materialName)||!boundedArray(entry.baseColorFactor,4,1)||!boundedArray(entry.emissiveFactor,3,1000))throw Error('Preset v4: override de material inválido.');
    if(entry.emissionStrength!==undefined&&(!Number.isFinite(entry.emissionStrength)||entry.emissionStrength<0||entry.emissionStrength>1000))throw Error('Preset v4: emisión de material inválida.');
    names.add(entry.materialName);
  }
}

/** Sidecars are already in runtime world coordinates and contain scaled watts.
 * Validation never reapplies the Blender coordinate transform or light scale. */
export function validateWorkshopV4Metadata(metadata){
  const {contract,frames,day,night}=metadata??{};
  if(contract?.version!==4||contract.ready!==true||contract.stable!==true||contract.asset!=='workshop-runtime-v4.glb'||contract.coordinateTransform?.appliedToGeometry!==true)throw Error('El contrato del taller v4 no está listo o no usa coordenadas runtime.');
  if(frames?.version!==4||frames.coordinateSpace!=='runtime world'||!Array.isArray(frames.lights)||frames.lights.length!==22||!Array.isArray(contract.lighting?.hints)||contract.lighting.hints.length!==22)throw Error('Direcciones de luces v4 incompatibles.');
  prepareWorkshopLights(contract,'atelier',frames);
  for(const [variant,preset]of [['day',day],['night',night]]){
    if(preset?.version!==4||preset.variant!==variant||!Array.isArray(preset.lights)||preset.lights.length!==22)throw Error('Preset de iluminación v4 incompatible.');
    for(const light of preset.lights){
      const original=contract.lighting.hints.find(hint=>hint.name===light.name);
      if(!original||light.type!==original.type||!samePosition(light.position,original.position))throw Error('Preset v4: emisor o posición runtime incompatible.');
    }
    validateOverrides(preset);
    prepareWorkshopLights({...contract,lighting:{...contract.lighting,hints:preset.lights}},'atelier',frames);
  }
  return metadata;
}

export async function loadWorkshopV4Metadata(baseURL,{signal,fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw Error('No hay transporte para los contratos v4.');
  const entries=await Promise.all([
    ['contract','asset-contract-v4.json'],['frames','light-directions-v4.json'],['day','lighting-day-v4.json'],['night','lighting-night-v4.json']
  ].map(async([key,file])=>{
    const response=await fetchImpl(new URL(file,baseURL),{signal});
    if(!response.ok)throw Error(`No se pudo cargar metadata v4 (${file}, HTTP ${response.status??'error'}).`);
    return [key,await response.json()];
  }));
  return validateWorkshopV4Metadata(Object.fromEntries(entries));
}

/** The old adapter remains untouched. Night uses its authored values directly,
 * not the historical .45/.65 night treatment a second time. Room lamps retain
 * their authored watts; Dojo alone keeps the existing optional neutral styling. */
export function prepareWorkshopV4Presets(metadata,surroundings=null){
  const {contract,frames,day,night}=validateWorkshopV4Metadata(metadata);
  if(surroundings){
    validateWorkshopSurroundings(surroundings);
    if(surroundings.version!==4||surroundings.asset!=='workshop-360-v4.glb'||surroundings.lighting?.hints?.length!==2)throw Error('El cerramiento no corresponde al taller v4.');
  }
  return Object.fromEntries([...ARENAS].map(arena=>{
    const preset=arena==='midnight'?night:day,variantContract={...contract,lighting:{...contract.lighting,hints:preset.lights}};
    const merged=surroundings?completeWorkshopLighting(variantContract,frames,surroundings):{contract:variantContract,frames};
    return [arena,prepareWorkshopLights(merged.contract,arena==='dojo'?'dojo':'atelier',merged.frames)];
  }));
}

/** Prepare the two normalized material variants once after GPU upload. Draw
 * records retain texture bindings/parameters: only directly read color and
 * emission arrays change. A repeated arena applies no allocations or writes. */
export function createWorkshopV4VariantController(model,metadata){
  const {night}=validateWorkshopV4Metadata(metadata);
  if(!Array.isArray(model?.materials))throw Error('El modelo v4 no tiene materiales normalizados.');
  const changes=night.materialOverrides.map(entry=>{
    const indices=model.materials.flatMap((material,index)=>material.name===entry.materialName?[index]:[]);
    if(indices.length!==1)throw Error(`El material nocturno v4 no es único o no existe (${entry.materialName}).`);
    const index=indices[0],day=model.materials[index];
    // emissiveFactor in the portable preset already includes emissionStrength.
    const material={...day,baseColorFactor:entry.baseColorFactor.slice(),emissiveFactor:entry.emissiveFactor.slice()};
    return {index,day,night:material};
  });
  let current='day',arena='atelier';
  return Object.freeze({
    get arena(){return arena;},
    apply(nextArena){
      if(!ARENAS.has(nextArena))throw Error('Preset de arena v4 desconocido.');
      arena=nextArena;const variant=arena==='midnight'?'night':'day';if(variant===current)return false;
      for(const change of changes)model.materials[change.index]=change[variant];
      current=variant;return true;
    },
  });
}
