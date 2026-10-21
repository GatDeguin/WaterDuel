// Package the material-only revision after all asset checks have passed.
import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const relative='public/assets/characters/water-mannequin/v3';
const out=path.join(root,relative);
const load=async p=>JSON.parse(await readFile(path.join(root,p),'utf8'));
const save=async (p,data)=>writeFile(path.join(root,p),JSON.stringify(data,null,2)+'\n');
const hash=async p=>createHash('sha256').update(await readFile(path.join(root,p))).digest('hex');
const baseline=await load('public/assets/characters/water-mannequin/v2/rig-contract.json');
const baselineInfo=await load('public/assets/characters/water-mannequin/v2/asset-info.json');
const build=await load(`${relative}/build-receipt.json`);
const geometry=await load(`${relative}/geometry-equivalence.json`);
const runtime=await load(`${relative}/runtime-compatibility.json`);
assert.equal(geometry.ok,true);assert.equal(runtime.ok,true);
assert.equal(geometry.summary.variantsPassed,3);
const variants={};
for(const [id,name] of [['mint','water-mannequin'],['amber','water-mannequin-amber'],['boss','water-mannequin-boss']]){
  const candidate=build.assets.find(a=>a.name===name);
  const checkId=id==='mint'?'normal':id;
  const compat=runtime.results.find(a=>a.variant===checkId);
  const equivalence=geometry.results.find(a=>a.variant===checkId);
  const qa=await load(`${relative}/validation-${id}.json`);
  const roundtrip=await load(`${relative}/${name}-roundtrip.json`);
  const source=await load(`${relative}/${name}-source-equivalence.json`);
  assert(qa.ok&&roundtrip.ok&&source.ok&&compat.ok&&equivalence.ok);
  assert.equal(source.before,source.after);
  assert.equal(await hash(`${relative}/${name}.glb`),candidate.sha256);
  assert.equal(compat.candidate.sha256,candidate.sha256);
  assert.equal(await hash(`public/assets/characters/water-mannequin/v2/${name}.glb`),candidate.source_sha256);
  variants[id]={...baseline.variants[id],source:`docs/assets/characters/v3/${name}.blend`,
    preview:`${name}-preview.png`,detail:`${name}-detail.png`,bytes:candidate.bytes,sha256:candidate.sha256,
    baseline_sha256:candidate.source_sha256,textures:qa.textures,
    roundtrip:{max_bounds_error_metres:roundtrip.max_bounds_error_metres,
      max_socket_error_metres:Math.max(...Object.values(roundtrip.socket_error_metres)),
      head_test_displacement_metres:roundtrip.head_test_displacement_metres,
      body_test_displacement_metres:roundtrip.body_test_displacement_metres},
    runtime_cpu_counts:compat.counts,geometry_bytes_sha256:equivalence.geometry.sha256};
}
const textureBudget={embedded:true,image_count:11,dimensions:'1 x 1024²; 10 x 512²; RGB8 PNG',
  channels:{basecolor:'sRGB',normal:'linear tangent space',orm:'linear R=AO G=roughness B=metallic'},
  encoded_bytes_per_glb:geometry.results[0].textures.encodedBytes,
  gpu_RGBA8_mip_bytes_per_variant:geometry.results[0].textures.gpuRGBA8MipBytes,
  gpu_RGBA8_mip_bytes_all_three:geometry.summary.gpuRGBA8MipBytesAcrossFiles,
  gpu_RGBA8_mip_bytes_with_hash_dedup:geometry.summary.uniqueImageGPU_RGBA8MipBytes,
  estimate:'RGBA8, full mip chain, no GPU compression, excluding renderer overhead; runtime dedup not assumed'};
const limits={runtime_selection:'V3 prepared for Principal; no runtime path/config edits in this delivery. V2 remains the integrated baseline.',
  fluid:'Preview water/latex remain static authored geometry and materials, unchanged from v2. Runtime builds the moving balloon/water separately.',
  wear:'Shared UVs/materials: no exclusive physical dirt placement per limb; microcracks and scratches are shader detail, not geometry.',
  anisotropy:'Directional normal detail only; no anisotropic BRDF or unsupported material extension added.',
  sources:'Editable Blender material graphs use the same packed images; source AO is not wired, GLB AO uses mild strength.',
  gpu:'Blender studio previews checked; no WebGL visual or FPS benchmark claimed.',
  rig:'18 authored joints; 16 retained in runtime preparation. No new animation clips, topology, UV, weights, bind matrices or collision shapes.'};
const contract={...baseline,date:'2026-10-17',asset:'WaterDuel mannequin v3 — material-only revision of frozen v2',
  material_only:true,geometry_baseline:'v2',pose:{...baseline.pose,source:'Normal/amber retain v2 rest skeleton and fencing pose. Boss retains normalized v2 rig and scaled rest skeleton.'},
  textures:textureBudget,variants,limits};
await save(`${relative}/rig-contract.json`,contract);
await save(`${relative}/asset-info.json`,{date:'2026-10-17',version:3,material_only:true,rig:baseline.rig,
  units:baseline.units,axes:baseline.axes,pose:contract.pose,texture_budget:textureBudget,limits,
  references:baseline.references,variants:Object.fromEntries(Object.entries(variants).map(([id,v])=>[id,{...baselineInfo.variants[id],...v,source_bones:undefined}]))});
const lines=[
'# Personajes WaterDuel V3 — entrega estable',
'',
'Revisión exclusiva de materiales sobre v2. Normal, ámbar y jefe conservan exactamente la geometría, nodos, jerarquía, UV, pesos, huesos e inverse-bind matrices de sus GLB v2. La versión v2 y el runtime permanecen intactos.',
'',
'## Cambios visuales',
'',
'Madera marrón cálida con veta más fina, variación leve de rugosidad, polvo y desgaste discretos, pequeñas marcas y microfisuras. Latón con pátina y rayas suaves; cuero con poro fino; tela con trama, variación de rugosidad y sheen compatible. No hay brillo ni sombras pintados. Los UV compartidos repiten patrones: no se atribuye suciedad física exclusiva a pies o codos. El mecanizado se sugiere mediante normales direccionales, sin BRDF anisotrópico.',
'',
'La cabeza de globo y el agua conservan sus materiales y geometría v2, sin rasgos faciales añadidos. El agua de estos renders es estática; el runtime usa su propio solver y excluye esa geometría de presentación.',
'',
'## Archivos',
'',
'- GLB: `public/assets/characters/water-mannequin/v3/` (normal, amber, boss).',
'- Fuentes editables: `docs/assets/characters/v3/` (un .blend por variante, imágenes empacadas).',
'- Texturas reproducibles: `docs/assets/characters/v3/textures/`.',
'- Contrato: `v3/rig-contract.json`; metadatos: `v3/asset-info.json`; hashes: `v3/delivery-sha256.json`.',
'- Vista conjunta: `v3/waterduel-models-v3.png`, render independiente de los GLB reimportados. El jefe se refleja solo para la composición; no modifica el asset.',
'',
'## Compatibilidad y comprobaciones',
'',
'`geometry-equivalence.json`: JSON estructural y 7.351.220 bytes de geometría/UV/pesos/IBMs idénticos a v2 entre las tres variantes. Nombres e índices de materiales conservados, incluidos los que identifican el faldón. Los materiales protegidos de globo/agua y sus dependencias también coinciden.',
'',
'`runtime-compatibility.json`: parser, preparación y retarget reales; hashes de geometría y atributos, clasificación del faldón y posiciones/matrices retargeteadas coinciden en diez muestras. Normal/ámbar mantienen una parte de faldón; jefe dos. Sin cambios al código del runtime.',
'',
'`validation-*.json`: índices, accesores, skins, materiales, texturas y límites válidos. `*-source-equivalence.json`: geometría, UV, pesos, rig y pose de las fuentes idénticos antes/después. `*-roundtrip.json`: reimportación de los tres GLB, 18 huesos, error de límites <0,007 mm y de sockets <0,009 mm; mover cabeza no desplaza el cuerpo.',
'',
'PNG embebidos, sin URI externa ni nuevos requisitos de extensión; se usa sheen ya admitido por el shader. ORM R=AO/G=roughness/B=metallic. Basecolor sRGB; normales/ORM lineales. No transmisión, volumen, clearcoat ni anisotropía mediante texturas no soportadas.',
'',
'## Presupuesto',
'',
`11 PNG por GLB (uno de 1024² y diez de 512²), ${textureBudget.encoded_bytes_per_glb.toLocaleString('es-AR')} bytes codificados. Estimación RGBA8 con mips: ${(textureBudget.gpu_RGBA8_mip_bytes_per_variant/1048576).toFixed(2)} MiB por variante; ${(textureBudget.gpu_RGBA8_mip_bytes_all_three/1048576).toFixed(2)} MiB si se cargan las tres sin deduplicar. Las once imágenes son idénticas entre variantes; deduplicación por hash reduciría esa estimación a un juego de mapas, pero no se presume implementada.`,
'',
...Object.entries(variants).map(([id,v])=>`- ${id}: ${v.bytes.toLocaleString('es-AR')} bytes, ${v.triangles.toLocaleString('es-AR')} triángulos, SHA-256 \`${v.sha256}\`.`),
'',
'Principal puede seleccionar las rutas v3 conservando sus mediciones, retarget, solver y bisagras existentes. Esta entrega no cambia la selección activa ni certifica render WebGL o rendimiento. La vista de Blender no demuestra movimiento del fluido ni del faldón en el juego.',
'',
'Reproducir: ejecutar generadores de mapas, `create-water-mannequin-v3.mjs`, `source-water-mannequin-v3.py` en Blender y validadores v3. No reexportar los GLB desde Blender: la construcción parchea únicamente materiales y bytes de imágenes para conservar exacto el contrato geométrico.',
''];
await writeFile(path.join(root,'audit/COORDINACION_PERSONAJES_V3.md'),lines.join('\n'));
const files=[];
for(const v of Object.values(variants))files.push(`${relative}/${v.glb}`,v.source,`${relative}/${v.preview}`,`${relative}/${v.detail}`);
files.push(`${relative}/waterduel-models-v3.png`,`${relative}/rig-contract.json`,`${relative}/asset-info.json`,
  `${relative}/geometry-equivalence.json`,`${relative}/runtime-compatibility.json`,'audit/COORDINACION_PERSONAJES_V3.md');
const receipts=[];
for(const file of files)receipts.push({file,bytes:(await stat(path.join(root,file))).size,sha256:await hash(file)});
await save(`${relative}/delivery-sha256.json`,{revision:3,material_only:true,files:receipts});
console.log(JSON.stringify({ok:true,variants:Object.keys(variants),textureBudget,filesHashed:receipts.length},null,2));
