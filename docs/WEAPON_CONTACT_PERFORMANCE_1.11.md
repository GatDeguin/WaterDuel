# Contactos de armas: rendimiento de CPU

El perfil de secuencias reales de forcejeo señaló trabajo repetido en la
construcción y proyección de contactos. El solver conserva sus contactos,
iteraciones, fricción, impulsos, límites y reglas de daño. La optimización
elimina arrays temporales de vértices y ejes, acumula mínimos y máximos en el
mismo orden y reutiliza la cara de soporte dentro de un mismo manifold.

Se probaron espada, lanza, hacha y martillo con postura neutral y movimientos
enfrentados de los mandos, a distancia de práctica. El corpus suma 1.013 pasos
de física real. La lanza neutral mantiene contacto de acero en 177 de sus 180
pasos; el martillo neutral, en los 180. Los ataques pueden romper el globo por
contacto legal y terminan al salir del combate.

Cuatro ciclos ABBA del motor completo mejoran un **5,17 % mediano por par**.
Los cambios de cada ciclo son −12,18 %, −4,27 %, −5,80 % y −4,55 %. Los dos
controles A/A varían 1,92 % y 1,90 %. Se conservan todos los bloques; el primer
ciclo es más variable y no se elimina. Las mediciones excluyen render, GPU y
audio de hardware, por lo que no certifican FPS ni una mejora global equivalente.

Los 1.013 pasos conservan exactamente replay, agua, matrices del rig,
coordenadas, velocidades, contactos, marcas y eventos. La guarda pública usa
el oráculo histórico original de CCD sin modificar sus bytes; comprueba
trayectorias del motor, soportes rasantes y aritmética de proyección con
vacíos, NaN, infinitos, extremos y ceros con signo. Las 36 pruebas focales de
armas, fricción, rig, daño y geometría pasan sin omisiones.

Se descartó otro candidato de búsqueda de caché de restricciones: era exacto,
pero su cambio mediano fue +0,50 % y quedó dentro del ruido. Ese cambio no se
incorpora al producto.

Datos resumidos de todos los bloques: [comparación CPU](performance-1.11.0/weapon-contact-paired.json).
Los perfiles y datos por paso permanecen en la investigación local.

El coste de proyectar marcas visuales nuevas sobre las mallas de equipo se
investigó por separado. Ese trabajo sucede en el renderer y no se incluye en
las cifras anteriores.

## Consultas de cabeza dentro de los contactos

El solver consultaba `pose().head` dentro de sus iteraciones, aunque ya tenía
los estados cinemáticos de ambos muñecos. Eso construía además frames de todos
los miembros, snapshots de la falda, daño y marcas visuales para leer sólo tres
coordenadas. Ahora copia exactamente X/Y del estado y calcula Z con la misma
fórmula y el mismo orden que `pose()`. La función pública de pose y sus datos
visuales se conservan; únicamente se evitan esas peticiones desde la física.

Este cambio se midió por separado, sobre el motor que ya incluye el SAT
anterior: cuatro ciclos ABBA dan un **−3,93 % mediano**, con controles A/A de
2,16 % y 3,82 %. Es una mejora moderada, cercana a la variación global. En el
caso objetivo predefinido de contacto sostenido de lanzas, el cambio mediano
es **−6,05 %**, frente a controles de 0,81 % y 2,05 %. No se acredita una mejora
clara de p95 ni se suman estos porcentajes con los del SAT o del renderer.

Los 1.013 pasos completos vuelven a coincidir exactamente. La guarda nueva
comprueba 12 pares con inclinación lateral, escalas normal/jefe, espejos y
miembros dañados o desprendidos contra la referencia histórica original. En
el caso de regresión se eliminan las 33 llamadas a `pose()` por muñeco que
antes se hacían dentro de un solo solve. Las 39 pruebas focales de este corte
pasan sin omisiones.

La propuesta de eliminar derivados de las muestras CCD se descartó: su
beneficio medido quedó dentro del ruido y no forma parte del producto.

Recibo independiente: [cabezas y presentación](performance-1.11.0/head-contact-paired.json).
