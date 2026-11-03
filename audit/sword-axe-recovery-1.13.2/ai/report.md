La integración conserva la política de IA publicada. La separación geométrica inicial de armas se limita al modo `versus`; el modo `solo` conserva las bases de apertura y el recorrido anterior. La recuperación compuesta de armas permanece en `weapon-bind.js`.

El corte de motor es `b06cbb0b67d2bb90985a9d6a56b50a2a19ce1675ff6e070a97ce885690e26da6`. Sólo añade dos guardas `mode==='versus'` sobre el corte geométrico `3362eeb0…`: aplicación de la pose inicial y limpieza de observaciones de contacto al reiniciar. Las bases `3.8/4.0` ya existían en `AB55`; no cambian.

El cuerpo completo de `updateAI`, desde su declaración hasta `#setAIState`, tiene SHA-256 `4882c9396be21d67b242859144bab5b59be6ac4743de6c564cf37b2e5773d980` tanto en el corte final como en el motor publicado `ab55912da7216cdb3e8a5c8c52d5fcf9f68026e6981f3e19c8471b33f7dd9d2d`. El test histórico `tests/ai.test.mjs` mantiene SHA-256 `0c3566caa07f623240a7d3e511b0eca6ae2206e92760dd511f1055f761424d0e`.

La búsqueda de una reparación de IA produjo seis candidatos privados. Ninguno se integra:

| Candidato | Hipótesis y prueba observada | Decisión |
| --- | --- | --- |
| 1 | Torso completo para toda preparación corta. Unidad RED `lean=.502411` frente a `1`, privada GREEN. Réplica detenida por presupuesto a 1783 ticks, sin estocadas ni puntos. | Descartado; no resolvió la trayectoria física. |
| 2 | Activar la retirada existente tras preparación y recuperación si seguía faltando alcance. Unidad RED/GREEN. A 2249 ticks la retirada ya se ejecutaba, pero seguía sin estocadas ni puntos. | Descartado como solución completa. |
| 3 | Retirada baja cuando la hoja observada estaba sobre el objetivo. Cuatro unidades privadas GREEN; dos pinchazos reales a `12.583333` y `28.425`. A 3600 ticks quedaba `burst`, aunque el marcador era `[0,2]`. | Descartado: el histórico exige `matchover` a 3600 ticks y se mantuvo esa exigencia. |
| 4 | Exigir el mismo contacto táctil propio que utiliza el agarre humano antes de retirar por falta de alcance. Replay de 3600 ticks GREEN `[0,2]/matchover`, pero batería histórica `15/16`: el jefe no alcanzaba su recuperación para permitir el contraataque. | Descartado. |
| 5 | Conservar un mínimo F64 de alcance observado por episodio de contacto; no retirar mientras mejora. Jefe original GREEN y replay GREEN; batería histórica `15/16`: el principiante quedaba en `fight` después de 125 s. | Descartado. |
| 6 | Torso completo sólo con arma libre y alcance pendiente. Diez unidades GREEN; principiante y contraataque al jefe originales GREEN. El replay de 3600 ticks terminó `fight/[0,1]`, con un único pinchazo a `17.666667`. | Descartado. |

Los datos que separan las causas se conservaron en los informes privados:

- En el atasco inicial, el normal tenía `windup.time=.925` frente a duración `.44`, alcance proyectado `1.1738878`, error angular aproximado `-.212`, contador angular cero y ningún desenganche.
- En el candidato 3, la segunda retirada se iniciaba con la hoja ya libre, impulso cero y alcance `1.0031621`. La retirada interrumpía una aproximación casi terminada.
- En el candidato 4, el jefe obtenía 40 mínimos nuevos en 44 observaciones entre `6.641667` y `7.0` s: alcance `1.5148798→1.2611502`, todavía con contacto. El temporizador confundía contacto con falta de progreso e interrumpía esa preparación.
- En el candidato 5, el principiante quedaba libre y visible desde `17.558333` s, sin mínimo guardado ni contador de bloqueo. Su alcance se estabilizaba cerca de `1.09515`, con `lean=.74542` y error angular pequeño. Era un equilibrio distinto del atasco cargado.

Los candidatos sólo modificaron controles normalizados y metadatos de IA en copias privadas. Sus campos temporales eran `disengageLow` y `bestProjectedReach`; no están presentes en el código de producción final. El mínimo permanecía finito o ausente y se probó su limpieza al perder visión, cabeza o contacto, al iniciar otro episodio y al reiniciar partida. Estas pruebas no establecieron convergencia universal de la política, y los fallos físicos impidieron integrarla.

El test experimental quedó fuera del descubrimiento de pruebas en `ai-reach-spacing-115.experimental.test.mjs.txt`, con bytes intactos y SHA-256 `d94c10b0c6385a74fcd9b5e79dab0f949cba28be513aaf7f1028ed5200b9b762`. Es evidencia de investigación, no un contrato nuevo del corte publicado. Los `.log` y `.patch` privados se destinan al archivo de artefactos raw, conservando sus bytes.

La validación final ejecuta el archivo histórico original directamente contra el motor final:

```powershell
& 'C:/Program Files/nodejs/node.exe' --test tests/ai.test.mjs
```

Resultado final: **16/16 correctos, 0 fallos, 0 omitidos**, en `180160.8243 ms`. El código de salida fue `0`. El log original se conserva en `raw/final-original-ai.log`. Los seis archivos comprobados antes y después mantienen sus hashes del recibo final. Los tiempos de los ensayos son costes de pruebas CPU y no una medición de FPS.
