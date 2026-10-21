# Tirones de contacto y rotura · mediciones de CPU

El diagnóstico nuevo utiliza el motor que incluye daño y desprendimiento. El agregado comprende cuatro recetas de 60 actualizaciones con espada, lanza, hacha y mazo, más un episodio de espada de 488 actualizaciones hasta salir de una rotura física completa. Son 728 actualizaciones por ejecución. Las recetas cortas de espada y lanza llegan a la fase de rotura y se cortan a las 60 actualizaciones declaradas; no son roturas completas adicionales.

No se asignaron puntas ni se llamó manualmente a `burst`. La receta completa produjo el contacto geométrico con el globo. La medición incluye las actualizaciones completas del motor y sus transiciones, sin renderer, audio de navegador ni GPU. No se observaron fragmentos desprendidos en ese agregado. Los porcentajes siguientes pertenecen al agregado mixto y no pueden atribuirse únicamente al instante del pinchazo.

## Perfil observado

El perfil de referencia recoge 4.439,859 ms de muestras. Los tiempos inclusivos se solapan y no se suman:

| Trabajo | Tiempo inclusivo | Porcentaje |
| --- | ---: | ---: |
| Contactos entre luchadores | 1.933,108 ms | 43,54 % |
| `resolvePair`, incluido en contactos | 1.471,306 ms | 33,14 % |
| Actualización de agua | 828,532 ms | 18,66 % |
| Paso del fluido, incluido en agua | 701,786 ms | 15,81 % |
| Paso de membrana | 351,189 ms | 7,91 % |
| Recolección de memoria | 350,936 ms | 7,90 % |

La reconstrucción y el dibujo de superficies de agua quedan fuera de este perfil. Tampoco permite atribuir un pico a la preparación de audio, medir latencia del mando o certificar 60 FPS. Se necesita una medición visible del navegador para esas conclusiones.

## Candidato descartado

Se probó generar sólo el panel solicitado dentro de `contactByKey`. El diferencial conservó exactamente 728 actualizaciones por rama y contó 8.972 consultas de contacto entre ambas ramas. Sin embargo, las dos comparaciones pareadas empeoraron 1,72 % y 2,52 %, frente a una variación absoluta A/A de 0,30 %. Se restauró el archivo completo anterior y se conservaron el candidato y sus recibos; no se repitió la prueba para buscar un resultado favorable.

Evidencia: [resultado y límites](../audit/rejected-rig-selective-contact-1.5/RESULTADO.md). El perfil de referencia y los recibos identifican sus fuentes; las ampliaciones posteriores de escudos y colisiones de agua requieren su propia época de medición.

## Segunda hipótesis descartada

Se probó omitir las caras alternativas de separación en el recorrido externo, donde ningún consumidor las utiliza, conservándolas para el autocontacto. El oracle mantuvo 728 actualizaciones por rama exactas, y pasaron 60 pruebas focales. El único pareado produjo un empeoramiento de 2,46 % y una mejora de 0,87 %, con variación A/A de 0,68 %. No demostró una mejora consistente: se restauró el baseline completo y se archivó [la evidencia de esta época](../audit/rig-external-contact-axes-1.5/RESULTADO.md).

También se revisó reutilizar buffers FP32 de subida. El contrato actual acepta arrays JavaScript e iteradores cuyo comportamiento no equivale siempre a copiar índices en un buffer reutilizado. No se implementó ni se atribuyó un ahorro de memoria o tiempo a esa propuesta.

## Capturas de navegador incompletas

Se hicieron dos capturas del fixture de servicios del host con el renderer actual, una con perfil de CPU y otra sin perfil con la pestaña visible. Ambas se abortaron al alcanzar el límite de 60 segundos sin completar la rotura; `validCompleteVisibleBurst` fue falso. El pinchazo procedió de una punta física, pero las ventanas observadas sólo contienen una parte del agua libre.

Los intervalos RAF pasaron a aproximadamente un segundo incluso en la prueba visible, mientras el perfil mostraba al hilo mayormente ocioso. El dato es compatible con una limitación de planificación del entorno de captura; no demuestra que esa sea la causa de los tirones del juego. Estas ejecuciones no permiten certificar FPS, comparar una rotura completa ni atribuir tiempos de GPU. Los resultados abortados se conservan en `audit/browser-lag-1.5/`.

## Trabajo siguiente identificado, sin cambio de producto

- La superficie del agua que permanece en un globo perforado se reconstruye por render; conviene medirla por separado de la superficie del agua libre, que ya tiene caché temporal y por movimiento. Son conjuntos distintos, no dibujos duplicados del mismo líquido.
- Las matrices de un fragmento se cachean por identidad de `sourcePose`, pero las vistas de presentación copian esa pose. Conviene contar aciertos y reconstrucciones antes de cambiar el aislamiento de las repeticiones.
- Los contactos de piezas caídas reconstruyen paneles al consultar una clave. Sólo se pueden compartir muestras mientras no cambie el estado físico; los impulsos y las proyecciones invalidan geometría previa.

El audio ya reutiliza el banco de 84 variantes y los efectos visuales tienen un pool limitado a 176 partículas. No se atribuye un ahorro a estas tres líneas de investigación: aún no tienen una comparación válida que justifique alterar el producto. No se redujeron efectos, pasos físicos ni funcionalidad.
