> **Nota de versión v1.0:** se implementaron materiales procedurales, marionetas refinadas, fluidos volumétricos basados en partículas y rotura de látex procedural. Las imágenes de referencia son objetivos visuales; para saber qué funciona hoy y qué falta, consultar `README.md` e `IMPLEMENTACION_FISICA_V1.md`.

# WATER DUEL — Game Design Document

**Versión de diseño 1.0 · Juego de duelos de autómatas · Una pantalla compartida + móviles por QR · Operación sin Internet**

## A. Identidad y objetivos

**Pitch:** Dos marionetas artesanales con cabezas de látex cargadas de agua intentan pinchar la del rival. Cada mano responde a un pad táctil de celular; el equilibrio, la posición del cuerpo y el impulso de estocada transforman un duelo pequeño en una confrontación visual y física de alta expresividad.

**Pilares:** (1) Control corporal comprensible; (2) decisiones tácticas relevantes; (3) respuesta físico-visual coherente; (4) partidas sociales de incorporación instantánea; (5) estética artesanal minimalista cinematográfica; (6) funcionamiento sin conectividad externa.

**Cámara de juego:** lateral 3D con perspectiva suave para leer alcance, arma y cabeza; zoom de tensión y replays opcionales en etapas futuras. La cámara nunca debe ocultar puntas, cabezas o manos durante los cuadros decisivos.

**Tono:** humor físico elegante y competitivo. Destrucción de objetos, agua y goma, sin violencia humana realista. Materiales madera, latón, acero, porcelana clara, látex y agua.

## B. Versiones de juego

### B.1 Single Player

- **Primer contacto:** conectar celular 1 o utilizar teclado; aprender mano armada, brazo de guardia, torso y muñeca.
- **Partida rápida:** oponente IA seleccionado por nivel (Aprendiz / Competidor / Maestro). *Ya implementado en el prototipo.*
- **Campaña prevista:** 12 rivales con personalidades y patrones distintos: Centinela, Estocador, Contratacador, Ilusionista, Zurdo, Equilibrista, Acorazado, Veloz, Desviador, Larguirucho, Caótico y Maestro del Agua.
- **Desafíos previstos:** acertar diez globos a distintas distancias, sobrevivir 45 segundos, derrotar a un rival sin usar estocadas consecutivas, encadenar tres paradas, defender con torso inmóvil, pinchar durante la recuperación de una esquiva.
- **Progresión prevista:** acceso a nuevas arenas, pequeñas variaciones estéticas y gradiente de habilidades, **sin** ventajas ocultas de daño o colisión en niveles competitivos.

La IA debe percibir posiciones y velocidades **observables** y decidir por intervalos. No debe poder alterar el resultado después de detectar que perderá ni usar impactos sin contacto geométrico.

### B.2 Versus 1v1

- PC o tablet muestran una arena única; cada teléfono controla exactamente uno de los muñecos.
- El host genera un QR verde J1 y otro naranja J2.
- Permite primer jugador y segundo jugador conectados en distinto orden.
- Cuenta atrás: 3, 2, 1, duelo. Emparejamiento no bloqueante y reconexión en el mismo cupo.
- Mejor de tres: primer competidor con dos perforaciones gana el partido.
- Tiempo ordinario: 90 s por ronda; si no hay pinchazo se entra en **muerte súbita**, sin regalar golpes ni declarar vencedor arbitrario.
- Recibir un impacto en el arma o en la mano defensiva cambia la trayectoria de la estocada. En etapas premium, simular impulsos y transferencia de momento con solver de restricciones.
- Botón de revancha y selección de arena.

### B.3 Modos futuros, separados del MVP

Campaña completa, torneos de 4–8 participantes rotando cupos, desafíos, repeticiones persistentes, personalización, armas con masa calibrada, arenas con reglas meteorológicas, clasificatorias locales y modo espectador.

## C. Mecánica y controls

### C.1 Acciones analógicas simultáneas

| Eje | Rango | Interpretación física |
|---|---:|---|
| Mano izquierda X,Y | [-1,+1]² | Objetivo de IK del brazo sin arma; guarda y desvíos |
| Mano derecha X,Y | [-1,+1]² | Objetivo de IK del brazo armado y ángulo del ataque |
| Torso | [-1,+1] | Consigna de inclinación y desplazamiento del centro de masa |
| Muñeca | [-1,+1] | Ajuste fino ±45° conceptual; en el prototipo desplaza el ángulo de la punta |
| Guardia | booleano | Protección activa en mano libre |
| Estocada | pulso | Impulso hacia delante y posterior enfriamiento |

**Física de control:** el jugador solicita una meta articular, no mueve directamente vértices del cuerpo. El conjunto rig/IK + restricciones convierte esas consignas en posiciones alcanzables. Velocidades y aceleraciones de servocontrol deben estar limitadas, especialmente en dispositivos donde el dedo salta varios centímetros.

### C.2 Ventanas tácticas

- En neutral, el jugador explora distancia de ataque y líneas de la punta.
- Al inclinar el torso hacia delante, se gana alcance a cambio de exponer el globo.
- La mano defensiva intercepta una línea de estocada activa si se encuentra cerca del recorrido.
- Una estocada tiene fase de aceleración y recuperación; el “spam” no debe generar más precisión ni energía.
- El pinchazo solo ocurre si existe una intersección válida entre trayectoria, volumen del globo y ataque intencional.

### C.3 Colisión, puntuación y justicia

El prototipo utiliza barrido de un segmento entre dos posiciones consecutivas de la punta contra una elipse que aproxima la proyección del globo. La implementación premium debe usar cápsula/punta en 3D con CCD y una membrana deformable que recibe un evento de perforación al exceder umbral local de presión. Distinguir **contacto** de **perforación**.

Los puntajes deben derivarse de eventos físicos que el motor valide. Ninguna animación, replay o sonido concede puntos de forma independiente.

## D. Animación y física

### D.1 Rig del muñeco

Estructura objetivo: pelvis y centro de masa; torso; cuello flexible; hombros con rotación; codos; muñecas; manos; cadena de soporte de piernas; pies y puntos de apoyo. Materiales y masas configurados separadamente. La cabeza llena de agua genera un centro de masa alto que afecta oscilación y recuperación.

**Prototipo implementado:** rig simplificado con IK de dos huesos, resortes numéricos de seguimiento, cabeceo del cuerpo, oscilación del globo y colapso después del estallido. **No está implementado** un ragdoll 3D articulado completo basado en impulsos rígidos.

### D.2 Globo cargado con agua — especificación premium

1. **Estado inicial:** membrana elástica con tensión uniforme y cuello unido al torso; masa líquida conservada; deformación por movimiento del cuerpo.
2. **Impacto superficial:** triangulación o malla deformable computa desplazamiento local, tracción y contacto con punta.
3. **Perforación:** umbral basado en espesor, fuerza normal y geometría de punta; registro de la coordenada del contacto.
4. **Desgarro:** propagación limitada y direccional de grietas sobre malla, conservación de continuidad hasta la rotura; fragmentos de goma o trozos conectados con deformación elástica.
5. **Liberación:** el contenido líquido transita desde confinamiento a flujo abierto; volumen total se conserva (excepto evaporación/LOD estética ficticia) y la presión se resuelve según el modelo.
6. **Acoplamiento:** impulso del agua sobre torso, manos, base, arma y otros cuerpos; caída de masa líquida reduce la inercia y desplaza el equilibrio del muñeco.
7. **Superficies:** agua forma gotas, láminas y charcos que se desplazan; su interacción debe respetar gravedad, normal y fricción de plataforma.
8. **Cámara y audiovisual:** macro/replay cinemático **sin alterar la física base**. Cámara lenta muestra estados guardados o re-simulados de manera coherente.

**Prototipo implementado:** entre 105 y 265 gotas visuales con gravedad, velocidad inicial anisótropa, rebote y fricción; pequeños fragmentos visibles de goma y ondas de charco. Es físicamente inspirado, pero no conserva volumen mediante un solver de fluidos ni representa tensión superficial ni flujo contínuo de malla deformable.

### D.3 Renderizado

- Geometría procedural 3D de madera, brazos articulados, acero y cabeza globo.
- Iluminación direccional estilizada, rim light, brillos metálicos y transparencia aproximada.
- Etapa premium: PBR por material, ambiente HDR, sombras coherentes, iluminación de contacto, espesor de látex, refracción realista, superficies mojadas y normal maps dinámicos.
- LOD: Alta / Eco. Optimización estricta para tablets, con reducción de partículas antes que reducción de legibilidad de la aguja.

### D.4 Audio

Sonidos específicos: resortes y madera, cuchillada o vibración metálica, choque de arma, tensión de látex, explosión acuosa y goteos. En el MVP se generan mediante Web Audio (síntesis local, sin recursos descargados). Futuro: mezcla adaptativa por eventos y acústica por arena.

## E. Experiencia de usuario

**Pantalla host:** menú de modalidad y dificultad; arena; marcador; estados de fase; QR de J1 y J2; selección IP de Wi-Fi; selector de arena; opción Alta / Eco y pantalla completa; reinicio y audio.

**Pantalla mando:** dos pads grandes para multitoque, barra de torso, barra de muñeca, botones de guardia/estocada con retención, indicador de conexión, nombre/cupo y marcador, feedback háptico cuando navegador lo admita.

**Conexión offline:** UI debe mostrar explícitamente si se conectó el navegador host y si hay dos mandos reales. Nunca presentar “CONECTADO” solo por abrir una URL si no se ha completado el handshake WebSocket. QR rotativos por sesión, enlace personal por jugador.

**Accesibilidad:** no depender solo del color, teclas en PC, textos de estado, vibración opcional, controles suficientemente grandes, `prefers-reduced-motion` en elementos UI y evitar destellos intensos.

## F. Sistema técnico

- **Servidor:** Node.js built-in HTTP + upgrade WebSocket sin paquetes adicionales; 0.0.0.0:8787; conexión local.
- **Host:** HTML/CSS/JavaScript; WebGL2 3D procedural; bucle fijo 120 Hz (el display renderiza a la frecuencia efectiva de su dispositivo).
- **Mando:** HTML táctil, eventos Pointer Events, WebSocket ~30 transmisiones/s en estado estable.
- **Protocolo:** `hello/host`, `hello/controller`, `control`, `presence`, `state`, `event`, `welcome`.
- **Arquitectura:** servidor reenvía inputs autenticados por cupo; una instancia de simulación en el navegador host es la única autoridad física de la partida.
- **Operación:** NAT, nube, TURN, OAuth, CDN y acceso a Internet innecesarios. Los datos permanecen en la Wi-Fi local.

## G. Criterios de aceptación

### Imprescindibles actuales

1. Servidor inicia offline, sirve HTML/JS/CSS y QR válido por cupo.
2. Ambos celulares reciben sesión y sus comandos no se mezclan.
3. Un host activo recibe inputs J1 y J2, y notifica pérdida/reconexión.
4. Single Player completa partidas físicas con IA.
5. Una trayectoria correcta de aguja activa provoca un estallido y actualiza puntuación.
6. Agua y fragmentos se mueven con gravedad y tocan la plataforma.
7. Controles táctiles operan sin HTTPS y sin sensores especiales.
8. La salida gráfica se adapta a escritorio y tablet compatible con WebGL2.

### Objetivos de producto futuro (no declarar implementados)

- Simulación de membrana con deformación no rígida y rotura topológica real.
- Fluido con conservación de masa y acoplamiento sólido-líquido.
- Servos y colisiones de un ragdoll 3D completo.
- Replays reproducibles con estado físico determinista e interoperabilidad.
- Campaña, jefes, múltiples tipos de armas y editor de personajes.
- Validación intensiva en gama de Android/iOS y dispositivos de baja potencia.

## H. Valoración de producto

Para el lanzamiento comercial, priorizar primero: **fricción de conexión baja, controles estables y combate táctico legible**. Después elevar el tratamiento visual del agua y la membrana con una pipeline GPU especializada. Una física espectacular pero que impida controlar el brazo o que pierda inputs desde Wi-Fi degradará la experiencia central.
