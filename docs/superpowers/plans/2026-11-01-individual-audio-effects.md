# Control individual de FX · 1.12

El menú Sonido de ambos mandos tendrá una sección desplegable para los 27 FX activos. Cada sonido tendrá un interruptor, agrupado por uso, además de activar o silenciar todos. Las preferencias se aplican inmediatamente y se conservan entre sesiones; cambiar un FX no activa el sonido general ni modifica volúmenes o música. `wood-contact` conserva su eliminación anterior.

El catálogo compartido fija IDs y posiciones de bits. La arena conserva una máscara escalar validada; cada comando individual contiene únicamente un ID conocido y un booleano. El host compone cada cambio sobre su estado actual para no perder otras selecciones. El mando distingue la recepción del comando de la confirmación del estado aplicado y restaura la autoridad ante rechazo, fallo o desconexión.

1. Catálogo y filtro de reproducción, incluyendo voces existentes y diferidas.
2. Persistencia compatible con preferencias anteriores, comandos y DTO acotados.
3. Sección móvil accesible, estados pendientes y acciones masivas sin conflictos.
4. Pruebas de audio, protocolo autenticado, persistencia y mando; revisión visual cuando la herramienta lo permita.
5. Publicación del corte y comprobación de archivos servidos. La PC conserva la arena y sus QR.
