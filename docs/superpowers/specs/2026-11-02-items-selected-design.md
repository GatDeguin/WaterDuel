# Ítems: agarres, parada, artesanía y tacto

Selección humana: propuestas **26, 27, 34, 36, 37 y 44** de la lista de cincuenta mejoras. Se implementan dos agarres del cuchillo secundario, parada direccional por contacto real, refinamiento de construcción y marcas originales en siete ítems, y respuesta háptica por impacto.

## Comportamiento

- El cuchillo sigue siendo exclusivamente secundario. El mazo conserva las dos manos y fuerza defensa `none`.
- El agarre normal o invertido se elige durante preparación y se conserva en reinicios y repeticiones. El normal mantiene la forma histórica `{weapon,defense}` del equipo; el invertido añade `knifeGrip:'reverse'` únicamente con defensa `knife`. Otros equipos descartan esa propiedad. El protocolo rechaza valores de agarre desconocidos.
- Render, agarre de mano, punta física y perfil de parada deben coincidir en ambos jugadores. La elección invertida coloca la hoja debajo de la mano y requiere una colocación defensiva cercana al cuerpo. No aumenta el radio de parada.
- La parada modifica el movimiento de la hoja rival mediante el contacto y una reacción mecánica limitada. No concede un ataque independiente al cuchillo ni asigna impactos, perforaciones o puntajes.
- El móvil puede recibir un pulso breve y acotado por impacto físico significativo que involucre a su jugador. Material e intensidad modifican el patrón. Se conservan las prioridades de daño y la neutralización por pérdida de foco. La falta de soporte de vibración no impide jugar.

## Arte

Nueva entrega en `public/assets/equipment/workshop/v3/` y fuentes en `docs/assets/equipment/v3/`. Se mantienen intactas v1 y v2. Los siete modelos reciben detalles de construcción visibles en primeros planos: madera, uniones, costuras y herrajes.

Marca original discreta propuesta: **Taller del Cauce**, con símbolo hidráulico artesanal. Cada pieza incorpora grabados de función: canales del estoque, marcas de presión de lanza, uniones del hacha, bancada del mazo, anillos del broquel, duelas del escudo y arcos de parada de la daga. Estos motivos pertenecen al taller; no establecen una facción nueva.

Se conservan escala, ejes, origen, sockets y geometría funcional. Objetivos incrementales por modelo: triángulos hasta 15 % y bytes hasta 25 % sobre v2; texturas core PNG hasta 512 px y materiales compartidos. Las decoraciones no amplían colliders. Se entrega Blender editable y renders desde los GLB reales.

## Enfoque elegido

Se extiende el catálogo y la simulación existentes con módulos pequeños de técnica de cuchillo y háptica. El arte se exporta en un namespace versionado. Esto permite validar cada bloque y preserva las entregas anteriores. Se descartó crear un segundo catálogo de armas para representar los agarres, porque la daga conserva su identidad secundaria; también se descartó resolver la parada mediante un resultado guionado, incompatible con la física actual.

Los detalles de forma, parámetros de desvío y límites hápticos son decisiones de implementación verificables. El alcance humano aprobado son las seis propuestas; Principal conserva la coordinación del runtime compartido y de la ventana de QA visual.

## Aceptación

Pruebas focales de normalización/protocolo, ambos agarres en ambos jugadores, alineación GLB/rig, reacción de parada y ausencia de ataque secundario, persistencia en replay, háptica inválida/cero/acotada y flujo LAN/local. Comparación de modelos y revisión visual de detalles/marcas. La página pública de QA debe ejercitar selección de agarre y los modelos v3 sin autenticación ni autoridad LAN. No se acreditan sensaciones de vibración en hardware físico sin un ensayo real.
