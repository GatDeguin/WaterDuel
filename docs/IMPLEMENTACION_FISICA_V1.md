# WATER DUEL · Especificación técnica del motor visual y físico v1.0

**Documento histórico, sustituido en parámetros por la versión 1.1.** Sus cifras de llenado, gaussianas, grilla y conteo de pruebas describen V1, no la entrega actual. Consultar `QA_EVIDENCIA.md`, `LIMITACIONES.md`, `MATRIZ_REFERENCIAS.md` y los informes de ronda 4.

## A. Topología de simulación

1. PC/Android Termux aloja `server.mjs` (HTTP + WebSocket, sin dependencia externa).
2. Navegador de la PC o tablet renderiza una única simulación autoritativa (WebGL2).
3. Cada teléfono conecta con su QR y transmite exclusivamente controles normalizados.
4. `engine.js` integra a pasos fijos `dt=1/120` si el navegador puede mantener el ritmo.
5. El renderer reconstruye mallas de membrana y malla líquida de manera independiente del paso físico.

## B. Modelo de masa de agua

Antes del estallido: cabeza elipsoidal con volumen geométrico aproximado

\[V=\frac{4\pi}{3}abc,\quad a=0.392,\ b=0.456,\ c=0.365.\]

Cada partícula en `FluidVolume` representa `V/N` unidades cúbicas y, si se escala un jefe de tamaño `s`, se asigna `s³V/N`. La masa por partícula se estima con densidad 997 kg/m³ suponiendo que las unidades de longitud son metros (las dimensiones son parámetros artísticos, no medidos del globo fotografiado).

Después de perforar: los mismos `N` elementos se liberan y se les asignan velocidades iniciales a partir de velocidad de la cabeza, posición del impacto, normal de membrana y velocidad de ataque. El solver actual utiliza integrador semi-implícito de gravedad, hash espacial para pares cercanos, corrección simétrica de separación, viscosidad entre vecinos, pequeña cohesión y contactos suelo/pared.

**Garantía implementada:** no se añaden ni eliminan partículas de fluido durante una ronda; por tanto, su volumen contable total permanece constante (véase test). Las partículas secundarias visuales y salpicaduras pequeñas constituyen un efecto independiente y **no están contabilizadas** en ese volumen principal. Esta distinción es importante.

**Límite:** el solver de vecindad utilizado es un modelo simplificado, no satisface formalmente ecuaciones completas de Navier–Stokes ni incomprensibilidad exacta en cada instante.

## C. Malla líquida tridimensional

`surfaces.js/buildFluidSurface` genera una función de densidad en una grilla tridimensional adaptada al conjunto de partículas. Cada partícula aporta un núcleo gaussiano local. La superficie umbral se polygoniza mediante seis tetraedros por celda cúbica. Se generan normales geométricas y triángulos streaming WebGL2.

Perfiles nominales: ECO `voxel~0.20`; ALTA `~0.151`; CINEMÁTICA `~0.112`. La grilla tiene límites finitos por eje y el número máximo de triángulos está acotado. La frecuencia de actualización es menor que la del render.

El volumen visual de la malla no implica una medición exacta de volumen físico en cada frame; el volumen se contabiliza por partículas, no por integración de la isosuperficie extraída.

## D. Látex, perforación y pérdida de masa

Antes de perforar, la membrana se representa mediante una malla cerrada de latitud/longitud, con variaciones radiales asociadas a oscilación y tensión. La punción identifica la cabeza y el punto de impacto. El estado cambia a `ruptureAge=0`, registra orientación del desgarro y elimina instantáneamente la masa de la cabeza del rig; el torso entra en una respuesta de pérdida de contrapeso.

Después, una segunda malla independiente de diez sectores de látex se abre en paneles con contornos irregulares, retroceso elástico, giro, presión decreciente, curvatura y caída gravitatoria. Los elementos de membrana secundarios se dispersan como fragmentos balísticos.

Esto es un **modelo de ruptura procedural de malla**, no el cálculo de propagación de fractura de una membrana constitutiva con tensiones calculadas por elementos finitos. El juego permite observar rotura espacial, bordes móviles, fragmentos y vaciado desde un modelo controlable de pocos parámetros.

## E. Marionetas y articulaciones

Rig 2.5D por personaje con pelvis, torso, hombros izquierdo y derecho, codo izquierdo y derecho, mano ofensiva, mano defensiva, cuello, rodillas, apoyos y arma. Las posiciones de manos las establece el usuario mediante pads; los codos resuelven IK de dos segmentos (restricción trigonométrica de longitud). La inclinación y torsión tienen muelles amortiguados, impulsos de retroceso y dependencia inercial de masa de la cabeza.

Los herrajes de latón se renderizan en distintos anillos de pivote; las piezas de madera son volúmenes biselados. Hay tendones visuales y refuerzos, no actuadores rígidos físicamente simulados uno a uno. Los brazos chocan con armas y escudo; la punción tiene barrido continuo de punta sobre elipse de la cabeza. El evento de daño sigue siendo autoritativo en el engine para ambos jugadores.

## F. Materiales y estética

Shader GLSL ES 3.00 con normal transform inversa transpuesta, combinación diffuse/specular microfacet GGX, Fresnel y roughness/metallic, dos luces puntuales cálida/fría, luz direccional ambiente, grano procedural de madera y poros, metal cepillado, cuero por ruido procedural, látex semitransparente, agua refractante aproximada (Fresnel/sheen, **no refracción ray-traced**), mapeo tonal y niebla suave. Materiales sin imágenes externas ni dependencias de red.

Las referencias visuales son de calidad cinematográfica; la v1 busca acercar geometría, color, textura y materiales mediante WebGL2. No supone equivalencia fotográfica pixel-perfect ni un motor de producción AAA.

## G. Equilibrio calidad/CPU/GPU

Durante cada ronda solo se libera la cabeza derrotada, así que existe un único conjunto de fluido a la vez. La extracción de isosuperficie es la etapa CPU más exigente; se actualiza con baja frecuencia según perfil. El fallback ECO reduce resolución, polígonos y DPR. Se debe medir rendimiento en tablet real antes de aumentar partículas. Cuando cae el FPS, la prioridad es preservar control y colisión y simplificar la superficie.

## H. Validación reproducible

`npm test`: 16 pruebas que cubren físicas de juego, volumen, mallas sin NaN, geometría de látex, jefe, JS WebGL emulado, HTTP/WS/QR. El shader vertex y fragment se compilaron y enlazaron correctamente contra OpenGL ES 3 mediante EGL/Mesa en el entorno de desarrollo. La navegación automatizada al host local se encuentra bloqueada administrativamente; no se dispone de una prueba de GPU en tu hardware, FPS medido ni capturas verificadas de la versión v1 en un navegador real.
