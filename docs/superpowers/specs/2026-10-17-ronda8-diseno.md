# Ronda 8 — capacidades jugables y luz

Fuente: mandato completo §§9–13, prioridad humana de fidelidad/material/mecánica/agua/látex y auditoría R8. Esta ronda no sustituye la cobertura completa ni certifica dispositivos físicos.

## Decisiones y alternativas

Replay: volver a simular inputs arriesga reproducir otra agua/ruptura; vídeo raster consume memoria y pierde cámara3D. Se elige grabación de estados visuales propios separada del motor autoritativo. Progresión: se conserva DuelEngine con configuración explícita de práctica/formato, sin victorias por botones. Luz: oclusión de iluminación directa y relleno/transmisión conservados; añadir sombras por sí solo no corrige los globos oscuros de captura33.

## Repeticiones — módulo independiente

`public/replay.js` exporta `ReplayRecorder`, `captureReplayState(game)` y `replayView(frame)`. API Recorder: constructor con `sampleHz=20`, `beforeSeconds=2`, `afterSeconds=1.2`, `maxClips=3`, `maxBytes=64*1024*1024`; `record(game,dt)` usa reloj fijo; `event(name,data)` marca contacto; `newMatch()` limpia ring/pending conservando biblioteca; `.clips`, `.bytes`, `.pending`, `.clear()`. Ajustes compatibles pueden proponerse tras inspeccionar el renderer. Sin DOM/WebGL.

Frame: poses físicas, agua retenida/libre/superficie interna, membrana nativa con espesor, nudo y efectos renderizados, colores/configuración/estado. Typed arrays y datos propios; nunca referencias al motor/rig/GPU. `replayView` crea adaptador de lectura compatible con Renderer3D; cachés/offset no mutan frame ni motor. No reejecutar colisiones ni score.

Clips activados por `burst` real, con antes/después y metadata que distingue demo. Memoria acotada por bytes de buffers/datos, expulsión completa determinista y sin clips vacíos. Guardar contactos decisivos; ranking sólo con metadata mecánica disponible, sin inventarla. UI iniciar/detener, velocidad y barra temporal fuera de fight/countdown; pausa explícita entre rondas/tras partida. Resultado y entrada viva no cambian durante playback.

## Individual — módulo independiente

`public/single-player.js` exporta `SinglePlayerSession` y campaña. API: `constructor({storage=null}={})`; `select(kind)` duel/training/practice/precision/campaign; `configuration()` devuelve `{scenario,aiEnabled,difficulty,aiStyle,arena,bestOf,opponentName}`; `observe(game,dt)` lee poses; `event(name,data,game)` procesa eventos reales; `view(game)` devuelve objetivo/progreso/target/estado/nextAction; `next()` sólo avanza tras victoria/objetivo válido. No DOM/WebGL ni mutación del motor.

Entrenamiento: mover ambos brazos con desplazamiento físico medido, avanzar/retroceder, guardia y estocada efectivas, perforación real. Práctica: objetivo físico sin IA y rondas que se reinician sin terminar por dos puntos. Precisión: zonas marcadas en cabeza rival; sólo `burst` competitivo con punto de impacto dentro de zona cuenta. Fallar puede romper globo pero no cumple objetivo. Demo nunca cuenta.

Campaña: siete encuentros con arena/nombre y estilos agresivo/defensivo/contra/finta/preciso/errático/jefe, avance tras `matchover` ganador1, derrota permite reintentar y empate no avanza. Guardado local versionado/validado; JSON corrupto, versión futura, rango inválido o storage denegado no bloquean jugar ni fabrican progreso. Reset explícito. Estilos usan misma física con conducta diferenciada, no sólo nombres.

## Motor, presentación y autoridad

`DuelEngine.setBestOf(3|5)` sólo ready/matchover, `.bestOf` y `.roundsToWin`; default2 compatible con RULES. `.setScenario('duel'|'practice')` y `.aiEnabled`: práctica reinicia rondas reales indefinidamente, no otorga victorias competitivas. `burst` incorpora impacto copiado y marca de demo; reglas de detección/puntaje se conservan. `.aiStyle` elige perfil táctico compartido por física/control.

Selección individual/formato, objetivo compacto de borde y cajón de replay; no ampliar overlays al centro. Dos QR y exclusividad host intactos. Playback sólo en pausa segura fuera de fight/countdown, neutraliza entrada y no modifica score. Reanudar conserva exactamente el estado vivo.

## Luz/materiales

Mapa de sombra de profundidad desde luz principal sobre opacos, comparación filtrada/bias; agua/látex no se convierten en paredes opacas. Recursos liberados en resize/context loss/dispose, fallback explícito. Evaluar sombras y transmisión bajo luz neutra/final. Película con dispersión reducida ligada a espesor e iluminación puede mejorar lectura; no emisión ficticia del volumen ni óptica SI calibrada.

## Aceptación

Replay acotado reproduce agua/ruptura anterior sin alterar resultado. Individual integrado con acciones reales; mejor5 termina a3 victorias y empate no suma. Estilos respetan reacción, motor y anticipación. Sombras responden a oclusor y materiales preservan transmisión en ambas luces. Tests, GPU real, arbitraje y ZIP offline reproducible con límites/costes expresos. Cobertura completa permanece activa.

§22 autoriza decisiones técnicas ordinarias autónomas, sin nueva confirmación. No hay Git para commits/worktrees; entrega1.3 congelada.
