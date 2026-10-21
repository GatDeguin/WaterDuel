# WaterDuel 1.1 — pruebas manuales pendientes

Esta lista es un protocolo, **no un acta de pruebas realizadas**. Todos los casilleros quedan sin marcar hasta ejecutar el caso y guardar evidencia. Ver [QA_EVIDENCIA.md](QA_EVIDENCIA.md) para los artefactos disponibles. Redimensionar Chromium de PC no acredita un teléfono/tablet físico.

## Arranque offline y dispositivos

- [ ] Registrar PC/tablet/teléfonos, sistemas, navegadores/versiones, CPU/GPU identificada, resolución, calidad, arena, fecha y versión/corte.
- [ ] Con Node 20+ previamente instalado, extraer el ZIP y comprobar `MANIFEST.sha256`, sin `npm install`. Windows: `INICIAR_WINDOWS.bat`; Mac/Linux: `bash INICIAR_MAC_LINUX.sh`. Abrir `http://localhost:8787` y comprobar cargas/WebGL2.
- [ ] PC y mandos en la misma Wi-Fi sin aislamiento de clientes; elegir IPv4 LAN accesible en QR. Permitir puerto en red de confianza, sin abrirlo hacia Internet.
- [ ] Desconectar WAN manteniendo router/Wi-Fi activos y completar partida con dos teléfonos. Registrar cómo se desconectó WAN y los participantes.
- [ ] Escanear QR J1/J2 en dos teléfonos diferentes: J1 controla verde, J2 ámbar. Probar ambos pads, inclinación, muñeca y botones simultáneamente, sin mezclar dedos ni cupos.
- [ ] Probar toque breve/sostenido/liberación de ESTOCADA. Una interrupción con botón sostenido no rearma ataques; liberar/retoque permite el siguiente.
- [ ] Cancelar gesto/perder captura fuera del control: lean/muñeca vuelven a cero con knob, texto y valor accesible. Probar teclado en el mando.
- [ ] Ocultar página, cambiar aplicación, bloquear pantalla y desconectar Wi-Fi: controles caducados se neutralizan y gestos viejos no reviven. Reconectar y relevar un teléfono sin alterar el otro cupo.
- [ ] Probar slider de muñeca ±45° por HTTP LAN sin sensor. Si se prueba sensor/vibración, registrar permisos y soporte reales.
- [ ] Medir latencia física con método/error explícitos. RTT o límite lógico de caducidad no son input-to-photon.
- [ ] Vencer/reiniciar sesión y comprobar cierre/reescaneo. TTL por defecto: cuatro horas; anotar si se aceleró `SESSION_TTL_MS` en el ensayo.

## Autoridad y tablet

- [ ] Con anfitriona PC activa, abrir otra arena en pestaña/tablet: recibe `HOST_BUSY` y la primera conserva autoridad. **No se espera mirror ni espectador.**
- [ ] Liberar la anterior y reintentar tablet como **única anfitriona**, con Node en PC. La tablet simula/renderiza; registrar hardware, perfil y estabilidad.
- [ ] Probar pantalla completa, orientación, vuelta a vista normal y relevo sin dos simulaciones autoritativas.

## Combate y reglas

- [ ] Un pinchazo ofensivo válido gana ronda; contacto sin ataque suficiente o fuera del globo no puntúa. Probar ambos lados y jefe.
- [ ] La barra es **guardia finita, no vida**: sostener consume, bajar recupera, bloquear cuesta energía y cancela estocada. Guardia/ataque son excluyentes.
- [ ] Agotar guardia la rompe; sostener no recarga; al bajar y recuperar umbral vuelve a defender. Evaluar legibilidad del aviso.
- [ ] Doble pinchazo del mismo paso: ambos globos rotos, empate, sin puntos y ronda repetida. Si no se reproduce manualmente, registrar no ejercitado; fixture determinista es evidencia aparte.
- [ ] Completar 2–0, 0–2, 2–1 y 1–2: termina quien gana dos rondas. Revancha/reinicio limpian marcador, guardia y resultado.
- [ ] Esperar 90 segundos sin pinchazo: tiempo extra, sin victoria por reloj; siguiente pinchazo resuelve o doble repite sin puntos.
- [ ] Iniciar durante rotura no salta resolución. `R` reinicia partida completa con cuenta atrás.
- [ ] En cuatro dificultades, probar retirada/aproximación, defensa y contraataque al jefe en recuperación; comprobar alcance y ausencia de solapamiento evidente de globos.

## Inspección visual y audio

- [ ] Fuera de combate, «Cámara, materiales y audio» → **Detalle de articulaciones**. Comparar brazos/herrajes con **Arena completa**; iniciar cuenta atrás/combate vuelve al encuadre general.
- [ ] Comparar **Taller cinematográfico** y **Luz neutra de inspección** en el mismo estado. Registrar normales, transparencias, contraste y clipping.
- [ ] Normal/jefe: superficie libre dentro de membrana y aire encima. Reposo → cambio de dirección → asentamiento, ambas luces. 65% de volumen no significa 65% de altura.
- [ ] Registrar ruptura competitiva y, por separado, **VER DEMO DE ESTALLIDO 3D**, etiquetada punción escenificada. Capturar antes/contacto/liberación/caída: buscar inflación instantánea, doble reserva, desaparición o panel bajo tarima.
- [ ] Repetir agua/látex en ECO/ALTA/CINEMÁTICA y doble pinchazo. Calidad puede cambiar detalle; puntuación/reglas se conservan. Modelo reducido, sin CFD validado ni refracción real.
- [ ] Elegir Boss · El Maestro Hidráulico: nombre, tamaño, anticipación/recuperación y resultado coherente. No se espera campaña/torneo.
- [ ] Tras interacción que habilite audio, comprobar volumen/silencio y eventos. No asumir soporte físico de vibración/sensor.

## Resolución, accesibilidad y rendimiento

- [ ] Arena/mando en 360×800, 390×844, 1024×768 y 1920×1080; distinguir dispositivo físico de viewport redimensionado. Revisar scroll, controles, HUD/overlays y campo de juego.
- [ ] Probar teclado/foco, etiquetas/valores, zoom, lector de pantalla y contraste medido; registrar limitaciones táctiles, auditivas y de color.
- [ ] Guardar JSON con modo/fase/calidad/arena/resolución/duración; separar ventana quieta, captura/interacción y estallido. CPU de envío no mide ejecución GPU.
- [ ] En hardware identificado, ensayar carga fría/caliente, sesión larga, memoria total/VRAM/térmica y dos estallidos. No extender FPS de un caso al resto.

## Acta por prueba

Registrar caso/fecha/versión o hash; dispositivos/OS/navegadores; red y WAN; ajustes especiales; calidad/arena/modo/resolución/duración; pasos/esperado/observado; captura/vídeo/JSON y método; resultado **pasa/falla/bloqueado/no ejercitado**; defecto y reproducción si falla.

Una casilla sin marcar no se convierte en aprobación por un test automatizado parecido. Los bloqueos y casos no ejercitados se conservan explícitos.
