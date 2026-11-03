# Diagnóstico posterior del candidato de volúmenes

Producto congelado12df4bee2cda985fb64b38e4108370d8ed157b0e041897a36e596415815bb31f. La primera corrida `volume-paired.json` se conserva completa y **no autoriza promoción**: pese a−45.12% en lecturas, advanceLeak260 empeoró11.39% frenteA/A4.23% en ese caso.

## Problemas de receta/contexto detectados antes de otra medición

- engine211/277usa balloonSize/fluid.scale1.16 para boss;1.18 es escala del rig. El harness original usó1.18, impacto−.422/área.04 sin escalado. Es una receta API válida, pero no dimensiones del jefe real. El benchmark histórico fluid-leak usa1.16, impacto×scale/área×scale².
- Cuatro warmupPairs significan cuatro avances de72ticks por variante,288ticks,360incluyendo la comparación funcional. Las muestras260 duraban sóloA3.79–4.16ms/B4.23–4.48ms, pero la separación resultó consistente en las cuatro rondas y no se oculta.
- El ensayo original calentó primero microlecturas: A320000pares/B192000por controlesA/A. Después midió contexto físico en el mismo proceso y las mismas funciones.
- Además las parcelas de lecturaA evolucionan nativamente porAPI, mientrasB asigna `structuredClone(a.particles)`. Igualdad de valores está comprobada, pero esa diferencia puede producir feedback de formas distinto paraJIT al pasar después a parcelas nativas. Es una **inferencia**, no una causa demostrada.

## Diagnóstico autorizado, no nuevo gate

`diagnose-volume.mjs` terminó1.65s. Doce procesos independientes: seis con fuentes puras y `trace-opt/deopt/turbo-inlining`, otros seis con counters en copias separadas fuera del timing. Cada componente físico tiene cuatro warmups y cuatro avances72ticks/.6segundos; no incluye calentamiento de microlecturas. Se etiquetan normal200, original260/1.18 sin escalado y boss260/1.16 con impacto/área escalados (API con dimensiones correctas, no motor competitivo completo). Las fuentes del producto no se modificaron.

FasesA/B idénticas al inicio y al final: inicial0libres, released/leakingtrue; final30/26/36libres respectivamente,72ticks,.6000000000000003s. Las llamadas retainedVolume fueron390/386/396. Arraysfiltered totales durante avance:

| Receta | Baseline | Candidato | Arrays evitados |
| --- | ---: | ---: | ---: |
| normal200 | 564 | 174 | 390 |
| diagnóstico260/1.18 | 556 | 170 | 386 |
| dimensionesboss260/1.16 | 576 | 180 | 396 |

El resto corresponde a getters de listas que siguen devolviendo arrays propios. ReleasedVolume no se consulta en el avance interno de estas recetas; sí se registra fuera del intervalo para el diagnóstico de fase.

Los tiempos bajo trace son diagnósticos y **no sustituyen el pareado original**. B resultó más rápido en las tres recetas, así que la regresión260 no se reproduce bajo ese aislamiento, pero no se atribuye un ahorro temporal aprobado a fuentes trazadas.

`advanceLeak` alcanzaMAGLEV al terminar las corridas tantoA comoB. No aparece una negativa de inliningTF que demuestre un cliff del getter. El helpernuevo `nativeVolumeList` sí muestra deopt `unexpected name in keyed access` al alternar nombres released/retained (`normal-B.log:243`, `original260-B.log:251`, `boss260-B.log:348`), también fuera del caso260. Los deopts `wrong map` de placeContained/step aparecen en ambas variantes. Son observaciones concretas; no prueban causalidad del primer resultado.

Siguiente validación propuesta al coordinador: época física pura SINtrace en procesosA/B separados, fuentes congeladas, sin clones ni microlecturas previas, mismas cuatro warmups/72ticks/ABBA/A/A y gate convencional. Mantener recetaoriginal1.18 declarada y añadir dimensionesboss1.16. Medir lecturas como otro componente/proceso con parcelas nativas evolucionadas porAPI en ambas variantes. No seleccionar fallback por count260 antes de distinguir contexto de harness y regresión real.
