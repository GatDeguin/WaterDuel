# Entrega coordinada de Personajes v4

Usuario: selección exacta 2,3,4,5,6,7,8,9,11,14,15,16,17,18,19,31,32,34,36,37,40,42,43,46,49. Diseño y coordinación con Items y Principal aprobados expresamente el 2026-11-02.

Estado: implementación, revisión por tareas, integración y QA de Personajes completadas. No publicado por Personajes. Principal conserva versiones, empaquetado, promoción y CI.

## Alcance entregado

Tres fuentes Blender y GLB v4, atlas original compartido, contrato y recibos de reimportación, pies físicos con dos tobillos nuevos, transferencia de apoyo, lenguaje corporal, daño proyectado al mesh y paño deformable continuo. El renderer selecciona v4. Rutas históricas v1–v3 intactas. La matriz de las 25 mejoras está en `PERSONAJES_V4_TRAZABILIDAD.md`.

`PERSONAJES_V4_PROMOTION_FILES.json` es la lista explícita y curada para promover. `PERSONAJES_V4_PROMOTION_RECEIPTS.json` registra bytes/SHA de cada archivo, salvo su propio recibo para evitar circularidad. El manifiesto de producción contiene 25 fuentes; los archivos compartidos `engine.js` y `render3d.js` incluyen también cambios coordinados de Principal e Items. No copiar directorios ni respaldos `.superpowers/sdd/.../baseline`, ni modificar `.runtime/github-publish` desde Personajes.

Dependencias preexistentes: fuentes/GLB v3 para rebuild/contrato óptico, validador general `scripts/validate-water-mannequin.mjs`, fixtures N14 y su capa de referencia, parser/render y recursos de equipo/escenario del proyecto. La lista de promoción incluye todos los fixtures nuevos; no reemplaza el árbol base completo de WaterDuel.

## Revisión y regresiones

A/B/D: APPROVE tras corregir doble lubricación y probes de muñeca. C: APPROVE tras conservar pose en consumidor de marcas de pies. E: APPROVE tras corregir separación de paños con espesor mediante deformación por vértice y director compartido. F: revisión final de recursos, pie procedural, cuello y prioridad manual; el hallazgo de aros del cuello se corrigió con cobertura real del renderer y compatibilidad histórica.

La prueba procedural histórica conserva los cuatro SHA originales. Un fixture estático capturado del N14 original permite comprobar esos bytes, mientras nuevas pruebas contrastan N16 con hulls físicos. La prueba de cuatro pies ahora exige todos los vértices de las cuatro suelas reales y mantiene el caso legacy de cajas. No se convirtió una expectativa de cuatro piezas en cero.

La receta de cercanía con armas bajas produjo 1,165963 en N16 frente a 1,024719 en N14. Se preservó el límite 1,15 y el plazo de 390 pasos en la prueba histórica portable, con dos fuentes RAW N14 y SHA fijados. El diagnóstico mostró retraso transitorio de aproximación y menor inclinación pélvica; N14 usaba reacción bilateral negativa donde N16 permite sólo suelo unilateral. No se ajustó el solver para imitar esa reacción. Ocho recetas de brazo/muñeca y tres de agachado legal no resolvieron cercanía. Principal autorizó separar contratos: A prueba de avance real N16 hasta cap 2,7, ambos rigs avanzan >0,47 m, vivos/no solape/score/estabilidad; B receta N14 con <1,15 original; C contacto analítico N16 aislado con penetración inicial, separación e impulso no vacuos. A+B: 7/7 PASS. Resultados diagnósticos en `PERSONAJES_V4_HEAD_APPROACH.*`, `PERSONAJES_V4_HEAD_RECIPE.json` y `PERSONAJES_V4_HEAD_CROUCH.json`.

## Evidencia y comprobaciones

- Tres reimportaciones PASS, errores de sockets <8,39 µm; contrato de huesos/sockets/materiales protegido.
- Atlas: nueve pruebas Python PASS; 338 regiones originales y tres mapas compartidos de 1024².
- Pose sweep final: 32 perfiles, 200 muestras, 10.070.700 vértices; `ok:true`, máximo bajo suelo 1,06516 µm.
- Cuello procedural, render y payload legacy: 49/49 PASS después de corregir aros/barra sobre el eje 3D conseguido.
- Agachado: 3/3 PASS. La antigua comprobación de centro fijo se sustituyó por suelas físicas con reacción positiva en 420/420 frames por slot; centro/hull conservan el frame rígido, descenso >0,20 m y recuperación ±0,02 m.
- Contacto aislado N16: 4/4 PASS, sentidos ±1 y escalas 1/1,18; ratio elipsoidal independiente 0,98 antes y ≥1−1e−8 después, corrección acotada, único impulso de látex positivo y cierre medido por diferencias finitas reducido de >0,29 a <0,001. Suelo y madera están separados sin eliminar colliders. No se afirma conservación de momento global por este ensayo.
- Pruebas de apoyo/CCD/mecánica independientes, paño dinámico y consumidores: resultados focales en reportes por tarea. No sumar corridas superpuestas como cantidad única de pruebas.

La primera suite global (Principal) terminó con 1.507 pruebas: 1.493 PASS y 14 fallos. Se diagnosticaron y corrigieron dos defectos reales en la integración de apoyos/contactos; no se amplió el guard de altura de pelvis. Se añadieron motor físico de agachado separado de la intención rápida y salida compacta de diagnóstico con física bit a bit idéntica. `PERSONAJES_V4_FISICA.md` documenta causas, revisiones, 30/30 focos de postura y 63/63 de contacto, mediciones y límites.

La suite global final ejecutada por Principal aprobó **1.552/1.552 pruebas**, cero fallos y omisiones, en 495.030,7504 ms. Registro: `.runtime/release-1.13.0/full-tests-third.log`. IA/contactos y compatibilidad de equipo fueron verificados sobre el corte integrado; Personajes no modificó tests/tolerancias de Items para ocultar resultados.

Después de esa suite, la revisión de portabilidad detectó una dependencia de un archivo interno en `character-v4-contract`. Se copiaron sus bytes exactos a `tests/fixtures/water-mannequin-v3-baseline.json` (SHA-256 `8468ba8a0eb68dc21e09d4cc59e3e4c0dc36a4f4fd704f32ffdf77f3d9fee169`) y se cambió únicamente la ruta de lectura. Contenido y aserciones intactos. La prueba afectada pasó **5/5** por separado; ese cambio posterior no se atribuye a la corrida global anterior. CI volverá a comprobar el paquete promovido.

No existe medición de FPS ni hardware móvil en esta entrega.

## QA pública

`/qa/personajes-v4.html`: fixture sin Host/session/socket, con guardia, marcha, esquiva, paño, daño, ganador y jefe. Las llamadas de daño y resultado están identificadas como preparación explícita de QA; el movimiento usa mandos y reloj físico reales.

Principal operó la única ventana WebGL y el servidor. Personajes revisó los PNG guardados, sin abrir otro navegador. Carga **11/11** sin error, entorno y personajes revisión 4, matrices finitas. Vistas aprobadas: guardia, marcha, esquiva, paño, daño/desprendimiento, celebración y jefe. Sin P1/P2 de assets visibles. Se recapturaron guardia y celebración para mostrar actores y pies completos.

Capturas y registros JSON: `.runtime/release-1.13.0/characters-{guard,walk,dodge,cloth,damage,detached,celebration,boss}-v4.{png,json}`. Son ocho estados de siete presets, sin QR ni sesiones. La celebración usa un burst de demostración y no acredita una victoria competitiva. Una imagen estática no certifica cada microtextura, toda trayectoria posible ni rendimiento; se complementa con los contratos y pruebas descritos arriba.
