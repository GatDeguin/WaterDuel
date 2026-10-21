// Assemble a delivery receipt from fresh asset checks; no runtime dependencies.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'public/assets/characters/water-mannequin/v2');
const readJSON=async name=>JSON.parse(await readFile(path.join(dir,name),'utf8'));
const required=(condition,message)=>{if(!condition)throw Error(message);};
const definitions=[['mint','water-mannequin'],['amber','water-mannequin-amber'],['boss','water-mannequin-boss'],['burst','water-mannequin-burst']];
const variants={};const sources=[];
for(const [key,name]of definitions){
  const qa=await readJSON(`validation-${key}.json`);required(qa.ok,`${key} structural validation failed`);
  const roundtrip=await readJSON(`${key==='amber'?'water-mannequin':name}-roundtrip.json`);
  required(roundtrip.ok,`${key} roundtrip failed`);
  required(roundtrip.max_bounds_error_metres<.0002,`${key} geometry moved`);
  required(Object.values(roundtrip.socket_error_metres).every(n=>n<.0002),`${key} sockets moved`);
  const glb=await readFile(path.join(dir,`${name}.glb`));
  const json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString().trim());
  const equipment=json.nodes.filter(n=>n.name?.startsWith('Preview_Rapier_')).map(n=>n.name);
  required(equipment.length===3,`${key}: optional rapier parts must remain separately hideable`);
  const source=`docs/assets/characters/v2/${key==='amber'?'water-mannequin':name}.blend`;
  const sockets=Object.entries(roundtrip.sockets).map(([name,[x,y,z]])=>({name,position_source:[x,y,z],position_glb:[x,z,-y]}));
  variants[key]={glb:`${name}.glb`,source,preview:`${name}-preview.png`,bytes:glb.length,sha256:createHash('sha256').update(glb).digest('hex'),triangles:qa.triangles,meshes:qa.meshes,materials:qa.materials,textures:qa.textures,bones:qa.joints[0],bounds_glb:qa.bounds,sockets,optional_equipment_nodes:equipment,roundtrip:{max_bounds_error_metres:roundtrip.max_bounds_error_metres,max_socket_error_metres:Math.max(...Object.values(roundtrip.socket_error_metres)),head_test_displacement_metres:roundtrip.head_test_displacement_metres,body_test_displacement_metres:roundtrip.body_test_displacement_metres},source_bones:roundtrip.source_bones};
  required((await stat(path.join(root,source))).size>0,`Missing ${source}`);
  sources.push(source);
}
const contract={schema:2,date:'2026-10-17',asset:'WaterDuel reference mannequin v2',rig:'WD_Mannequin_Rig',units:'metres; artist scale, retarget explicitly',axes:{source:'Z up, -Y forward',glb:'Y up, +Z forward',conversion:'source(x,y,z) -> glTF(x,z,-y)',origin:'ground midpoint in the authored model; spread fencing stance'},pose:{source:'Normal/burst retain v1 rest skeleton with an authored fencing pose. Boss rest skeleton scaled 1.15 and rig object scale normalized to 1.',glb:'Authored fencing pose exported as joint rest pose; inverse-bind matrices differ from v1.',animations:[]},weighting:'Rigid 1.0 weight per vertex to one bone; 18 joints, no organic blending',equipment:'Hide three Preview_Rapier_* GLB nodes; source objects Rapier_* and Leather_Grip_Wrap_*; attach Items equipment at Socket_MainHand/SecondaryHand.',textures:{color:'1024x1024 honey wood',normal:'512x512 tangent normal',roughness:'512x512 packed by exporter',embedded:true},variants,limits:{runtime_integrated:false,fluid:'Static geometry, not a solver',burst:'Frozen artistic state, not a temporal simulation or conservation proof',cloth:'Static mesh',colliders:false,lods:false,performance_benchmarked:false,rig_validation:'Head bone movement and stable body verified; full joint ranges not certified'},references:{attachment:'Rounded timber anatomy',w1:'Fencing guard, separated feet, bent lead knee, extended rapier',w2:'Honey wood PBR, satin brass bearings, wrapped grip/wooden fingers, folded knot and sloped waterline',w3:'Flexible latex ribbons and connected perforated water sheets with curved ligaments/drops',w4:'Separate boss silhouette, armor, dark heraldic breastplate and burgundy tabard'}};
await writeFile(path.join(dir,'rig-contract.json'),JSON.stringify(contract,null,2));
const summary={date:contract.date,version:2,rig:contract.rig,units:contract.units,axes:contract.axes,pose:contract.pose,limits:contract.limits,variants:Object.fromEntries(Object.entries(variants).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).filter(([key])=>!['source_bones','sockets'].includes(key)))]))};
await writeFile(path.join(dir,'asset-info.json'),JSON.stringify(summary,null,2));
const hashes=[];
for(const source of new Set(sources)){const bytes=await readFile(path.join(root,source));hashes.push({path:source,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
for(const v of Object.values(variants))hashes.push({path:`public/assets/characters/water-mannequin/v2/${v.glb}`,bytes:v.bytes,sha256:v.sha256});
await writeFile(path.join(dir,'delivery-sha256.json'),JSON.stringify(hashes,null,2));
const table=Object.entries(variants).map(([k,v])=>`| ${k} | ${v.triangles.toLocaleString('es-AR')} | ${v.meshes} | ${v.materials} | ${(v.bytes/1e6).toFixed(2)} MB | ${v.bounds_glb.size[1].toFixed(4)} m |`).join('\n');
const audit=`# Personajes v2 · 17 de octubre de 2026

Revisión solicitada por el humano: «mejora los modelos, segun referencias w1 w2 w3 w4». Corte independiente en public/assets/characters/water-mannequin/v2/ y docs/assets/characters/v2/. V1 y el runtime permanecen sin cambios de este frente.

## Cambios visibles

W1: guardia de esgrima, piernas separadas, rodilla delantera flexionada, torso inclinado y estoque extendido. Conserva las formas de maniquí redondeadas del adjunto original.

W2: madera miel con mapas de color, normal y rugosidad, latón satinado, rodamientos con eje oscuro y ranura de tornillo. Nuevas manos y falanges sujetan la empuñadura. Los actuadores van entre anclajes del mismo antebrazo para mantener su unión en la pose. Globo mint más definido, nivel oblicuo, burbujas y nudo de látex plegado.

W3: estado artístico aparte con cintas finas curvas, labios enrollados, hojas de agua perforadas, ligamentos curvos y gotas variadas. El render usa iluminación de estudio adicional para hacer legible el agua; no emisión del líquido. No representa simulación física ni prueba de conservación de masa.

W4: jefe independiente, altura relativa 115%, torso 125% de ancho y 112% de profundidad. Hombreras, brazales, musleras/grebas, placa oscura con corona e hidráulica dorada y faldón borgoña con emblema.

## Coste de los GLB finales

| Variante | Triángulos | Primitivas | Materiales | Bytes aproximados | Altura del bounds, agua incluida |
|---|---:|---:|---:|---:|---:|
${table}

Todos conservan rig de 18 huesos, cinco Socket_* y tres nodos Preview_Rapier_* ocultables. Tres texturas embebidas; no necesitan red. GLB sin compresión de geometría y con KHR_materials_transmission, KHR_materials_ior, KHR_materials_volume y KHR_materials_clearcoat. El motor propio aún requiere importador, skinning y materiales compatibles; no se ha medido rendimiento ni número real de draw calls en él.

## Contrato y comprobaciones

rig-contract.json registra jerarquía, pivotes/rest/pose por variante, sockets y dimensiones. Blender: Z arriba/frente -Y; glTF: Y arriba/frente +Z. Metros, origen en suelo. La fuente normal conserva rest v1 más pose de guardia; el GLB usa la guardia actual como referencia. El jefe tiene rest escalado 1.15 y escala del objeto rig normalizada a 1 para compatibilidad de sockets. No reutilizar inverseBindMatrices v1.

Se validaron los cuatro binarios con scripts/validate-water-mannequin.mjs, incluidos índices/accessors/normales, pesos, recursos embebidos y transmisión. Los GLB normal, jefe y burst se reimportaron independientemente en Blender mediante scripts/check-water-mannequin-v2.py con --python-exit-code 1. Bounds y sockets coinciden con fuente dentro de 0,0002 m; mover head mueve la cabeza y deja el cuerpo inmóvil. Ámbar comparte geometría/rig con mint y tiene validación estructural propia. Recibos validation-*.json y *-roundtrip.json. delivery-sha256.json identifica los archivos entregados.

Se revisaron previews completos de cada variante. La presentación waterduel-models-v2.png vuelve a importar GLB normal/jefe y espeja el jefe solo para la composición. No es captura del juego.

## Límites y continuación

Agua/látex/faldón estáticos, sin colisionadores, LODs ni clips de animación. La prueba de head no certifica todos los rangos de articulación. La tela y el burst requieren animación/solver para jugar. No se afirma equivalencia visual exacta, calidad AAA ni física inferida de imágenes.

Principal debe adaptar escala/retarget a su rig planar y acoplar los sistemas reales de líquido/látex. Items puede ocultar Preview_Rapier_* y usar los sockets. No se tocaron render3d.js, engine.js, game.js, replay.js, index.html ni otros frentes.

Recrear: scripts/improve-water-mannequin-v2.py; scripts/create-water-mannequin-boss-v2.py; scripts/create-water-mannequin-burst-v2.py; scripts/document-water-mannequin-v2.py; scripts/check-water-mannequin-v2.py; scripts/preview-water-mannequin-v2.py; validaciones Node y scripts/finalize-water-mannequin-v2.mjs. Usar Blender --background --factory-startup --python-exit-code 1. No instalar dependencias del juego.
`;
await writeFile(path.join(root,'audit/COORDINACION_PERSONAJES_V2.md'),audit);
console.log(JSON.stringify({ok:true,variants:Object.fromEntries(Object.entries(variants).map(([k,v])=>[k,{bytes:v.bytes,triangles:v.triangles,meshes:v.meshes,maxSocketError:v.roundtrip.max_socket_error_metres}]))},null,2));
