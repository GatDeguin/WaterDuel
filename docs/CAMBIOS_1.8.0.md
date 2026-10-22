# WaterDuel 1.8.0

## PC, móviles y QR

El build de Pages reemplazaba el índice de PC por `mobile.html`, por lo que toda
computadora recibía los joysticks móviles. Ahora publica las dos entradas y
`entry.js` selecciona la correspondiente al dispositivo. La PC conserva el
canvas y las invitaciones J1/J2; el móvil conserva los dos joysticks y el menú.
También se redirigen los enlaces antiguos a `mobile.html` abiertos desde PC antes
de mostrar sus controles. Se conservan los parámetros y el prefijo del sitio.

Windows táctil sigue usando PC. Android/iPhone/iPad, incluido iPadOS con identidad
Mac y los móviles con mouse, siguen usando móvil. Los selectores explícitos
`view=desktop` y `view=mobile` tienen prioridad y no producen redirecciones en bucle.
Los mandos autenticados de los QR no pasan por este selector.

El Versus con QR funciona con el servidor local en la misma Wi-Fi. Pages no
ejecuta ese servidor: en PC muestra la escena, sin sesiones ni invitaciones
ficticias. En móvil permite jugar individualmente sin PC. Ver
[publicación](GITHUB_PAGES.md) y [uso móvil](MOBILE.md).

## Defensa automática observada en 3D

La asistencia estima una aproximación corta a partir de la posición y el
movimiento observados de la punta y de la propia cabeza en XYZ. Usa una envolvente
elipsoidal; dejar de aproximarse en profundidad evita respuestas a una amenaza
que sólo coincide en XY. No resuelve impactos ni mueve cuerpos.

Hombro y codo del brazo defensivo dañados aumentan la demora y reducen la
probabilidad del intento. Un brazo desprendido no puede defender. Se mantienen
los dos sorteos deterministas por episodio, el control manual, la energía y los
ataques comprometidos. Una finta no dispara una reacción pendiente desde una
observación vieja; retomar la aproximación reinicia su demora sin volver a sortear.
El daño posterior al disparo no aumenta la duración máxima de guardia.

La altura de intercepción usa la mano defensiva observada en el mundo: mover el
cuello no desplaza el plano del escudo. Una aproximación curva puede completar
una reacción ya iniciada durante un puente menor de 0,15 s, con movimiento actual
finito y corredor Z compatible. Ese puente nunca inicia episodios ni prolonga
la guardia. Retirada, pérdida de observación o salida de profundidad lo vetan
hasta adquirir otra amenaza proyectada y cumplir de nuevo la reacción.

La preparación de estocadas de los estilos de IA también comprueba el alcance
observado en XYZ. La distancia XY por sí sola podía habilitar ataques que aún
quedaban fuera de la sección del globo a esa profundidad. Esta decisión sólo
produce intención de ataque; el contacto barrido sigue decidiendo el pinchazo.
Conserva la longitud de estocada del modelo planar actual; la profundidad se
incluye al comprobar el segmento contra el volumen observado del globo.

## Colisiones de agua

El avance conservador de la colisión entre agua y sólidos reutiliza un registro
privado por consulta para sus sondeos iterativos. Los extremos y las muestras
recursivas mantienen objetos independientes. No cambian las fuerzas, los tiempos
de muestreo, el presupuesto CCD, las tolerancias ni la cantidad de partículas.

En seis ciclos ABBA de 100.000 consultas, la mediana baja de **674,65 a 612,67 ms**
(**9,19%** en ese tramo). Los seis ciclos son favorables, entre 5,20 y 14,46%; los
controles A/A tienen una variación absoluta mediana de 3,51%, con un extremo de
13,82%. Se conserva la dispersión completa, no sólo el promedio favorable.
[Muestras aisladas](performance-1.8.0/water-ccd.json).

Las 28 corridas del anfitrión, de 481 ticks cada una, conservan exactamente el
estado físico, contactos y replay. Ambas variantes usan el grafo publicado 1.7.4,
con rig y autodefensa congelados; sólo cambia el módulo de colisiones de agua.
El tiempo medio total pasa de 5.739,53 a 5.653,93 ms (1,49%), **dentro del ruido** de
sus controles. No acredita una mejora global ni 60 FPS.
[Corridas completas](performance-1.8.0/water-host.json).

El primer bloque de 10.000 consultas fue demasiado corto y ruidoso. Se conserva
[ese resultado](performance-1.8.0/water-short-rejected.json), y se amplió la misma
medición a 100.000 consultas sin cambiar el corpus físico.

## Cinemática del estado objetivo

El cálculo interno del objetivo de los motores sólo consume las derivadas
verticales `jy`. Ahora evita crear sus arrays `jx`, conservando coordenadas,
metadatos y la aritmética vertical. Los estados normales, avanzados, las matrices
y los contactos siguen completos. Un estado parcial nunca se guarda en la caché
compartida; un objetivo que comparte `q` puede leer su estado completo existente.

Las 266 guardas directas comparan por bits coordenadas, `jy`, metadatos y fuerza
nominal; incluyen alias del objetivo, caché fría/caliente, mutaciones, daño,
desprendimientos y extremos. También coinciden exactamente las 18 trazas físicas
completas y los buffers de matriz en 11 casos extremos.

En ocho ciclos ABBA y ocho controles A/A de **40.960 objetivos por bloque**, la
mediana baja de **300,09 a 256,35 ms**, un **14,57%** en el tramo objetivo y su
compensación de gravedad. Los ocho ciclos favorecen al candidato. La variación
absoluta mediana de A/A es 2,82%, con dos picos de 11,06 y 15,03%; las muestras
completas quedan en el [resultado](performance-1.8.0/rig-goal.json).

Los bloques iniciales de 4.096 objetivos se conservan: [primero](performance-1.8.0/rig-goal-short-first.json)
y [repetición](performance-1.8.0/rig-goal-short-repeat.json). Se amplió el mismo
corpus por diez para decidir sobre un bloque más largo. El rig completo pasa de
102,53 a 100,78 ms en 320 substeps (1,70%), con rangos amplios superpuestos: no
acredita una mejora integrada. [Trazas y tiempos](performance-1.8.0/rig-step.json).
Estos porcentajes no se suman al ahorro del agua ni equivalen a FPS de pantalla.

## Intentos descartados del rig

Omitir metadatos no utilizados en estados intermedios conservó las 18 trazas,
pero pasó de 97,26 a 98,34 ms en 320 substeps (+1,12%, rangos superpuestos).
No se incorporó. [Resultado](performance-1.8.0/rig-metadata-rejected.json).

Acumular sólo las columnas estructuralmente activas de la matriz de masas
conservó 18 trazas y los buffers de matriz en 11 casos extremos. Sin embargo,
pasó de 104,53 a 106,69 ms (+2,07%, rangos superpuestos). Tampoco se incorporó.
[Resultado](performance-1.8.0/rig-matrix-rejected.json).

Compartir seno y coseno entre extremo y centro de cada pieza redujo el número
de llamadas JavaScript, pero empeoró el tramo de cinemática: 22,02 a 22,75 ms
(+3,35%; siete de ocho ciclos desfavorables). El conteo con funciones envueltas
no prueba un ahorro en V8. No se incorporó.
[Resultado](performance-1.8.0/rig-trig-rejected.json).

## Verificación de las interfaces

En navegador real se verificó la arena LAN con sus dos QR cargados y cero pads o
menús en PC. También se verificó el build estático montado en `/WaterDuel/`: la
entrada de PC y los enlaces móviles antiguos terminan en la vista correcta, y
`view=mobile` muestra dos pads de 150 px y vuelve a ellos tras Comenzar. Los
11 modelos cargaron y no se registraron errores de consola.

La selección de identidad móvil se verifica con pruebas unitarias; la revisión
de navegador con `view=mobile` no certifica sensores, vibración ni rendimiento de
un teléfono físico. El protocolo LAN se comprobó con sesión, QR y conexiones
autenticadas de ambos jugadores.
