# Personajes v4: selección de 25 mejoras

Estado: aprobado por el usuario el 2026-11-02 mediante «Aprobar diseño y coordinar». Implementación autorizada de las 25 mejoras y coordinación con Items y Principal.

Selección humana exacta: **2, 3, 4, 5, 6, 7, 8, 9, 11, 14, 15, 16, 17, 18, 19, 31, 32, 34, 36, 37, 40, 42, 43, 46, 49** de la propuesta de Personajes. La numeración no corresponde a la lista independiente de Items.

## Objetivo y límites

Mejorar la construcción artesanal, el apoyo y el lenguaje corporal de normal/menta, ámbar y jefe según w1–w4. La forma de maniquí y las cabezas dinámicas de globo con agua conservan su identidad. Las propuestas no seleccionadas no se incorporan como funciones nuevas.

La entrega incluye fuentes Blender editables, tres GLB v4, mapas originales, integración del runtime, pruebas y evidencia visual. Se preservan v1/v2/v3 como entregas anteriores. No se modifican armas ni defensas de Items, controles humanos, reglas de pinchazo, puntajes, daño o ventanas vulnerables del jefe para conseguir un resultado visual. La publicación, versiones y `.runtime/github-publish` permanecen bajo Principal.

## Estado observado

- El workspace es `D:/2026/WaterDuel`, sin repositorio Git. El package actual declara 1.12.0. Principal comunicó su corte publicado `ef9ebf4`; no se identifica ese commit con una revisión Git local inexistente.
- `render3d.js` ya carga los personajes v3. La nota antigua de selección pendiente en su manifiesto describe la entrega histórica, no el estado actual.
- V3 cambia materiales sobre geometría v2: normal/ámbar 57.014 triángulos completos, jefe 78.482; tras excluir cabeza/agua/estoque de presentación quedan 28.736/50.204 visibles. Se preparan 61 partes y 16 huesos útiles a partir de 18 joints de autoría.
- Hay cinco sockets, pesos rígidos de 1,0 y clasificación del faldón por nombres, conectividad y propietario. Nuevas piezas deben conservar esa propiedad, especialmente al desprenderse una extremidad.
- La inspección de las fuentes encontró 20 tapas de madera con área UV nula por variante. Los pies son elipsoides sin plano de apoyo. Los doce ejes ya inspeccionados son paralelos al Y de autoría: su orientación no se declara un fallo.
- El solver tiene 14 coordenadas y no tiene tobillos independientes. El renderer coloca los pies horizontales. El contacto actual también impone igualdades XY sobre la trayectoria del pie aéreo; esto debe separarse del apoyo real para transferir peso sin una sujeción invisible.
- El faldón tiene bisagra, humedad y suelo; durante combate activo reinicia su ángulo y velocidad. Esa bisagra por sí sola no satisface torsión y pliegues locales.
- Existen agarres por equipo, holgura y desprendimientos, marcas de contacto ancladas a triángulos, lubricación y caída pasiva. Se refinan esos sistemas; no se presentan como capacidades ausentes.

## Enfoque propuesto

Recomiendo una **v4 integrada por cortes**, con geometría/UV nuevos y una revisión física explícita para tobillos y apoyos. Se conserva el contrato de autoría de 18 huesos y cinco sockets; los grados de libertad del solver son un contrato distinto y pasan de 14 a 16 al añadir los dos tobillos. El modelo visible, los contactos y la pose proceden de una misma transformación física.

Se descartaron dos alternativas: limitar todo a cambios visuales no resolvería el apoyo del pie ni los pliegues físicos; reemplazar el solver por un sistema 3D completo ampliaría considerablemente el alcance seleccionado. No se propone una nueva clavícula: torso y hombros pueden coordinarse con las articulaciones existentes.

Los valores de forma, densidad de atlas y amortiguación indicados abajo son propuestas de implementación, no preferencias atribuidas al usuario. Se ajustarán con mediciones conservando los criterios funcionales.

## Construcción y materiales: 15 mejoras

| Nº | Cambio previsto | Criterio de entrega |
|---|---|---|
| 2 | Afinar cintura, pelvis y transiciones de las extremidades; conservar puertos, longitudes entre pivotes y la masa visual propia del jefe. | Comparación frontal/lateral con v3; cambios perceptibles sin desalinear hombros, rodillas, manos o pies. Cualquier envolvente modificada se vuelve a medir. |
| 3 | Separar visualmente horquilla, casquillo y pasador; asignar cada componente al padre o hijo correcto. | Pesos rígidos por triángulo y piezas que permanecen o caen con su propietario físico correcto. |
| 4 | Introducir chaflanes y transiciones geométricas, aproximadamente 1,5–3 mm según pieza. | Cantos legibles en primer plano, normales válidas y ninguna superposición coplanar. |
| 5 | Dar islas radiales a testas y orientación longitudinal a laterales. | Ninguna cara visible con UV degenerado en el canal que usa el material; las tapas muestran fibra transversal. |
| 6 | Mejorar soportes y coaxialidad de las bisagras existentes, respetando sus ejes reales. | Centros de herrajes a ≤0,5 mm del eje previsto y desviación angular ≤0,5° en el marco local. No se afirma física 3D completa. |
| 7 | Rehacer tornillos protagonistas con cabeza, asiento y ranura rebajada; familias consistentes. | Detalle geométrico visible sin cuerpos físicos por tornillo ni patrones negros que aparenten cavidades inexistentes. |
| 8 | Definir zonas de inserción intencional y holgura libre inicial de 2–3 mm donde corresponda. | Barrido de guardia, extensión, defensa, esquiva, caída y desprendimientos en ambos sentidos; tolerancias y excepciones de ensamblaje documentadas. |
| 9 | Construir talón, puntera y suela plana dentro del volumen funcional acordado. | Plano de suela a ≤0,1 mm en reposo; socket y envolvente de contacto medidos del GLB real. El movimiento final se verifica con 31. |
| 11 | Atlas con regiones únicas por pieza visible, evitando marcas espejadas o repetidas entre miembros. | Informe de islas, padding y densidad; costuras sin alterar pesos ni forma; comparación de ambos brazos y piernas. |
| 14 | Distribuir desgaste según función: roce, apoyos, alojamientos y recesos. | Máscaras por pieza que complementan los contactos dinámicos existentes; sin sombras ni reflejos pintados. |
| 15 | Orientar microfisuras con la fibra y concentradores junto a alojamientos. | Variación propia por pieza; fisuras superficiales no se confunden con daño estructural ni activan roturas. |
| 16 | Pulir latón en bordes y superficies de contacto frecuentes. | Contraste de rugosidad localizado, conservando lectura metálica y pátina protegida. |
| 17 | Diferenciar mecanizado circunferencial y radial mediante normales orientadas. | Patrones coherentes con la forma y sin atribuir al shader un BRDF anisotrópico que no admite. |
| 18 | Refinar pátina, grasa y residuos en juntas; composición con lubricación dinámica. | Recesos diferenciados, sin ennegrecer todo ni duplicar marcas de contacto ya existentes. |
| 19 | Mejorar costuras, solapes, cantos y compresión del cinturón de cuero visible. | Cambio presente en geometría que consume el juego; no limitarlo al estoque de presentación excluido ni editar los equipos de Items. |

### Contrato de assets y atlas

- Directorios nuevos `docs/assets/characters/v4/` y `public/assets/characters/water-mannequin/v4/`; scripts y recibos v4 independientes. Se parte de fuentes v3 editables.
- Se mantienen nombres de huesos, sockets y materiales relevantes (`Satin_Brass`, `Mint_Woven_Sash`, `Boss_Burgundy_Woven_Cloth`) y los prefijos de exclusión. Se conservan marcos de bind y pivotes; si una operación los altera, se corrige la operación o se documenta y valida una migración, nunca se copian IBMs incompatibles.
- La geometría, índices y UV sí cambian. La equivalencia binaria material-only v3 conserva su función histórica y no se modifica para hacer pasar v4.
- Propuesta inicial: tres atlas de cuerpo 1024², basecolor sRGB, normal OpenGL +Y lineal y ORM lineal R=AO/G=roughness/B=metallic. UV1 aloja las regiones nuevas; UV0 se conserva y se corrigen sus tapas degeneradas. Tela con región neutra y tinte por variante. Sin extensiones nuevas.
- Los atlas comparten bytes e interpretación entre las tres variantes, reservando regiones para armadura del jefe. Presupuesto inicial RGBA8+mips: 16 MiB. Si un primer plano muestra insuficiencia medible del hardware, se admite un triplete adicional 512²: 20 MiB; techo propuesto 24 MiB documentado, sin contar dos veces recursos realmente compartidos.
- Presupuesto provisional: ≤65.000 triángulos completos normal/ámbar y ≤90.000 jefe; ≤18 mallas antes de preparación. Si una mejora no cabe, se presenta su coste antes de ampliar estos límites. El recibo separa triángulos completos y efectivamente renderizados.
- La cabeza/látex/agua/cresta de presentación se protegen; la cabeza dinámica del juego sigue perteneciendo a su solver actual. No hay cambios de óptica, ruptura o balance de agua en esta selección.

## Movimiento y respuesta: 10 mejoras

| Nº | Cambio previsto | Criterio de entrega |
|---|---|---|
| 31 | Añadir tobillo delantero y trasero al final de las coordenadas existentes, con ángulo, velocidad, topes, masa/inercia y marco de pie. | Mismo frame para GLB, talón/punta/suela, suelo, sombras y colisiones; ningún pie rotado solo en render. |
| 32 | Transferir intención de pelvis/centro de masa al apoyo antes del despegue; separar suelo unilateral del seguimiento motor del pie aéreo. | Pie en vuelo con reacción de suelo cero; reacción en apoyo y estabilidad verificadas con agua, jefe y pérdida de pierna. |
| 34 | Coordinar anticipación y recuperación entre torso y hombros mediante motores existentes. | Continuidad sin clavícula nueva, sin aumentar alcance ni sustituir dirección de ataque o agarres humanos. |
| 36 | Coordinar pelvis, torso y cuello durante la esquiva existente. | Cabeza, agua/látex y CCD siguen la pose conseguida; conserva límites, neutral para rearme y ausencia de inmunidad. |
| 37 | Dar contrapeso a la mano secundaria únicamente cuando esté libre y no haya entrada manual. | Prioridad: dos manos, defensa/agarre de Items, control humano y por último gesto automático. Cancelación inmediata por input o cambio de equipo. |
| 40 | Reemplazar la rigidez activa por oscilación, torsión y pliegues locales mediante un accesorio reducido de paño. | Se deben demostrar las tres respuestas, no acreditar pliegues con una sola bisagra. Humedad, suelo, piernas, adorno y caída usan la misma geometría deformada. |
| 42 | Diferenciar desgaste, fisura y unión próxima a separarse con el estado de daño existente. | Marcas ancladas al mesh real, sin posiciones Z fijas ni marcas flotantes; ownership correcto al desprenderse. Sin cambiar umbrales ni cálculo de daño. |
| 43 | Afinar la respuesta vibratoria de coordenadas existentes tras impulsos reales. | Sin impulso no nace vibración; respuesta amortiguada y acotada, reproducible, sin offsets de render ni ruido que añada energía. No es háptica móvil. |
| 46 | Celebración corporal del ganador una vez resuelto el resultado: brazo libre o reverencia según equipo. | Usa tiempo de simulación; no crea ataques, impactos ni puntos; respeta empate, derrotado, remontaje de ronda y modos de movimiento reducido. |
| 49 | Perfil de apoyos, transferencia y recuperación corporal más deliberado para el jefe. | Respeta percepción, aperturas y ventanas existentes; peso legible sin trayectorias que atraviesen al rival ni bonificaciones ocultas. |

### Revisión física de pies

Conservar los índices 0–13 y añadir tobillos en 14–15 no basta por sí solo: se amplían matriz de masas, Jacobianas, barridos y cachés. Se separa `ankleF/B` de los puntos históricos `footF/B`: rodilla–tobillo conserva longitud y el centro/suela se deriva del frame del pie. Se mide nuevamente `SHIN_FLOOR` y toda envolvente modificada. Los pies adquieren cuerpos físicos articulados; su propiedad de daño/desprendimiento hereda la rama de la espinilla. No se añade un umbral de rotura de tobillo ni una nueva clase de daño en esta selección.

Los campos de pose nuevos se copian por valor y se conservan en replay. `public/replay.js` captura poses visuales y no vuelve a ejecutar el solver: no se necesita un segundo solver legado para ese consumidor. Las poses antiguas sin frame de pie usan una suela horizontal explícita; sin paño deformado usan la bisagra histórica. Se prueba la reproducción y la propiedad por valor de ambos formatos, sin tratar la ausencia de campos antiguos como un modo físico nuevo.

### Revisión física del faldón

Propuesta: malla reducida de 2 columnas por 3 filas de paneles, con 12 nodos, borde superior anclado al cinturón y restricciones de longitud/flexión que permitan torsión. La densidad se ajusta solo si el jefe necesita conservar sus adornos, con presupuesto y evidencia propios. Esto es un paño reducido, no una simulación textil microscópica.

La geometría base mantiene ownership pelvis; la deformación del accesorio se trata expresamente en preparación/render. Los pliegues no se obtienen mediante una rotación global de todo el faldón. Contacto con piernas/suelo y mojado se evalúan sobre el mismo paño deformado; los herrajes del cinturón permanecen rígidos y el adorno de borde sigue su panel. Como el accesorio actual, no puede sostener ni desplazar al personaje. Este cambio requiere contrato de accesorio v4 y pruebas nuevas, además de preservar los consumidores del accesorio antiguo.

## Coordinación de bloques

La instrucción recibida de Principal reserva para Items bloques de agarre, desvío y contactos en `equipment.js`, `engine.js`, rig/render y DTO/replay/controller. No reserva archivos completos.

Antes de modificar puntos compartidos se acordarán con Items y Principal los límites de funciones y campos. Personajes propone hacerse cargo de geometría/UV de personajes, pies/apoyos, intenciones corporales, faldón y presentación del daño/resultado. Items mantiene equipo, técnica del cuchillo, agarres de arma/defensa, desvío y háptica.

Puntos a coordinar: extensión de cinemática y snapshots de `ArticulatedRig`; intenciones previas a `buildPose`; ramas de pies/faldón en `characterTransforms`; resultados posteriores a resolución en `engine.js`; y campos de pose/replay. La mano libre utiliza la prioridad del equipo existente y no reimplementa su técnica. Cualquier cambio de DTO comparte contrato de campos, sin editar todo el controlador.

Los módulos y tests nuevos usarán nombres de Personajes. Cambios del renderer se limitan a consumo del personaje v4, pies, paño y marcas; las rutas y transformaciones del equipamiento de Items se conservan. No se hacen suites globales ni QA GPU concurrentes con un corte compartido en movimiento.

## Orden y evidencia de entrega

1. **Construcción y atlas:** completar los quince cambios artísticos en fuentes/GLB v4 aislados. Inspección de invariantes, UV, materiales, presupuesto y reimportación. Aún sin activar rutas nuevas.
2. **Pies y transferencia:** implementar 31–32 junto con su contrato de suelo/render. Migrar deliberadamente las pruebas que fijaban 14 coordenadas y pies horizontales; mantener las regresiones de física, contacto y fragmentos.
3. **Lenguaje corporal y paño:** integrar 34/36/37/40/42/43/46/49 mediante los bloques coordinados, con pruebas focales antes de cada integración.
4. **Integración y revisión:** activar v4 solo tras validar contratos; probar ambos lados, normal/jefe, los siete equipos, defensa vacía/escudo/daga, dos manos, daño y desprendimientos, distintas cadencias y movimiento reducido. Ejecutar la suite global una vez congelado el corte.
5. **Evidencia real:** renders de los GLB reimportados, capturas/vídeos de guardia, avance, retroceso, esquiva, paradas, humedad/pliegues, celebración y jefe. Una lámina de Blender no certifica el comportamiento del juego.

Se reutilizan y amplían las suites `asset-rig`, `glb`, `asset-gpu`, `rigid-batches`, `articulated-rig`, `rig-selfcontact`, `inter-rig-contact`, `body-evasion`, `head-dodge`, `head-contact-pose-exact`, `joint-*`, `apron-*`, `equipment-render`, `equipment-contact-integration`, `replay` y `boss-opening`, con casos específicos de tobillos, apoyo aéreo, paño deformable y celebración.

Aceptación de assets: roundtrip ≤0,0002 m, matrices finitas, pesos rígidos, sockets verificados, normales/tangentes correctas, sin rutas externas ni extensiones no soportadas. Los materiales protegidos se comprueban por contrato y hashes independientes.

La entrega final traza los 25 números a sus archivos, pruebas, capturas y limitaciones. No se declaran funciones completadas por existir un helper desconectado o un asset que el runtime excluye. Principal recibe fuentes, hashes, contrato y evidencia, y conserva el proceso de publicación. No se atribuyen FPS, fluidez en móvil o sensación háptica sin medición del dispositivo correspondiente.

## Decisión registrada

El usuario aprobó este enfoque completo y la coordinación con **Items** y **Principal** el 2026-11-02 mediante «Aprobar diseño y coordinar». El plan y los cortes de implementación se ejecutan bajo esa autorización.
