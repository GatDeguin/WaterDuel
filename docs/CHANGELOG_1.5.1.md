# WaterDuel 1.5.1 · Superficies y matrices

Se elimina trabajo repetido sin reducir resolución, número de partículas, efectos, pasos físicos ni calidad fija. No cambian el solver, las reglas, el audio ni el control móvil.

## Agua dentro del globo

El cap, la superficie y el menisco mantienen sus triángulos y normales originales. Un plan privado de cada plantilla identifica tuplas de posición y normal exactamente iguales; transforma cada tupla una sola vez y expande el resultado en el orden original. En Alta, 4.800 transformaciones se reducen a 888. Los resultados siguen siendo arrays nuevos, sin alias entre llamadas. Los puntos o rotaciones con accesores conservan el recorrido anterior.

Los 106 oráculos F64 conservaron posiciones, normales y salidas combinadas. La reconstrucción caliente redujo un 61,88 % la CPU del tramo en el pareado; la variación A/A máxima fue del 12,00 %. El primer uso cuesta más: las medianas de Alta pasan de 1,20 a 3,16 ms y Ultra de 2,22 a 6,11 ms. La medición fría y sus picos se conservan; no se presenta como una reducción general del 62 % del juego. Ver [medición completa](../audit/contained-vertex-plan-1.5/RESULTADO.md).

## Agua libre en GPU · candidato retirado

Se probó conservar un VAO y dos buffers por jugador mientras las superficies propias siguieran visibles, actualizando su contenido en cada malla nueva. El experimento preservó profundidad óptica, color, offset físico y actualización de geometría dinámica genérica y mutable.

El oráculo verifica bytes F32, geometría, orden y uniformes con película mutable intercalada. En el caso aislado que conserva la malla ocho cuadros, la CPU de preparación y envío disminuye un 84,1–86,3 % y los bytes de agua transferidos un 87,5 %. Al reconstruir cada cuadro no se ahorran envíos y la diferencia permanece dentro de la variación del control. Son pruebas de CPU con GL simulado, sin medir tiempo de driver ni GPU. Ver [recibos](../audit/water-geometry-submissions-1.5.1-01/paired.json).

La primera comparación integrada en Chrome no demostró una mejora: la composición candidata quedó en 38,98–40,71 FPS RAF frente a 41,73–42,03 de las referencias calientes. Esos datos no aíslan qué cambio causó la diferencia. Se retiraron completos la caché GPU y sus hunks; el helper, pruebas y benchmark nuevos se archivaron fuera del producto y de la suite activa, conservando todas sus fuentes y recibos. Las subidas de agua vuelven al recorrido previo. Ver [rechazo y reproducción del experimento](../audit/water-geometry-browser-rejected-1.5.1/README.md). No se usa la microprueba favorable para ocultar el resultado integrado.

## Matrices de piezas separadas

La caché reconoce por valores las copias propias de una misma pose, conservando independientes la física, las vistas interpoladas y el replay. Los cambios de pivotes, escala, equipo y falda invalidan la firma. La caché es débil por asset y acotada a 24 entradas; las matrices móviles y la selección de partes continúan actualizándose por dibujo.

Los 4.320 envíos del oráculo conservan sus bytes F32. El tramo aislado reduce un 76,7–79,0 % su CPU, aproximadamente 0,065 ms por vista de un fragmento. Con identidad ya estable, la firma añade 3,23–3,88 microsegundos por envío; ese coste también se conserva en el informe. Ver [medición y límites](../audit/detached-pose-matrices-1.5-02/README.md).

## Intentos descartados

La precalculación de distancias de ejes en la extracción libre empeoró un 10,43 %. La omisión certificada de bloques de calibración mejoró un 2,45 %, dentro del ruido A/A. Ambos fueron revertidos completos. También se preserva la primera variante de bloques, inválida por un contraejemplo con NaN, y su medición: no se usa para promover cambios.

Los recibos y fuentes se conservan en `audit/water-axis-distance-1.5/` y `audit/water-calibration-blocks-1.5/`. No se redujeron tolerancias ni se repitieron los mismos candidatos para buscar cifras favorables.

## Control inicial de imagen en Chrome

La composición inicial, que aún incluía la caché GPU posteriormente retirada, comparó seis estados estáticos de 1280 × 720 con calidad Alta: sano, tres edades de rotura física y dos piezas separadas. En cinco estados, los cuatro dibujos A1/A2/B1/B2 tienen exactamente los mismos bytes RGBA. En el brazo separado, un único byte verde varía en un nivel tanto en el control A/A como en B/B, en el mismo píxel; A/B también difiere allí. El control estricto queda **FAIL por inestabilidad del propio control**, sin ampliar tolerancias, normalizar píxeles ni repetir el estado para buscar un pase. No se atribuye la variación al candidato.

Las 24 lecturas mantuvieron cero errores GL, los 11 assets cargados en ambas ramas y fuentes estables. Los oráculos geométricos y de envíos conservan sus valores exactos; la igualdad estricta de todos los píxeles de ese estado no queda acreditada. La medición de rendimiento se realiza por separado y no convierte este fallo en un pase. Ver [resultado crudo y capturas](../audit/water-matrices-1.5.1-browser/pixel-gate-initial.json).

## Rendimiento integrado y alcance final

La primera serie ABBA + AA completó seis roturas físicas auténticas, con fuentes estables. Su composición incluía la caché GPU experimental y no demostró mejora integrada; por ese motivo se retiró. Las referencias calientes rindieron 41,73–42,03 FPS RAF y B 38,98–40,71; también se conserva A1 frío con 7,61 FPS, sin excluir sus picos. Ninguna corrida cumplió el presupuesto de 60 FPS. Ver [serie completa](../audit/water-matrices-1.5.1-browser/performance-abba-aa-initial.json).

Una segunda época probó el código final sin caché GPU. Su primera referencia agotó 60 segundos antes de salir de la rotura, con intervalos RAF cercanos a un segundo; se abortó conforme al límite previo. No llegó a ejecutar B, por lo que no permite calcular una ganancia ni certificar FPS del código final. No se repitió para obtener un resultado favorable. Ver [captura abortada](../audit/water-matrices-1.5.1-browser/performance-abba-aa-epoch2-aborted.json).

Una página HTTP independiente leyó los metadatos normales de su contexto WebGL: ANGLE/D3D11 con NVIDIA GeForce RTX 3060 Ti. Esto no mide tiempo de GPU ni verifica los ajustes de aceleración de Chrome. La lectura de la página interna `chrome://gpu` fue bloqueada por la política de protocolos del navegador y no se intentó sortearla. Los metadatos se obtuvieron por la API WebGL publicada de una página propia. Ver [resultado](../audit/water-matrices-1.5.1-browser/webgl-context-metadata.json).

**60 FPS sostenidos durante toda la rotura continúan pendientes.** Las reducciones de CPU documentadas pertenecen a las funciones aisladas; no se presentan como una mejora global demostrada. Los solvers, efectos, calidad fija y funcionalidades se mantienen.

## Verificación del corte final

**971/971 pruebas en 123 archivos**, cero fallos, omitidas o canceladas, en 213,194 segundos. Las fuentes se mantuvieron estables durante la suite. Ver [recibo y hashes](../audit/corte-1.5.1-superficies-matrices-01/receipt.json).

El motor `c0592283`, la interpolación `2fc80719` y el adaptador de assets `d72f0a04` conservan sus archivos anteriores. El renderer sólo incorpora la caché de matrices y su limpieza; las modificaciones de geometría de agua están acotadas a la transformación de plantillas contenidas. Los shaders mantienen su prueba histórica byte por byte. El nuevo caso del renderer comprueba sus matrices contra el renderer congelado anterior con nueve articulaciones, ambos lados y escalas reales de jefe.

El servidor temporal de loopback 18787 y todas las pestañas creadas por la QA quedaron cerrados. No se regeneraron certificados ni se generó un ZIP nuevo.
