# Personajes v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Implementar las 25 mejoras aprobadas de Personajes con modelos v4 e integración física verificable.

**Architecture:** Fuentes y GLB v4 independientes, atlas PBR original por pieza, dos tobillos físicos adicionales y una única pose para render/colisión. Módulos separados de intenciones corporales y paño reducido; preservar la técnica de Items.

**Tech Stack:** Blender 5.2 background, Python/numpy/Pillow, JavaScript ESM, WebGL2 propio, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-02-personajes-selected-design.md` (aprobado).

## Global Constraints

- Selección exacta 2,3,4,5,6,7,8,9,11,14,15,16,17,18,19,31,32,34,36,37,40,42,43,46,49.
- v1/v2/v3 congeladas; v4 en `docs/assets/characters/v4/` y `public/assets/characters/water-mannequin/v4/`.
- Conservar 18 huesos de autoría, cinco sockets, pesos rígidos 1,0, nombres de materiales/faldón y marcos de bind. La geometría y los UV cambian; no se afirma equivalencia binaria v3.
- Tobillos físicos en índices14/15, sin renumerar0–13. Suelo, pie visible, sombras y colisión usan el mismo frame. Pie en vuelo sin apoyo externo invisible.
- No modificar técnica/agarre/desvío/contactos de armas ni DTO/controlador de Items; acordar bloques compartidos antes de editarlos.
- No modificar reglas de pinchazo, puntajes, daño/umbrales, aperturas del jefe, agua/látex dinámicos, versiones/release/tasks ni publicación.
- ≤65.000 triángulos completos normal/ámbar y ≤90.000 jefe; ≤18 mallas. Atlas inicial3×1024², presupuesto16MiB RGBA8+mips, alternativas justificadas20/24MiB.
- Sin nuevas dependencias ni extensiones glTF. PNG embebido; base sRGB, normal/ORM lineales. Fuentes Blender editables y GLB reales reimportados.
- Workspace sin Git: no commits ni worktrees artificiales; respaldos por archivo para revisión, sin restaurar trabajo ajeno.

## Review Focus

- Pies en vuelo, pérdida de pierna y cambio de dirección: cero reacción de suelo aérea y ownership correcto.
- Daga invertida, escudo y mazo a dos manos: cancelar cualquier gesto secundario que compita con Items.
- Replay antiguo sin frames nuevos: fallback explícito; replay nuevo posee sus arrays y no ejecuta física.
- Paño mojado, agachado y caída: misma deformación en contacto/material/render, sin sostener el cuerpo.
- Celebración, empate y nueva ronda: ningún ataque/punto extra y reinicio completo del gesto.

## Task A: construcción, UV y export v4

**Files:** crear `scripts/character_v4_geometry.py`, `scripts/build-water-mannequin-v4.py`, `scripts/inspect-water-mannequin-v4.py`; fuentes, layouts y GLB v4; test nuevo `tests/character-v4-contract.test.mjs` o validación equivalente sin depender del runtime compartido aún.

**Interfaces:** producir `docs/assets/characters/v4/atlas-layout.json` con `{schema:4,size:1024,regions:[{id,material,kind,rect:[x,y,w,h],seed,...}]}`. Coordenadas de rect en píxeles del PNG, origen superior izquierdo. UV1 de cada región utiliza el interior con margen; `kind` wood/endgrain/brass/leather/cloth/steel. Compartir layout para los tres modelos. Atlas taskB exporta `body-basecolor.png`, `body-normal.png`, `body-orm.png`; el builder puede esperar a que estén listos antes del export definitivo.

- [ ] Añadir validación que falle contra v3 por suela no plana y tapas UV degeneradas.
- [ ] Refinar proporciones sin mover pivotes; ensamblajes con ownership, chaflanes, testas, tornillos reales y pies planos. Mantener la forma de maniquí, no imponer la propuesta1 no seleccionada.
- [ ] Generar UV1 únicos por pieza, arreglar tapas UV0 y emitir layout determinista. Avisar contrato a B antes de exportar.
- [ ] Conectar atlas UV1 con materiales existentes, preservar cabeza/agua/cresta y exportar tres GLB/fuentes.
- [ ] Validar ejes, pesos, sockets, presupuesto, holguras y reimport ≤0,0002m. Emitir envolventes físicas de pie/espinilla y descriptor del paño para C/E.
- [ ] Informe `.superpowers/sdd/personajes-selected-v4/task-A-report.md`: archivos, controles ejecutados, métricas y limitaciones.

## Task B: atlas de construcción y desgaste

**Files:** crear `scripts/create-character-atlas-v4.py`, mapas y stats en `docs/assets/characters/v4/textures/`; tests focales de atlas/PNGs.

**Interfaces:** consumir layout taskA; generar tres PNG RGB8 a1024 y `atlas-stats.json`. Generación por seed de región independiente del orden. BC sRGB; normalunit+Y y ORM R/G/B. El material de tela conserva su factor de tinte; atlas tela neutro.

- [ ] Prueba de regiones únicas, determinismo, dimensiones, canales y ausencia de píxeles fuera de rango.
- [ ] Implementar veta/testas, desgaste funcional, fisura con fibra, pulido/torneado, pátina/grasa y costuras/cantos del cinturón.
- [ ] Dilatar bordes sin contaminación entre regiones; no iluminar ni pintar reflejos/sombras.
- [ ] Medir memoria y comprobar normal/roughness/metallic por clase. Mantener bytes iguales entre variantes.
- [ ] Generar preview de mapas y reporte `.superpowers/sdd/personajes-selected-v4/task-B-report.md`.

## Task C: tobillos, apoyos y respuesta de impacto

**Files:** modificar bloques coordinados en `public/physics/articulated-rig.js` y pies/shin de `public/rendering/asset-rig.js`; nuevos helpers si simplifican responsabilidad; tests propios `tests/character-v4-feet.test.mjs` y ajustes intencionales de pruebas de rig que fijaban14coordenadas.

**Interfaces:** `pose.ankleF/B` son puntos conseguidos; `pose.feet.front/back` contienen frame físico (matriz4×4 propia), talón/punta/centro, ángulo y estado de apoyo. `footF/B` mantienen puntos de centro para consumidores antiguos. El fallback de render sin `pose.feet` reproduce exactamente suela horizontal histórica. `pose.apron` no se modifica en C; Root gestiona E.

- [ ] RED de rodadura del pie, mismo frame render/contacto, longitud rodilla-tobillo y ausencia de soporte aéreo.
- [ ] Integrar dos coordenadas y masa/inercia/topes; actualizar cinemática/Jacobianas/CCD/cachés/ownership sin alterar índices0–13.
- [ ] Separar trayectorias motoras de restricciones de suelo; adelantar transferencia de peso al paso.
- [ ] Respuesta vibratoria corta derivada de impulso real y amortiguada, sin ruido/renderoffset ni modificar daño.
- [ ] Probar ambos lados, agua/jefe, daño y desprendimientos, diferentes pasos temporales; conservar equipo/knife de Items.
- [ ] Reporte `.superpowers/sdd/personajes-selected-v4/task-C-report.md` y contrato de datos estable antes de integración D/E.

## Task D: intenciones corporales, daño y celebración

**Files:** crear `public/physics/character-intent.js`, `tests/character-intent.test.mjs`; integrar bloques coordinados de intención en `public/engine.js`; refinar `public/rendering/joint-damage.js`/`combat-wear.js` y dibujado de marcas en `public/render3d.js` sin cambiar técnica ni contactos Items.

**Interfaces:** `characterIntent(fighter,context)` produce offsets/objetivos acotados de torso y brazo libre; entrada incluye fase/tiempo/estado, boss, equipo, aceleración y input. El resultado nunca contiene ataques/puntaje. `resultIntent` usa tiempo de simulación y gesto posterior al resultado. Etapas de marca se derivan de `pose.joints` actual y su proyección al mesh real.

- [ ] RED de prioridad dosmanos→defensa→humano→contrapeso, y cancelación por amputación/equipo.
- [ ] Implementar coordinación de hombros/torso, esquiva, contrapeso y perfil deliberado del jefe conservando autoridad de input y ventanas de apertura.
- [ ] RED/ GREEN celebración solo ganador resuelto, empate sin gesto, reset de ronda y reducedmotion; intenciones físicas con `thrust=false`.
- [ ] Marcas escalonadas por daño ancladas al mesh y propietario correcto; cero marcas flotantes en junta desprendida.
- [ ] Verificar regresiones de head/CCD, boss-opening, equipo y replay; reporte task-D.

## Task E: paño reducido con torsión y pliegues

**Files:** crear `public/physics/apron-cloth.js`, `public/rendering/apron-deform.js`, `tests/apron-cloth.test.mjs`; integrar `public/physics/apron.js`, `public/physics/surface-state.js`, preparación/render del paño y `render3d.js` en sus bloques.

**Interfaces:** `ApronCloth` consume descriptor canónico y avanza a reloj fijo con frame del cinturón, colisiones de piernas/suelo, gravedad y humedad. Snapshot posee `cloth:{revision:4,columns:2,rows:3,rest,positions,normals,...}` más estado heredado. `deformApronPart(part,snapshot)` transforma la misma superficie que usa contacto/mojado. Herrajes de cinturón rígidos; adorno de borde sigue panel.

- [ ] RED de oscilación activa, torsión no rígida, pliegue local, quietud amortiguada y snapshots propios.
- [ ] Implementar12nodos, restricciones de longitud/flexión y anclaje superior; suelo/piernas en la misma geometría. Accesorio nunca sostiene/desplaza cuerpo.
- [ ] Integrar render/deform y mojado de dos regiones desde contacto real; mantener fallback de bisagra para replay antiguo.
- [ ] Probar normal/jefe, marcha, agachado, caída, húmedo/seco y adornos; evidencia específica de las tres deformaciones.
- [ ] Reporte task-E, sin atribuir plegado a una simple rotación de todo el paño.

## Task F: integración, revisión y entrega

**Files:** rutas de personaje en `public/render3d.js`, `scripts/validate-water-mannequin-v4.mjs`, scripts nuevos de preview/reimport, metadatos/hash v4, `audit/COORDINACION_PERSONAJES_V4.md`, trazabilidad25.

- [ ] Revisión de tareas y resolución de defectos; no rebajar las pruebas históricas v3.
- [ ] Seleccionar v4 tras invariantes aprobados y actualizar envolventes medidas (no copiar límites v2 como si estuvieran certificados).
- [ ] Focos Node del cambio, suite global en ventana congelada acordada; no GPU concurrente con otro chat.
- [ ] Reimportar/renderizar GLB reales y comprobar navegador GPU en fixture pública; registrar capturas/vídeos reales para movimiento y estado.
- [ ] Emitir contrato, presupuesto, SHA, fuentes, evidencia y matriz de las25mejoras. Enviar informe estable a Principal, que conserva publicación.

## Ejecución

El usuario aprobó el diseño y la coordinación; se continúa sin una segunda aprobación del mismo alcance. Se usa delegación paralela en archivos disjuntos A/B/C y ejecución Root en D/E, con interfaces congeladas y revisión posterior. Es la adaptación necesaria a la instrucción de delegación proactiva. No se fabrican commits en este workspace sin Git.
