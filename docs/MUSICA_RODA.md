# Roda de muñecos · WaterDuel 1.7.1

Dirección solicitada: «música de capoeira pero de muñecos».

La composición original sitúa una cuerda pulsada con caja resonante al frente,
como voz que pregunta y responde. La acompañan golpes desplazados de un pequeño
tambor, tacos de madera, semillas, cascabeles de latón y una carraca discreta.
Los ataques cortos y las resonancias pequeñas remiten a los muñecos y al taller.
Los compases alternan respuestas y pequeños remates, manteniendo aire entre golpes.

La referencia cultural para la cuerda que conduce el ritmo es la descripción de
la [roda de capoeira de UNESCO](https://ich.unesco.org/es/RL/el-circulo-de-capoeira-00892).
Es un arreglo instrumental original inspirado en esa dirección, sin transcribir
un toque tradicional ni usar grabaciones o muestras de terceros.

## Integración

- 96 BPM, ocho compases, 20 segundos y tónica Re; capas `wood`, `metal`, `bass`.
- Cuatro colores modales según preparación, duelo, desventaja y presión del jefe.
- Doce WAV estéreo precalculados, con el mismo reloj y transiciones por compás.
- Se conservan límites de fuentes, pausa, silencio, volumen y reducción de música
  durante eventos importantes. El foley mantiene su bus y espacialización 3D.
- Banco nuevo `public/assets/audio/workshop-roda-v4`; los bancos previos permanecen
  disponibles para compatibilidad y sus pruebas históricas.

Para regenerar: `node scripts/export-game-audio.mjs --roda-v4`.
La síntesis nueva está en `public/audio/roda-synthesis.js`.

## Comprobaciones

Las pruebas comparan los samples preparados con la síntesis, verifican hashes,
formato PCM16, capas, suma, determinismo, modos y la continuidad de los bucles.
También comprueban resonancia después del ataque y golpes fuera de pulso en la
forma de onda, además de ausencia de clipping y DC significativo. La procedencia
del runtime conserva los hashes anteriores mediante una nueva capa reversible;
no modifica los archivos históricos.

Estos controles no sustituyen una escucha y mezcla en cada altavoz o teléfono.
La muestra `listening-montage.wav` contiene cinco segundos de cada color modal;
los archivos `music-*-mix.wav` contienen los bucles completos.
