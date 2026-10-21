# Juego móvil

`public/mobile.html` presenta el juego y los mandos en el mismo documento. Usa
`data-mobile-game="true"`, un único `gameCanvas` y los módulos compartidos
`game.js` / `controller.js`; no hay iframe ni una segunda simulación en la página.
La integración del runtime móvil selecciona la sesión individual local, sin PC
ni WebSocket. La entrada de escritorio conserva el Versus y sus QR.

## Presentación

- La escena ocupa el viewport completo, sin rotación CSS forzada. En vertical
  aparece una recomendación discreta de usar orientación horizontal.
- Dos pads de 110–150 px se anclan a las esquinas inferiores, respetando las
  áreas seguras. Son semitransparentes y el centro del duelo queda libre.
- Un botón de menú de 44 px abre un diálogo lateral accesible. Estado, jugador,
  instrucciones, equipo, campaña, imagen, audio y repeticiones están en el panel.
- El menú móvil pausa la simulación mediante el runtime. Versus figura como
  opción deshabilitada y tiene un enlace explícito a `./?view=desktop`.
- `mobileHeadTouch` controla el panel opcional `mobileHeadPanel`, oculto por
  defecto. El runtime cierra el menú al activarlo para que el headPad
  funcione con los controles normales. Sus botones de sensor siguen en el menú.
- Victoria/revancha conserva el overlay y los IDs del mando existente. Los
  avisos de carga y error imprescindibles tienen una presentación pequeña.
- `joinCodes` existe por compatibilidad del módulo de juego, pero el CSS móvil
  lo oculta incluso si cambia su atributo `hidden`.

## Contrato compartido

Se conservan los 94 IDs de `controller.html`. Al añadir una opción o un elemento
requerido por `controller.js`, actualizar también `mobile.html`; los IDs no
deben duplicarse. El panel opcional está fuera del diálogo para poder controlar
la cabeza después de cerrarlo. Los dos joysticks principales siguen generando
movimiento y ataque; no se agrega un botón de ataque.

`mobile.css` se carga después de `controller.css` y redefine únicamente la
composición móvil. No incorpora imágenes, fuentes remotas ni filtros de fondo
costosos. Mantiene foco visible, objetivos táctiles y el comportamiento de
movimiento reducido de los controles compartidos.

## Uso y verificación

Ejecutá `npm start` o el lanzador de tu plataforma y abrí `/mobile.html` en el
teléfono. La entrada principal también selecciona esta vista cuando el dispositivo
tiene pantalla táctil, puntero principal grueso y no usa hover. `?view=mobile`
permite elegirla explícitamente y `?view=desktop` conserva la entrada de PC.
Los scripts y recursos se sirven por HTTP/HTTPS; GitHub muestra los archivos
fuente y no ejecuta por sí mismo el servidor Node.

La revisión verificó IDs, etiquetas, referencias ARIA e imports. En Chrome con
emulación táctil se probó la escena real a 844×390 y el menú a 390×844: cargaron
los 11 modelos desde una subcarpeta, ambos dedos controlaron sus pads a la vez,
Comenzar devolvió directamente al juego y el mando opcional de cabeza abrió su
panel al cerrar el menú. El reloj físico permaneció idéntico durante una rotación
con el menú abierto. El estado de carga completada queda dentro del menú.

Las pruebas Node ejercitan HostSession, el protocolo local, el STEP del juego,
neutralización, expiración de entradas, pausas y compatibilidad de los mandos LAN.
Esta validación no certifica 60 FPS, sonido ni vibración en un teléfono físico.
