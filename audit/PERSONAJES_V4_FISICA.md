# Integración física v4 — cierre de los defectos encontrados

Este recibo complementa la selección de 25 mejoras. No atribuye equivalencia numérica a N14/N16 ni rendimiento de navegador a mediciones de Node.

## Apoyo y altura

La primera suite global encontró una caída real de pelvis de 87–92 mm con el objetivo de altura intacto. No se amplió la tolerancia `.055`. La causa se aisló con dos escenarios: los motores usaban la matriz implícita `A=M+hD+h²K`, pero la velocidad se proyectaba después en la métrica de `M`. Reutilizar el factor de A para las proyecciones de velocidad recuperó la altura a +1,83…+2,12 mm del objetivo. Posiciones, autocontacto instantáneo e impulsos públicos conservan M. Los motores de base continúan en cero; no cambiaron rigidez, feedforward ni objetivos.

Las suelas usan el mismo hull físico, frame de tobillo y profundidad en GLB, contacto, sombra y fallback. Los OBB de líquido proyectan todos los vértices reales del hull sobre sus dos ejes; no redondean la envolvente asimétrica al ancho nominal. La cobertura independiente de geometría/CCD conserva los fixtures históricos y verifica N16 por separado.

## Agachado continuo

El nuevo apoyo unilateral expuso un despegue transitorio al ordenar el agachado. El candidato de fuerza de compresión no lo resolvió: la fuerza ya era positiva. Se conservó la intención original, con tasas 12/8 y 69,8805788% a 100 ms, profundidad `.29` y finta `.85` segundos.

`motorCrouch` y su velocidad separan el objetivo físico de esa intención. Sólo las dos lecturas físicas de altura de `engine.js` consumen el objetivo filtrado. Se mantienen límites de 0,8 unidades/s y 5 unidades/s², normalizados por profundidad y escala. El frenado discreto considera el paso h y la distancia al límite; no detiene instantáneamente el motor al cruzar una meta analógica interior. Se verificaron relojes fijos de 120, 60 y 30 Hz, reversión cerca de ambos límites y dt=0.

Los cuatro actores de normal/jefe cumplen 420 pasos de agachado/retorno con apoyo positivo en ambos pies, hull dentro de `.0003`, contacto dentro de `.0002`, descenso >`.20` y retorno <`.02`. La intención rápida, controles y finta conservan sus pruebas originales. Foco final ejecutado por Root: **30/30 PASS** en seis suites, `TESTS_PERSONAJES_V4_CROUCH_FINAL.txt`.

## Impulso firmado y contacto principal de armas

Una matriz simétrica de respuesta 2×2 sólo representa un conjunto activo común; no puede representar a la vez todos los cambios de suelo/stop para impulsos de signos distintos. `trialContactImpulse` prueba el impulso total firmado sin instalar q, velocidad, objetivos, reacciones ni lastImpulse. Su W usa un único conjunto activo por cuerpo. `reactImpulse` aplica exactamente el resultado del mismo ensayo.

El contacto principal de armas valida A(−p)/B(+p), complementariedad, reducción de cierre, energía y los límites Coulomb existentes. Iteración máxima 8 y fallback máximo 8 reducciones; si ningún candidato es admisible no aplica impulso. No se simetrizan columnas de conjuntos distintos ni se recorta W para aparentar positividad. El default de `contactInertia` sigue siendo una consulta local direccional de 1e−6; no una garantía para cualquier impulso finito.

La primera versión pasó 61/61 regresiones y el corte compacto 63/63. Las nuevas comprobaciones incluyen masa/Jacobianas por diferencias finitas, energía independiente, signos ±/mixtos, ambos sentidos/tamaños, descarga de apoyos, ausencia de soporte aéreo, estado inicial/holguras compartidos, propiedad de arrays y trial→apply exacto. El guard antiguo 1e−8 se mantiene en vuelo libre con suelo y topes inactivos. La revisión independiente de los bloques físicos fue APPROVE.

Alcance deliberado: daga, escudo/cuello y fragmento–padre todavía tienen consumidores que usan consultas locales sin validar el impulso total combinado. Esto limita la garantía de este recibo al consumidor principal actualizado; por sí solo no prueba un aumento de energía en esos consumidores. Principal conserva su revisión integrada.

## Coste de diagnóstico y salida compacta

El primer perfil de cuatro contactos reales encontró 8–10 trials y 183–232 KB de payload numérico mínimo devuelto por contacto; aproximadamente 78% correspondía a filas copiadas. No se identificó ese número con heap asignado ni con pausas de GC.

La API conserva el diagnóstico completo por defecto. Los consumidores de producción piden una salida compacta, cuyos agregados se calculan en el mismo recorrido y con los mismos umbrales. Se omiten las copias de filas y objetos diagnósticos; no cambian matrices, conjuntos, caches, iteraciones, velocidades, energía ni aplicación.

Prueba pareada ABBA: cuatro escenarios, seis rondas, cuatro bloques de 20 llamadas, más warmup; **2.016 salidas físicas/metadata exactamente iguales** al corte detallado congelado. Las 24 rondas favorecieron al compacto: medianas por escenario 20–26% menores en tiempo de pared local. Payload numérico 183–232 KB → 4,1–5,3 KB, reducción 97,67–97,79%; 1.128–1.430 arrays y 1.112–1.410 objetos devueltos evitados por contacto. Son conteos estructurales y tiempo local de componente con `project:false`, sin afirmación sobre heap, ciclos de GC, FPS o móviles. Se conserva por la mejora medida y equivalencia de física; no hubo cambios de tolerancias ni parámetros para conseguirla.

Los RAW de referencia rich y su SHA están archivados y son portables. `PERSONAJES_V4_CONTACT_COMPACT_ABBA.json` conserva protocolo, dispersión y límites de la comparación.

## Geometría y estado final

El barrido final inspeccionó 200 muestras de 32 perfiles y 10.070.700 vértices reales de GLB/paño: `ok:true`, máximo bajo suelo **1,06516 µm**, dentro del guard 10 µm. El barrido no demuestra todas las combinaciones posibles ni separación triángulo–triángulo exhaustiva.

La revisión compartida final y WebGL se registran en `COORDINACION_PERSONAJES_V4.md`. La publicación queda bajo Principal.
