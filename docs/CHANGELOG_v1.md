# WATER DUEL — Cambios v1.0 vs v0.1

### Implementado

- Geometrías de madera biselada, detalles de metal cepillado, pasadores, discos, roblones, agarres, tendones y articulaciones independientes.
- Materiales procedurales PBR aproximados, doble iluminación cálida/fría y mayor profundidad del escenario Atelier.
- Globe de látex geométrico dinámico y diez paneles de rotura orientados al impacto.
- Agua volumétrica con partículas de volumen conservado y malla de isodensidad 3D triangulada.
- Cohesión, repulsión, viscosidad, choque con el piso, chorreos y charcos.
- Balance reactivo y caída por pérdida de masa de globo.
- Nuevo jefe Maestro Hidráulico para modo Single Player y su dificultad.
- Tres perfiles de resolución y detalle: Eco / Alta / Cinemática.
- Corrección del primer fotograma que podía intentar renderizar poses aún no inicializadas.
- 8 nuevos tests: física de volumen, látex, mallas, jefe, render dinámico; total 16.

### No implementado ni declarado como AAA

- Física validada de látex con material constitutivo FEM / propagación real de fractura.
- Fluido FLIP/PBF de alta resolución con solver incomprensible exacto, refracción ray-tracing y acoplamiento sólido-fluido completo.
- Ragdoll 3D libre con resolución por motor físico generalista.
- Campaña narrativa de 12 capítulos, ranking/online remoto, editor completo y 60 fps garantizados en cualquier tablet.
- Capturas directas de la versión ejecutada WebGL2 en un navegador de este entorno (bloqueo administrativo del navegador automatizado).

### Siguientes hitos con mayor retorno

1. Solver XPBD de articulaciones 3D con distribución de masa y torque por segmento.
2. PBF/SPH validado y GPU surface reconstruction adaptable a la VRAM.
3. Membrana XPBD con restricciones anisotrópicas y actualización topológica por punción.
4. Texturas PBR 2K generadas offline y sombras reales cascadas (PC) / baked/cheap shadows (tablet).
5. Pruebas instrumentadas de latencia Wi-Fi, input-to-photon y frame-time en hardware concreto.
