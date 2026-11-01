import {loadGLB} from './glb.js';
import {batchStaticAsset} from './static-batches.js';

export function validateWorkshopSurroundings(contract){
  const room=contract?.cameraInterior;
  if(contract?.schemaVersion!==1||contract.stable!==true||!Array.isArray(room?.min)||!Array.isArray(room.max)||room.min.length!==3||room.max.length!==3||!room.min.every((v,i)=>Number.isFinite(v)&&Number.isFinite(room.max[i])&&v<room.max[i]))throw Error('El cerramiento del taller no tiene un volumen interior válido.');
  return contract;
}

/** Existing emitter records remain untouched. New room fixtures use only the
 * two spare light slots, with authored frames validated by the normal adapter. */
export function completeWorkshopLighting(contract,frames,surroundings){
  validateWorkshopSurroundings(surroundings);
  const hints=surroundings.lighting?.hints??[],lights=surroundings.lightDirections?.lights??[];
  if(!Array.isArray(hints)||!Array.isArray(lights)||hints.length!==lights.length||hints.length+(contract.lighting?.hints?.length??0)>24)throw Error('Las luces del cerramiento exceden la capacidad del taller.');
  return {contract:{...contract,lighting:{...contract.lighting,hints:[...contract.lighting.hints,...hints]}},frames:{...frames,lights:[...frames.lights,...lights]}};
}

export async function loadWorkshopSurroundings(baseURL,{signal,fetchImpl=globalThis.fetch}={}){
  const response=await fetchImpl(new URL('workshop-360.json',baseURL),{signal});
  if(!response.ok)throw Error('No se pudo cargar el contrato del taller 360°.');
  const contract=validateWorkshopSurroundings(await response.json());
  const source=await loadGLB(new URL('workshop-360.glb',baseURL),{signal,fetchImpl});
  return {contract,source:batchStaticAsset(source)};
}
