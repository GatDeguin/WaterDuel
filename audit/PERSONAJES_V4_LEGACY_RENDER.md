# Personajes v4: preservación del render procedural legacy

Fecha: 2026-11-02. Alcance: QA de compatibilidad del payload histórico; no se modificó producción en esta tarea.

El test histórico construía actores mediante el motor activo. Tras migrar a N16, ese procedimiento dejó de representar el ABI anterior: cada actor físico usa dos hulls dinámicos en lugar de seis primitivas de pie. El conteo regular baja seis llamadas y el render agrega dos llamadas dinámicas. Cambiar el hash esperado por el del solver nuevo habría borrado la evidencia histórica.

Se recuperaron los cuatro actores desde el `engine.js` y el rig N14 inmutables de `.superpowers/sdd/personajes-selected-v4/baseline/public/`. El renderer archivado reprodujo los cuatro conteos y SHA-256 originales antes de guardar el corpus. El test actual recibe esas poses estáticas, sin ejecutar ningún motor histórico ni generar una pose con el solver N16.

| Caso histórico | Llamadas regulares | SHA-256 ordenado F32 conservado |
| --- | ---: | --- |
| Espada | 218 | `87b8f359b7fc0cb5ab6591669f4e6582d9430c8f7ac8c09a9bc0f47332ccfbd1` |
| Espada, flag jefe | 248 | `6ff1a96c13fc9c46b339b98f3d9a01971cd9c64d48984fd3e0682dd6e6bb4adc` |
| Mazo | 226 | `61bf9866981436b6ff1f7609ca24f5976a3b4247c8bed010ed44100d78c32ced` |
| Mazo, flag jefe | 256 | `589391b22abc16cd1e788752942d1e39035ce534cd6ea1be5ee8d5f643afd5ba` |

Se preservó exactamente el protocolo anterior: `new DuelEngine()`, modo versus, `setLoadout(1, ...)`, asignación del flag `boss` y ningún avance de simulación. El flag jefe se asignaba después de construir la pose; este corpus conserva ese protocolo, no pretende documentar una apertura física de campaña con escala jefe.

## Procedencia del corpus

Archivo: `tests/fixtures/procedural-legacy-characters-1.12.json`, 48,320 bytes. SHA-256 completo: `75f2eaf7678b20f372267af6fece9a0fd6f6bd0729e5faae8b59c7d5fcb1105f`. El test fija este hash además de conservar los cuatro hashes originales como literales independientes.

| Fuente archivada | SHA-256 de bytes originales |
| --- | --- |
| `engine.js` | `c15937c1b35da53d7836048aae4577e4079624f9f7acff6b5b8eb149195e84dc` |
| `physics/articulated-rig.js` | `b18375efac5b262551ef2f8efe36ad37c2fb2769f83601aee175d20c8630f92e` |
| `render3d.js` | `4acd7085e6d7364e7e980329c2fc62afea74b33d429c71e203730d4c54e722bb` |

La carga de recuperación usó módulos `data:`: el import del rig dentro del motor se redirigió al rig N14 archivado. Los demás imports relativos se resolvieron a las URL `file:` equivalentes bajo `public/`; no se copió el solver N16 como oráculo. El rig archivado importa explícitamente `ApronHinge`, aún disponible en `public/physics/apron.js`; no instancia `ApronCloth`. La sección `provenance.sources` del corpus registra también los SHA-256 de esas dependencias directas usadas durante la captura. Ese inventario documenta el entorno de recuperación; no afirma archivar todo su cierre transitivo.

Cada actor guarda `slot`, `dir`, `equipment`, `balloonColor`, `matchApronToBalloon`, `boss`, `lean`, `balloonSize` y la pose completa N14. No contiene `pose.feet`, `pose.ankleF` ni `pose.ankleB`. No se guardaron instancias de física activas ni se añadió lógica de solver al fixture.

El hash ordenado concatena, para cada llamada regular, los bytes de `JSON.stringify([shape,color,material,opacity,wobble,wet])` y los bytes crudos de la matriz `Float32Array`. Se conserva además el hash del bloque de shaders original: `178065a1e4e30b754e730bda414c821a1f84403a3ccf5a497851ede5cc70ac49`.

## Verificación independiente del material archivado

Este fragmento ESM, ejecutado con Node desde la raíz, recupera y mide los cuatro casos sin usar `public/engine.js` ni `public/physics/articulated-rig.js` como constructor del actor. No escribe ni recalibra el fixture. Sus dependencias directas actuales deben coincidir con el inventario del corpus para reproducir el entorno exacto de captura.

```js
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const archive='.superpowers/sdd/personajes-selected-v4/baseline/public/';
const current=path=>pathToFileURL(resolve('public',path));
const relocate=(source,path,overrides={})=>source.replace(
  /(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
  (_,a,p,c)=>a+(overrides[p]??new URL(p,current(path)).href)+c);
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const rig=moduleURL(relocate(await readFile(archive+'physics/articulated-rig.js','utf8'),'physics/articulated-rig.js'));
const {DuelEngine}=await import(moduleURL(relocate(await readFile(archive+'engine.js','utf8'),'engine.js',{'./physics/articulated-rig.js':rig})));
const {Renderer3D}=await import(moduleURL(relocate(await readFile(archive+'render3d.js','utf8'),'render3d.js')));
for(const weapon of ['sword','maul'])for(const boss of [false,true]){
  const g=new DuelEngine();g.setMode('versus');
  g.setLoadout(1,{weapon,defense:weapon==='maul'?'none':'short'});
  const f=g.fighters[0];f.boss=boss;
  const r=Object.create(Renderer3D.prototype),calls=[];
  r.assetScene={characters:{},equipment:{}};r.assetPoseCache=new WeakMap();r.depthOnly=true;
  r.draw=(shape,matrix,color,material=0,opacity=1,wobble=0,wet=0)=>calls.push({shape,matrix:matrix.slice(),color,material,opacity,wobble,wet});
  r.drawPuppet(f,.5,{quality:'high'});
  const hash=createHash('sha256');
  for(const c of calls){
    hash.update(JSON.stringify([c.shape,c.color,c.material,c.opacity,c.wobble,c.wet]));
    hash.update(Buffer.from(c.matrix.buffer,c.matrix.byteOffset,c.matrix.byteLength));
  }
  console.log(weapon,boss,calls.length,hash.digest('hex'));
}
```

## Cobertura N16 y resultado

El test nuevo captura `dynamicDraw` del fallback con ownership limitado a `frontFoot` y `backFoot`. Exige cero primitivas proxy antiguas y dos hulls. Para normal/jefe y ambas orientaciones, modifica pelvis, pierna y ambos tobillos; compara todos los vértices emitidos con una proyección independiente de `FOOT_SHAPES` mediante `pose.feet[side].matrix`, incluidos los dos extremos de profundidad. También exige que cada vértice de contorno exista en el mesh y que su altura mínima coincida con `support.y`. No llama a `proceduralFootMesh` para calcular el esperado ni fija un hash nuevo N16.

Medición informativa del protocolo original sobre el motor N16: 212/242/220/250 llamadas regulares y dos hulls de 36 triángulos en cada caso. Estos conteos nuevos no sustituyen los contratos históricos.

Validación fresca: `node --test tests/joint-damage-render.test.mjs tests/character-feet-consumers-v4.test.mjs`: **14/14 PASS**, cero fallos, omitidos o cancelados. El archivo de daño/render tiene 10/10 PASS. Se mantienen los tests existentes de desprendimiento, defensa, GLB, replay e interpolación.
