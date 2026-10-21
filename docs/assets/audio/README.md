# Audio original de WaterDuel

Mezclador, política modal dinámica y observador físico ya conectados al juego: [integración coordinada con Principal](../../../audit/COORDINACION_AUDIO.md). Mesa de escucha: `/qa/audio-checks.html` en el servidor local.

Ampliación de espadas, materiales, pasos y rotura acuosa: [Foley v2](foley-v2.md) · [contrato y evidencia de integración](../../../audit/COORDINACION_AUDIO_FOLEY_V2.md). El banco original de 35 WAV permanece intacto.

Dirección aprobada: **taller mecánico sutil**. Percusión de madera, notas metálicas suaves y bajo discreto; agua y látex tienen capas propias. Todo el audio se sintetiza con código local. No se usaron grabaciones, muestras descargadas, servicios externos ni dependencias de audio.

## Entrega

- `public/audio/synthesis.js`: renderizadores puros, compartidos por el navegador y el exportador.
- `public/assets/audio/workshop/`: 18 efectos mono, 12 pistas musicales estéreo, cuatro mezclas estéreo, montaje de escucha y manifiesto.
- `scripts/export-game-audio.mjs`: exportación reproducible a WAV PCM de 16 bits; 22050 Hz por defecto.
- `tests/audio-synthesis.test.mjs`: verificación de señales, modos musicales, loops, formato y procedencia.

El banco por defecto contiene **35 WAV, 32.08 MB**. El manifiesto incluye duración exacta en muestras, pico, RMS y SHA-256 de cada WAV. La exportación es determinista y no incorpora fechas variables.

```powershell
node scripts/export-game-audio.mjs
node --test tests/audio-synthesis.test.mjs
```

El exportador acepta `--sample-rate 8000` hasta `48000` y `--output RUTA`; solo escribe sus archivos declarados y no elimina carpetas. El límite del banco es 80 MB, suficiente para el máximo admitido. Los picos y RMS del manifiesto se calculan sobre el PCM cuantizado que se entrega.

## Foley y efectos

| Nombre | Uso sonoro |
| --- | --- |
| `wood` | Impacto corto con resonancias de madera |
| `joint` | Articulación de juguete, doble golpe grave |
| `metal` | Choque de metal con cola corta |
| `ring` | Resonancia metálica sostenida |
| `whoosh` | Movimiento de aire coloreado |
| `slosh` | Movimiento de agua grave y burbujas |
| `tension` | Látex que se estira y sube de tono |
| `puncture` | Chasquido de perforación y primeras gotas |
| `tear` | Desgarro pulsado con resonancias de látex |
| `jet` | Chorro de agua con gotas dispersas |
| `drip` | Gota resonante breve |
| `splash` | Salpicadura grave con burbujas separadas |
| `countdown` | Pulso de cuenta atrás |
| `go` | Señal ascendente de inicio |
| `victory` | Frase metálica ascendente |
| `defeat` | Frase descendente suave |
| `draw` | Frase de cierre neutral |
| `ui` | Confirmación breve de interfaz |

`renderSound(name, {sampleRate = 22050, seed = 1})` devuelve un `Float32Array` mono. Las semillas producen variaciones reproducibles. Cada efecto comienza y termina en cero, conserva margen de nivel y dura entre 0.1 y 1.6 segundos. Los nombres desconocidos, semillas no finitas y frecuencias de muestreo fuera del rango admitido se rechazan.

## Música modal

`renderMusic({sampleRate = 22050, stem = 'mix', mode = 'lydian'})` devuelve `{channels, sampleRate, bpm: 96, bars: 8, duration: 20}`. Los dos canales contienen exactamente 20 segundos. `MUSIC_STEMS`, `MUSIC_MODES` y `MODE_INTERVALS` exponen los nombres y las escalas disponibles.

Todas las versiones comparten **tónica Re, 4/4, 96 BPM y ocho compases**. Cambian las notas de melodía, percusión afinada y armonía. Las quintas del bajo también se calculan dentro de cada escala.

| Modo | Intervalos en semitonos desde Re | Color característico |
| --- | --- | --- |
| `lydian` | 0, 2, 4, 6, 7, 9, 11 | Sol sostenido, cuarta aumentada |
| `dorian` | 0, 2, 3, 5, 7, 9, 10 | Fa natural y Si natural, tercera menor y sexta mayor |
| `aeolian` | 0, 2, 3, 5, 7, 8, 10 | Si bemol, sexta menor |
| `phrygian` | 0, 1, 3, 5, 7, 8, 10 | Mi bemol, segunda menor |

Las tres pistas son `wood`, `metal` y `bass`. Cada WAV musical se llama `music-MODO-PISTA.wav`; las mezclas se llaman `music-MODO-mix.wav`. Por ejemplo, `music-dorian-metal.wav` y `music-phrygian-mix.wav`.

La victoria usa Re mayor para acompañar lidio; la derrota desciende por Re menor para acompañar eólico. Inicio y empate usan Re y La, comunes a los cuatro modos.

Las pistas conservan el mismo nivel que tienen en la mezcla: su suma reproduce `mix`. Las colas que cruzan el final se suman al principio con índices circulares. Para el loop se utiliza el buffer completo, sin recortar ni aplicar un fundido a silencio. Un compás dura 2.5 segundos; el mezclador puede cambiar de modo en ese límite manteniendo el reloj y aplicando una transición corta de ganancia.

Para evitar trabajo de síntesis durante un duelo, se recomienda precargar y decodificar los WAV locales al activar el audio. El renderizador puro queda disponible para reconstrucción, exportación y pruebas.

El mezclador de la entrega implementa esa carga local asíncrona y usa `StereoPannerNode`, ganancias y fuentes de buffer de la [especificación Web Audio](https://www.w3.org/TR/webaudio/).

## Escucha y verificación

`listening-montage.wav` presenta los 18 efectos en el orden de `SOUND_NAMES`, con 300 ms entre ellos, y luego cinco segundos de cada mezcla modal. Los capítulos exactos están en `manifest.json`. Para evaluar las frases completas y las uniones del loop deben escucharse los WAV musicales de 20 segundos.

Las pruebas comprueban señales finitas, niveles y DC acotados, extremos suaves, variación determinista, tamaño y duración, sincronía de pistas, colas en el límite, y formato/hash de los archivos exportados. Las pruebas espectrales verifican las notas características reales y detectan quintas del bajo ajenas a los modos. La suite general y la prueba final de los cambios de modo durante el juego corresponden a la integración de principal.

El nivel de mezcla musical es deliberadamente bajo; los efectos retienen más presencia. La percepción final depende del dispositivo, volumen y mezcla del juego. El banco está verificado por análisis de señal; la audición en parlantes y auriculares sigue siendo una revisión subjetiva útil.
