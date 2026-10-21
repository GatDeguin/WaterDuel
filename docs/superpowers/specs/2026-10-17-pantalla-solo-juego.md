# Pantalla dedicada a la escena

La instrucción expresa del usuario sustituye el diseño de escritorio de R8: la PC muestra sólo el juego, con la escenografía ocupando todo el viewport. No hay HUD, marcador, botones, menú, QR ni diagnóstico sobre la escena. La interfaz completa vive en los móviles ya autenticados.

La simulación, los resultados, los préstamos de equipo de entrenamiento, la campaña y las repeticiones siguen bajo autoridad del host. Los móviles solicitan acciones mediante comandos tipados con ID creciente, fecha, cupo autenticado y ACK correlacionado con la conexión original. El host vuelve a validar valores y fases; ninguna opción escribe puntos ni fabrica contactos.

La escena se presenta desde el primer frame, sin pantalla de bienvenida. El documento contiene únicamente el canvas y el script. Los errores de render se comunican al móvil y a la consola. Los enlaces iniciales de vinculación permanecen en la consola del servidor; nunca se publican claves en el estado compartido.

El menú móvil contiene inicio, revancha, reinicio, modalidad, experiencias individuales, dificultad, formato, escenario, equipo, calidad, cámara, iluminación, sonido, volumen, progreso y transporte de replay. Abrirlo o cerrarlo libera las entradas activas. Las opciones que invalidan la partida se bloquean en combate; el host aplica esas restricciones incluso ante mensajes fabricados. Reiniciar es una acción explícita disponible desde el menú.

La reproducción congela motor, observador y grabador. Volver al combate neutraliza controles, preserva resultados y no recupera tiempo acumulado. Los frames se presentan como copias propias. El objetivo de precisión puede permanecer dentro del mundo como guía de juego, sin UI de PC.

Verificación: pruebas de contrato/relay real, comandos y restricciones del host, continuidad de campaña/equipos/replay, pruebas previas de mandos y captura WebGL del documento sin interfaz a viewport completo. Las pruebas locales no certifican Wi-Fi o teléfonos físicos.
