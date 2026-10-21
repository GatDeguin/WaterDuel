# Desarrollo R8 — actividades, reproducción y lectura material

Este registro describe el trabajo actual, no una entrega ZIP certificada. Corte conjunto pendiente de integración de Items y validación nueva.

- Actividades individuales: siete objetivos de entrenamiento desde movimiento/guardia/contactos, práctica continua con rival neutral, tres blancos de precisión móviles y siete encuentros de campaña con progreso local validado.
- Formato3/5: la misma condición autoritativa gobierna HUD y fin de partida. Se rechazan cambios durante la ronda. Demo explícita no acredita progreso ni replay.
- Siete estilos de IA: decisiones distintas usando los mismos motores, reacción observada, preparación y recuperación. El alcance proyectado desde mano/hoja evita gastar el pulso antes de una trayectoria viable. No modifica colisión/masa para obtener victorias.
- Replay: copias visuales propias de pose, parcelas, membrana/espesor y efectos,20Hz,2s previos/1.2s posteriores y biblioteca hasta3clips/64MiB de datos. Scrub/velocidad con motor pausado; no asigna ni recalcula puntos. No es vídeo ni replay de partida completa.
- Sombra real: geometría opaca desde lámpara principal, DEPTH24, PCF3×3,512/1024/1536; estado/restauración/fallback/disposición probados. GPUreproducible en `/qa/shadow-checks.html`, PASS con oclusor móvil yGL0.
- Látex: pigmento dispersa luz incidente según espesor, con el mismo material antes/después del corte. Espesor nodal continuo conserva integral de volumen material en triángulos físicos. Modelos reducidos de transporte, con constantes artísticas, inspirados en [transmitancia homogénea](https://www.pbr-book.org/4ed/Volume_Scattering/Transmittance) y [materiales translúcidos](https://google.github.io/filament/Materials.md.html), sin afirmar calibración física de látex comercial.

Se corrigieron el objetivo de estocada perdido cuando el primer tick ya perforaba, el texto fijo de dos victorias al elegir cinco, la atribución de métricas de replay a combate y el marcador de precisión actualizado a10Hz. Ahora el marcador sigue la pose de ese render y las métricas separan replay.

La revisión independiente comparó cuatro referencias y16PNG reales; el color mejoró pero el agua sigue opalescente, las proporciones/pose son compactas, faltan bordes curvos de látex y profundidad del taller. Véase `audit/BRECHA_FOTOREALISMO_REFERENCIAS.md`. Hay nuevos trabajos Blender/GLB separados: sus renders todavía no acreditan consumo por el juego.

Pruebas: globalintermedia300/300 en184.497s, anterior a cambios concurrentes de Items; por eso no certifica el corte actual. Los focos de Crítico100 y Árbitro45 se solapan y no se suman. El presupuesto de memoria de replay no incluye heap/VRAM totales. Falta rendimiento sostenido del corte conjunto, cliente visual de tablet, capas de audio y dispositivos/red físicos.
