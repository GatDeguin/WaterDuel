# 1.4.3 · Recoger la espada bajo el mazo

El gesto hacia atrás del joystick derecho activaba la misma extensión sostenida que el gesto hacia delante: calculaba su intensidad sólo con la distancia al centro. La mano retrocedía poco, pero la estocada seguía extendida y la punta podía avanzar respecto del neutro.

La extensión sostenida ahora descuenta el componente hacia atrás. Recoger horizontalmente retira la extensión; las diagonales la reducen de forma gradual y permiten orientar la hoja con la muñeca. Los movimientos hacia delante y verticales, los pulsos del teclado, el retorno al neutro y el protocolo del mando se conservan.

El mando indica **RECOGIENDO** y explica la maniobra: izquierda recoge, vertical orienta, derecha vuelve a extender. Para liberar una hoja bajo el mazo, retirar y bajar antes de extender. La maniobra depende de la posición real y del contacto; no hay una liberación automática ni una exención de colisiones.

No se cambian el solver de contacto, masas, fuerza de los motores, límites de articulaciones, geometría de las armas o profundidad del brazo. La inclinación del móvil sigue controlando la cabeza.

Las nuevas regresiones cubren ambos jugadores: retirada física de mano y punta, diagonales, retorno al neutro, ataques existentes y un contacto real entre espada y cabeza de mazo con la secuencia recoger/bajar/extender. Se comprueba la separación por SAT al final de cada paso, los apoyos, coordenadas finitas y ausencia de resultados fabricados. Las pruebas previas de contacto continuo siguen cubriendo el barrido entre pasos.

La verificación completa pasó **876/876 pruebas**, en 110 archivos, sin omisiones ni cambios de fuentes durante la ejecución. Sus hashes se registran en `audit/corte-1.4.3-movilidad-02/receipt.json`. El primer recibo se conserva: detectó dos pruebas que exigían extensión total con el mando hacia atrás. Esas pruebas mantienen sus umbrales de extensión para el gesto hacia delante y añaden la retirada sostenida con contracción real, incluida la ruta HTTP/WebSocket. Este cambio de controles no acredita 60 FPS ni sustituye una prueba de comodidad con teléfonos físicos.
