# Personajes v4 — trazabilidad de las 25 mejoras

Diseño aprobado por el usuario el 2026-11-02. Los GLB v4 están seleccionados en el renderer; v1–v3 se conservan. La publicación pertenece a Principal.

| Nº | Resultado integrado | Fuente / evidencia principal |
|---|---|---|
| 2 | Cintura, pelvis y transiciones afinadas, pivotes conservados. | `scripts/character_v4_geometry.py`; tres `*-construction.json`; preview GLB reimportado. |
| 3 | Horquilla padre, casquillo y tornillo hijo con pesos rígidos. | Builder v4; `character-v4-contract`, `joint-damage-render`, `joint-detachment`. |
| 4 | Chaflanes geométricos de aproximadamente 2 mm. | Fuentes Blender y recibos construction; render CPU de GLB. |
| 5 | Testas radiales y fibra longitudinal; 52 regiones de testa. | `atlas-layout.json`; cero triángulos UV0 madera degenerados, frente a 488 v3. |
| 6 | Herrajes coaxiales con bisagras existentes. | 36 ejes/variante: distancia <1 µm y desviación máxima 0,019783°. |
| 7 | Cabeza, asiento y ranura real de tornillo de 2,4 mm. | Geometría builder y fuentes Blender; propiedad por hueso preservada. |
| 8 | Holguras constructivas e inserciones deliberadas documentadas. | Recibos físicos; `check-character-v4-poses.mjs`: 200 muestras de 32 perfiles. El barrido no demuestra separación triángulo–triángulo exhaustiva. |
| 9 | Talón, puntera y suela plana, 24 vértices coplanares/pie. | Inspección/reimportación; `character-v4-contract`, `character-v4-shin-floor`, `render`. |
| 11 | 338 regiones únicas, atlas compartido de 1024² con gutter de 4 px. | `atlas-layout.json`, `atlas-stats.json`, nueve pruebas Python de atlas. |
| 14 | Desgaste por función y pieza, compuesto con marcas dinámicas. | `create-character-atlas-v4.py`; `combat-wear.js`, `character-damage-v4`. |
| 15 | Microfisuras con fibra y variación determinista por región. | Generador de atlas y preview de detalle; no modifican daño estructural. |
| 16 | Latón pulido localizado mediante rugosidad. | Mapas ORM y estadísticas por clase; preview GLB. |
| 17 | Mecanizado radial/circunferencial en normales orientadas. | Mapa normal OpenGL +Y, generador y pruebas de canales; sin BRDF anisotrópico nuevo. |
| 18 | Pátina, grasa y recesos diferenciados sin duplicar lubricación. | Atlas y `combat-wear.js`; prueba de aceite sin duplicación. |
| 19 | Costuras, solape y cantos de cinturón presentes en runtime. | `V4_Belt_Saddle_Stitch_*` rígidos en pelvis; clasificación `apron-parts.js`. |
| 31 | Tobillos físicos 14/15 y frame compartido por pie. | `articulated-rig.js`, `foot-geometry.js`; `character-v4-feet`, consumidores, render y referencia numérica independiente. |
| 32 | Transferencia previa al paso, apoyo unilateral y motores internos. | 0,12 s transferencia, pasos normal/jefe 0,28/0,34 s; pruebas no vacuas de vuelo/reacción/aterrizaje. Integración de velocidad coherente en A, posición/impulsos en M. |
| 34 | Anticipación y recuperación coordinan torso/hombros. | `character-intent.js` conectado en `engine.js`; prioridad manual ±1 y pruebas de integración. |
| 36 | Pelvis, torso y cuello coordinan esquiva por controles existentes. | Intención rápida 12/8 conservada, motor físico `.8/5` con frenado continuo; 30/30 focos de postura/HUD y cuatro actores con apoyo positivo durante agachado/retorno. |
| 37 | Mano libre aporta contrapeso y cede a equipo/input/daño. | `character-intent`, pruebas de dos manos, defensa, input y cancelación. |
| 40 | Paño reducido con oscilación, torsión y pliegue local. | `apron-cloth`, `apron-deform`, `asset-gpu`; 12 nodos, geometría dinámica y uniones continuas <0,24 µm. |
| 42 | Desgaste, fisura y riesgo de separación según daño real. | `joint-damage.js` y `drawJointDamageWear`; proyección al mesh y ownership de fragmentos. |
| 43 | Respuesta amortiguada tras impulso real. | Perfil de amortiguación durante 0,12 s; impulso cero no activa vibración, reproducción 30/120 Hz y energía decreciente. |
| 46 | Gesto corporal del ganador tras resultado resuelto. | `resultIntent` y reloj de burst fijo; pruebas de empate, derrotado, input, nueva ronda y movimiento reducido. |
| 49 | Apoyos y recuperación corporal del jefe más deliberados. | Parámetros de marcha e intención por masa/equipo; no altera reglas de apertura ni bonifica ataques. |

## Evidencia de assets

Normal/ámbar: 63.682 triángulos completos, jefe: 85.150; 15 mallas, 18 huesos y cinco sockets en las tres variantes. Máximo error de reimportación de socket: 8,39 µm, frente a límite de 200 µm. Materiales serializados de cabeza, agua y cresta exactamente iguales a v3. El juego sigue generando su propia membrana y agua.

El GLB de autoría incluye nueve imágenes por el estoque opcional de presentación. Antes de subir a GPU se excluye ese equipo y se remapean recursos: tres mapas de cuerpo compartidos, 16.777.212 bytes RGBA8+mips estimados (aproximadamente 16 MiB), sin contar overhead de driver. No se atribuyen FPS ni rendimiento móvil a estas mediciones CPU.

`pose-sweep.json` inspecciona 10.070.700 vértices de GLB y paño deformado: máxima penetración del suelo 1,06516 µm, menor que la tolerancia 10 µm. Muestra controles legales, caída y amputación; no certifica todas las combinaciones posibles. El cierre físico y sus mediciones están en `PERSONAJES_V4_FISICA.md`.

## Límites de validación

Las referencias N14 conservan hashes y fixtures históricos. N16 usa masa/Jacobianas independientes por diferencias finitas y un oráculo dinámico de impulso; la invariancia de caché no se presenta como equivalencia entre solvers. El sistema es multibody plano con capas de profundidad y cuello lateral reducido, no un solver 3D completo. El paño es un accesorio de 12 nodos, sin capacidad para sostener el cuerpo.

La comprobación global y la evidencia WebGL se registran en `COORDINACION_PERSONAJES_V4.md` al cerrar la ventana conjunta con Principal. Un render estático de Blender acredita apariencia del GLB, no el comportamiento dinámico del juego.
