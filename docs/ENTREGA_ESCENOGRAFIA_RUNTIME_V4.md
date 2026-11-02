# WaterDuel: escenografía v4

Revisión terminada y lista para integrar según las propuestas elegidas **4, 6, 7, 10, 11–22**. `asset-contract-v4.json` está `ready:true/stable:true` y el verificador confirma `readyForIntegration:true`. Las referencias w1–w4 siguen empaquetadas en las dos fuentes editables. La fuente original y los editables/GLB v2 y v3 se preservan por SHA-256. Principal recibió el aviso con rutas, métricas y condiciones de integración; la comprobación del juego le corresponde.

## Archivos

| Entregable | Ruta |
|---|---|
| Blender de día | `output/blender/WaterDuel_Atelier_v4.blend` |
| Blender de noche | `output/blender/WaterDuel_Atelier_v4_noche.blend` |
| Renders nativos | `output/blender/WaterDuel_Atelier_v4_dia.png`, `WaterDuel_Atelier_v4_noche.png` |
| GLB principal | `public/assets/environment/workshop/workshop-runtime-v4.glb` |
| Contrato principal | `public/assets/environment/workshop/asset-contract-v4.json` |
| Cobertura de las 16 mejoras | `public/assets/environment/workshop/features-v4.json` |
| Direcciones y posiciones de luces | `public/assets/environment/workshop/light-directions-v4.json` |
| Presets de día y noche | `lighting-day-v4.json`, `lighting-night-v4.json`, en el mismo directorio |
| HDR del taller | `public/assets/environment/workshop/reflection-v4.hdr` |
| Cerramiento compatible | `public/assets/environment/workshop/workshop-360-v4.glb`, `workshop-360-v4.json` |
| Fuente del cerramiento | `output/blender/WaterDuel_Workshop360_v4.blend` |

GLB principal: **48.890.340 bytes, 398.587 triángulos, 56 grupos y 51 materiales**. SHA-256: `9dafb0641072e9ec5e281e43aa0ad1282468fb21b84bfd0955d9166813f1afbe`. Texturas RGBA8+mips conservadoras:169,50MiB. Límites por GLB:500.000 triángulos,60 grupos,64MiB de archivo y200MiB de texturas. Recursos PBR autocontenidos; no requiere descargas ni decodificadores nuevos.

Fuente de día:63.550.045 bytes, SHA `0102459d4961b52620f24e9de99cef8e4f122733fab65bae582d6f07b4e18f86`.
Fuente de noche:39.855.427 bytes, SHA `26e9b7471245ec3250fe2b416bd3d6c93af5aee1ce479a6048674d81611d44c9`.
Las dos conservan tres cámaras,22 luces y56 mallas visibles. Todas sus imágenes FILE están empaquetadas, incluidas w1–w4. La diferencia de tamaño se debe a recursos de horneado sin usuarios que Blender depura al reabrir la copia nocturna.

## Mejoras incorporadas

| N.º | Cambio concreto |
|---:|---|
| 4 | HDR equirectangular1024×512 del taller real, capturado desde la tarima; materiales preparados para reflejar su geometría. |
| 6 | Dos luces ambientales existentes reubicadas cerca del techo, con distinto tono y energía, para separar vigas y planos altos. |
| 7 | Huecos reales en fachada y reveles, con patio distante, edificios, cubiertas, chimeneas y árboles. |
| 10 | Fuente nocturna completa con lámparas cálidas y exterior azul oscuro; preset de22 luces y dos overrides de materiales. |
| 11 | Veta con dominio orientado y semilla propia por pieza, sin repetición idéntica entre tablones. |
| 12 | Testa por normal real de cara, con anillos en extremos y fibra longitudinal lateral. |
| 13 | Pequeñas abolladuras geométricas localizadas en la protección frontal de latón. |
| 14 | Humedad irregular continua sobre las caras superiores, correlacionando color y rugosidad. |
| 15 | Catorce injertos/tapones de reparación sobre cantos y mesones, con veta y acabado propios. |
| 16 | Diez fijaciones nuevas, con arandelas y cabezas/rebajes distintos en muebles laterales. |
| 17 | Depósitos de verdín localizados junto a uniones de cobre; Metallic variable horneado en el azul del ORM. |
| 18 | Vidrio antiguo con ondulación suave de hasta4,2mm en escala de autoría, fase continua por paño y normales analíticas independientes de los biseles. Cada paño alfa cerrado aporta sólo su cara orientada a cámara para evitar la doble mezcla triangular. |
| 19 | Restos de barniz y desgaste correlacionado en madera. Capas completas de Coat en la fuente Blender; señales del acabado en PBR portátil. |
| 20 | Mampostería expuesta y parches de cal localizados; atlas de pared2048 color/1024 normal. |
| 21 | Bandeja con muestras CERA, ACEITE y GOMA LACA, acabados distintos, veta y etiquetas tridimensionales. |
| 22 | Tablero con perfiles pintados de formón, llave y martillo, etiquetas y tres ganchos vacíos. |

Los materiales procedurales completos se mantienen en las fuentes editables. El GLB usa mapas de color, rugosidad, normal y Metallic donde corresponde, horneados sin iluminación completa. Las normales son OpenGL+Y. La representación PBR del barniz no serializa todos los nodos de autoría.

## Verificación

- `verification-v4.json`: parser del GLB real, recursos, rotor, presupuestos, seis baselines inmutables y cobertura activa de las16 mejoras. Los archivos de evidencia llevan hash y las referencias a nodos/materiales deben ser alcanzables desde la escena activa.
- `reimport-verification-v4.json`: GLB reabierto en Blender, imágenes decodificadas, bounds, altura de tarima, área de combate y rotor.
- `geometry-verification-v4.json` y `geometric-reimport-v4.json`: siete separaciones, selecciones completas soldadas y BVH/SAT de los cinco conjuntos corregidos contra todos los otros meshes exportados, incluidas las nuevas piezas. Cero cruces externos de esos cinco conjuntos.
- `output/blender/verification-editable-v4.json`: cámaras originales,22 luces por variante, portabilidad de imágenes, cuatro referencias y bucle nativo LINEAR/CYCLES a7,2rad/s. Poses0/90/180/360/450° con pivote fijo. Inclinación máxima de las normales de caras amplias del vidrio:2,262°, sin mezcla con biseles.
- `output/blender/preview-variants-v4.json`: renders Cycles de día/noche1280×720 y SHA de ambos editables sin cambios durante el render.
- Nueve vistas del GLB reimportado: `preview-glb-v4-eevee.png`, `preview-glb-v4-oblique.png`, `preview-v4-materials.png`, `preview-v4-details.png`, `preview-v4-tools.png`, `preview-v4-copper.png`, `preview-v4-glass.png`, `preview-v4-exterior.png` y `preview-v4-ceiling.png`.

Las siete separaciones runtime siguen siendo: faldón izquierdo36,320mm/derecho32,645mm; al suelo8,542/7,386mm; plano29,443mm; banderines traseros29,015/30,027mm. El área activa X±3,7,Z±1,31,Y0,36…3,5 queda libre. La tarima alcanzaY0,32446122, con nominal0,3245.

Las vistas Eevee son QA offline de los recursos importados, no una captura del juego. Las tomas de detalle conservan sombras de áreas y contribución de puntuales sin sus sombras. Los renders Cycles proceden de las fuentes nativas. Ninguno incluye personajes, interfaz ni QR.

## Integración por Principal

Las posiciones están ya escaladas y orientadas. No aplicar de nuevo95/147 ni el offset−0,4186972789. El rotor `Workshop_FanRotor` conserva pivote runtime `[-4.2006802559,1.7139557600,-2.2263605595]`, eje+Z y velocidad7,2rad/s; transformar sólo ese nodo una vez.

Usar juntos `workshop-runtime-v4.glb`, `asset-contract-v4.json` y **`light-directions-v4.json`**. Las dos luces de techo cambiaron de posición, por lo que la ruta antigua de direcciones no corresponde a esta revisión. Son22 luces; las dos del cerramiento completan24. Los presets ya expresan `scaledWatts` y coordenadas runtime.

Sustituir también la pareja del cerramiento por **`workshop-360-v4.glb` y `workshop-360-v4.json`**. El cerramiento previo tapaba el nuevo patio; v4 abre detrás de la fachada histórica una sección central, conservando retornos y dintel. Tiene33.440 triángulos,14 grupos y10.550.632 bytes; SHA `5bc507ab91bf5e0a39a827d2eb35ad81ff8494f83e952f2499dd15c483c408a4`. Su verificación incluye64 rayos de ventana libres y nueve de guarda con cerramiento conservado; los33 PNG y14 materiales previos se reutilizan idénticos.

El cerramiento está **`stable:true`** como artefacto geométrico validado offline, con **`runtimeIntegrationVerified:false`** explícito. `stable` permite cargar el recurso y no depende de la QA del juego: la construcción anterior del cerramiento original ya usa esa semántica. El marcador pendiente de construcción de la pareja v4 se cerró el2/11/2026 mediante `scripts/mark-workshop-360-v4-ready.mjs`. Recalcula64 rayos y nueve guardas contra los dos GLB, verifica preservación de recursos/atributos/cámara/luces, cierre y volumen del marco, presupuestos y hashes. La evidencia está en `verification-360-v4.json`. El verificador principal y su marcador ahora también exigen que la pareja supere este control; no se debilitaron las validaciones de carga. Los dos GLB y las tres fuentes Blender conservan sus hashes anteriores al cierre.

El motor existente ya captura su propio cubemap. `reflection-v4.hdr` es una captura de referencia portable del taller, no evidencia de integración GPU. La noche queda entregada como escena nativa y preset: su activación en el juego la resuelve Principal. `runtimeIntegrationVerified:false` permanece explícito hasta esa comprobación. Esta entrega no modifica renderer, motor ni UI.

## Reproducción

1. Abrir `WaterDuel_Atelier_v3.blend` en Blender background y ejecutar `scripts/create-workshop-v4.py`.
2. Abrir el checkpoint `WaterDuel_v4_Working.blend` y ejecutar `scripts/bake-export-workshop-v4.py`; reutiliza los bakes por checksum.
3. Ejecutar `node scripts/build-workshop-clearance-v4.mjs`.
4. Abrir la fuente de día y ejecutar `scripts/render-variants-workshop-v4.py`; genera noche, HDR y los dos renders nativos.
5. Ejecutar `scripts/verify-native-workshop-v4.py` en Blender background y `node scripts/prepare-workshop-features-v4.mjs`.
6. Reimportar y renderizar con `scripts/reimport-workshop-runtime-v4.py --preview --exterior-preview --ceiling-preview`. Inspeccionar las nueve vistas y las dos nativas.
7. Ejecutar `node scripts/verify-workshop-runtime-v4.mjs` y cerrar con `node scripts/mark-workshop-v4-ready.mjs --visuals-reviewed` sólo tras inspección.

El constructor compatible del cerramiento es `scripts/create-workshop-360-v4.py`. Todos los procesos usan copias propias background; las fuentes previas permanecen intactas.

Para verificar el cerramiento sin reconstruirlo: `node scripts/verify-workshop-360-v4.mjs --require-stable`. Sus cuatro pruebas de regresión usan `--self-test`; las12 del verificador principal conservan su propio `--self-test`. La lista curada actual está en `audit/ESCENOGRAFIA_V4_ENTREGABLES.json`, con hashes regenerados después del cierre del marcador360. La QA GPU continúa separada y a cargo de Principal.

Tras ese cierre, `node --test tests/workshop-runtime-v4.test.mjs tests/workshop-surroundings.test.mjs tests/workshop-360.test.mjs` pasó14/14 pruebas reales de carga, rechazo de contratos pendientes,24 luces, presets y rotor. Los validadores runtime y sus pruebas no se modificaron desde Escenografía.
