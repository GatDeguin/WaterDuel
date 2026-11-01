# Apertura del duelo y orientación del hacha · 1.10

Al comenzar cada ronda de duelo, los apoyos parten con una separación de 3,8 unidades de juego; contra el Maestro Hidráulico, 4,0. Antes eran 3,06 y 3,50 respectivamente: el aumento es del 24,2 % y del 14,3 %. Los dos casos conservan el límite de base de la arena en ±2,2. La cuenta regresiva se inicia después de colocar e inicializar los cuerpos en esas posiciones.

La apertura se aplica desde `#startRound` mediante `resetRound({opening:this.scenario==='duel'})`: cubre Versus, Duelo IA y campaña, en primera ronda, ronda siguiente, revancha y siguiente encuentro. Los ejercicios de práctica, entrenamiento y precisión conservan su colocación didáctica. `resetRound()` y la vista de espera/inspección conservan su postura de referencia, por lo que los oráculos de rig, materiales y agua no cambian por una translación ajena a sus pruebas.

Las distancias se eligieron comprobando la apertura con las cuatro armas y que la IA histórica conserva su acercamiento, preparación y contacto físico con espada y lanza en ambos jugadores. Se investigaron separaciones de 4,2/4,4, pero exigían cambios adicionales de política de IA que se descartaron. `updateAI` y `#setAIState` permanecen idénticos a la referencia histórica; también se conserva el piloto histórico del contraataque. No cambian perfiles, temporizadores, controles, volúmenes de contacto ni condiciones de puntuación, y no se añade inmunidad temporal. El jefe sigue ofreciendo una recuperación vulnerable tras una parada real.

El hacha tiene una hoja asimétrica en el eje transversal de su asset. El frame anterior usaba la misma normal del mango para ambos jugadores: al reflejar el brazo del jugador 2, la hoja quedaba del lado exterior. Ahora el hacha del jugador 2 gira 180° sobre su mango. La empuñadura, la punta nominal y la longitud se conservan; giran juntos los dos ejes transversales y se mantiene el determinante positivo, sin invertir triángulos ni normales.

La misma convención `equipmentAcrossSign` se aplica al GLB, al dibujo procedural, a los puntos del filo que perforan, al proxy del cabezal y a las muestras de suelo. Una pieza desprendida conserva su pose fuente corregida y la transforma con su compuesto físico. No se modificaron los archivos GLB, sus UV, materiales o snapshots de entrega.

## Verificación y referencias históricas

Las pruebas nuevas comprueban aperturas con las cuatro armas en ambos modos, jefe sin pinchazo al aparecer, ronda siguiente, revancha y campaña. La orientación se comprueba con el GLB real, la geometría procedural y el proxy físico en ambos lados; los filos reflejados perforan con idéntica velocidad material. También se contrasta la transformación visible y física del hacha desprendida.

Tres referencias congeladas de optimizaciones incluían el cabezal antiguo. Sus archivos permanecen intactos. `tests/fixtures/axe-facing-reference-layer.mjs` verifica el SHA-256 original y aplica sólo dos hunks literales: el import de la convención y los dos usos del centro transversal. El helper exige cardinalidades exactas y revierte el resultado a los bytes originales antes de devolverlo. Las comparaciones completas y bit a bit de los once casos históricos permanecen vigentes; no se relajaron assertions ni tolerancias.

El digest histórico de colisiones de agua también se conserva: su SHA esperado se verifica contra la implementación congelada sin adaptar, y el producto se compara con todos sus datos IEEE contra esa misma referencia con la corrección reversible del hacha. No se sustituyó el hash original por uno calculado del producto nuevo.

Las pruebas de regresión mantienen sus assertions, plazos y contacto físico: sword/spear en J1 y J2 desde el inicio, apertura legible del jefe en dos estilos, patrones y recuperación vulnerable, parada seguida de perforación durante la recuperación, y victoria del jefe frente a un rival que sólo retrocede. La suite amplia se integra en el corte general de la versión.

Verificación final del corte: 78/78 pruebas de geometría, referencias, equipo y sesión, más 9/9 de contacto/apertura/recuperación de IA. Los SHA de las tres referencias congeladas se conservan y todas las guardas comparan sin tolerancias relajadas.
