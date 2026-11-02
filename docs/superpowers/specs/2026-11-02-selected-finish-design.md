# WaterDuel: selección Principal 10,12,13,14,15,18,21,29,44

La selección humana se refiere a las 50 propuestas de Principal. Se implementa sobre 1.12.0 y se coordina con las selecciones humanas independientes de Items y Personajes, que comparten workspace.

## Resultado esperado

- 10: al ganar la campaña, ceremonia en el mundo, celebración corporal, trofeo y cierre visible en el móvil.
- 12: fintas más legibles desde cambios reales de intención, sin botón adicional ni ataques automáticos.
- 13: apoyo, transferencia de peso y trabajo de pies consistentes entre solver y render.
- 14: manejo y recuperación distinguen las propiedades reales de espada, lanza, hacha y mazo.
- 15: postura, holgura y marcas comunican el daño existente, sin cambiar umbrales o inventar daño.
- 18: segunda fase existente del jefe con preparativos y recuperaciones diferenciados; contacto físico decide los resultados.
- 21: materiales coherentes de madera, metal, cuero y tela según w1–w4, combinando shaders y fuentes nuevas originales de Personajes/Items.
- 29: dirección de cámara que conserva el pinchazo, la caída, la orientación espacial y el regreso al frontal.
- 44: siete encuentros avanzados desbloqueados por la campaña normal y con progreso independiente.

## Decisiones de implementación

Se amplían los sistemas existentes mediante módulos pequeños. La campaña normal conserva su clave y formato; la avanzada usa almacenamiento independiente, selección explícita normal/advanced y validación de desbloqueo en la arena. El móvil espera ACK y estado posterior, como el resto de opciones. Cambiar de campaña se limita a fuera del combate y prepara el encuentro, sin iniciarlo automáticamente.

La ceremonia sólo aparece tras una victoria real final en campaña, no en demos, derrota, empate o replay. El trofeo vive en la escena y el texto/opciones quedan en el móvil. Su presentación no crea contactos, ataques ni puntos; se respeta movimiento reducido.

Los módulos de movimiento modifican objetivos físicos existentes, no offsets exclusivamente visuales. Las geometrías compartidas entre simulación, CCD y render usan la misma pose. Personajes desarrolla apoyos, daño visual y lenguaje corporal; Principal coordina fintas/manejo y reserva la IA del jefe; Items mantiene agarres/desvíos/háptica y cuchillo secundario.

Se descartan reemplazar el motor, introducir un solver de agua nuevo o añadir atributos mágicos de combate. Los cambios se verifican por cortes y se publican juntos únicamente cuando las fuentes estén congeladas.

## Invariantes

PC muestra escena y QR; menús y opciones permanecen en el móvil. No se añade botón de ataque. La punta física debe perforar el globo. Se conservan el cuchillo secundario, el mazo a dos manos, el daño/desprendimiento, los replays y el audio 1.12 con 27 FX y preferencias de silencio/volumen cero. No se rebajan detalle ni funciones para aparentar rendimiento. No se afirma fotorealismo o 60 FPS sin evidencia.

## Criterios de aceptación

Pruebas de progreso antiguo/avanzado, desbloqueo y reset; transporte LAN/local y ACK; ceremonia sólo con victoria real; ambos lados y equipo extremo en movimientos; daño y miembros desprendidos; jefe seguro al inicio y fase2 con preparación/retiro; cámaras continuas con bounds360; revisión visual final en ventana exclusiva y suite completa sobre el corte de publicación.
