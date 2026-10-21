# Foley de contacto y movimiento

Ampliación original del taller mecánico sutil de WaterDuel. Añade diez cues en un banco separado de **679624 bytes**: diez efectos y un montaje mono de 9.24 segundos. Los 35 WAV, el manifiesto y la API de 18 sonidos del banco `workshop` se conservan.

## API e integración

```js
import {FOLEY_NAMES, renderFoley} from './audio/foley-synthesis.js';
const mono = renderFoley('blade-beat', {sampleRate: 22050, seed: 1});
```

`renderFoley` devuelve un `Float32Array` mono. Acepta frecuencias de muestreo enteras entre 8000 y 48000 Hz y semillas numéricas finitas. Rechaza nombres desconocidos y parámetros que permitirían una asignación excesiva. Todos los efectos empiezan y terminan en cero; las variaciones conservan las características del material.

Los WAV están en `public/assets/audio/foley-v2/NOMBRE.wav`; se pueden precargar para evitar trabajo de síntesis durante el duelo. El banco nuevo tiene su propio `manifest.json`. El montaje `foley-montage.wav` reproduce los diez cues en el orden de `FOLEY_NAMES`, separados por 280 ms; sus capítulos están en el manifiesto.

| Cue | Duración | Construcción y lectura acústica |
| --- | ---: | --- |
| `blade-beat` | 0.52 s | Golpe agudo con resonancias inarmónicas de hoja de acero |
| `blade-slide` | 0.74 s | Fricción granulada sostenida y resonancias de acero que cambian de tono |
| `shield-metal` | 0.92 s | Cuerpo grave y cola de metal con color de latón |
| `shield-wood` | 0.42 s | Caja de madera hueca, golpe corto y resonancias amortiguadas |
| `wood-contact` | 0.40 s | Contacto de madera cargada, grave, con flexión discreta |
| `latex-rub` | 0.72 s | Chirrido de contacto por modulación de frecuencia, sin transitorio de rotura |
| `footstep-dry` | 0.34 s | Apoyo grave, segundo contacto de peso y roce de madera seco |
| `footstep-wet` | 0.48 s | El mismo apoyo físico con roce acuoso y pequeñas gotas posteriores |
| `water-burst` | 1.20 s | Liberación de presión seguida por descarga sostenida y gotas; distinta de `splash` |
| `blade-swish` | 0.42 s | Aire coloreado con crecimiento y caída suaves durante el movimiento |

Estos cues son vocabulario acústico; el observador de escena y el mezclador controlan cuándo se disparan, su nivel espacial y la frecuencia de repetición. En particular, `latex-rub` representa roce sin rotura y `water-burst` representa descarga por presión, mientras que la salpicadura de impacto conserva su cue original `splash`.

## Procedencia y reconstrucción

Todo se genera localmente mediante resonadores, ruido filtrado, modulación y envolventes. Algunas capas proceden de los renderizadores originales `wood`, `metal` y `puncture`, sin modificar su código o archivos. No se usaron grabaciones, descargas, servicios externos ni dependencias de audio.

```powershell
node scripts/export-foley-audio.mjs
node --test tests/audio-foley-synthesis.test.mjs
```

El exportador admite `--sample-rate` y `--output`. Valida la frecuencia antes de asignar el banco o crear archivos, limita la salida a 4 MB y escribe únicamente los once WAV declarados y su manifiesto. La entrega por defecto es WAV PCM firmado de 16 bits, mono, a 22050 Hz. El manifiesto contiene duración exacta en muestras, bytes, pico, RMS y SHA-256 de cada archivo; los niveles se miden después de la cuantización PCM.

## Recibo de verificación

- Flujo TDD: seis fallos iniciales por funcionalidad ausente; preservación del banco anterior ya pasaba. Resultado final: **7/7 pruebas enfocadas pasan**.
- Pruebas de materiales: acero más brillante que contacto de madera; escudo metálico con cola mayor que escudo de madera; deslizamiento más sostenido que golpe; pasos húmedos con cola acuosa; látex y aire con entrada progresiva; descarga de presión más sostenida que salpicadura de suelo.
- A 22050 Hz y semilla 1: pico máximo entregado **0.699981689453125**; RMS de los efectos entre **0.04810 y 0.10307**. No hay clipping ni muestras no finitas.
- Revisión independiente: siete pruebas aprobadas y sonda de seis semillas a 8, 22.05 y 48 kHz, con muestras finitas, pico máximo 0.70 y extremos suaves.
- SHA-256 del manifiesto nuevo: `46741febd3dba911fbc638d701700561513fb64ab2a60e0f07bbcf4085ed0e6a`.
- SHA-256 del manifiesto `workshop` conservado: `8bcf6bcaf982619c060a50bf403b4ed7f24508667c09f39c2e15ebcb1424cc16`; sus 35 archivos coinciden con los hashes originales.

La verificación es numérica y acústica. El realismo percibido, los niveles durante contactos simultáneos y la coordinación con animación requieren escucha y prueba en el juego, a cargo de la integración de principal.
