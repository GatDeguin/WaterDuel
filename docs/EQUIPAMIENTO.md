# Armería del taller

La armería debajo de la arena permite elegir un arma principal y una defensa para cada duelista. La selección se ve inmediatamente y se conserva al reiniciar rondas, partidas, dificultad o modalidad. Se puede cambiar antes del inicio y al terminar la partida. Durante la cuenta atrás, combate, estallido y reproducción de un contacto, los controles quedan bloqueados. El botón **J1 ⇄ J2** intercambia los equipos completos.

## Piezas

| Mano principal | Identidad | Comportamiento |
| --- | --- | --- |
| Espada | Estoque del taller | Acero fino, cazoleta de latón y cuero; alcance y recuperación equilibrados. Conserva los parámetros del equipo anterior. |
| Lanza | Aguja de presión | Asta de madera, abrazaderas de latón y punta de acero; más alcance y recuperación más lenta. |
| Hacha | Hacha del carpintero | Mango de madera y filo de acero; más corta y pesada que la espada. |
| Mazo a dos manos | Mazo de bancada | Cabeza de madera, latón y acero; masa mayor y recuperación lenta. La segunda mano queda sujeta físicamente al mango. |

| Mano secundaria | Comportamiento |
| --- | --- |
| Escudo corto | Broquel circular; cobertura compacta y consumo moderado. |
| Escudo largo | Duelas de madera y borde de latón; mayor cobertura vertical con mayor consumo de guardia. |
| Sin escudo | No existe volumen de bloqueo. El botón de guardia no impide atacar. |
| Cuchillo | Daga de parada, exclusivamente secundaria. Solo la zona estrecha de su hoja desvía ataques mientras se sostiene guardia; no realiza un segundo ataque. |

El mazo ocupa ambas manos y fuerza **Sin escudo**. Al volver a un arma de una mano se puede elegir otra defensa. **GUARDIA** y los ejes del brazo secundario usan los mismos controles de teclado y teléfono que antes.

## Referencias y reglas

W1 y W2 aportan las empuñaduras de cuero, cazoletas de latón, acero fino y construcción mecánica artesanal. W3 conserva el globo como condición de victoria. W4 inspira el peso visual del mazo y sus abrazaderas en el Maestro Hidráulico. Las piezas nuevas extienden ese vocabulario; no agregan facciones ni reglas de daño por puntos de vida.

Las diferencias de alcance, masa, recuperación, consumo y cobertura se calculan en la simulación. Hacha y mazo agregan un arco de golpe y barridos de sus superficies de impacto, alineados con la geometría visible. El combate conserva su detección competitiva en 2.5D; no constituye una simulación general de filos, fractura de madera o destrucción de escudos. Las repeticiones guardan una copia del equipo que existía en el contacto, independiente de elecciones posteriores.

El catálogo compartido está en `public/equipment.js`; la selección visual en `public/armory.js` y los modelos en `public/rendering/equipment.js`. No se agregaron recursos de red ni dependencias.
