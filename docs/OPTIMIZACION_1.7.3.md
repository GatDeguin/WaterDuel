# Optimización 1.7.3

Se conservaron los cambios con una mejora reproducible en su tramo medido,
sin reducir efectos, resolución, geometría, iteraciones físicas o funciones.

## Cambios conservados

| Tramo CPU aislado | Antes | Después | Alcance |
|---|---:|---:|---|
| Emisión de 100.000 contactos de efectos | 577,87 ms | 300,11 ms | −48,07%; seis ciclos ABBA por repetición, rangos separados |
| 200.000 muestras de aire, dentro y fuera del flujo | 22,19 ms | 9,90 ms | −55,38%; ocho ciclos ABBA, rangos separados |
| Galería de 160 consultas de armas rígidas | 159,99 ms | 23,62 ms | −85,23%; seis ciclos ABBA, resultados exactos |
| Galería de 80 consultas de armas flexibles | 223,32 ms | 53,13 ms | −76,21%; seis ciclos ABBA, resultados exactos |

La emisión conserva los objetos del pool y los rellena directamente, evitando
el registro temporal de `Object.assign`. El sampler de aire usa escalares con
el mismo orden Float64 de las sumas originales, evitando arrays y callbacks.
Cada resultado público sigue siendo propio y los parámetros mutables del
ventilador se leen en cada consulta.

La primera repetición de emisión obtuvo −46,46% y su confirmación −48,07%.
Para aire, la primera obtuvo −54,02% y la segunda −55,38%. El ensayo de tick
mixto de efectos quedó dentro del ruido y no se atribuye una mejora a él.
Estos porcentajes no se suman ni representan el tiempo de un cuadro completo.
Son aproximadamente 2,78 μs ahorrados por contacto de 18 chispas y 0,061 μs
por consulta de aire en las respectivas fixtures calientes.

El CCD de armas usa `collisionGeometryAt(t,key)`, que ya conservaba la geometría
exacta, en lugar de reconstruir todos los paneles y Jacobianos para consultar uno.
La caché pertenece sólo a una consulta, por tiempo y clave, incluidos misses y
claves duplicadas. Los colliders antiguos y fragmentos sin ese API conservan el
muestreo completo. No cambian límites de avance, tolerancias, orden de pares,
manifold ni respuesta física. Los tests cubren flexión, cabezales, escalas de
jefe, ambos roles y cambios de pose/desprendimiento entre consultas.

La primera comparación completa de combate registró +6,86% de wall time y se
conserva. Para comprobar esa señal se repitió la misma trayectoria de 300 ticks
con tres calentamientos por variante, GC previo idéntico y seis ciclos ABBA con
controles A/A. La repetición obtuvo −3,25% de wall time y +0,51% de CPU del proceso,
sin regresión sistemática, con ruido A/A de hasta 5,44%. Los 42 bloques comparten
el mismo checksum físico/replay/eventos. No se atribuye una ganancia integrada:
la mejora acreditada sigue limitada a las consultas de geometría. La única
comparación completa de ruptura también se conserva sin inferir FPS de ella.

Se mantienen cantidades, colores, tamaños, vida y trayectoria de las chispas,
la cuota de 56 chispas y el máximo global de 176 partículas. No se cambian el
agua física, los daños, los controles, el audio ni las reglas del combate.

## Equivalencia y datos

Los oráculos originales de efectos y aire están fijados por SHA256 en
`tests/fixtures`. Las trazas comparan exactamente partículas vivas/libres,
estados del generador aleatorio, integración, snapshots propios, créditos,
reinicios y cambios de entorno. El aire se compara en 9.600 puntos aleatorios,
además de fronteras, parámetros mutables y entradas inválidas.

- [Emisión: medición y decisiones](performance-1.7.3/fx.json).
- [Aire: segunda medición cruda](performance-1.7.3/air.json).
- [Copia de presentación descartada](performance-1.7.3/presentation-rejected.json).
- [Búsqueda del solver descartada](performance-1.7.3/solver-rejected.json).
- [Consultas de armas y primera trayectoria completa](performance-1.7.3/selected-geometry.json).
- [Repetición completa de combate con controles A/A](performance-1.7.3/selected-geometry-host-repeat.json).
- [Comparación WebGL](performance-1.7.3/visual.json): 11 recursos cargados,
  872.914 píxeles no uniformes en ambas capturas, cero canales distintos y
  cero errores gráficos. Es una fixture controlada al mismo reloj, no FPS.

La suite completa se ejecuta como condición del despliegue de Pages.
Las capturas de perfil y las micropruebas Node no certifican 60 FPS ni una
mejora global; los costes dominantes de contactos y agua requieren medición
integrada posterior en el dispositivo objetivo.

## Intentos descartados

- Copia enumerada de partículas para presentación: +26,36% de coste en esa
  fixture. No se cambió `simulation-presentation.js`.
- Pasar vectores de emisión como escalares: 1,46% de diferencia y rangos
  solapados. Se revirtió, conservando la API privada anterior.
- Reemplazar la búsqueda del caché del solver por bucles: −0,76% agregado,
  con signos mixtos entre ciclos. No se cambió `articulated-rig.js`.
