# Rendimiento · cortes medidos

## 1.5.2: normales procedurales y contacto con fricción

Se conserva el cálculo escalar de la matriz de normales procedural: 2.058 salidas Float32 exactas, razón mediana de CPU 0,331985 en una época de once pares y cinco controles A/A (variación máxima 9,47 %). Es un ahorro del constructor aislado. El experimento de lecturas diferidas del agua libre quedó dentro del ruido y el de constantes del rig no mejoró consistentemente; ambos están retirados. La fricción comparte la factorización de masa de sus dos direcciones dentro de cada consulta, sin cachés físicos entre pasos. Ver [cambios, recibos y límites](CHANGELOG_1.5.2.md). **No se atribuyen 60 FPS a estos resultados.**

## 1.5.1: superficies y matrices · 20 de octubre de 2026

Se conservan dos cambios con salida geométrica exacta: deduplicación del trabajo de transformación del agua contenida (−61,88 % de CPU caliente del tramo, con primer uso más caro) y caché por valores de las matrices fuente de fragmentos (−76,7–79,0 %, ahorro aproximado de 0,065 ms por vista). No son porcentajes del juego completo. La caché GPU, favorable en GL simulado, se retiró después de una comparación integrada sin mejora consistente. La época final sin ella se abortó en el baseline y no midió B. **No hay validación nueva de 60 FPS ni una mejora global cuantificada del código final.** Ver [evidencias, primer uso, control de píxeles y medición de navegador](CHANGELOG_1.5.1.md).

## 1.5.0: diagnóstico de contactos y rotura

El perfil mixto de CPU señala contactos entre luchadores (43,54 % inclusivo) y actualización de agua (18,66 % inclusivo); no separa el instante de choque del resto del episodio ni mide GPU. Dos candidatos de rig conservaron exactamente la simulación pero no mostraron mejora consistente y se restauraron. Las dos capturas actuales de navegador se abortaron sin completar la rotura, con planificación RAF cercana a un segundo incluso en la pestaña visible. **No hay una optimización de rendimiento nueva retenida ni una validación nueva de 60 FPS.** Ver [recibos, límites y trabajo repetido identificado](PERFORMANCE_SPIKES_1.5.md). Las mediciones siguientes corresponden a sus cortes históricos.

## 1.4.2: adaptación visual experimental, fija por defecto

El móvil permite elegir adaptación render-only de perfiles existentes y resolución100–70%, manteniendo la simulación original. Los20 episodios controlados conservaron el estado físico; las cinco parejas mejoraron CPU medio por callback y frescura. Sin embargo, el ahorro mediano23,319% no superó la variación AA máxima32,003%: **falló la puerta de promoción**. Calidad fija queda como valor inicial y fallback; la adaptación requiere elección explícita como experimento. No se recortaron picos, excluyeron controles ni repitió la prueba. El promedio por callback no equivale al ahorro total de CPU. **60FPS sigue pendiente.** Ver `audit/adaptive-quality-post1.4.1/RESULTADO.md` y `paired-summary.json`.

## Host en Worker con codec exacto V1: descartado

El candidato posterior1.4.1 conserva397 publicaciones+ready byte a byte, física/agua/recorder y siete puntos gráficos completos (21 comparaciones AA/AB/BB exactas; cuatro controles negativos detectados). Sin embargo, dos nuevos diagnósticos fríos con audio preparado entregan297 imágenes nuevas en A directo frente172 en B Worker, con176 repeticiones en B. Edad P95 del estado48,933→146ms; intervalo entre submits nuevos P9549,8→80,3ms. Se activa el criterio previo de abandonar whole-Host Worker para este corte. No se promueve ni se encadena otro DTO/interpolador para rescatarlo.

Ambos conservan795 updates/282 pasos físicos incluido flush/135 capturas20Hz,48 eventos y78 fuentes/assets estables, con0 buffers audio creados durante la ventana. Solicitudes de reproducción aceptadas122→112: no equivale a diez eventos perdidos ni certifica escucha de hardware. Dos cold y timer no son un A/B causal ni acreditan60FPS. Producto1.4.1 sigue intacto y60FPS durante toda la ruptura continúa pendiente. Ver `audit/RESULTADO_HOST_SCENE_CODEC_FASTPATH_V1_POST1.4.1.md` para raws, hashes, gates y límites.

## Audio integrado en 1.4.1

El primer evento frío de audio podía ocupar 31,3–35,8 ms dentro de la física. Tras preparar las 84 variantes en Worker, cinco parejas Chromium midieron 0,1–0,3 ms para el evento y cero `createBuffer` en countdown/fight/burst. Preparar efectos y música en la QA aislada llevó 822,5–866,2 ms; el mayor slice de copia fue 0,1–0,2 ms. No son cifras de latencia de hardware ni una promesa general de FPS. El tercer par tuvo FPS ligeramente menores y se conserva. Ver `audit/RESULTADO_AUDIO_PREPARADO_CHROMIUM_POST1.4.md`.

La fuente real de producto `fe6c03a0…` se verificó después sin esperar efectos antes de start: comenzó con 10/84 variantes en staging; las 74 copias restantes ocurrieron durante countdown, ninguna durante fight/burst. El banco completó en 1182,4 ms y el mayor slice fue 0,2 ms. Una segunda corrida con el banco retenido creó cero buffers en todas las fases. Ambas completaron el contacto físico con fuentes estables, GL0 y consola vacía. Evidencia: `product-audio-{cold,warm}-no-wait-post1.4.json`. Se conservan los renderers de muestras originales; sin Worker, el fallback heredado mantiene su coste y no tiene esta garantía. No se midió escucha física.

## Agua experimental: resultado de los gates

Wasm permanece fuera del juego. En cinco pares de HostSession completos ahorró una mediana de 6,72 % de CPU del renderer; el incremento mediano de FPS de 5,20 % no superó el mayor control A/A de 7,17 %. La siguiente comparación estática conservó geometría y submissions en 20 estados, pero **falló el gate estricto de imagen**: 11/20 completos y 14/20 A/B, con diferencias también entre repeticiones del mismo backend. No se rebajaron tolerancias. Ambos contextos tenían 11/11 assets y GL0. Ver `audit/ARBITRAJE_PLAN_AGUA_POST1.4.md` y el primer recibo `browser-wasm-renderer-quality-post1.4.json`.

El JSON crudo recuperado contiene 105 mallas y 104.288.837 bytes. Su validación encuentra todas las referencias, posiciones y optics, pero 18 hashes de normales no se recomputan tras serializar JSON; la recuperación binaria completa no queda certificada. Una posible pérdida de signo de cero requiere diagnóstico independiente. No se normalizaron datos para producir un PASS. El fallo posterior de exportación DOM se corrigió sólo en QA; el primer resultado fallido se conserva. **Ni estos experimentos ni la corrección de audio cierran 60 FPS durante toda la ruptura.**

## Baseline del renderer sin servicios de anfitrión

Se midió el corte con renderer `2d34f821…` y extractor `1588c703…`, después de la suite 815/815. Las 13 fuentes relevantes registradas en `burst-current-post1.4-source-{before,after}.json` permanecieron estables. El fixture público de motor/renderer real se ejecutó como única escena activa, visible, Alta y 1280×720, con 11/11 assets y GL0. No hubo suites, benchmarks, capturas o Profiler durante esta ventana.

`benchmarks/results/browser-current-physical-burst-720-post1.4.json` conserva 300 cuadros, de los cuales 125 son de ruptura y 175 de cuenta atrás. Empieza después del primer contacto físico (`contact:true`, `demonstration:false`) y termina sin otro contacto dentro del intervalo.

| Fase de ruptura | Resultado |
|---|---:|
| FPS medios | 38,263 |
| FPS mínimo observado | 14,970 |
| Intervalo P95 / máximo | 50,1 / 66,8 ms |
| CPU simulación / render, medias | 10,103 / 15,124 ms |

La GPU tiene 300 muestras mezcladas: mediana 11,587 ms y P95 23,241 ms. **No es GPU exclusivo de ruptura.** El fixture excluye HostSession, recorder, audio, transporte y teléfonos; no certifica la experiencia anfitriona. Esta corrida y los cortes históricos inferiores no son un A/B pareado: no se atribuye su diferencia a una optimización particular. **El objetivo de 60 FPS durante toda la ruptura sigue pendiente.**

En una ejecución separada se capturó `browser-current-physical-burst-720-post1.4.cpuprofile`: 29.337,494 ms, 16.471 muestras y cuatro contactos físicos acumulados al final. La atribución inclusiva de extracción libre es 5201,481 ms y retenida 45,942 ms. No se utilizan los FPS de una ejecución instrumentada como baseline. Una sonda Node por fases localiza trabajo sin certificar ganancias: `audit/SURFACE_HOTPATH_PHASE_DIAGNOSTIC_POST1.4.json`.

El filtro aislado de candidatos de normales conservó los resultados exactos, pero fue **rechazado**: razón agregada 1,034978 (3,50 % más lento), dentro de una prueba de 48 casos con 11 pares alternados y 5 controles A/A. No se integró. Ver `audit/RESULTADO_NORMAL_SUPPORT_POST1.4.md`.

El siguiente experimento evalúa el volumen tetraédrico en Wasm, conservando en JavaScript la decisión inicial de expansión. Chromium verificó los 48 casos: posiciones, normales e isos idénticos; diferencias escalares de hasta 4,28e-16 relativas. La mediana de las razones agregadas fue 0,894268 (10,57 % menos CPU), frente a variación A/A absoluta mediana 2,21 % y máxima 3,93 %. Los totales suman 48 extracciones y **no son tiempos de cuadro**. Algunos casos individuales no mejoran. Cinco mallas Ultra alcanzan el presupuesto y siguen usando el fallback original; no se certifica cierre volumétrico de esas mallas truncadas. Fuentes: `browser-wasm-volume-{correctness,paired}-post1.4.json` y `audit/WASM_VOLUME_PROTOTYPE_POST1.4.md`. La ruta experimental aún no está activada en el juego: falta medir el renderer real durante rupturas completas.

Se midió además un fixture propio con HostSession, grabador de replay, presentación, renderer y audio opcional. Sin audio: 122 cuadros visibles de ruptura en 3266,7 ms, 37,35 FPS; con audio: 115 en 3283,5 ms, 35,02 FPS. Ambos acreditan contacto físico y fuentes estables. **No son una comparación causal**: los canvas fueron 1254×705 y 1265×712, y el audio tenía condiciones distintas. El evento de audio frío alcanzó 36,1 ms, anidado dentro del tiempo de motor/física: no se suma otra vez. El fixture excluye transporte, descubrimiento de sesión, teléfonos, emisión de menú y temporización GPU. La escucha de hardware no se verificó. Recibos: `browser-host-services-{muted,audio}-720-post1.4.json`; diagnóstico: `audit/PLAN_AUDIO_PRIMER_ESTALLIDO_POST1.4.md`.

---

# Rendimiento observado — desarrollo1.4 (cortes históricos)

## Corte aprobado por global03, guardia corregida

Tras810/810pruebas y congelar engine`95f58412`/autoDefense`a97dd21b`, se volvió a cargar el fixture público real, sin otras pestañas del juego, tests ni benchmarks concurrentes. Taller/Alta,1280×720,11/11assets, sin erroresGL. Fuentes `benchmarks/results/browser-frozen-ready-720-1.4.json` y `browser-frozen-physical-burst-720-1.4.json`.

- Preparación:300RAF,59,998FPS, P9516,8ms, mínimo59,17. CPU media sim/render3,13/3,83ms; GPU300consultas, mediana11,29/P9512,88ms.
- Ruptura física separada:105RAF, **30,88FPS**, P9583,3ms, máximo133,3ms/mínimo7,50FPS. CPU media sim/render16,80/15,04ms; heap máximo observado258.543.750bytes desde la carga.
- La ventana completa300RAF contiene105cuadros de ruptura,186de cuenta atrás y9de combate. El primer contacto dispara la medición y su estado inicial ya contabiliza1; termina con2acumulados, de modo que sólo añade uno respecto del snapshot inicial. Su GPU mediana12,34/P9522,48ms pertenece al agregado, no sólo a ruptura. Los contactos son físicos, `contact:true`, `demonstration:false`, sin reducir las200parcelas del modelo normal.

El fixture usa DuelEngine/Renderer reales y excluye host/recorder/transporte/Audio: no certifica la partida anfitriona ni teléfonos. Las capturas no se hicieron durante las ventanas. El recibo `audit/POST_GPU_FROZEN_SOURCE_1.4.json` compara después todos los paths de la global con sus hashes; los archivos nuevos de medición/documentación se registran aparte. **No se cumple60FPS durante la ruptura**, y este fallo de rendimiento sigue abierto aunque la suite funcional esté verde. No se bajó calidad, detalle, conteo de parcelas o iteraciones para cambiar la cifra.

## Corte conjunto con consultas de sombras y segunda optimización

Se repitió el fixture real sin otras tareas CPU/GPU, después de congelar rig`1f996419`, CCD`8f86d2f5` y extractor`1588c703`, con la nueva frontera de sombras. Taller/Alta, mismo navegador y equipo. Fuentes `benchmarks/results/browser-second-{ready,physical-burst}-{720,1080}-1.4.json`.

| Resolución y fase | Muestras | FPS medios | Mínimo | P95 cuadro | CPU sim/render media |
|---|---:|---:|---:|---:|---:|
|1280×720, preparación |300 |60,00 |59,17 |16,8ms |3,10/3,55ms |
|1280×720, ruptura |108 |30,14 |6,00 |83,4ms |17,47/15,03ms |
|1920×1080, preparación |300 |58,25 |29,85 |16,8ms |5,65/3,60ms |
|1920×1080, ruptura |118 |33,24 |8,58 |66,7ms |14,11/13,53ms |

Las ventanas de ruptura comienzan después del contacto que las dispara y terminan con2contactos físicos acumulados, frente1en su snapshot inicial; se separa la fase de las cuentas atrás. GPU de las ventanas completas de300cuadros: preparación720mediana/P9511,27/12,74ms(300consultas), ruptura72012,42/23,19ms(300), preparación108016,75/19,21ms(246), ruptura108018,33/32,16ms(216). Las consultas pendientes/disjuntas no se convierten en ceros. No se midió GPU por fase. Sin erroresGL.

El tiempo de creación del fixture, calentamiento, GC, estado de standby previo y cadencia real afectan los resultados. No se controla todo el sistema ni se infiere que1080sea más rápido causalmente que720: las muestras no son una pareja de estados/frames idénticos. La mejora aislada en Node se valida aparte contra los mismos snapshots. El render medio de preparación bajó en estas corridas, mientras ruptura mantiene gran variación. **El requisito60FPS durante ruptura sigue abierto.** A1080, incluso la medianaGPU de preparación está en torno al presupuesto completo de16,67ms. El pico de heap observado en la corrida720fue314.844.728bytes; no es memoria total ni prueba de fuga.

## Medición conjunta del 18 de octubre, después de la primera optimización de ruptura

Chromium integrado/WebGL2, taller y calidad Alta, canvas1280×720, un único tab de prueba visible, sin Blender, suites ni benchmarks concurrentes. El fixture público `/qa/assets-checks.html` usa motor, renderer y assets reales; no abre un mando autenticado. La ventana inicia con una perforación detectada a partir del gesto continuo del joystick, `contact:true`, `demonstration:false`. No se asigna la victoria. Las capturas y el perfil CPU se realizan aparte.

| Ventana | Muestras RAF | FPS medios | P95 de cuadro | CPU simulación media | CPU render media | GPU mediana/P95 |
|---|---:|---:|---:|---:|---:|---:|
| Preparación | 300 | 60,00 | 16,8ms | 3,82ms | 4,82ms | 11,42/13,01ms |
| Sólo cuadros en fase de ruptura | 104 | 30,74 | 66,7ms | 15,41ms | 16,63ms | No separado por fase |
| Ventana completa iniciada en contacto | 300 | 44,44 | 50,1ms | 8,62ms | 8,96ms | 12,69/23,44ms |

Fuentes: `benchmarks/results/browser-final-ready-720-1.4.json` y `browser-final-physical-burst-720-1.4.json`. El nombre `final` identifica esa corrida, **no una certificación del producto terminado**. La ventana completa contiene186 cuadros de cuenta atrás,10 de combate y104 de ruptura, termina con2contactos acumulados frente1inicial, y no sustituye el resultado separado de ruptura. El máximo intervalo de ruptura fue100ms, mínimo10FPS. La extensión de temporización GPU estuvo disponible; `glErrors=[]`. El máximo de heap observado desde esa carga fue251.679.024bytes, sin afirmar pico total de proceso o VRAM.

El corte anterior del mismo caso registraba8,67FPS en ruptura (`gpu-burst-final-720-1.4.json`), frente60FPS en preparación. Hay una mejora observada, pero **todavía no se cumple60FPS durante el agua y la caída**. No se extrapola a1080p, teléfonos, otros equipos ni sesiones largas. El perfil CPU posterior `browser-burst-after-first-opt-1.4.cpuprofile` dura16,09s y señala la extracción de agua, física, asignaciones y consultas síncronas de estado gráfico. El perfil es diagnóstico y no sustituye la ventana de rendimiento sin perfilador.

Las optimizaciones puras de membrana, CCD y superficie conservan sus oráculos y mediciones pareadas en `audit/OPTIMIZACION_MEMBRANA_FINAL_1.4.md`, `CCD_BURST_REAL_OPTIMIZADO_1.4.md` y `OPTIMIZACION_SUPERFICIE_BURST_1.4.md`. No se suman sus porcentajes ni se convierten benchmarks aislados en FPS. Hay trabajo posterior sobre esas fuentes y las consultas de sombras: requerirá otra medición conjunta antes de publicar una cifra nueva.

## Historia de entrega1.3 y desarrolloR8

Las secciones siguientes corresponden a cortes anteriores; sus pendientes y cifras describen esos momentos.

## Ronda8: comprobaciones acotadas

No hay todavía un benchmark sostenido del corte conjunto con equipamiento nuevo. Blender y varias particiones de tests están compitiendo por CPU/GPU: los FPS vistos durante esa carga no se publican como regresión ni como presupuesto certificado.

El grabador fue medido por su constructor con120muestras bajo carga concurrente: captura mediana1.2701/P952.2225ms; adaptación de vista .8616/1.2668ms. Tres clips de65muestras/3.2s contabilizaron57.097.608bytes; algunas sesiones retienen sólo dos clips por el techo64MiB. Este conteo de datos propios no limita el heap/VRAM totales. Ver `audit/PLAN_REPLAY_RONDA_8.md`.

El fixtureGPU persistente `round8-shadow-gpu.json` confirma sombra/PCF/movimiento del oclusor yGL0. El mapaALTA consume4.194.304bytes y511draws/190.724triángulos; la primera captura integradaregistró4.5ms deCPU, incluyendo reserva/primer uso. No es tiempoGPU ni coste sostenido. ECO/ULTRA usan512/1536, con bytes proporcionales al área. Falta medir ventanas separadas de combate intacto, ruptura y reproducción sobre el corte final.

Las ventanas siguientes corresponden a versiones anteriores y conservan su alcance.

## Ronda 7

Mismo equipo/Node descritos abajo. `round7-browser-versus.json`: 300 RAF quietos en Versus ALTA, 1918×1078, 59.995 FPS medios, mínimo59.172, P9516.8ms, simCPU3.470ms y envío render4.407ms. El destino de profundidad óptica añade8,270,416bytes. **Sólo duelo intacto quieto; no acredita burst, GPU, tablet ni móviles físicos.** El heap desde carga es65,436,333bytes, con vida de sesión y GC distintos del corteR6: no se infiere ahorro de memoria.

La coherencia del agua exige más reconstrucciones cuando cambia de forma. Benchmark reproducible independiente del navegador:

```text
node benchmarks/cache-motion.mjs --output benchmarks/results/repeticion-cache.json
```

Usa200parcelas,31snapshots durante0.5s físicos a60Hz, dos calentamientos y siete corridas útiles. Orden agrupado por escenario/versión, sin alternancia. Baseline es una reducción declarada de la política de caché1.2 y comparte el mismo extractor, cuyo núcleo conserva hash. El JSON guarda fuentes, snapshots/hash, tiempos por frame, memoria observada y cinco fixtures de dominio.

| Caso ALTA | Extracciones antes/después | CPU total mediana antes/después | Desfase máximo de muestras dibujadas antes/después |
|---|---:|---:|---:|
| Reposo | 4/4 | 59.488/48.805ms | 0/0 |
| Traslación común | 4/4 | 40.565/42.624ms | .463361/1.91e-15u |
| Ráfaga deformable | 4/31 | 67.610/588.997ms | .695034/0u |

Fuente `round7-cache-motion.json`. El nuevo caso deformable tiene mediana19.699ms y P9529.025ms en frames que reconstruyen. **No sostiene por sí solo un presupuesto de16.67ms; el cuello de CPU permanece.** La corrección conserva el extractor y la física: aumenta trabajo para no dibujar una forma retrasada. La traslación rígida por COM conserva volumen/normales y evita trabajo en movimiento común; se reconstruye ante residuo>¼decelda y al cambiar una superficie recortada contra piso/paredes. El desfase de muestras no es una cota universal Hausdorff ni error de imagen.

El máximo de memoria de proceso observado entre frames en ese benchmark es aproximadamente199.6MB; no es un pico dentro de la extracción ni VRAM. Estos costes no son FPS: excluyen integración física, GL, subida y dibujo. Las diferencias pequeñas entre corridas no certifican una optimización causal.

Costes focales adicionales: autocontacto ordinario .1585→.1860ms/rig/tick; soporte geométrico normal construye consulta en mediana.680ms/P951.091 y consulta200centros en1.372/P951.785ms. Son CPU aislada y modelos de prueba; no se suman indiscriminadamente. Ver planes R7 y arbitraje independiente.

## Cortes anteriores

# Rendimiento observado — WaterDuel 1.1

Fecha: 2026-10-17. Estos resultados corresponden a casos concretos. No acreditan 60 FPS sostenidos en todo PC, 30 FPS en una tablet ni latencia física de dos teléfonos.

## Entorno y método

Windows 10 x64, Intel Core i7-9700K, ocho procesadores lógicos, 34.262.712.896 bytes de RAM informados por Node, Node v24.20.0. GPU no identificada: la consulta CIM fue denegada. Navegador Chromium integrado de Codex con WebGL2 real. Registro: `benchmarks/results/entorno.json`.

La arena registra intervalos RAF mientras el documento está visible y retiene los últimos 300. FPS medio es `1000 / media(frameMs)`; mínimo es el inverso del mayor intervalo; P95 usa orden estadístico. CPU de simulación y envío de render se mide con `performance.now()`. El envío de comandos no mide su ejecución en GPU. `heapPeakBytes` es el máximo de heap JavaScript informado desde la carga, no memoria total del proceso ni VRAM.

Las capturas y el redimensionado se realizan aparte de la ventana quieta de medición. Durante esta sesión también se observaron ventanas con intervalos de 150–166,7 ms al operar/capturar la interfaz. En la ventana documentada de esas operaciones se observaron **56,78 FPS medios, mínimo 6,66 FPS y máximo intervalo 150,1 ms**, con pico de heap JS 104.229.053 bytes. Fuente: `browser-ronda4-con-capturas.json`, transcripción explícita del diagnóstico DOM. No se atribuye causalidad exclusiva al capturador. La ventana quieta no demuestra ausencia de tirones durante esas acciones.

## Navegador real

Duelo Versus, ALTA, arena Atelier, cámara general, canvas CSS de 835 × 528, ambos contendientes intactos y sin entradas durante la ventana. Son aproximadamente cinco segundos, sin estallidos ni teléfonos conectados.

| Métrica | Antes del ciclo 4 | Ciclo 4, superficie interior |
|---|---:|---:|
| Muestras RAF | 300 | 300 |
| FPS medio | 60,00 | 60,00 |
| FPS mínimo de la ventana | 59,17 | 59,52 |
| Intervalo P95 | 16,8 ms | 16,8 ms |
| Mayor intervalo | 16,9 ms | 16,8 ms |
| CPU simulación, media | 0,221 ms | 0,141 ms |
| CPU envío de render, media | 4,440 ms | 4,677 ms |
| Pico de heap JS desde la carga | 99.194.053 bytes | 95.008.045 bytes |

Fuentes: `benchmarks/results/browser-versus-high.json` y `browser-ronda4-versus-high.json`. Son ejecuciones distintas con cachés, calentamiento y actividad del sistema no controlados; las diferencias pequeñas no son una mejora causal certificada. La segunda ventana precede a los ajustes posteriores de liberación/superficie externa, que no se ejercitan en este caso intacto.

También se inspeccionaron resoluciones de viewport 390 × 844 y 1024 × 768. Esas capturas verifican disposición y encuadre en Chromium de escritorio, **no rendimiento ni soporte de dispositivos físicos**. Los errores/warnings de consola capturados en la revisión fueron cero; no se hizo un ensayo prolongado.

## CPU de fluidos

Ejecutar desde la carpeta del juego:

```text
node benchmarks/fluid.mjs repeticion-local
```

El benchmark usa cinco muestras útiles después de dos de calentamiento; reporta mediana y P95. Integrar 120 pasos mide un segundo físico completo, no un frame. La reconstrucción de malla mide una llamada, cuya cadencia depende del perfil. No sumar indiscriminadamente esos tiempos ni convertirlos en FPS.

`fluid-final.json` conserva el corte previo al ciclo 4. Los resultados de superficie interior y de herencia del slosh se guardan por separado, con etiquetas de procedencia. El informe de arbitraje final determina qué cambios posteriores han sido revalidados.

## Coste final de la continuidad volumétrica

Fuentes reproducibles: `volume-field-before.json` y `volume-field-after.json`. El segundo usa campo compacto ponderado por volumen y calibración por componente; no escala una malla ya terminada. En el estado inmóvil inicial, el error de volumen libre es −0,0365% ECO, −0,0097% ALTA y +0,0068% ULTRA en el benchmark del Constructor. El Árbitro ejecuta sus propios fixtures.

| Reconstruir una superficie tras 0,2 s simulados | Antes, mediana CPU | Después, mediana CPU |
|---|---:|---:|
| ECO | 9,87 ms | 25,79 ms |
| ALTA | 11,20 ms | 31,22 ms |
| ULTRA | 15,36 ms | 56,89 ms |

Es una **regresión de coste** a cambio de corregir la inflación de volumen y su independencia de `p.volume`. Se conserva la cadencia de reconstrucción por perfil. La caché reduce frecuencia, pero no elimina el pico de cada llamada. No se garantiza 60 FPS durante el efecto. Al agotar presupuesto se usa únicamente el lote de todas las gotas volumétricas, sin malla truncada superpuesta; el volumen de unión de gotas solapadas sigue siendo aproximado.

Se repitió una medición real tras recargar el producto congelado, con un único evento demo y sin suites CPU simultáneas. `browser-final-burst-high.json` contiene **35 muestras de fase burst**, aproximadamente **0,684 s iniciales**: **51,21 FPS medios, mínimo 20 FPS, P95 33,3 ms y máximo intervalo 50 ms**. CPU media: simulación 2,263 ms y envío de render 11,149 ms; pico de heap JS de esa carga 80.532.824 bytes. El agregado de 300 frames incluye ready y no es el FPS del estallido. `browser-final-ready-high.json` conserva su contexto previo.

La secuencia visual de 60 frames y 3,662 s se capturó aparte. No se utiliza para calcular rendimiento. Esta medición breve no acredita todo el efecto, dos rupturas simultáneas ni una sesión sostenida. En otras cargas de esta QA se observaron picos de heap JS de hasta 157.697.024 bytes; son ejecuciones distintas, no un ensayo de fugas ni memoria total.

## Mediciones pendientes

GPU por pase/frame; carga fría y caliente; memoria total y VRAM; temperatura; sesión larga/fugas; dos estallidos simultáneos en varios equipos; tablets reales; Android Chrome/iPhone Safari/Firefox; jitter/pérdidas Wi-Fi; input-to-photon; partida con WAN desconectada y dos teléfonos: **NO MEDIDO**.

El servidor de pruebas local y los relojes simulados verifican contratos de secuencias, edad y reconexión. No sustituyen esas mediciones físicas. No se añadieron dependencias ni telemetría para obtener los datos.
