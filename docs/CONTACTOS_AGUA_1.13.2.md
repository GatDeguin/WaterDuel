# Apertura, contactos y agua · 1.13.2

## Problema reproducido en PC con QR

La PC ejecuta `HostSession`, la física y el render. El servidor LAN transmite mandos, menú y eventos; no calcula las colisiones. La distancia de apertura por sí sola no impedía que algunas armas se cruzaran antes del combate.

La captura de 1.13.1 conserva las coordenadas, velocidades, objetivos, equipo y apoyos del caso real. Con espada J1 y hacha J2 se solapaban el eje y el cabezal del hacha. El contacto seleccionado atendía primero al eje y podía empujar la espada hacia el cabezal, mientras otra restricción pedía corregir en sentido contrario. Las pruebas usan SAT independiente sobre los paneles físicos para verificar la penetración, además del contacto que informa el juego.

## Corrección

En versus, incluido el recorrido PC con QR, la apertura conserva la distancia de 3,8 unidades y recoge las muñecas mediante sus articulaciones reales. La búsqueda verifica un extremo libre en ambos sentidos antes de refinarlo; no cambia el tamaño de las armas ni el de la arena. Sincroniza pose, historial CCD y observaciones, sostiene esa postura durante la cuenta atrás y libera el objetivo al comenzar el combate. La inspección y la práctica conservan sus poses de referencia.

El modo contra IA conserva su postura inicial anterior. Aplicarle el mismo ajuste de muñeca cambió las trayectorias y expuso preparaciones que no concluían en los replays originales. Se probaron y descartaron seis ajustes de control porque ninguno pasó todos los escenarios físicos; no se modifican la IA ni los tiempos o las aserciones de sus pruebas. La recuperación compuesta descrita debajo sí funciona en ambos modos. El [overlay de alcance](../audit/sword-axe-recovery-1.13.2/versus-opening-overlay.json) y el [informe de descartes](../audit/sword-axe-recovery-1.13.2/ai/report.md) registran este límite.

La recuperación de un encaje considera todos los pares penetrantes del cabezal y el eje. Sólo una penetración inicial `t=0`, con un cabezal real y normales contradictorias, activa la elección de un lado común de salida. Los puntos y anclajes se reconstruyen sobre las caras físicas correspondientes. Las entradas continuas desde fuera, la separación en Z, las tangencias, los límites de fuerza, la fricción y las ventanas de contraataque se conservan.

Los oráculos de caché y del muestreo seleccionado comparan el mismo contacto corregido con las dos implementaciones que pretenden verificar. Mantienen sus casos y aserciones exactas. Las fuentes históricas siguen congeladas; las pruebas de regresión de este defecto comprueban la recuperación, en lugar de exigir que el solver repita la trayectoria atascada.

## Explosión en tiempo real

Se elimina la velocidad física de 0,3× durante los primeros 1,3 s. Un segundo real contiene ahora 120 pasos de 1/120 s y un segundo físico de agua, látex y cuerpo. Se conservan la interpolación, los remanentes, la pausa, los resultados, la órbita y el retorno de cámara, y el puente entre rondas de 3,25 s. La velocidad configurable de una repetición sigue siendo una opción independiente.

## Medición del caso encajado

El ensayo restaura la misma captura antes de cada ejecución y compara un bloque ABBA corto con 8 y 32 pasos físicos. Construcción de rigs, restauraciones, firmas y comprobaciones quedan fuera del cronómetro. La referencia usa el rig de 1.13.1 y su bind `0f2b8487…`; el candidato usa el mismo rig y el bind corregido `a30c9379…`.

| Caso espada J1 / hacha J2 | Referencia | Corrección |
|---|---:|---:|
| 8 pasos | 252–327 ms | 40–65 ms |
| 32 pasos | 1.182–1.251 ms | 129–152 ms |
| Penetración final, 8 pasos | 0,2095 | 0 |
| Penetración final, 32 pasos | 0,2235 | 0 |

El control de dos espadas a 32 pasos quedó dentro del ruido: 211–216 ms frente a 209–225 ms. Son tiempos del componente físico de recuperación en Node, no porcentajes globales de FPS ni medidas de latencia de los móviles.

El orden inverso hacha J1 / espada J2 ya se liberaba en la referencia. En la ventana corta de 8 pasos el candidato costó 38,57 ms frente a 33,24 ms de media; con sólo dos muestras por rama no se afirma una mejora en ese caso. A 32 pasos pasó de 126,82 a 122,17 ms. La nueva apertura de versus evita que ambos órdenes aparezcan encajados, y el coste añadido de recuperación sólo se justifica al corregir una penetración real.

Reproducción del contacto:

```powershell
node benchmarks/compound-recovery-115.mjs --out .runtime/recovery-1.13.2.json
```

## Agua sin listas temporales en consultas de volumen

Durante una fuga, `releasedVolume` y `retainedVolume` suman directamente las parcelas de su fase, sin construir primero arrays filtrados. Se mantienen el orden de adición y los valores físicos. Los getters de listas siguen devolviendo arrays propios; sus overrides conservan la ruta anterior. Fuera de la fase de fuga se usa la expresión original. No hay caché de volumen que pueda quedar desactualizada.

El dominio validado son las parcelas nativas del juego con campos de datos. La reducción fusionada no promete el orden de efectos secundarios de objetos externos con accessors, `Proxy` o filtros personalizados que muten otras parcelas; no se encontraron esos patrones entre los llamadores productivos.

La validación final usa procesos separados por componente, variante y receta; ambas ramas evolucionan objetos nativos mediante la API, sin asignar clones de la referencia al candidato. Mantiene cuatro pares de calentamiento, cuatro rondas comparativas, controles A/A y mediana convencional. Cada muestra comprueba las fases inicial y final, el hash completo de parcelas y balances, y las estadísticas.

| Ensayo | Ahorro de CPU | Mayor desvío del control A/A |
|---|---:|---:|
| Consultas de volumen, 200/260 parcelas y 15 % / 70 % liberadas | 57,29 % | 4,54 % |
| `advanceLeak`, 72 pasos de 1/120 s, normal y jefe | 15,56 % | 4,70 % |

Las cuatro razones de tiempo candidato/referencia del avance son 0,8401, 0,8781, 0,8486 y 0,8226. El personaje normal mejora un 14,91 % y el jefe, con su escala real de globo de 1,16, un 17,61 %. Este ensayo de API no incluye sólidos, membrana, rig, renderer, audio o red; no se suma su porcentaje al de los contactos ni se atribuye al frame completo.

El primer ensayo mixto mostró una regresión de 260 parcelas y se conserva: compartía el calentamiento de consultas con física, usaba clones sólo en el candidato y confundía la escala de globo del jefe con la del rig. No se cambió el producto para obtener el resultado favorable. El diagnóstico y la validación posterior corrigen esas condiciones con la misma fuente, ventanas y criterio de aceptación.

Se descartaron cuatro alternativas sin ganancia consistente: vecinos por celda, Map temporal de presentación, rechazo axial al agrupar partículas y extracción de cálculos Y/Z fuera del bucle interior. `surfaces.js` y `simulation-presentation.js` se restauraron byte a byte; en `fluid.js` sólo cambian las consultas escalares de volumen. No se reducen resolución, cantidades, iteraciones ni efectos.

```powershell
node benchmarks/fluid-volume-paired-1.13.2.mjs --output .runtime/water-volume-1.13.2.json
```

## Verificación y alcance

La prueba WebGL con `HostSession` y `Renderer3D` reales cargó los 11 recursos, completó la cuenta atrás de espada/hacha y avanzó 120 pasos de rotura: tiempo de fase y edad física coincidieron con un segundo. Conservó 200 parcelas, balance de volumen dentro de 7×10⁻¹⁶, puntuación correcta y cero errores de consola o WebGL. Es una prueba visual determinista sin audio ni red, no una medición de FPS; las pruebas de host y red cubren el recorrido PC con QR por separado.

El corte final pasó 81 pruebas focales en el clon de publicación y las 16 pruebas originales de IA sin modificar sus casos, aserciones ni duraciones. El oráculo de apertura conserva las comprobaciones físicas de versus y compara 64 combinaciones de equipo/dificultad en solo, más campaña y observaciones de reinicio, contra el motor publicado de 1.13.1.

La integración completa detectó dos dependencias de las pruebas: una secuencia de daga medida para la postura anterior y un orden global supuesto entre dos sockets independientes. La receta J1/reverse ahora apunta mediante controles normales a la sección observada de la daga antes de avanzar, conservando sus límites y todas las aserciones de contacto, impulso, fricción y desprendimiento. La prueba de red espera ambos mandos, comprueba su cardinalidad por jugador y cierra las conexiones ante fallos. Ambas pruebas suman 14/14 casos correctos; estos ajustes no modifican el motor ni el servidor. [Evidencia de daga](../audit/sword-axe-recovery-1.13.2/validation/knife/receipt.json) · [Evidencia de red y llegada invertida](../audit/sword-axe-recovery-1.13.2/validation/network/receipt.json).

[Recibo de contactos](../audit/sword-axe-recovery-1.13.2/receipt.json) · [Mediciones de recuperación](../audit/sword-axe-recovery-1.13.2/measurement.json) · [Audit de agua y descartes](../audit/fluid-volume-1.13.2/README.md) · [Medición final del agua](../audit/fluid-volume-1.13.2/paired.json).

Los logs y diffs originales referidos por ambos recibos se distribuyen comprimidos, conservando sus bytes y rutas: [archivo e índice de verificación](../audit/sword-axe-recovery-1.13.2/RAW_ARTIFACTS.md).

Las pruebas globales y el cotejo de la publicación se registran en el recibo de la versión. No se certifican 60 FPS sostenidos en equipos no medidos.
