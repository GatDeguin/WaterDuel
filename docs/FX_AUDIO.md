# Inventario de efectos de audio

El runtime actual tiene **27 sonidos activos**: 21 efectos físicos y seis avisos tonales. **`wood-contact` está desactivado por pedido explícito del usuario**, en todas las fases y rutas de reproducción, incluido el audio alternativo y la capa que antes acompañaba al daño articular.

El registro histórico conserva 28 nombres y el banco original de 66 WAV para sus guardas de integridad; los tres archivos de `wood-contact` no se reproducen en el juego actual. Un nombre de evento, como `joint-break` o `burst`, puede combinar varios sonidos y no constituye otro sonido independiente.

| Nº | ID | Sonido / uso |
| --- | --- | --- |
| 1 | `wood` | Movimiento mecánico de madera del cuerpo. |
| 2 | `joint` | Crujido o movimiento de articulaciones; también participa en daño y desprendimiento. |
| 3 | `shield-wood` | Golpe sobre un escudo de madera. |
| 4 | `footstep-dry` | Pie de madera sobre mesa seca. |
| 5 | `footstep-wet` | Paso sobre superficie mojada. |
| 6 | `metal` | Impacto metálico genérico disponible en el banco. |
| 7 | `ring` | Cola de resonancia metálica añadida a ciertos choques. |
| 8 | `blade-beat` | Choque entre hojas metálicas. |
| 9 | `blade-slide` | Fricción o deslizamiento de metal con contacto medido. |
| 10 | `shield-metal` | Impacto sobre escudo metálico. |
| 11 | `tension` | Estiramiento del látex; también aviso de tensión en tiempo extra. |
| 12 | `puncture` | Pinchazo del globo. |
| 13 | `tear` | Desgarro que sigue al pinchazo. |
| 14 | `latex-rub` | Roce o contacto con látex. |
| 15 | `slosh` | Agua moviéndose dentro del globo. |
| 16 | `jet` | Chorro durante la descarga física de agua. |
| 17 | `drip` | Gotas que alcanzan la mesa. |
| 18 | `splash` | Salpicadura o grupo de gotas al impactar. |
| 19 | `water-burst` | Masa de agua descargada al romperse el globo. |
| 20 | `whoosh` | Barrido de aire genérico disponible en el banco. |
| 21 | `blade-swish` | Movimiento del arma según su velocidad observada. |
| 22 | `countdown` | Pulso de la cuenta regresiva. |
| 23 | `go` | Comienzo del combate. |
| 24 | `victory` | Victoria. |
| 25 | `defeat` | Derrota. |
| 26 | `draw` | Empate o doble pinchazo. |
| 27 | `ui` | Aviso breve de interfaz disponible en el banco. |

Los sonidos genéricos disponibles no se disparan todos continuamente. Los contactos actuales eligen sonidos específicos según material y acción. El daño articular conserva `joint`, su física y sus señales de daño; la capa `wood-contact` ya no suena. Una rotura combina `puncture`, `tear` y `water-burst`. El golpe de agua contra el suelo se dispara aparte, cuando ocurre el contacto físico.

## Activar o silenciar cada efecto

En el menú del móvil, abrí **Sonido → Efectos individuales**. Los 27 interruptores se agrupan por cuerpo y pasos, armas y escudos, látex, agua y avisos. El contador muestra cuántos están seleccionados. **Activar todos** y **Silenciar todos** cambian únicamente esta selección: no activan el sonido general ni modifican sus volúmenes o la música.

La selección queda guardada en el dispositivo que ejecuta la arena: la PC en partidas LAN o el teléfono en el juego móvil individual. Los mandos remotos esperan la confirmación de la arena antes de dar el cambio por aplicado; un corte de conexión restaura el último estado confirmado. Apagar un FX detiene sus fuentes activas y programadas; la reverberación que ya emitió termina de decaer naturalmente. Las preferencias antiguas conservan los 27 seleccionados y mantienen sus volúmenes anteriores. `wood-contact` sigue excluido.

## Golpeteos repetitivos de madera

El observador de movimiento puede emitir `wood` cada 0,22 s y `joint` cada 0,18 s por personaje si supera sus umbrales de velocidad. Esos son máximos permitidos, no temporizadores que fabriquen sonidos estando inmóvil.

Antes de desactivarlo, los contactos físicos entre muñecos producían `wood-contact`. La auditoría de una espera de seis segundos encontró 72 planes de ese sonido para el par `mainForearm/weapon`, aun fuera del combate; el mezclador reproducía 36. En cambio, `wood` y `joint` sólo aparecieron durante el asentamiento inicial de esa muestra. Esa ruta era un candidato concreto al «toc-toc» continuo descrito por el usuario.

La capa de audio del taller bloquea `wood-contact` antes de entrar en la reproducción heredada, por lo que tampoco genera voces durante contactos reales, daño o desprendimientos. `wood`, `joint`, los escudos de madera y los pasos siguen disponibles. El foley inicial de movimiento se atenúa fuera del combate. El código histórico queda disponible para sus guardas; el juego real utiliza la capa nueva.

## Procesamiento y música

Los efectos pasan por distorsión tenue y después reverberación compartida. Los controles permiten dejarlos en 0. HRTF y el oyente de cámara sitúan cada fuente en 3D; el mastering conserva limitación/compresión y saturación suave, y el duck reduce temporalmente la música ante contactos importantes.

La música se reproduce por un bus independiente: intro y tres batallas de la carpeta `music`. No cuenta como otro efecto del inventario. Si persisten golpes con Efectos en 0%, su origen es la pista musical u otra reproducción, no estas voces de foley. Esta desactivación de `wood-contact` no altera los volúmenes ni las preferencias guardadas del usuario.
