# Contactos y agua · 1.13.2

El usuario identifica el problema en PC con mandos QR y aporta un caso concreto: espada que aparece dentro del hacha. Además pide optimizar el agua y eliminar la cámara lenta al romper el globo.

1. Reproducir el solapamiento con colliders reales, distinguir la pose inicial de un contacto durante el combate y corregir su recuperación sin invalidar el forcejeo, el daño o las ventanas de ataque. Medir por separado el coste del contacto.
2. Hacer coincidir tiempo físico y tiempo real durante la rotura. Conservar los pasos de 1/120 s, la interpolación, la órbita de cámara, los 3,25 s entre rondas y los resultados. Verificar remanentes, pausa y equivalencia entre cadencias.
3. Perfilar agua retenida, liberada y superficies. Conservar sólo optimizaciones medidas con el mismo trabajo y estado físico, sin reducir partículas, resolución, colisiones o calidad. Separar la ganancia de CPU del aumento de pasos por segundo real que implica quitar la cámara lenta.

La física y el render se ejecutan en Chrome de la PC; el servidor LAN retransmite los mandos y eventos. Las pruebas focales verifican ese recorrido. Las mediciones no certifican 60 FPS en equipos no medidos.

Integración: cambios acotados, revisión independiente, pruebas de regresión, build y publicación desde el clon limpio, con cotejo de los archivos servidos. Los ensayos temporales no forman parte del juego publicado.
