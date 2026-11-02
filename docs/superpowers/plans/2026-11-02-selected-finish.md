# Selected Finish Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Entregar la selección Principal 10,12,13,14,15,18,21,29,44 integrada con los cortes coordinados de Items y Personajes.

**Architecture:** Progreso y reglas en la sesión autoritativa, presentación en renderer y mandos móviles, movimiento compartido entre física y render. Bloques separados por propietario evitan sobrescrituras.

**Tech Stack:** JavaScript ES modules, WebGL2, Node test runner, relay WebSocket existente, fuentes Blender existentes.

**Spec:** ../specs/2026-11-02-selected-finish-design.md

## Global Constraints

Conservar PC sólo escena/QR, mando móvil sin botón de ataque, perforación física, Items secundario/maul2manos, daño/replay y audio1.12. No editar clon de publicación hasta congelación conjunta. No debilitar guardas para obtener un resultado verde.

## Review Focus

- Progreso avanzado inaccesible antes de ganar normal y sin sobrescribir sus datos.
- ACK anterior/estado posterior, fallos de almacenamiento o desconexión sin éxito aparente.
- Ceremonia jamás asociada a demo, replay, empate o derrota.
- Movimiento respeta daño, desprendimientos, ambos lados y límites físicos.
- Cámara y materiales conservan legibilidad, reducedMotion, detalle y límites360.

## Tasks

- [x] Campaña: pruebas RED de desbloqueo/progreso/final; single-player + módulo nuevo; GREEN de campaña y ejercicios históricos.
- [x] Móvil/protocolo: normalizador setCampaignTier, DTO acotado, HostSession, selector y resultado con ACK; RED->GREEN LAN/local/controller.
- [x] Ceremonia: módulo puro de elegibilidad/estado y objeto de escena; RED->GREEN sin efectos sobre física/replay.
- [x] Combate/jefe: coreografía en módulo nuevo + integración AI; perforación y contraataque físicos, focal final y suite global N16 aprobados.
- [x] Fintas/manejo: lectura corporal y recuperación por equipo coordinadas con Personajes; cierre físico conjunto y revisión visual aprobados.
- [x] Apoyos/daño/materiales: integrar cortes de Personajes/Items con manifiestos/hashes y evidencias; conservar recursos anteriores.
- [x] Cámara/shaders: continuidad y paths materiales, hook AssetGPU y QA visual exclusiva del conjunto aprobados.
- [x] Congelación: revisión independiente, suite completa del conjunto (1552/1552), build, QA visual exclusiva, documentación de límites y promoción curada comprobada en clon (24/24). La publicación se verifica por separado en el pipeline Test → Build → Deploy y en los bytes públicos.
