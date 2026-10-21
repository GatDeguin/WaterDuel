# WaterDuel 1.2 — materiales, articulación, agua y látex

2026-10-17. Esta etapa responde a la prioridad humana de avanzar significativamente en esos cinco ejes. La versión 1.1 queda preservada como antecedente reproducible; la nota histórica 70/100 no cierra el objetivo completo.

## Resultado implementado

- Biblioteca de materiales: roble, barniz, latón, acero pulido/pavonado, bronce patinado, lino, cuero y dieléctricos. Relieve de veta/poro, barniz y acabados diferenciados. Agua/látex tienen metalicidad cero e IOR explícito.
- Refracción de la escena mediante color/profundidad en dos destinos disjuntos y snapshots entre capas. Captura geométrica del taller en seis caras, mipmaps lineales, Fresnel y absorción aproximada. HDR RGBA16F cuando está disponible; codificación de pantalla y FXAA al presentar. No se lee un attachment mientras se dibuja en él.
- Pelvis separada, horquillas, rodamientos, ejes, tornillería, dedos y actuadores telescópicos anclados a la pose. Rig planar de 14 coordenadas con masas/inercias, motores, muñeca, límites, apoyo alternado, carga/COM del agua e impulsos de contacto. Render y collider consumen la misma pose dinámica.
- Membrana XPBD persistente: 162 nodos físicos comunes a perfiles, 1280 triángulos interpolados, restricciones de longitud/área/volumen y contacto leve recuperable. Punción localizada, separación de conectividad y propagación por strain. El material separado sigue en la malla con su masa; se retiraron los 19 fragmentos cosméticos independientes.
- Agua con fases retenida/libre, COM/tensor por volumen y descarga por apertura/presión reducida. La retracción que deja superficie insuficiente libera exceso por pérdida de soporte. No se borra volumen ni se duplica con el cap; el renderer reconstruye sólo partículas libres. Los destellos son diminutos y explícitamente sin volumen.
- IA adaptada a actuadores reales: anticipación completa, alcance mecánico, preparación observable y orientación desde mano/cabeza físicas. Conserva tiempo de reacción, recuperación, guardia, reglas y oportunidades de contrajuego.

## Evidencia y alcance

- Suite global: 212/212, Node v24.20.0, `audit/TESTS_RONDA_6.txt`. Reataque posterior de render: 30/30 en `TESTS_RENDER_FINAL_RONDA_6.txt`; incluye fallo de compilación, liberación de recursos, winding, película húmeda y formato HDR. Son conjuntos solapados.
- GPU real: `/qa/render-checks.html`, pixel RGB200 esperado200, `glError=0`, buffers/cubemap activos en RGBA16F. Evidencia `screenshots/22-ronda6-gpu-lineal.png`. Las pruebas GL simuladas por sí solas no certifican imagen/GPU.
- Agua optimizada: comparación alternada de 75 pares por perfil, misma geometría/normales/estadísticas. ALTA mediana25.30→14.51ms, P9530.78ms. ECO18.22→11.07 y ULTRA44.31→27.00ms. Esto mide reconstrucción CPU, no tiempo total de frame; no garantiza60FPS.
- Material nuevo `.55/1.65`: a0.5s físicos libera aproximadamente71–73% del volumen en los fixtures fresco/estabilizado, por retracción y pérdida de soporte. Error sellado máximo1.713%, masa constante y estado finito. Ver `benchmarks/results/round6-material-calibration.json` y su script `membrane-material.mjs`.
- Integración: mismos nodos, agua, articulaciones y resultado entre ECO/ULTRA; carga retenida no desaparece al puntuar; descarga y soporte siguen el reloj fijo incluso en cámara lenta. Tests `physical-integration`, `membrane`, `fluid-leak`, `articulated-rig`.

Se corrigieron durante integración colapso de tronco por carga, giro instantáneo de muñeca, caída del brazo seco, percepción/alcance de IA, orientación de primitivas, mezcla gamma, doble composición del fondo y fugas de recursos. Los planes/auditorías R5/R6 mantienen trazabilidad, incluidos experimentos descartados y mediciones concurrentes identificadas.

## Límites que siguen abiertos

Modelo reducido planar, contacto competitivo2.5D, presión/viscosidad/material no calibrados, cap CDF cinemático y cota conservadora de contención. Sin autocontacto completo, CFD bidireccional, GI resuelta o equivalencia fotográfica con las referencias. Campaña, entrenamiento avanzado, grabación/reproducción completa y prueba con dos celulares físicos continúan pendientes en el objetivo general. No se declara entrega AAA final.

Fuentes primarias de implementación: [XPBD](https://mmacklin.com/xpbd.pdf), [WebGL2](https://registry.khronos.org/webgl/specs/latest/2.0/), [EXT_color_buffer_float](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/). Los parámetros propios no son una validación material atribuida a esas fuentes.
