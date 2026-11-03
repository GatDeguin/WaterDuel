# Volúmenes de agua sin arrays temporales — conservado

El cambio aprobado afecta únicamente los getters `releasedVolume` y `retainedVolume` de `public/physics/fluid.js`. Mientras hay fuga, las consultas nativas suman directamente las parcelas de su fase en orden original, sin crear primero una lista filtrada. No se suma cero a una parcela excluida y se mantienen los holes del array. Los getters de listas conservan su API y las ramas sin fuga mantienen el recorrido anterior. Si un consumidor reemplaza el getter de lista propio, de subclase o de prototipo, se utiliza ese getter mediante el fallback original.

No cambia inventario, volumen individual, integración, pasos, posiciones, velocidades, densidad, viscosidad, colisiones, mallas, calidad, reloj, renderer ni audio. No hay caché pública ni una selección especial por200/260parcelas.

## Contrato y correctitud

El camino rápido corresponde al modelo nativo: parcelas con campos escalares y array leído sin efectos laterales. No se declara equivalencia para getters de campos de parcela, Proxies o overrides de `array.filter` que muten datos durante la lectura. Las dos fases se observaban primero mediantefilter y después sereducían; la reducción condicional ahora intercala la consulta de fase y volumen. Evitar ese caso ajeno al modelo nativo mediante un guardO(n) anularía esta optimización. El guard de los getters públicos de listas sí se mantiene y se prueba.

RED:12pares de consultas nativas generaban24arrays filtrados; el nuevo contrato exigía cero. GREEN final19/19 de getters, fuga e integrador: orden aritmético sensible, holes, ceros con signo, NaN excluido, todas las fases, listas propias, overrides y fugas progresivas con cada parcela, ledger y momento exactos. La verificación anterior ampliada pasó25/25 con soporte de membrana; después se redujo la ruta sin fuga a la expresión original literal y se repitieron los19 focales. El coordinador también ejecutó el corte de integración con fuente final estable. Los logs se conservan sin sustituir el primer resultado.

Copias instrumentadas separadas de los tiempos observaron390/396consultas retainedVolume en72ticks normal/jefe y la misma cantidad de arrays evitados:564→174 y576→180. Los arrays restantes pertenecen a getters de listas que continúan siendo propios. Son conteos de asignación, no porcentajes del juego.

## Resultado temporal válido

`paired.json` es la validación final sintrace. Cada combinación de componente, variante y receta se ejecuta en su propio proceso Node persistente: no comparte feedbackJIT con la otra variante ni con microlecturas. Ambas variantes evolucionan parcelas NATIVAS medianteAPI; no se asignan clones deA aB. Hay cuatro pares de calentamiento, cuatro rondasABBA/BAAB, controlesA/A, mediana convencional y los mismos72ticks/.6segundos físicos del plan. Las muestras de lecturas usan4000pares de consultas con15%/70%libre. Las fases inicial/final y el hash completo de parcelas/ledger/stats coinciden en **cada muestra y control**.

| Componente | Mediana B/A | Ahorro CPU del componente | Máximo desvíoA/A |
| --- | ---: | ---: | ---: |
| Lecturas de volumen200/260 | 0.427101 | 57.29% | 4.542% |
| Avance de fuga normal200 + jefe260 | 0.844352 | 15.56% | 4.698% |

Las razones agregadas de avance son `[0.840065,0.878086,0.848640,0.822637]`, todas inferiores a1; rango0.8226–0.8781. Normal200 mejora14.91%; jefe260con escala real de globo1.16 mejora17.61%. Ambos casos superan sus controles. La receta anterior260/1.18 se conserva sólo como diagnóstico aparte y mejora16.69% bajo aislamiento; no entra en el agregado de dimensiones reales.

El alcance medido es `FluidVolume.advanceLeak` con entradaAPI y sin sólidos, membrana, rig, renderer, audio o red. **No es un porcentaje del frame completo ni una garantía de60FPS.**

## Primer ensayo y diagnóstico conservados

`paired-original-mixed.json` registra una ganancia clara de lecturas pero regresión260del11.39%. No se promovió usando el agregado favorable. El harness calentaba primero lecturas y luego física en las mismas funciones; ademásB usaba parcelas de `structuredClone`, mientrasA mantenía parcelas nativas. Usaba1.18(delrig) para el agua del jefe, cuyo tamaño nativo es1.16. Son problemas de receta y contexto del ensayo, no un resultado que deba borrarse.

`diagnostic/` conserva los seis procesos con trace y seis copias con conteos autorizados posteriormente. No se pudo atribuir causalidad a un rechazo de inliningTF; sí se observó deopt delhelper al alternar nombres de getter. Los tiempos trazados no se usaron como gate. La validación sintrace corrige el aislamiento y la forma nativa en ambas ramas manteniendo fuente, pasos, calentamiento y criterio; no se ajustaron parámetros del producto para obtener un resultado favorable.

## Descartes anteriores

| Hipótesis | Resultado y decisión |
| --- | --- |
| Vecinos por celda | −3.53% agregado frenteA/A7.56%; parciales empeoran. Descartado. |
| Map scratch de presentación | Mediana convencional−2.44% frenteA/A4.76%; dos rondas empeoran. Descartado. |
| Rechazo axial de agrupamiento | +4.03%CPU frenteA/A2.46%. Descartado. |
| HoistingY/Z sin tablas | −1.10% frenteA/A9.94%, casos inconsistentes. Descartado. |

Fuentes candidatas completas, recibos originales y explicación detallada permanecen en `discarded/`. Superficies y presentación se restauraron byte a byte a49675ac6… y7c8e321e… antes de comenzar el candidato de volúmenes. Ningún manifiesto histórico se modificó.

## Fuentes y reproducción portable

- Baseline completo e inmutable: `tests/fixtures/fluid-pre-volume-query-1.15.js.txt`, SHA256`cc52b342969598de6d4757894b54e4e8ff26af0bbe1afe0f8447f0a40af7673a`.
- Producto aprobado y copia `fluid-candidate.js.txt`: SHA256`12df4bee2cda985fb64b38e4108370d8ed157b0e041897a36e596415815bb31f`.
- Benchmark público: `benchmarks/fluid-volume-paired-1.13.2.mjs` y su worker hermano. No dependen de rutas privadas ni de artefactos `.runtime`.
- `files.json` fija los hashes exactos de los archivos entregados y del recibo final.

Desde la raíz del proyecto:

```powershell
node --test tests/fluid-volume-query-115.test.mjs tests/fluid-leak.test.mjs tests/fluid-integrator-equivalence.test.mjs
node benchmarks/fluid-volume-paired-1.13.2.mjs --candidate audit/fluid-volume-1.13.2/fluid-candidate.js.txt --output benchmarks/results/fluid-volume-reproduction-new.json
```

La segunda orden requiere una ventana deCPU exclusiva. El benchmark rechaza sobrescribir un recibo o checkpoint existente, valida baseline/candidato porSHA y vuelve a comprobar la fuente al terminar. La versión portable agrega rutasCLI y controles de procedencia fuera de los cronómetros; conserva los bucles, recetas, ventanas y gate de la corrida final. Sólo se verificó su sintaxis después de promoverla; **no se repitió el timing**.
