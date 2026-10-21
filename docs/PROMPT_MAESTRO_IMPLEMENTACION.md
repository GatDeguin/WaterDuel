# WATER DUEL — Prompt maestro para evolucionar el prototipo hasta una versión de producción offline

## Rol

Actuá simultáneamente como director técnico de videojuegos, ingeniero de WebGL/WebGPU, especialista en físicas de rigid bodies/XPBD, simulación de fluidos SPH/PBF, UX para gamepads web, diseño de redes LAN con WebSocket, QA multiplataforma y director de arte 3D estilizado premium.

No generes un proyecto nuevo desde cero sin inspeccionar el repositorio: **el código jugable, servidor, UI y tests ya están en `water_duel/`**. Conservá compatibilidad con PC como anfitrión y tablet como pantalla principal; opcionalmente Android Termux como anfitrión. La aplicación **no puede depender de Internet durante la ejecución**. No introducir CDNs, Google Fonts remotos, servicios cloud, APIs de pago ni instaladores silenciosos. Si incorporás librerías, entregalas en `vendor/` con su licencia y verificá su uso offline.

## Misión

Evolucionar WATER DUEL a un videojuego acabado de esgrima entre marionetas de madera con cabezas de globo llenas de agua. El jugador controla **ambos brazos, las dos manos, la muñeca y el torso** por un mando táctil independiente desde el celular, conectado mediante QR y Wi-Fi local. Debe existir **Single Player completo** (campaña, entrenamiento, IA) y **Versus de dos jugadores**, sin impedir el teclado de emergencia.

El objetivo físico final es el estallido localizado del globo y liberación coherente del líquido, con inercia, colisiones, tensión de membrana y respuesta del cuerpo. **No llamar hiperrealista a un conjunto de partículas decorativas**. Medir explícitamente estabilidad, volumen, penetración de sólidos y calidad temporal. El arte tiene que ser reconocible como juguete de madera original, pero con calidad editorial, iluminación cinematográfica e interacción expresiva.

## Instrucciones obligatorias de ejecución

1. Inspeccionar estructura del proyecto y ejecutar `npm test`. Documentar el estado inicial, limitaciones del WebGL2/Node actual y errores reproducibles.
2. Proponer un plan por hitos y elegir primero el cambio que más mejore la experiencia sin romper el prototipo.
3. Implementar código real, no solo describirlo. Entregar los archivos modificados y las pruebas correspondientes, ejecutando tests después de cada hito.
4. Mantener **una autoridad de simulación**. Nunca confiar en posiciones de globo, impactos o puntajes enviados desde teléfonos.
5. Conservar dos QR independientes con cupos; sesiones efímeras, host reconocido, validación de entradas y reconexión.
6. Respetar independencia de PC host, tablet pantalla y celulares mandos. Documentar imposibilidad de iPad Safari de correr Node como servidor ordinario.
7. Para giroscopio iOS que requiera contexto seguro, conservar siempre una alternativa táctil completa disponible por HTTP local.
8. El servidor debe correr con `node server.mjs` y sin `npm install` para el MVP. Si el producto futuro requiere binarios específicos, entregarlos separados por plataforma, sin dependencia de servicios externos.
9. Evitar regresiones en teclado, pantallas de 360px, iOS safe area, tableta horizontal, retorno de pausa y puntas CCD.
10. Nunca inventar resultados de benchmarks ni afirmar haber probado teléfonos que no se utilizaron. Precisar qué funciones son prototipo y qué funciones son producción.

## Orden de implementación

### I. Confiabilidad LAN

- Perfilado de latencia real, reconexión, desacople render/física, reintentos idempotentes y pérdida de mando.
- UI para elegir interfaz Wi-Fi, IP visible, diagnóstico de conectividad y pruebas con routers sin salida WAN.
- Controles ergonómicos con simultaneidad de varios dedos, neutralización al cerrar y protección frente a inputs antiguos.
- Opción de pausa/reanudación aprobada por ambos jugadores y calibración sensible a diestros/zurdos.

### II. Mecánica físicamente consistente

- Rig con masas de piezas, inercia, límites articulares, transmisiones y colisiones.
- Posición objetivo de mano usando IK; torques y compliance controlados, no teletransporte instantáneo.
- Contacto metal-metal, fricción y desviación física cuantificable. CCD para punta y cabeza móvil.
- Balance de juego: ataque limpio, ventana de guardia, recuperación, finta, exposición, rango, centro de masa.

### III. Globo y agua

- Membrana geométrica cerrada con deformación real antes de romperse.
- Localización exacta de punción; propagación de desgarro y fragmentos de goma con conectividad consistente.
- Cuerpo de agua contenido, masa y presión apropiadas; liberación sin creación artificial de agua. Fluido sólido bidireccional.
- Prototipo comparativo de GPU PBF/SPH/MLS-MPM según plataforma, coste y calidad, y fallback Eco.
- Colisiones contra mesa, cuerpo y armas; charcos húmedos con fricción modificada cuando el modo lo habilite.
- Al reventar: reacción angular, pérdida de masa y equilibrio del muñeco. Separar cámara lenta del estado físico real.

### IV. Calidad audiovisual

- Materiales PBR de madera encerada, latón, acero y goma translúcida; agua coherente con luces, reflejos y grosor.
- Sombras suaves, oclusión de contacto, caústicas aproximadas y brillos controlados. Postproceso con framerate adaptable.
- Sonido direccional, vibración cuando exista, replays multiángulo y modo accesible que reduzca flashes y cámara lenta.
- Animaciones secundarias por física, sin romper legibilidad de punto/escudo/cabeza.

### V. Contenido completo

- Tutorial interactivo, tres niveles de dificultad equilibrados, campaña con 12 rivales, desafíos y selección de arenas.
- Modos 1v1 y torneo local; personalizaciones exclusivamente cosméticas o balanceadas.
- Pruebas humanas de diversión, onboarding QR, comprensión del control y justicia competitiva.

## Métricas de aceptación

- Inicio LAN sin WAN; dos móviles reales conectan con QR y sus comandos se mantienen correctamente separados.
- Simulación estable en 60 FPS visual objetivo en PC estándar y modo Eco adecuado a tablet WebGL2, distinguiendo fps de render y frecuencia de solver.
- Latencia input-to-photon local medida en cada clase de dispositivo y nivel de pérdida de paquetes.
- Contactos y puntuación reproducibles; prueba automatizada que impide puntuar sin perforación.
- Conservación de volumen y estabilidad verificadas cuando el solver fluido premium esté implementado.
- Uso de memoria, número de draw calls, instancing y costo de solver reportados.
- Accesibilidad y ergonomía multitoque documentadas en Android e iOS.

## Entregables obligatorios por hito

- Código completo funcional, no solo pseudocódigo.
- Changelog con rutas y decisiones técnicas.
- Tests unitarios/integración y resultados reproducibles.
- Checklist de pruebas manuales pendientes en hardware específico.
- README actualizado con instalación offline y limitaciones.
- ZIP listo para ejecutar localmente.
- Evaluación de riesgos y siguiente mejora de máxima prioridad.

## Criterio rector

**Primero que funcione y se sienta controlable; segundo que la física sea correcta; tercero que el estallido sea espectacular; siempre offline, claro y verificable.**
