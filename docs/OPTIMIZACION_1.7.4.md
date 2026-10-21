# Optimización 1.7.4

La reconstrucción de geometría capilar conserva los mismos triángulos de
contacto entre agua y látex, eliminando vectores, listas y callbacks temporales
por cara. No modifica el modelo físico, el CCD, la resolución de superficies,
las partículas, los materiales ni los límites de efectos.

## Resultado medido

En seis ciclos ABBA, con tres calentamientos por variante, la mediana de
3.000 reconstrucciones baja de **1.184,86 a 386,54 ms: −67,38% de CPU**.
Se usan seis pieles de 320 caras, intactas, pinchadas y deformadas, con escala
normal y de jefe. Los rangos no se solapan: 1.150,66–1.221,44 ms frente a
379,51–412,06 ms. Cada ciclo obtiene entre 66,25% y 67,96% de ahorro.
Es una medición aislada del constructor, no del tiempo de un cuadro.

La trayectoria completa de un pinchazo real se repite con HostSession, replay,
481 actualizaciones físicas y consultas de presentación a 60 Hz. Dos
calentamientos por variante, cuatro ciclos ABBA y controles A/A producen
28 corridas con el mismo checksum físico, de eventos y de replay. El tiempo
medio es 5.478,23 frente a 5.355,46 ms (−2,24%); el uso CPU del proceso cambia
−0,85%. El primer ciclo queda casi neutral. Se conservan todos los datos y
no se presenta esto como una ganancia global robusta ni como FPS.

## Equivalencia

El oráculo completo de 1.7.3 está fijado por SHA256 en
`tests/fixtures/capillary-contact-pre-build-opt-1.7.3.js.txt`. Las tres pruebas
nuevas comparan exactamente superficies reales y aleatorias, clasificación de
cuello/pliegues, resultados de proximidad, orden de claves públicas y aristas,
caché por versión y propiedad de resultados. Los nodos siguen siendo referencias
vivas; puntos y pesos de cada consulta siguen siendo propios. También se
comparan energía, impulso, reacción de nodos y estado de parcelas durante
40 reconstrucciones sucesivas.

La suite completa es una condición del despliegue a Pages. Estas pruebas de
Node excluyen GPU y audio; **60 FPS sostenidos siguen sin certificarse**.

La comparación WebGL independiente usa 11 recursos completos y cinco relojes
fijos del combate y del pinchazo real, a 1.280 × 720. Los cinco pares mantienen
exactamente los mismos píxeles, draws y triángulos, con cero errores gráficos
o de consola. Cada captura contiene más de 921.000 píxeles distintos del
fondo; la igualdad no se obtiene comparando canvases vacíos. Esta comprobación
visual tampoco mide FPS.

## Intentos descartados

- Seleccionar sólo los dos paneles del contacto al corregir su posición:
  139,77 → 139,65 ms en seis ABBA (−0,088%), dentro del ruido. Se comprobó
  equivalencia de 50 escenarios, pero no se incorporó el cambio.
- Reutilizar inversas del esqueleto de origen, validando sus parámetros
  mutables: dos mediciones aisladas obtienen −17,58% y −15,40% en
  `characterTransforms`. El ahorro equivale a unos 0,017–0,020 ms para dos
  llamadas, una estimación que no acredita mejora del cuadro. Se descarta
  porque exige nueva caché y firmas de invalidación sin evidencia suficiente
  de impacto en el render completo. La fuente de producción permanece intacta.

## Datos

- [Reconstrucciones capilares, todos los bloques](performance-1.7.4/capillary-build.json).
- [Pinchazo completo con controles A/A](performance-1.7.4/host-burst.json).
- [Selección de paneles descartada](performance-1.7.4/keyed-contact-rejected.json).
- [Caché de marcos de origen descartada](performance-1.7.4/asset-source-rejected.json).
- [Comparación WebGL de combate y ruptura](performance-1.7.4/visual.json).
