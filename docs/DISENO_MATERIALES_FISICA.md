# Diseño de la siguiente etapa física y visual

2026-10-17. Pedido vigente: avanzar significativamente en materiales, sofisticación de muñecos/articulaciones, agua volumétrica y látex realista. La entrega 1.1 es una base reproducible; su nota 70/100 no cierra el mandato. Campaña, entrenamiento, replays y validación de dispositivos continúan dentro del objetivo general, aunque esta etapa prioriza los cinco ejes indicados.

## Materiales y render

Se conservará WebGL2 local y el renderer existente, ampliándolo con una biblioteca central de propiedades (rugosidad, metalicidad, IOR, absorción, capa de barniz). La luz neutral y la del taller deben ejercitar el mismo modelo. La madera tendrá relieve de veta/poro, cambios de cara y barniz; el metal tendrá acabado y microvariación; látex y agua tendrán respuesta dieléctrica en lugar de metalicidad decorativa.

Se compararon tres soluciones de transmisión: mantener alfa analítica (barata, pero no deforma el escenario), copiar solo color (refracción limitada y sin grosor de escena), y separar opacos/composición con color y profundidad. Se elige la tercera: dos framebuffer objects de tamaño acotado, sin muestrear una textura que está siendo escrita. Los opacos se resuelven primero; el transparente consulta ese color/profundidad y aplica refracción aproximada, Fresnel y absorción. Un entorno capturado del taller aporta reflejos coherentes. No se presenta como trazado de rayos ni refracción multicapa exacta.

Los recursos deben reconstruirse al cambiar tamaño/calidad, liberarse al sustituirlos y tener fallback explícito ante framebuffer incompleto/contexto perdido. No se puede resolver un fallo escondiendo agua ni reemplazando geometría con la referencia. El coste GPU, las dimensiones y las capturas deben verificarse en navegador; el GL simulado valida orden/contratos, no calidad visual.

## Látex y agua

La membrana sectorizada actual es insuficiente para el nuevo pedido. El siguiente modelo tendrá nodos, masas, restricciones de arista/área/volumen y contacto localizado; punción y tensión cambiarán conexiones y liberarán tensión acumulada. Su malla saldrá de los nodos simulados, no de diez paneles con apertura predefinida. XPBD es la alternativa elegida para controlar cumplimiento de restricciones con subpasos; sigue requiriendo calibración de material.

El líquido conservará su ledger y la reconstrucción calibrada. La optimización no reducirá partículas, iteraciones, cobertura o precisión para simular una ganancia. El acoplamiento con la membrana debe distinguir presión, desplazamiento de soporte e impulso de perforación. Comparar normal/jefe, punciones en distintos puntos, golpes leves y liberación; preservar resultados competitivos entre perfiles.

## Muñecos y articulaciones

La construcción visible debe expresar mecanismos: pelvis/torso separados, clevis, ejes, cojinetes, fijaciones y actuadores unidos a puntos coherentes de la pose. La evolución física debe introducir límites y respuesta de articulaciones, masa/inercia y contacto en vez de etiquetar IK como active ragdoll completo. Se verificará longitud de segmentos, límites, estabilidad, alcance humano/IA y recuperación; cualquier cambio de alcance exige revalidar contrajuego y colisión.

## Evidencia y aceptación

- Antes/después de CPU bajo el mismo calentamiento y fixtures; descartar experimentos neutros o peores.
- Compilar/enlazar shaders reales; sin errores GL ni realimentación de texturas.
- Capturas equivalentes de combate, detalle y jefe bajo ambas luces.
- Agua y membrana: finitud, volumen, normales, contacto, escala y coste; ruptura localizada con topología modificada y continuidad temporal.
- Ningún puntaje interno sustituye probar requisitos ausentes. Registrar límites y mantener el objetivo activo mientras falte implementación o validación.

## Fuentes de implementación

- Macklin, Müller y Chentanez, [XPBD (2016)](https://mmacklin.com/xpbd.pdf): formulación de restricciones con cumplimiento y multiplicadores acumulados. Se aplica como modelo reducido, sin atribuir validación material al paper.
- [Especificación WebGL2 de Khronos](https://registry.khronos.org/webgl/specs/latest/2.0/): framebuffers, texturas y transferencia de buffers; se comprobarán formatos, dimensiones y ausencia de lectura/escritura simultánea de un attachment.
