# WaterDuel 1.12.0 · Efectos de audio individuales

El menú móvil incorpora **Sonido → Efectos individuales**, un desplegable con los 27 FX actuales, agrupados en cuerpo y pasos, armas y escudos, látex, agua y avisos. Incluye contador y controles **Activar todos** / **Silenciar todos**. Está disponible en el juego móvil y en los mandos QR de la arena LAN; la PC conserva sólo la escena y sus QR.

Cada cambio se aplica durante la partida, sin reiniciar física, progreso o marcador. Se guarda en la arena y conserva el silencio general y los volúmenes de música y efectos. Las preferencias previas sin selección individual conservan los 27 seleccionados. `wood-contact` continúa eliminado.

La arena aplica los cambios individuales sobre su selección actual para que dos mandos no sobrescriban efectos distintos. El móvil espera respuesta y estado posterior de la arena; los rechazos, desconexiones y esperas vencidas recuperan la última selección confirmada. La entrada acepta sólo IDs conocidos, booleanos y una máscara entera acotada para las acciones conjuntas.

El mezclador filtra los efectos apagados antes de preparar su reproducción y retira sólo sus fuentes activas o programadas. Conserva el banco grabado, sus variantes, la música y el presupuesto compartido de 24 voces. La reverberación ya emitida termina naturalmente, sin interrumpir los demás FX.

La verificación focal cubre los 27 efectos, persistencia y migración, volumen cero y silencio general, reproducción grabada y alternativa, fuentes programadas, presupuesto de voces y el flujo de confirmación del menú tanto por LAN real como por transporte móvil local. [Inventario de FX](FX_AUDIO.md).
