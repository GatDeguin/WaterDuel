/** CPU adapter for the workshop's exported lighting hints.
 * AREA sources are approximated as softened points. Blender watts and these
 * artist-tuned presets do not assert matching area-light photometry in raster.
 */
const CAPACITY=24;
const KEY=/^Key\s*\|\s*warm workshop softbox$/i;
const ARENAS=new Set(['atelier','midnight','dojo']);

function number(value,min,max,path){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)
    throw new RangeError(`${path}: se requiere un número finito entre ${min} y ${max}.`);
}
function vector(value,min,max,path){
  if(!Array.isArray(value)||value.length!==3)throw new TypeError(`${path}: se requieren tres componentes.`);
  for(let axis=0;axis<3;axis++)number(value[axis],min,max,`${path}[${axis}]`);
}
function validate(hints){
  if(!Array.isArray(hints)||hints.length<1||hints.length>CAPACITY)
    throw new RangeError('lighting.hints: la capacidad es de 1 a 24 luces, sin descarte implícito.');
  const names=new Set();let keyIndex=-1;
  for(let index=0;index<hints.length;index++){
    const hint=hints[index],path=`lighting.hints[${index}]`;
    if(!hint||typeof hint!=='object'||Array.isArray(hint))throw new TypeError(`${path}: se requiere un objeto de luz.`);
    if(typeof hint.name!=='string'||!hint.name.trim()||hint.name.length>160||/[\u0000-\u001f\u007f]/.test(hint.name))
      throw new TypeError(`${path}.name: se requiere una etiqueta no vacía de hasta 160 caracteres.`);
    if(names.has(hint.name))throw new TypeError(`${path}.name: las etiquetas deben ser únicas, sin duplicados.`);
    names.add(hint.name);
    if(hint.type!=='AREA'&&hint.type!=='POINT')throw new TypeError(`${path}.type: sólo se admiten AREA o POINT.`);
    vector(hint.position,-10000,10000,`${path}.position`);
    number(hint.scaledWatts,0,1000000,`${path}.scaledWatts`);
    vector(hint.colorLinear,0,1,`${path}.colorLinear`);
    if(KEY.test(hint.name)){
      if(keyIndex!==-1)throw new TypeError('lighting.hints: la Key debe ser única, sin ambigüedad.');
      keyIndex=index;
    }
  }
  if(keyIndex===-1)throw new TypeError('lighting.hints: falta la Key | warm workshop softbox.');
  return keyIndex;
}

/** Fresh typed arrays can be uploaded with uniform4fv. Only `count` slots are
 * active; the remainder of both 24-vec4 buffers is zero. World coordinates have
 * already been converted by the asset exporter and must not be transformed again.
 */
export function prepareWorkshopLights(contract,arena='atelier',authored=null){
  if(!ARENAS.has(arena))throw new RangeError(`arena: preset desconocido (${String(arena)}).`);
  const hints=contract?.lighting?.hints,key=validate(hints);
  const ordered=[hints[key],...hints.filter((_,index)=>index!==key)];
  const positions=new Float32Array(CAPACITY*4),colors=new Float32Array(CAPACITY*4),directions=new Float32Array(CAPACITY*4);
  let frames=null;
  if(authored){
    if(!Array.isArray(authored.lights)||authored.lights.length!==hints.length)throw new TypeError('light-directions: faltan emisores de autoría.');
    frames=new Map(authored.lights.map(light=>[light.name,light]));
    if(frames.size!==hints.length)throw new TypeError('light-directions: nombres duplicados.');
  }
  for(let index=0;index<ordered.length;index++){
    const hint=ordered[index],offset=index*4;
    const practical=hint.type==='POINT'||/practical|shade downlight|background amber/i.test(hint.name);
    const power=arena==='midnight'?(practical?.65:.45):arena==='dojo'?1.2:1;
    const cold=arena==='midnight'&&/window|blue/i.test(hint.name);
    for(let axis=0;axis<3;axis++){
      positions[offset+axis]=hint.position[axis];
      colors[offset+axis]=arena==='dojo'?hint.colorLinear[axis]*.65+.35:
        cold?hint.colorLinear[axis]*.65+[.30,.52,1][axis]*.35:hint.colorLinear[axis];
    }
    positions[offset+3]=hint.scaledWatts*power/(4*Math.PI);
    colors[offset+3]=hint.type==='AREA'?.65:.15;
    directions[offset+3]=-2; // point emitter, no directional clipping
    if(frames){
      const frame=frames.get(hint.name);
      if(!frame||frame.type!==hint.type)throw new TypeError(`light-directions: emisor incompatible (${hint.name}).`);
      vector(frame.position,-10000,10000,`${hint.name}.position`);
      if(frame.position.some((value,axis)=>Math.abs(value-hint.position[axis])>1e-5))throw new RangeError(`light-directions: posición distinta (${hint.name}).`);
      if(hint.type==='AREA'){
        vector(frame.direction,-1,1,`${hint.name}.direction`);
        if(Math.abs(Math.hypot(...frame.direction)-1)>1e-5)throw new RangeError(`${hint.name}.direction: debe ser unitaria.`);
        number(frame.sizeRuntime,.00001,10000,`${hint.name}.sizeRuntime`);number(frame.sizeYRuntime,.00001,10000,`${hint.name}.sizeYRuntime`);
        number(frame.spreadRadians,.00001,Math.PI+1e-6,`${hint.name}.spreadRadians`);
        directions.set(frame.direction,offset);directions[offset+3]=Math.max(0,Math.cos(frame.spreadRadians/2));
        colors[offset+3]=Math.sqrt(frame.sizeRuntime*frame.sizeYRuntime)/2;
      }else{
        if(frame.radiusRuntime!==undefined){number(frame.radiusRuntime,0,10000,`${hint.name}.radiusRuntime`);colors[offset+3]=Math.max(.01,frame.radiusRuntime);}
        // A shade's aperture blocks the bulb's upper hemisphere. This world
        // space visibility proxy is separate from the AREA downlight power.
        if(/^Practical warm bulb(?:\.\d+)?$/.test(hint.name)){
          const shade=frames.get(hint.name.replace('Practical warm bulb','Shade downlight'));
          if(!shade||shade.type!=='AREA')throw new TypeError(`${hint.name}: falta su pantalla de autoría.`);
          directions.set(shade.direction,offset);directions[offset+3]=-.5;
        }
      }
    }
  }
  return {count:ordered.length,positions,colors,directions,keyPosition:hints[key].position.slice(),keyIndex:0,names:ordered.map(hint=>hint.name)};
}
