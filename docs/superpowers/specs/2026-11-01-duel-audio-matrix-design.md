# Duelo, música y rotura cinematográfica

Pedido del usuario: mayor distancia inicial, filo del hacha hacia el rival, música de `music`, mejor fluidez y una rotura en cámara lenta con órbita, y distorsión muy leve seguida de reverb en efectos, ajustables desde el menú de sonido. Se añaden la eliminación explícita del efecto `wood-contact` y recorridos de cámara más drásticos y cinematográficos.

Se amplía el juego existente de PC/LAN y móvil. La PC conserva escena y QR; todas las opciones siguen en los móviles. Se mantienen calidad, geometría y contactos físicos.

## Decisiones de implementación

- Al iniciar un duelo, separar los personajes 3,8 unidades; contra el jefe, 4,0. La separación se restaura en cada ronda y encuentro, dentro de la mesa. Los ejercicios conservan su colocación didáctica. Se mantiene la IA histórica y su ventana de contraataque.
- Corregir la orientación asimétrica del hacha en la misma transformación que usan modelo y colisión; comprobar ambos jugadores y arma desprendida.
- Copiar sin alteraciones los cuatro MP3 provistos. Intro en espera/preparación; las tres batallas continúan y alternan por fin natural, sin reiniciarse en cada cuadro o ronda. Streaming evita decodificar minutos a PCM.
- Reutilizar la cámara lenta física existente (velocidad 0,3× durante los primeros 1,3 segundos) y su solver fijo a 120 Hz. La presentación incorpora barridos, cambios de altura y aproximación en espera y entradas; la rotura hace una órbita progresiva de unos 62° y un primer plano, con espacio acolchado alrededor de la acción. El foco parte del impacto real y se funde hacia el centro volumétrico del agua del snapshot, con alternativa al impacto si no hay parcelas válidas. La altura se limita respecto de la mesa y del foco para evitar el piso y el contrapicado vacío. El detalle puede recortar los cuerpos; la composición completa y el frontal se restauran antes del puente a la siguiente ronda. Las uniones siguen continuas cuando aumenta el número de ronda. No depende de una caída de FPS, no cambia resultados y respeta movimiento reducido.
- Mezcla: volumen general, música y efectos independientes; sólo los efectos pasan por distorsión y después reverberación. Valores iniciales elegidos para la implementación: volumen general 55 %, música 24 %, efectos 100 %, distorsión 3 %, reverb 8 % y cola de 1,1 s. Sliders acotados y persistencia validada; sin nodos ni impulsos nuevos en cada impacto.
- Excluir `wood-contact` de toda reproducción, incluidos eventos y fallback, conservando `wood`, `joint` y los eventos físicos de daño.
- Optimizar únicamente un coste demostrado mediante perfil y comparación repetida; conservar muestras físicas y calidad. No atribuir a la cámara lenta una mejora de FPS.

## Enfoques considerados

La separación elegida conserva el comportamiento histórico de la IA y las ventanas de contraataque. Se mantiene el reloj físico de rotura y se mejora la presentación, conservando agua, contactos y replay. Para la música se elige streaming por su uso de memoria. La optimización elimina trabajo redundante demostrado por mediciones y conserva la resolución y las partículas.

## Aceptación

Pruebas de separación y reinicio, orientación y colisión; transporte, persistencia y confirmación de cada ajuste de sonido; ciclos de audio, silencio, pausa y contexto cerrado; ausencia total de voces `wood-contact` con las demás capas intactas; recorrido de cámara continuo y determinista, impacto visible sin atravesar el escenario y composición completa restaurada al salir del detalle; benchmark antes/después y física equivalente. Build y pruebas generales; QA de navegador PC/móvil. Los 60 FPS sostenidos sólo pueden afirmarse con medición que lo acredite.
