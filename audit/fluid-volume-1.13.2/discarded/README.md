# Agua y presentación — candidatos descartados

No queda cambio de producción ni prueba activa de estos cuatro candidatos. `final-sources.json` conserva el cierre de los tres primeros; `final-sources-hoist.json` verifica la restauración final byte a byte después de la hipótesis adicional solicitada. Renderer, engine y manifiestos históricos no se editaron.

## Perfil breve previo

`profile.json`/dos perfiles CPU: reconstrucciones HIGH frescas de nube200 a24pasos14–18ms; nubes históricas de contacto real a120pasos10–16ms y370pasos16–29ms (muestras cortas con JIT/GC, no presupuesto garantizado). Integrar72pasos/.6segundos físicos de liberación200/260 empleó34/32ms; parcial11/10ms. La superficie fue el costo mayor. `fluidSurfaceComponent`196ms propios incluye inlining; no se atribuye entero a densidad. `enclosed`77ms, emisión73ms, GC33ms durante561ms muestreados. Se leyeron y no repitieron axis-distance, bloques de calibración y lazy-tetra históricos ya rechazados.

`presentation-profile.json`:200capturas propias/100vistas de cinco estados reales de solver tras ruptura por API, captura75.36ms/vistas100.55ms bajo sampler. No representa pinchazo competitivo ni frame/GPU. El experimento de doblebuffer sólo llegó a test RED y se abandonó antes de implementar: consumidores pueden retener previous/current.

## Vecinos por celda

RED5600consultas frente5600; GREEN10/10 con parcela/velocidad/Float32 correcciones, claves remotas, liberación parcial/full normal/jefe, mutaciones y CCD sólido/detach. El candidato reduce consultas y mantiene orden exacto de todos los pares. Pareado único4ABBA yA/A, igual72pasos/.6segundos físicos, sin sólidos/renderer. Ahorro agregado nearest-rank3.53% frenteA/Amax7.56%; parciales200/260 empeoran3.94%. Se descarta sin ajustar parámetros. Raw completo `neighbor-paired.json`; fuente `neighbor-candidate.js.txt`; test ejecutable `neighbor-query.test.mjs`.

## Map temporal de presentación

Capturas y poses mantuvieron propiedad e identidades originales; sólo se reutilizó un Map scratch para eliminar nueve Map y arrays de pares por vista. RED9vs9; GREEN13/13 de referencias completas, snapshots retenidos, fuente/vida/topología, interpolación y marcas. La extensión experimental duplicados/interleaving se corrigió después del último GREEN al detectar una vista extra sólo enB (serial distinto); no se suma a13/13 como corrida realizada.

El primer harness de timing comparó seriales de instancias con A/A (más vistasA) y falló antes de escribir recibo. Se conserva fuente/log `presentation-paired-invalid-serial.*`; no hay medición válida atribuida a esa ejecución. El harness corregido valida antes/después con instancias NUEVAS que reciben capturas/vistas simétricas. No cambia producto ni criterio. Cada ronda deja checkpoint antes del recibo final.

Única corrida válida:4ABBA por5estados,24capturas/12vistas por muestra, A/A intercalados. Razones agregadas `[0.634317,1.058685,0.937616,1.013537]`, rango0.6343–1.0587. El helper nearest-rank produjo `keep:true` con−6.24%, pero **la mediana convencional es0.975577 (−2.44%) y queda dentroA/Amax4.758%**. Dos rondas empeoran. Por revisión conservadora se descarta; no se usa el gate débil para promover. Raw completo `presentation-paired.json`, fuente `presentation-candidate.js.txt`, test/corpus archivados fuera suite.

## Rechazo axial de pares de soporte

Única alternativa autorizada después de descartar presentación. Conserva recorrido i/j, operaciones de los pares posibles y todas las uniones; rechaza sólo un eje imposible. RED19900distancias completas en ambas fuentes. GREEN10/10: todas posiciones/normales Float64 y estadísticas, nubes reales enECO/HIGH/ULTRA, densas, kernel expandido, clipping, presupuesto, tangencia, signed-zero, underflow y overflow (prefix real del agrupamiento para extremos sin construir dominios infinitos).

Último pareado único de10casos HIGH/ULTRA,4ABBA/BAAB yA/A; tres reconstrucciones frescas por muestra, cuatro pareswarmup, sin renderer/caché/GPU/FPS. Mediana convencional de razones agregadas **1.040314 (+4.03%CPU)**, A/Amax2.458%; rondas `[1.062945,1.032625,1.048002,0.993361]`. La geometría y estadísticas resultan exactas en cada caso, pero el costo es peor. Se descarta sin retocar/repetir. Raw `axial-paired.json`; fuente `axial-candidate.js.txt`; test ejecutable `surface-axial-groups.test.mjs`.

## Hoisting Y/Z sin tablas — hipótesis adicional solicitada

Tras el cierre anterior, el coordinador solicitó una variante diferente del axis-distance histórico: subir sólo las coordenadas, diferencias y productos Y/Z a sus respectivos bucles, sin arrays/tablas. Se conservan `(dx²+dy²)+dz²`, el recorrido z/y/x, normalCells/candidatos y bounds. El análisis independiente del sampler original observó39positionTicks en diferencias/r2 y43en peso, que motivaron el intento sin atribuirles todo el costo de densidad.

RED78215diferencias por eje en ambas fuentes; GREEN10/10 de comparación estricta y oráculos históricos. X queda78215, Ybaja10482 (−86.60%) yZ1478(−98.11%). Geometría, normales, estadísticas y propiedad de arrays anteriores permanecen idénticas. Los contadores son sólo un mecanismo, no una medida de ahorro temporal.

Único pareado válido con el MISMO harness/metodología/corpus/gate axial (sólo nombres de recibos y candidata cambian):4ABBA/A/A,10casosHIGH/ULTRA,3rebuilds/muestra,4pareswarmup, mediana convencional. Razones agregadas `[1.002472,1.008646,0.942034,0.975452]`; **mediana0.988962(−1.10%) frenteA/Amax9.937%**. Rango0.9420–1.0086. HIGHtemprano/medio empeoran36.89%/9.07%; HIGHtardío mejora9.38%, pilaHIGH11.26%, sin consistencia global. Se descarta sin ajustar ni repetir. Fuente bb55403e70e996fa9012dc50e63ad4efaa277edd23fee679e903c4642cdc0590; raw `hoist-paired.json`, test ejecutable `surface-axis-hoist.test.mjs`, fuente `hoist-candidate.js.txt`.

Los cuatro recibos y checkpoints permanecen completos. Ninguna cifra se presenta como mejora del juego, reducción de latencia o garantía de60FPS. La eliminación de cámara lenta pertenece al coordinador y no se mezcló con estas comparaciones de igual tiempo físico.
