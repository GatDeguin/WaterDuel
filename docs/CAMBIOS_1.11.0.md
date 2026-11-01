# Taller 360°, contactos y arranque en Chrome · 1.11.0

El escenario se completa para los ángulos que revelan las cámaras cinematográficas. También se reduce el trabajo de CPU durante el contacto de armas y el lanzador de Windows abre la arena en Chrome al terminar el arranque.

## Taller y encuadre

Una extensión independiente añade cerramientos laterales, nave frontal, pared opuesta, techo, vigas, suelo, estanterías, herramientas y mobiliario. El GLB ocupa 10.540.948 bytes (10,54 MB), contiene 33.420 triángulos y se agrupa en 14 batches de materiales. Conserva los bytes de las texturas históricas y sus factores PBR; las UV nuevas utilizan zonas válidas del atlas con margen. La GPU comparte las texturas entre los dos assets.

La extensión participa en el dibujo de la arena, las sombras y la captura del entorno. Los dos nuevos apliques completan los 24 emisores admitidos. Su geometría deja libre un volumen interior de cámara; el frente, los laterales y el techo quedan fuera de ese recorrido. [Contrato, dimensiones y presupuesto del escenario](../public/assets/environment/workshop/workshop-360.json).

La cámara conserva su resultado cuando ya está dentro de la sala. En pantallas estrechas limita la posición y calcula el campo visual desde esa posición final para mantener el encuadre. Se conservan las transiciones, el seguimiento del agua, el movimiento reducido y la reproducción determinista del replay.

## CPU durante contactos

La proyección de marcas nuevas sobre los triángulos reales del equipo evalúa las intersecciones con escalares y reutiliza un buffer Float64 por pieza. Los vértices se deforman mediante el mismo helper existente; el buffer se rellena en cada proyección. Se conservan el triángulo elegido, los polígonos baricéntricos, la distancia, los materiales, las marcas y las matrices, también en las piezas desprendidas.

El corpus compara 378 configuraciones de los siete equipos, ambos lados, extensión y flexión contra la implementación histórica congelada. Las guardas adicionales cubren personajes, aceite, bordes, empates y geometría modificada en el mismo objeto. Los registros de dibujo conservan exactamente sus posiciones y normales.

Ocho ciclos ABBA sobre 42 casos de contacto nuevo arrojan tiempos medianos de 1.581,58 y 95,28 ms para esa proyección. La **reducción mediana por par es del 93,95 % de CPU aislada**. El control A/A mediano es 2,63 %, con un máximo de 24,74 %; se retienen todas las muestras. La mediana de ocho valores utiliza el promedio de los dos centrales. Datos completos de [comparaciones de marcas](performance-1.11.0/wear-contact-paired.json) y [resumen](performance-1.11.0/wear-contact-summary.json).

La optimización del solver conserva contactos, fricción, impulsos, daño e iteraciones y elimina trabajo temporal de proyección y soporte. Cuatro ciclos ABBA del motor completo mejoran un **5,17 % mediano por par**; los controles A/A varían 1,90 % y 1,92 %. Los 1.013 pasos del corpus conservan exactamente estados físicos, replay, agua, matrices, contactos, marcas y eventos. [Escenarios, guardas y medición del contacto de armas](WEAPON_CONTACT_PERFORMANCE_1.11.md).

Además, las consultas internas de colisión de cabezas obtienen sus tres coordenadas del estado físico existente. Evitan reconstruir poses de presentación, tela y marcas en cada iteración. El caso de regresión pasa de 33 llamadas a `pose()` por muñeco a ninguna. Esta mejora, medida por separado, reduce un 3,93 % mediano del motor y un 6,05 % del caso de lanzas sostenidas; no acredita una mejora del percentil 95. [Recibo de las consultas de cabeza](performance-1.11.0/head-contact-paired.json).

Las cifras proceden de mediciones separadas y no se suman. La proyección visual es una medición aislada; las otras comparaciones excluyen render, GPU y audio de hardware. **No acreditan una mejora global equivalente ni 60 FPS sostenidos.** La comprobación nativa instrumentada ejercitó 60 cuadros con 117 pasos de contacto de acero y 34 marcas sin errores de carga o de WebGL; su coste de CPU completo siguió por encima de 16,7 ms por cuadro en ese entorno.

## Arranque desde Windows

`INICIAR_WINDOWS.bat` solicita abrir Chrome en una ventana a pantalla completa, con la vista de PC que muestra el juego y los QR. El navegador se abre después de que estén listos los listeners de la arena. Los menús y la configuración permanecen en los móviles.

El lanzador busca Chrome en las instalaciones habituales y en el registro de Windows y entrega la ruta y los argumentos por separado. Con `--check` comprueba el entorno y TLS sin iniciar la arena ni abrir Chrome. Si Chrome falta o no puede iniciarse, la arena sigue activa y la consola muestra su dirección para abrirla manualmente.

## Verificación

Las guardas del escenario comprueban presupuesto, texturas exactas, UV válidas, cierre del taller y volumen de cámara libre. Las de cámara cubren el encuadre tras limitar la posición y la conservación de las vistas que ya caben. Las de contacto comparan la geometría enviada al renderer y las trayectorias físicas con referencias congeladas. La prueba del lanzador comprueba una respuesta HTTP real antes de recibir el callback de apertura del navegador.
