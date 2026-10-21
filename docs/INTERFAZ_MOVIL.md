# PC dedicada al juego · móviles para configuración

La PC abre `/` y presenta el canvas WebGL2 ocupando todo el viewport. Por petición posterior explícita del usuario, las únicas superposiciones son dos QR pequeños: J1 abajo a la izquierda y J2 abajo a la derecha. No hay menú, HUD, marcador, avisos ni diagnóstico de escritorio. La página empieza mostrando directamente el taller. Para ocultar también las barras del navegador puede usarse su modo de pantalla completa.

## Vinculación inicial

Iniciar `node server.mjs` o el lanzador de la plataforma. Escanear el QR de cada esquina con el móvil correspondiente conectado a la misma LAN. La consola conserva la dirección de la arena y los enlaces personales J1/J2 como alternativa. Son invitaciones distintas; no deben copiarse a recibos ni al estado de menú. Los códigos proceden de `/qr/1.svg` y `/qr/2.svg`, generados por el servidor local con su codificador incluido y un margen blanco de cuatro módulos. La pantalla valida que ambos enlaces de `/api/session` pertenezcan a la dirección de servidor anunciada, al jugador correcto y a una sesión vigente; las claves no se copian a atributos HTML. Los QR se ocultan si su imagen falla, caducan o se pierde la conexión; al redescubrir la sesión se renuevan.

Cada imagen ocupa 96 px en una pantalla de 1280 px de ancho y se reduce hasta 64 px en ventanas pequeñas. Tiene fondo blanco opaco, el texto mínimo J1/J2 y no captura punteros ni reduce el canvas. La validación de rutas, generación y caducidad no equivale a comprobar el escaneo con un teléfono físico.

Una vez conectados, cualquiera de los dos móviles puede abrir **MENÚ** y gestionar la partida compartida. No hay un rol de administrador adicional. El host conserva la autoridad de resultados y aplica restricciones aunque el mando intente enviar valores fabricados.

## Opciones del móvil

- Inicio, reinicio, revancha, marcador, ronda, reloj, recursos de guardia y objetivos.
- Individual/versus; escuela, práctica, precisión, campaña y duelo; dificultad y mejor de3/5 cuando corresponda.
- Escenario, arma y defensa de ambos jugadores. La escuela presta espada/escudo corto y restaura las selecciones personales al salir.
- Imagen y sonido: fluidez, calidad máxima, cámara de detalle fuera del combate o en replay, luz, sonido y volumen de la arena. El audio sigue sujeto a la habilitación del navegador anfitrión.
- Campaña: progreso, siguiente encuentro, reintento y reinicio del progreso.
- Repeticiones: abrir contacto, pausa, recorrido, velocidad y vuelta a la partida. Durante playback no avanzan motor, observador ni grabador.

Abrir/cerrar el menú libera capturas multitáctiles y envía neutralización explícita. Ésta cancela una pulsación pendiente aún no consumida por el host; una estocada ya comprometida conserva su respuesta física. El combate continúa con el muñeco en neutro mientras el menú está abierto. El texto del menú lo indica.

Cambios de reglas, experiencia, equipo y escenario requieren preparación o fin de partida. La campaña fija escenario/dificultad/formato. Reiniciar es una acción explícita que puede interrumpir la partida. No hay victorias desde opciones ni cambios de puntos durante playback.

## Mano derecha y cabeza

El joystick derecho usa los controles existentes: **izquierda recoge, derecha extiende; arriba o abajo orienta el arma e inclina la muñeca**. En diagonal hacia la izquierda, la extensión disminuye gradualmente. El indicador muestra **RECOGIENDO** al llevar el eje horizontal por debajo de −0,08. Soltar vuelve al neutro; no hay un botón nuevo de ataque ni estocadas repetidas por temporizador.

Si el arma queda trabada bajo otra, probá retirarla y bajarla antes de volver a extender. La salida depende del contacto físico y del espacio disponible. La inclinación del teléfono sigue dedicada exclusivamente a la esquiva de cabeza lateral y en profundidad; no mueve el arma.

## Fluidez e imagen

En **MENÚ → Imagen y sonido → Fluidez**, **Calidad fija** es la opción predeterminada y mantiene el perfil elegido. **Adaptativa experimental** se activa sólo si se elige expresamente; su mejora de fluidez no está acreditada. **Calidad máxima: Eco / Alta / Cinemática** establece el techo que puede usar la adaptación.

Según la carga, la adaptación local de la arena reduce la resolución interna de imagen desde el 100 % hasta el 70 % y puede usar el perfil Eco durante la ruptura. La escena sigue ocupando toda la pantalla. No cambia la física a 120 Hz, las 200 parcelas de agua, los contactos, el audio, los controles ni los datos de las repeticiones. Al revisar una repetición se usa calidad fija para facilitar su inspección.

## Confirmaciones y reconexión

Los comandos usan ID creciente, tiempo de servidor y un relay autenticado por cupo. El servidor impone antigüedad, ritmo y expiración. El host vuelve a comprobar edad, valores y fase. Cada respuesta corresponde al socket que solicitó la acción; una reconexión no recibe ACK de un mando retirado. Los controles de sockets retirados tampoco llegan al host.

Las selecciones confirmadas esperan el estado autoritativo aplicado antes de volver a habilitarse. Si el host se desconecta o falta confirmación, se informa en el móvil y no se reenvían acciones automáticamente. Al caducar la sesión, la arena consulta otra vez `/api/session` y presenta los códigos nuevos; los móviles deben escanearlos nuevamente. Una segunda arena no desplaza a la autoridad existente.

Las pruebas de protocolo y VM no equivalen a ensayo con dos teléfonos físicos. El fixture `/qa/controller-layout.html` prueba sólo markup/CSS: no carga el controlador, no usa credenciales, no conecta sockets ni ejecuta acciones.
