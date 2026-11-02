# WaterDuel 1.13.0 · Cierre, combate y taller

Estado: corte integrado y verificado localmente; la publicación se comprueba por separado mediante el build y el despliegue de GitHub Pages.

## Selección de Principal

| Propuesta | Implementación |
|---|---|
| 10 | Final de campaña con trofeo del Campeón/Maestro en la escena, encuadre ceremonial y acción directa desde el móvil. |
| 12 | Lectura corporal de las fintas producidas por cambios reales del joystick, conservando dirección y ataque humanos. |
| 13 | Apoyos y transferencia de peso con tobillos físicos, suelas y contactos compartidos con el modelo visible. |
| 14 | Preparación y recuperación corporal según propiedades del equipo, sin bonificaciones ocultas ni cambios de agarre. |
| 15 | Lectura de desgaste y daño articular desde los estados reales, con propiedad correcta de piezas desprendidas. |
| 18 | Segunda fase del jefe con cuatro preparaciones, retirada/señal/asentamiento y recuperaciones vulnerables. |
| 21 | Construcción/materiales de los nuevos personajes e ítems y calibración de acabado al preparar sus materiales. |
| 29 | Órbita desde el origen fijo del pinchazo, plano amplio para doble estallido y transición frontal del final. |
| 44 | Campaña avanzada con siete encuentros propios, desbloqueo y progreso independiente. |

La numeración anterior corresponde a la lista de Principal. Items y Personajes tienen selecciones humanas independientes y manifiestos propios.

## Campaña y cierre

En **Menú → Partida → Campaña → Vuelta de campaña**, la avanzada se desbloquea al vencer los siete encuentros normales. La selección prepara el encuentro; Comenzar inicia el duelo. El botón verde del final normal también permite entrar directamente en la avanzada. El final avanzado permite repetir el último encuentro.

El progreso normal conserva su clave y formato. La avanzada usa `water-duel.campaign-advanced.v1`; los resultados contradictorios, prematuros, de demo/replay y repetidos no pueden avanzar ninguna de las dos campañas. El silencio y los ajustes de audio se conservan. Cambiar la vuelta está bloqueado durante combate, countdown o repetición.

El trofeo es un objeto de presentación, con las primitivas preparadas del renderer y su sombra; no añade cuerpos físicos, puntos ni ataques. Sólo una victoria final nueva y real inicia la ceremonia. El reloj global la hace avanzar desde cero, independientemente del reloj de fase heredado del estallido. Las repeticiones y las partidas cargadas ya completadas no vuelven a entregarlo.

La preferencia de movimiento reducido del sistema se comparte con el motor y la presentación. El trofeo aparece completo, la cámara evita el recorrido ceremonial y se omiten los gestos corporales automáticos correspondientes; los controles humanos siguen disponibles.

## Apoyos y contacto físico

Las restricciones de velocidad se integran con la misma respuesta implícita que los motores. Esto corrige el descenso espurio de la pelvis bajo el agua sin cambiar rigidez, objetivos, gravedad ni añadir fuerzas externas de base. El agachado conserva la respuesta rápida de la intención y limita la velocidad/aceleración de su objetivo físico; así las suelas pueden sostenerlo sin adhesión al suelo ni saltos de la meta al mover el joystick analógico.

Los pares de armas principales con la API completa evalúan el impulso total firmado y comparten el mismo conjunto de apoyos para sus dos direcciones. Los ensayos no alteran el estado; sólo se aplica el impulso aceptado una vez. Se conserva la ruta de compatibilidad para los otros adaptadores. La defensa con daga y los restantes consumidores locales mantienen su alcance propio de verificación; no se atribuye una garantía energética universal a todos los contactos del juego.

La ruta de producción omite el detalle de diagnóstico que no consume. En 24 rondas ABBA del componente Node fue más rápida en todas las rondas; las medianas por escenario bajaron aproximadamente un 20–26 % frente al mismo solver con diagnóstico completo. Los resultados físicos y metadatos coinciden bit a bit en 2.016 comparaciones. La carga numérica devuelta baja aproximadamente un 97,7 %; esto no mide heap, pausas de GC ni FPS. [Medición y alcance](../audit/PERSONAJES_V4_CONTACT_COMPACT_ABBA.json).

El foley de los pies consulta el apoyo real del hull articulado. La ruta histórica conserva su cálculo anterior. Los sockets de las dagas se contrastan con una referencia independiente de doble precisión, con la matriz Float32 exacta y con la cota de propagación del redondeo de los datos. Es una comprobación del endpoint virtual; la comprobación visual WebGL se registra aparte.

## Integración coordinada

Items aporta los siete equipos `workshop/v3`, detalles constructivos y sellos originales, cuchillo secundario normal/invertido, desvío físico y háptica medida por contacto. Su corte conserva versiones anteriores y distingue archivos sellados de referencias compartidas. [Entrega Items](ENTREGA_ITEMS_SELECCIONADOS_2026-11-02.md).

Personajes aporta la construcción y los apoyos v4, lenguaje corporal, lectura del daño, paño reducido y celebración. La ampliación de catorce a dieciséis coordenadas cambia las trayectorias físicas: las pruebas y las mediciones históricas N14 no certifican el N16. La equivalencia histórica se distingue de las nuevas pruebas de cachés y de las comprobaciones físicas independientes.

Escenografía aporta el taller y su cerramiento 360° v4, con 24 fuentes de luz y presets diurno/nocturno propios. El renderer consume sus coordenadas runtime sin volver a escalarlas; aplica las dos variantes de material antes de sombras y reflejos y evita duplicar las ganancias y el tinte nocturno antiguos. El ventilador usa su rotor, pivote y eje reales. El HDR entregado se conserva como referencia; los reflejos del juego proceden del cubemap de la sala, no de una carga del HDR. [Entrega Escenografía](ENTREGA_ESCENOGRAFIA_RUNTIME_V4.md).

La comparación de recursos principal + cerramiento pasa de 51.097.832 a 59.440.972 bytes de GLB y de 388.704 a 432.027 triángulos. La estimación conservadora de buffers y texturas compartidas pasa de 152.796.200 a 220.638.286 bytes; no es una medición de VRAM ni FPS. Ese incremento corresponde al nuevo contenido visual. Las versiones previas se conservan para reproducción y compatibilidad. [Recibo reproducible](../audit/workshop-v4-footprint.json), generado con `node audit/workshop-v4-footprint.mjs`.

## Alcance de verificación

La suite global del corte final aprobó **1.552/1.552 pruebas**, sin fallos, cancelaciones ni omisiones, en 495.030,7504 ms con Node 24 y concurrencia 2. Los resultados focales describen los módulos y hashes de cada corrida; sus totales se solapan y no se suman como una suite global.

La promoción incorpora el módulo de emblemas deformables y las dos guardas de contacto compacto que ya participaban de esa suite. Una referencia de prueba se trasladó después a `tests/fixtures` con bytes idénticos; revertir únicamente su ruta recupera el hash previo del test. Las 24 comprobaciones relacionadas pasan también desde el clon de publicación, sin depender del directorio de trabajo interno. El build del clon genera 603 archivos para Pages, versión 1.13.0.

La pasada WebGL local cargó los once recursos finales sin errores y verificó apoyos, esquiva, paño, daño y separación de miembros, jefe con mazo, selección e intercambio de los siete equipos, agarres de daga y ambas ceremonias ilustrativas. También comprobó el taller diurno/nocturno y la inspección neutra, la PC sin botones y con dos QR, y el móvil a 844×390 y 428×900. Comenzar cierra el menú tras la confirmación y devuelve los mandos. Las vistas ilustrativas de QA no acreditan victorias competitivas; el desbloqueo y los resultados reales se verifican además en las pruebas de sesión y protocolo.

El ejercicio de profundidad prepara el arma y la aproxima a una altura dentro del globo centrado, de modo que la esquiva 3D evita una amenaza física real. Se verifica con entrada directa y cuenta atrás, conservando los límites de 360/840 pasos y las 47 aserciones originales. Este cambio posterior a la entrega Items se registra como integración de Principal; no modifica retrospectivamente sus recibos históricos.

No se declaran fotorealismo equivalente a w1–w4, 60 FPS sostenidos, vibración en hardware físico ni fiabilidad Wi-Fi por pruebas de Node o capturas del navegador integrado.
