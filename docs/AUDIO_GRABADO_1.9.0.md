# Foley y efectos grabados · 1.9.0

El juego usa grabaciones de objetos y materiales para sus 22 efectos físicos, con tres variantes por efecto. La capa `RecordedGameAudio` está conectada a la entrada real de PC y móvil en `public/game.js`. No basta con exportar WAV: los contactos ahora reproducen estos buffers.

## Dirección sonora

| Material o acción | Tratamiento |
| --- | --- |
| Espadas y escudos metálicos | Impacto metálico y cola de resonancia a menor volumen; roces sólo cuando la física informa fricción. |
| Cuerpo, escudos de madera, pies y articulaciones | Golpes de madera y mecanismos pequeños; crujidos ligados al movimiento y al daño. |
| Globo | Roce y tensión elásticos, pinchazo breve y rotura; la descarga de agua sigue como capa separada. |
| Agua | Gotas, vertido, líquido contenido y salpicadura; el impacto en el suelo depende del contacto físico. |
| Movimiento del arma | Barridos grabados que siguen la velocidad observada. |

Los WAV de distribución son mono PCM16 a 44.100 Hz para que cada fuente pueda posicionarse mediante HRTF en XYZ. El navegador puede remuestrearlos a la frecuencia del dispositivo. El manifiesto registra recortes, mezclas, ganancias, fuentes y hashes; las variantes procedentes de una misma toma se identifican como ediciones, no como grabaciones independientes.

El banco de efectos ocupa 2.681.190 bytes y sus muestras Float32 a frecuencia nativa, 5.356.572 bytes. Incluye 42 originales individuales de siete publicaciones. El [montaje de escucha](../public/assets/audio/recorded-foley-v1/listening-montage.wav) dura 48,887 segundos y permite revisar todas las variantes y las tres combinaciones de rotura. No se descarga durante el juego.

La música de roda de muñecos y los seis avisos tonales conservan su implementación. Se mantienen las posiciones físicas, el oyente ligado a la cámara, las reflexiones del taller, los intervalos entre contactos y el límite compartido de 24 voces.

## Preparación y errores

Los 66 archivos se descargan, verifican por SHA-256 y decodifican antes de publicar el banco completo. Un impacto no descarga, decodifica ni crea buffers de muestras. La publicación es atómica: no se cambia de sonido sintético a grabado a mitad de la preparación.

El silencio cancela la carga y libera el banco. Las pausas lo conservan. Un contexto cerrado invalida cualquier resultado pendiente. Si la carga de grabaciones falla, queda disponible el banco histórico preparado; tampoco se sintetiza dentro del impacto. Las variantes rotan por efecto para evitar que las tres capas de una rotura repitan siempre la misma combinación.

## Procedencia y reproducción del banco

Los créditos accesibles desde ambos menús móviles están en [`credits.html`](../public/assets/audio/recorded-foley-v1/credits.html). El inventario de distribución está en [`manifest.json`](../public/assets/audio/recorded-foley-v1/manifest.json) y el script de preparación en [`prepare-recorded-foley.py`](../scripts/prepare-recorded-foley.py).

Los originales descargados y recibos de investigación quedan en el área privada de trabajo. Sólo se distribuyen los recortes necesarios, su procedencia y los créditos. No se usaron previews MP3, sonidos de uso personal ni originales de baja resolución remuestreados para simular mayor fidelidad.

## Validación

Las pruebas cubren preparación, fallos, mute, pausa, contexto cerrado, rotación de variantes, integridad, compatibilidad histórica, audio espacial y entradas PC/móvil. Las guardas históricas de muestras y procedencia permanecen intactas.

La revisión independiente comprobó los 42 originales y los 66 hashes finales únicos, sin clipping, con al menos 6 dB de margen y DC máximo de 6,44×10⁻⁷. La regeneración del banco, manifiesto y montaje produjo los mismos bytes.

En Web Audio real, el banco completo se preparó a los 48 kHz del dispositivo (5.830.184 bytes PCM). La ráfaga de prueba conservó los tres efectos críticos de rotura, HRTF/XYZ y 24 voces; no creó buffers de muestras ni decodificó durante los impactos. Silenciar canceló y liberó el banco; reactivar volvió a preparar los 66 archivos. No hubo errores ni advertencias de consola en esa prueba.

La verificación técnica no sustituye la evaluación auditiva en los parlantes o auriculares del jugador. No se deriva una certificación de 60 FPS del cambio de audio.
