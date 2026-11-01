# Duelo, música y rotura cinematográfica · 1.10.0

Al comenzar los duelos, los personajes se separan 3,8 unidades; contra el jefe, 4,0. La apertura se restaura entre rondas y encuentros, dentro de la mesa. Esta separación conserva la IA histórica y sus ventanas de contraataque. Los ejercicios mantienen su colocación didáctica. Se corrige el giro del hacha del jugador 2 en el modelo importado, la versión procedural, el filo físico, el cabezal y las piezas desprendidas. [Detalles y pruebas de geometría](DUEL_OPENING_AXE_1.10.md).

## Música y menú de sonido

El juego usa los cuatro MP3 provistos en la carpeta `music`: `intro.mp3`, `batalla.mp3`, `batalla2.mp3` y `batalla3.mp3`. Las copias de distribución en `public/music` conservan exactamente sus bytes; su manifiesto registra tamaño, SHA-256 y metadatos. Aunque las dos últimas tienen el mismo tamaño, son archivos distintos.

La intro acompaña la espera y la primera preparación. Durante el combate, las batallas alternan al terminar y continúan entre rondas. La pausa y el silencio conservan la posición de la pista. Se reproduce un único stream a la vez y se incluye como una voz en el presupuesto compartido de 24. El servidor LAN entrega tamaño y rangos de audio, por lo que el navegador conoce la duración y puede continuar o buscar dentro del MP3. Pages utiliza sus propios encabezados de archivos estáticos.

El menú móvil tiene una sección **Sonido** con volumen general, música, efectos, distorsión, reverberación y duración de la cola. Los valores iniciales son 55 %, 24 %, 100 %, 3 %, 8 % y 1,1 s, respectivamente. Se pueden ajustar durante una partida; se validan los límites y se confirma el estado aplicado por la arena. Los ajustes se conservan en el almacenamiento local del host, con una alternativa segura si éste está bloqueado.

Los efectos pasan por una saturación tenue y luego una sala compartida de delays filtrados; la música tiene su bus independiente. Las reflexiones antiguas quedan desactivadas en la capa nueva para que el ajuste de reverberación al 0 % sea realmente seco. Cambiar la duración modifica coeficientes nativos sin generar impulsos PCM. Se conservan HRTF, las posiciones XYZ, la prioridad de los pinchazos y el banco grabado. El mastering mantiene el limitador existente.

Se elimina el efecto `wood-contact` de la reproducción. Los golpes `wood`, los sonidos `joint` de articulaciones y los eventos físicos de daño conservan sus demás capas.

## Cámara de rotura

La espera y las entradas incorporan barridos laterales, cambios de altura y aproximación. Durante la rotura, una órbita progresiva de unos 62° pasa de una vista elevada a un primer plano lateral. El foco parte del impacto y sigue gradualmente el centro volumétrico del agua que cae, obtenido de las parcelas del snapshot; no sigue la cabeza vacía ni necesita historial de cámara. El encuadre reserva espacio a su alrededor y puede recortar los cuerpos durante el detalle. La altura se limita respecto de la mesa y del foco para evitar atravesar el piso o mirar al techo. La cámara recupera la composición completa y el frontal de combate antes del puente de ronda, que enlaza con la próxima entrada aun cuando aumenta el número de ronda. El recorrido se adapta a la relación de aspecto y respeta movimiento reducido e inspección de replay.

Se aprovecha la cámara lenta física existente: velocidad 0,3× durante los primeros 1,3 s, manteniendo pasos de 1/120 s y la interpolación del agua, el látex y los cuerpos. La órbita es una animación de presentación determinista; no depende de los FPS ni atribuye una mejora de rendimiento a reproducir la escena más despacio.

## Rendimiento medido

El perfil de un pinchazo real señaló asignaciones temporales en geometría de contacto. `projection` y `supportFace` ahora acumulan los mismos mínimos, máximos y soportes en el mismo orden, sin arrays temporales por vértice. No se recortan geometría, partículas, contactos ni iteraciones.

En ocho comparaciones ABBA de 300.000 pares, esos helpers bajan de 157,328 a 22,282 ms (**−85,84 % aislado**); los ocho ciclos favorecen el cambio. El ruido A/A mediano es 1,49 %, con un máximo de 7,36 %. El corpus incluye 4.227 casos y la guarda pública compara más de 5.000 paneles actuales, incluidos ambos lados del hacha corregida, a nivel de Float64.

Las 16 trazas de rig y los 28 pinchazos Host conservan exactamente sus estados, eventos, agua y replay. El Host completo arroja 5.487,67 → 5.280,63 ms (−3,77 % observado), pero el ruido A/A alcanza 6,16 %. **No se acredita con ello una mejora global ni 60 FPS sostenidos.** La fluidez final depende también de GPU, navegador y dispositivo.

Datos de [helpers](performance-1.10.0/panel-paired.json), [Host](performance-1.10.0/host-paired.json) y [trazas exactas](performance-1.10.0/rig-exact.json). El perfil y sus fuentes congeladas quedan en la investigación privada para no ampliar la descarga del juego.

## Verificación

Las pruebas abarcan apertura, hacha reflejada y desprendida, IA y recuperación del jefe, cámara y replay, playlist, ciclo de vida del audio, orden de efectos, exclusión de `wood-contact`, estado persistido y transporte LAN autenticado. La IA y el piloto histórico de contraataque conservan sus implementaciones anteriores. Se mantienen las guardas históricas de audio y física; las comparaciones que contenían el antiguo hacha aplican una capa literal y reversible para distinguir el cambio funcional de las optimizaciones.

La QA nativa comprobó intro y tres batallas con duración conocida, continuidad entre rondas, cero llamadas redundantes a `play`, banco grabado preparado, tres voces críticas XYZ/HRTF y un total máximo de 24 con música. Los impactos no decodifican ni crean buffers de muestras o shapers. La pausa y el silencio detienen el audio y sus colas; reactivar prepara el banco y reanuda un único stream.
