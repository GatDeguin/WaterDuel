# Desarrollo1.4 — evidencia actual y alcance

- Taller activo `workshop-runtime-v3.glb`, personajesv3 y equipamientov2. `scripts/verify-workshop-runtime-v3.mjs` comprueba hashes, conservación de materiales/UV y siete separaciones positivas; no hay cruces externos en los cinco conjuntos corregidos. Las versiones y fuentes editables anteriores se conservan.
- Captura principal real `WaterDuel-v3-escena-falda.jpg` en la carpeta de visualizaciones de esta conversación: taller v3, plano despejado y rival con globo/faldón dorados. Contiene QR de una sesión viva y se mantiene fuera del paquete offline. No es una imagen generada ni una prueba de partida completa.
- `tests/apron-color.test.mjs` y `opponent-loadouts.test.mjs`:14/14 en la comprobación del Principal. La tela del faldón sigue el matiz del globo sólo en rivales aleatorios de Duelo IA; herrajes, madera, mapas y rugosidad conservan sus materiales. La opción se preserva en rondas, revancha y replay.
- QA local sin autenticación: `audit/qa-postura-agachado-v3.json/.jpg` y `qa-postura-finta-v3.json/.jpg` muestran la pose física, apoyos, centro común de cabeza/agua/membrana y retorno. La captura de finta pausa explícitamente sólo el planificador del fixture para inspeccionar su pico. No se presenta como interacción remota o vídeo continuo.
- Mando: `audit/qa-mando-postura-320-v3.jpg` y `qa-mando-postura-640-v3.jpg` verifican guías de arriba/finta y abajo/agacharse, estética y dos pads visibles. El viewport de escritorio incluye barra de scroll; no acredita teléfono físico, sensor o vibración. Los resultados Seguir/Revancha se conservaron en capturas anteriores y pruebas de flujo.
- Items: `audit/ITEMS_INTEGRACION_SELECCION.md` y `qa-items-*.json/.jpg` prueban selección/intercambio, arma secundaria y agarres de mazo en WebGL real, sin transporte autenticado. Los recibos de Audio describen síntesis/enganche; no se afirma escucha en todos los equipos.
- Inicio durante carga: la barrera autoritativa rechaza iniciar/avanzar y congela reloj/recorder hasta que la presentación se resuelva;107/107 focales en `audit/TESTS_BARRERA_CARGA_FINAL_1.4.txt`. A14-I01 cerrado por reataque propio del Árbitro,49/49host/móvil,2/2relayreal/VM y5/5probe positivo, en `audit/ARBITRAJE_PREACEPTACION_1.4_ACTUAL.md`.
- Rendimiento posterior a global03: preparación60FPS y ruptura física30,88a720p, GLsin errores; fuentes enumeradas por la suite cotejadas después sin cambios. Las corridas anteriores de1080están fechadas aparte. Detalle, archivos y límites en [RENDIMIENTO.md](RENDIMIENTO.md). No se afirma60FPS para todo el juego ni mejora causal por diferencias pequeñas.
- La global01 fue interrumpida y no se cuenta. La global02 terminó803pruebas,793PASS/10FAIL, con fuentes estables; **corte rechazado**, detalle en `audit/REGRESION_CONJUNTA_02_1.4.md`. Después de corregirlos, global03 ejecutó102archivos y aprobó **810/810**, cero fallos/omitidas,237.551ms y fuentes/oráculos estables antes/después: `audit/corte-1.4-actual-03/receipt.json`. Las pruebas focales se solapan y no se suman como global. Paquete1.4 reproducible y verificación extraída aún tienen recibos propios pendientes; entrega1.3 preservada.

## Historia R8 — evidencia de un corte anterior

- `audit/BRECHA_FOTOREALISMO_REFERENCIAS.md` compara las cuatro referencias originales con16PNG completos de ejecución real, estados y hashes. No convierte renders Blender nuevos en capturas del juego.
- `screenshots/35-ronda8-antes-latex.png`, `36-ronda8-latex-cine.png`, `37-ronda8-latex-neutro.png`: fixture del motor real, antes/después óptico. El pigmento es más legible y el espesor continuo evita cambios bruscos por triángulo; el agua todavía parece opalescente.
- `/qa/shadow-checks.html` y `benchmarks/results/round8-shadow-gpu.json`: GPUrealPASS, sombra0/luz255/borde85, muestra pasa0→255 al mover oclusor yGL0. Renderer integrado: mapa1024²/4MiB/511draws de sombra/1061totales. CPU4.5ms de primera captura no es tiempoGPU ni coste sostenido. Captura39.
- Captura38: reproducción de un contacto auténtico en partida que terminó0–3 al mejor5. La UI permite scrub y anuncia pausa. El árbitro ejecutó las funciones reales de transporte/loop en VM60RAF sin updates/observe/record ni mutación de estado/frames. Recibo temporal de reloj en navegador sigue pendiente del corte estable.
- `session-integration.test.mjs`: tutorial desde acciones físicas, primerimpacto inmediato no pierde objetivo, tres zonas de precisión completadas con mandos/muñeca y contactos reales y replay propio con agua/látex. El árbitro repitió3/3. No es prueba con teléfonos o habilidad humana.
- `ai-styles.test.mjs`: siete estilos perforan legalmente; defender/counter completan partidas. No prueba balance frente a personas. Reataque y arbitraje propios están en audit/.
- Globalintermedia `audit/TESTS_RONDA_8.txt`:300/300 en184.497s. Comenzó antes de los cambios concurrentes de Items; no certifica el código conjunto actual ni un ZIP nuevo. Las pruebas focales se solapan, no se suman.
- `audit/COORDINACION_PROYECTO.md` fija namespaces y handoffs. Personajes entregó assets validados por su productor; Escenografia e Items continúan sus entregas. Falta integración/QA conjuntos y benchmark sin carga concurrente de Blender/tests. Entrega1.3 preservada.

---

# Corte R7 — verificación histórica entregada en1.3

- `28-ronda7-antes.png` / `33-ronda7-duelo-completo.png`: juego real, arena completa. `31`/`32`: detalle final/neutro en fixture del mismo motor/renderer. No se usaron imágenes generadas para acreditar ejecución.
- `/qa/optics-checks.html`, `round7-optical-depth.json`: dos espesores medidos en textura GPU; material intacto/rasgado con el mismo pixel ante la misma geometría, GL error cero. Captura `29` es el primer corte del fixture; JSON actualizado contiene también comparación de película.
- `/qa/physical-sequence.html`: calienta el rig 80 pasos, fuerza una perforación conocida y vuelve a simular el número elegido de actualizaciones. `ruptura-ronda7/secuencia.json` registra método/estado. No se presenta como vídeo ni fotogramas consecutivos de una sesión.
- Cuadros 0/4/8/20/80/300: volumen .17764203518124735 u³ constante; retenidas 200/90/29/0/0/0, libres complementarias, fracturas 1/3/3/11/15/15, GL error cero. No acredita interacción competitiva humana ni CFD validado.
- Ventana `round7-browser-versus.json`: 300 RAF quietos de Versus, 1918×1078, ALTA, 59.995 FPS medios/P95 16.8 ms. No es benchmark de burst sostenido ni tiempo GPU.
- Crítico y Árbitro verificaron por separado soporte geométrico, autocontacto, ledger, óptica y recursos. Ver informes R7 y recibo final de entrega extraída. Las cifras focales se solapan.

Las evidencias anteriores se conservan abajo con su corte temporal.

---

# QA y procedencia de evidencia — historia 1.1 y avance 1.2

## Corte 1.2 / R6

El detalle de capacidades/pruebas actuales está en `CHANGELOG_1.2.md`, los planes R6 y `audit/ARBITRAJE_RONDA_6.md`. Capturas nuevas:22GPU,23detalle neutral,24detalle cinematográfico,25jefe neutral y26duelo completo. `screenshots/ruptura-ronda6/` contiene36 fotogramas consecutivos de una demo escenificada durante2.415s de pared, con retracción/agua calculadas realmente; no certifica una jugada competitiva ni FPS sin captura.

`benchmarks/results/round6-browser-versus.json`: Chromium integrado, ALTA, Versus intacto sin órdenes, viewport1918×1078,300RAF:59.9976FPS medios, mínimo59.1716, P9516.8ms; CPU simulación3.42ms/render3.57ms de media, pico heap JS299405605B. Dos destinos HDR lineales contabilizan49622496B. Son una ventana quieta y un presupuesto de attachments, no memoria total ni garantía de rendimiento. Durante capturas del estallido se observaron P9533.3ms y mínimos20FPS: el coste de captura está incluido. Tiempo GPU y latencia Wi-Fi física siguen NO MEDIDOS. Consola sin errores/avisos y gl.getError=0 en la inspección final.

El fixtureGPU de composición devolvió RGB200 esperado200 en RGBA16F. Los módulos GL simulados comprueban contratos/limpieza; la evidencia GPU y las capturas son independientes. La apariencia sigue mucho más sencilla que R1–R4; agua, luz/material y animación no reciben certificación fotográfica por estas pruebas.

También se provocó pérdida/restauración con `WEBGL_lose_context` en la arena real: se observó el aviso de recuperación, volvió a ocultarse al reconstruir y se comprobó `isContextLost=false`, `getError=0`, escena nuevamente visible. Captura27. Es una recuperación ensayada, no una prueba de estrés prolongado.

## Historia 1.1

Registro: 2026-10-17. Este documento reúne artefactos y límites. No sustituye los informes independientes de `audit/`, ni convierte un resultado histórico en aceptación de archivos modificados después. El cierre final del ciclo 4 queda reservado al pie.

**IMPLEMENTADO**: integrado. **VERIFICADO**: prueba pertinente aprobada para el caso descrito. **VISUALMENTE VERIFICADO**: resultado renderizado inspeccionado. **MEDIDO**: registro cuantitativo con método y alcance. **APROXIMADO**: modelo reducido. **PENDIENTE**: falta implementación suficiente o evidencia. Ninguna etiqueta implica equivalencia con R1–R4.

## Capturas reales

Las capturas proceden de Chromium integrado, con WebGL2 real para la arena. Los originales `docs/referencias/w1.png` a `w4.png` y las copias JPG son objetivos artísticos, no resultados del juego.

| Artefacto en `screenshots/` | Evidencia | Límite |
|---|---|---|
| `00-ronda-1-base.png`, `01-antes-materiales.png` | Estado visual anterior | Historia, no aprobación final |
| `02-duelo-general-real.png`, `03-guardia-real.png` | Arena, HUD y pose defensiva previos a R4 | Una pose no prueba bloqueo efectivo ni partida completa |
| `04-detalle-materiales.png`, `05-detalle-luz-neutra.png` | Inspección previa de articulaciones/materiales | Son el antes del agua interior de R4 |
| `06-jefe-antes-agua.png` | Presentación previa del jefe | No acredita patrones ni balance |
| `11-ronda4-general-cine.png` | General en espera, HUD y superficie interior | Cartel inicial tapa parte central; no es combate |
| `12-ronda4-detalle-cine.png`, `13-ronda4-detalle-neutro.png` | Frontera agua/aire, brazos y herrajes en detalle | Estáticas; no prueban slosh temporal ni refracción real |
| `14-ronda4-jefe-detalle-neutro.png` | Escala del jefe e interior bajo luz neutra | No prueba la transición completa de ruptura |
| `15-ronda4-jefe-combate.png` | Estado de combate del jefe y HUD | Un fotograma no acredita una jugada humana |
| `16-ronda4-resultado-jefe.png` | Resultado visible 0–2 y agua en tarima | No contiene la secuencia ni prueba contrajuego humano |
| `17-ronda4-duelo-general.png` | Versus activo, globos intactos e interior | No acredita teléfonos conectados |
| `18-arena-responsive-390x844.png`, `19-arena-responsive-1024x768.png` | Disposición con esos viewports de escritorio | No son teléfono/tablet físicos |
| `10-mando-movil-sin-sesion.png`, `20-mando-controles-inferiores.png` | Pads, inclinación, botones, muñeca y aviso de QR requerido | Vista sin token/sesión; no acredita control autenticado ni Wi-Fi |
| `21-entrega-duelo-general.png` | Versus activo sobre código congelado, HUD y agua interior | Teclado/sin teléfonos; captura separada de las mediciones |

La captura 10 se sustituyó después de detectar una primera versión blanca. La versión inspeccionada para este registro muestra controles; la 20 incluye el aviso de ausencia de sesión. No se acredita la captura blanca anterior.

## Demo y continuidad del agua

`screenshots/estallido/secuencia.json` declara **botón demo con punción escenificada; no resultado competitivo**. Registra 27 imágenes, `frame-000.png` a `frame-026.png`, con marcas temporales no uniformes. Es una secuencia real del corte previo a R4, no vídeo a cadencia fija, benchmark de FPS ni prueba de un ataque humano. No valida automáticamente la liberación/superficie externa tras el ciclo 4.

El contrato interior usa `WATER_RADII=(.392,.456,.365)` y **65% de capacidad en volumen**, no 65% de altura. Capacidad elipsoidal nominal: **.2732954387403816 u³**; `HEAD_VOLUME`: **.17764203518124805 u³** a escala 1. El jefe con escala de globo 1.16 conserva el factor cúbico: **.2772807421462693 u³** de agua. Las unidades no están calibradas como litros.

`cycle4-contained-water-comparison.json` registra errores del cap geométrico frente al ledger de aproximadamente −1.338% ECO, −.635% ALTA y −.336% ULTRA. Son errores de esa malla contenida, no precisión universal de la superficie externa. El JSON declara que el antes se copió de mediciones previas de la sesión; no se volvió a ejecutar la implementación antigua.

`release-slosh-before.json` y `release-slosh-after.json` conservan un contraejemplo de herencia de velocidad interna. En ese fixture la diferencia máxima de salida pasa de 0 a .3919510539; el error posterior de diferencia de momento X es aproximadamente −5.33e−14. Es evidencia de una transición concreta, no validación energética general o CFD.

La auditoría y las reproducciones independientes de ronda 4 aceptan R4-01/02/03 en sus casos. R4-03 se corrigió con un campo ponderado por volumen y calibración por componente, sin mover una malla ya calculada. El reataque también comprueba volumen/2, escala, contactos, cierre, presupuesto y fallback. La tolerancia observada es menor del 0,05% en esos fixtures; no se declara exactitud universal, CFD validado ni refracción real.

La secuencia final `screenshots/estallido-ronda4/` contiene **60 frames reales y 3,6622269 s** según `secuencia.json`. Frame 000: espera; 005: comienzo de apertura; 020: apertura/agua libre; 040: cuerpo inclinado y agua en tablas; 055/059: siguiente ronda, cuyo reset limpia los efectos. Es **demo escenificada**, no detección competitiva demostrada por vídeo. Cadencia variable; los primeros frames preceden a la acción. No se han generado/interpolado imágenes ni usado esta captura para medir FPS.

| Vista solicitada | Evidencia disponible | Alcance |
|---|---|---|
| 1. Duelo general | Captura 21 | Motor final real |
| 2. Articulaciones | 12/13 | Detalle estático cine/neutro |
| 3. Globo intacto oscilante | Frame 000 y pruebas de slosh/membrana | No secuencia de indentación localizada previa a contacto |
| 4. Contacto competitivo de perforación | Pruebas `collision`/`rules` | Fotograma competitivo exacto **no capturado**; demo no lo sustituye |
| 5. Ruptura inicial | Frame 005 | Evento demo real con entrada escenificada |
| 6. Liberación de agua | Frame 020 | Superficie/partículas del motor |
| 7. Estado posterior | Frame 040, luego 055 | Agua/caída y limpieza normal de ronda |
| 8. Jefe individual | 14/15/16 | Escala, HUD y resultado; no balance humano |
| 9. Interfaz PC | 21 y 19 | Chromium de escritorio |
| 10. Mando móvil | 10/20 | Viewport de escritorio, sin sesión |

## Mediciones y entorno

Método y cifras completas: [RENDIMIENTO.md](RENDIMIENTO.md). `benchmarks/results/entorno.json` declara Windows 10 x64, i7-9700K, ocho procesadores lógicos, Node v24.20.0 y Chromium integrado/WebGL2 real. GPU **no identificada** por consulta CIM denegada; dispositivos físicos **no validados**.

`browser-versus-high.json`, `browser-ronda4-versus-high.json` y `browser-ronda4-con-capturas.json` registran 300 intervalos visibles, ALTA, Versus/fight y canvas CSS 835×528. La ventana quieta R4, con globos intactos y sin entradas, registra FPS medio **59.9976**, mínimo **59.5238**, intervalo P95 **16.8 ms**, CPU media de simulación **.141 ms**, CPU de envío de render **4.6767 ms** y pico de heap JS **95,008,045 bytes** desde la carga.

Son unos cinco segundos en ese entorno, antes de ajustes posteriores de liberación/superficie externa; no ejercitan estallido. No miden tiempo GPU, memoria total/VRAM, temperatura ni sesión larga. Capturas de inspección también muestran mínimos bajos durante operación/captura; la ventana quieta no garantiza ausencia de tirones. Ejecuciones antes/después no controlan todo el sistema y no prueban mejora causal por diferencias pequeñas.

`fluid-final.json` corresponde al corte **previo al ciclo 4**, aunque su etiqueta diga `final`. Los registros de interior y slosh están separados. Integrar 120 pasos mide un segundo físico, no un frame; reconstruir una malla mide una llamada. No se convierten esos tiempos CPU en FPS de GPU/tablet.

`volume-field-before.json` / `volume-field-after.json` y el comando `node benchmarks/fluid.mjs etiqueta --output ruta.json` permiten repetir los fixtures de la corrección final. Conservan la regresión de coste; no se selecciona la cifra favorable de una implementación anterior. `browser-final-burst-high.json` registra tras recarga un único evento demo: subventana **35 frames burst**, 51,207 FPS de media, mínimo 20 y P95 33,3 ms. Solo son aproximadamente 0,684 s iniciales; no garantiza el efecto completo a 60 FPS. La secuencia visual se capturó aparte.

`browser-local-resources.json` registra peticiones de la pestaña en recargas de QA con consultas/cabeceras omitidas: origen `http://localhost:8787` y recursos `data:` de origen nulo. La revisión estática tampoco encontró CDN/imports remotos de ejecución. Esto verifica recursos locales del caso, no la prueba física con WAN desconectada y teléfonos.

## Mando, LAN y pruebas automatizadas

La política de seguridad de URL de QA bloqueó abrir el mando LAN autenticado; no se intentó eludirla. Las capturas 10/20 muestran el mando sin sesión y no sustituyen ese ensayo.

`tests/controller.test.mjs` ejecuta `controller.js` real en VM con DOM/WebSocket externos mínimos: multitouch independiente, neutralización, liberación de captura, teclado y clocksync con desfases ±120000 ms y RTT simulado. Su ejecución enfocada documentada pasó **15/15**; junto a los siete tests de empaquetado, **22/22**. Es un corte enfocado, **no el total final**.

Red/búfer y arbitrajes ensayan servidor aislado, secuencias, pulsos, antigüedad acumulada, reconexión, autoridad única y rotación acelerada de sesión. Segunda arena: `HOST_BUSY`. Tablet: posible **única anfitriona**, sin mirror/espectador. TTL predeterminado: cuatro horas; una prueba acelerada no equivale a cuatro horas reales.

**No realizadas:** partida con dos teléfonos físicos, input-to-photon/Wi-Fi físico, WAN desconectada con dispositivos, sensores/vibración, ergonomía multitáctil, tablet anfitriona física, lectores de pantalla y sesión larga/térmica. La lista manual permanece sin marcar hasta tener resultados.

## Cierre y comprobante de distribución

Se incluyen juego/servidor/mando, recursos locales, lanzadores, instalación/LAN, pruebas, benchmarks, matriz, límites, auditorías y registros de corrección. `pack:offline` tiene pruebas con programa real en fixtures temporales, lector independiente, CRC y reproducibilidad. La confirmación del ZIP final se registra aparte en `release/VERIFICACION_ENTREGA.json`, acompañante externo: evita introducir el hash del ZIP dentro de sus propios bytes.

| Cierre | Evidencia y alcance |
|---|---|
| R4-03 / reataque / árbitro | `audit/AUDITORIA_RONDA_4.md` y `ARBITRAJE_RONDA_4.md`: fixtures independientes, decisión, tolerancia y hashes de código |
| Secuencia final de ruptura R4 | 60 PNG y manifiesto temporal, 3,662 s, demo escenificada |
| Suite congelada | Root: `npm test`, 149/149, 0 fallos, 9,640 s, `audit/TESTS_ENTREGA.txt`; Árbitro: 149/149, 10,001 s |
| Mediciones finales | JSON ready/burst posteriores a congelación; capturas anteriores al campo externo conservan alcance intacto/estático |
| ZIP reproducible | `release/VERIFICACION_ENTREGA.json`: tamaño/SHA-256 de dos empaquetados del mismo árbol |
| Extracción, manifiesto y arranque | El mismo comprobante externo informa solo los casos realmente ejecutados sobre el ZIP final |

Los 55/100 de ronda 3 pertenecen a su corte previo a QA visual/ciclo 4. El puntaje vigente y sus límites están en el arbitraje 4; aquí no se recalcula. Los informes del Crítico/Árbitro se conservan sin edición. Documentación V1 y roadmap son antecedentes históricos, no contrato de parámetros de 1.1.

## Amendamiento actual: PC sólo escena y menú móvil

Las capturas anteriores con HUD/paneles son antecedentes del diseño previo. `screenshots/42-pc-solo-escena.png` muestra el documento actual en WebGL2 real: `body` contiene sólo CANVAS/SCRIPT, texto vacío y canvas1280×720 desde(0,0), coincidente con el viewport. Recibo: `benchmarks/results/screen-only-dom.json`. No certifica calidad artística frente a las referencias ni FPS sostenidos.

`43-menu-movil-390.png` y `44-menu-movil-horizontal.png` usan el fixture estático de markup/CSS actual, sin controlador, credenciales, sockets ni comandos. Se midió390×720 y844×390, sin desborde horizontal y sin objetivos button/select/range menores de48px. `benchmarks/results/menu-layout-qa.json` declara ese alcance; no son capturas de teléfonos físicos ni de mando autenticado.

`audit/VERIFY_SCENE_HOST.mjs` ejecutó12comandos autenticados porWebSocketNode contra la arena de GPU abierta en el navegador. `benchmarks/results/screen-only-host.json` documenta inicio real, rechazo de arena durante cuenta atrás, préstamo/restauración de equipo y formato, y reinicio. El recibo espera estado posterior alACK; no usa invitaciones en su salida ni asigna poses/puntos. No sustituye el navegador del teléfono ni radioWi-Fi.

La revisión `audit/REATAQUE_PANTALLA_SOLO_JUEGO.md` cierra cinco defectos concretos con pruebas propias: cambio de arena inseguro, carrera de selección trasACK, pulsación pendiente al abrir menú, control desde socket retirado y error de render invisible en el móvil. El último caso usa unDTO de prueba: no acredita recuperación física deGPU. El repro de socket retirado sí usaTCP real semiabierto.

La global de ese corte terminó con salida0: **416/416**, sin fallos, cancelaciones, omisiones ni pendientes;168142.5767ms. Registro `audit/TESTS_PANTALLA_SOLO_JUEGO.txt`. Es anterior a la integración gráfica completa y a la petición posterior de dos QR pequeños. Los conteos focales se solapan; no se agregan a416.

## Integración de entregas, postura, luz y mandos

El corte conjunto posterior pasó **528/528**, salida0, sin omisiones ni pendientes;166787,0417ms. `audit/TESTS_INTEGRACION_REFERENCIAS_FINAL.txt` y `VERIFICACION_INTEGRACION_528.json` conservan log y hashes. Incluye cuerpos v2/equipo/taller, Audio, pose física ampliada, desplome, luces orientadas/sombras, cámara frontal, joysticks y QR. Es anterior al arreglo específico del accesorio del jefe que detectó el reataque; no certifica cambios posteriores a esos hashes.

En la arena real se observaron los once recursos cargados, cámara frontal de la referencia, QR J1/J2 y desplome durante ruptura, con cero errores de consola. La captura de la sesión viva se guarda fuera del paquete porque contiene invitaciones vigentes. La revisión de joystick utiliza `audit/joysticks/` y el fixture local sin transporte: arrastre fuera del área con captura, retorno/teclado y layouts320..1440 sin desborde. La independencia de dos pointerId se ensaya en VM, no en dos dedos físicos.

`screenshots/45-filtro-color-pbr.png` y `benchmarks/results/asset-color-gpu.json` prueban el filtrado sRGB de hardware en el shader real (pixel150 esperado150, GLerror0). Las métricas `assets-ready-high.json`/`assets-fight-high.json` pertenecen a la integración previa al último ajuste de iluminación/cámara: se mantienen como antecedentes y no se extrapolan al corte final. La simulación actual conserva la aproximación2.5D y el render no equivale a GI/áreas exactas/CFD.
