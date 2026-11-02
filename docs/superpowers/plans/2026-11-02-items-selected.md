# Ítems seleccionados: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar las mejoras 26, 27, 34, 36, 37 y 44 seleccionadas por el usuario.

**Architecture:** Módulos puros para técnica del cuchillo y clasificación de impactos hápticos; integración en los contratos y consumidores existentes. Exportación artesanal v3 en directorios nuevos, preservando v1/v2.

**Tech Stack:** JavaScript ESM, WebGL2 propio, pruebas Node, Blender background, GLB 2.0 PBR.

**Spec:** `docs/superpowers/specs/2026-11-02-items-selected-design.md`.

## Global Constraints

- Cuchillo exclusivamente secundario; mazo a dos manos con defensa `none`.
- Equipo normal compatible con snapshots anteriores; solo el cuchillo invertido añade `knifeGrip:'reverse'`.
- Contacto físico autoritativo; sin puntajes ni perforaciones inyectadas.
- v1/v2 congeladas; arte nuevo en `workshop/v3`, PNG de hasta 512 px.
- Coordinar cambios compartidos con Principal. No CUA autenticado, servidores alternativos ni pruebas globales concurrentes.

## Review Focus

- Selección vieja y replay sin `knifeGrip` siguen usando el agarre normal.
- Cambiar cuchillo invertido por escudo/mazo elimina el campo de agarre.
- Mano, punta, parada y GLB coinciden para J1/J2 y movimientos extremos.
- Impacto cero, remoto, no finito o manipulado no produce vibración.
- Repetición, foco perdido y hardware sin vibración no producen pulsos indebidos ni errores.

### Corte 1: contratos y técnica del cuchillo

**Files:** nuevo `public/knife-technique.js`; integrar `public/equipment.js`, `public/engine.js`, rig físico y render, `public/auto-defense.js`, `public/remote-menu.js`, controlador y las dos páginas de móvil. Nuevos tests focales de técnica e integración; ampliar consumidores estrictamente necesarios.

**Interfaces:** `knifeGrip` opcional y canónico; dirección/punta y conversión de contacto mediante helper puro. La interfaz final se documenta con su implementación antes de integrar consumidores.

- [ ] Escribir y ejecutar pruebas rojas de normalización/protocolo, punta normal/invertida y reacción defensiva.
- [ ] Implementar helper y conservar los defaults históricos.
- [ ] Integrar pose, perfil físico, mano renderizada, selección y ACK del móvil.
- [ ] Verificar reinicios, replay, cambio a mazo/escudos y ambos jugadores.

### Corte 2: háptica por impacto

**Files:** nuevo `public/item-haptics.js`, `tests/item-haptics.test.mjs`; integrar `public/game.js`, `server.mjs`, `public/mobile-session.js`, `public/controller.js` y pruebas de transporte/controlador.

**Interfaces:** `sanitizeItemImpact(data)` produce metadatos pequeños y acotados o null; `contactHaptic(data,localSlot)` produce `{pattern,priority}` o null. El host transmite solo eventos derivados de contacto real y el cliente conserva sus barreras de foco y prioridad.

- [ ] Ejecutar pruebas rojas de tipos, participantes, límites, impulso cero y patrones.
- [ ] Implementar clasificación pura y sanitización de frontera.
- [ ] Integrar LAN y sesión local sin duplicar pulsos de un mismo impacto.
- [ ] Comprobar suspensión, dispositivo sin soporte y prioridad de daño.

### Corte 3: artesanía v3

**Files:** scripts nuevos `*equipment*v3*`, `public/assets/equipment/workshop/v3/` y `docs/assets/equipment/v3/`.

- [ ] Añadir construcción, sellos y grabados originales a los siete modelos.
- [ ] Exportar e inspeccionar GLB reales, sockets, límites, materiales y presupuesto.
- [ ] Renderizar lámina y acercamientos; conservar fuente Blender editable.
- [ ] Cambiar la ruta de carga al corte v3 únicamente después de su validación.

### Corte 4: revisión conjunta y entrega

**Files:** fixture pública y test propios; evidencia nueva en `audit/`, guía de entrega nueva.

- [ ] Revisión independiente de módulos y contratos; resolver hallazgos.
- [ ] Ejecutar focos pertinentes una vez estabilizados los cambios.
- [ ] Coordinar QA visual pública con Principal, incluidos ambos agarres y marcas visibles.
- [ ] Entregar hashes, fuentes, evidencia y límites de comprobación; no afirmar vibración física ni FPS sin medición.

No se crean commits porque el workspace actual no es un repositorio Git. No se modifica package/version/release/tasks.
