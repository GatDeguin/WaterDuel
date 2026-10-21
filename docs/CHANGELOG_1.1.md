# WaterDuel 1.1.0 — 2026-10-17

Cambios implementados con regresiones automatizadas. La aceptación independiente corresponde al Crítico y Árbitro en sus cortes de evidencia; no se declara equivalencia con las referencias ni calidad AAA.

## Combate y personajes

- Pinchazo decisivo, primera persona en ganar dos rondas, 90 segundos y tiempo extra sin ganador artificial.
- Guardia consumible, recuperación, agotamiento y coste de bloqueo; excluye la estocada. HUD/puntos muestran guardia y rondas.
- Doble pinchazo simétrico: dos globos rotos, evento único, sin puntos, repetición de ronda. Inicio público no permite saltarse la resolución.
- Apoyo móvil común mediante `lean`, con límites/velocidad y separación conservadora 2.5. Corrige retirada invulnerable y solapamiento conocido de cabezas.
- IA determinista con observación, anticipación, ataque, recuperación, defensa reactiva y finta. Jefe con tres patrones, dos fases y contraataque humano comprobado.
- Mano alcanzable antes de IK; arma/defensa reutilizan esa pose. Muñeca angular real ±45° con longitud de espada constante.
- Radios de globo compartidos, piel `.006 × escala`, primera entrada del barrido, Z interpolada y orden temporal de guardia/cabeza. Proxy declarado 2.5D.

## Agua, látex y presentación

- Ciclo 4: volumen interior parcialmente lleno, superficie libre visible y aire superior. Llenado nominal 65% de capacidad útil `.2732954387403816 u³`; `HEAD_VOLUME=.17764203518124805 u³` a escala 1, con escala cúbica para jefe. Es una aproximación de slosh, sin CFD validado ni refracción real.
- La liberación hereda velocidad interna relativa además de la traslación/impulso. R4-02 y R4-03 pasan reataques independientes: campo ponderado por volumen, calibración por componente, cierre en suelo/paredes y fallback volumétrico exclusivo. Se documenta el mayor coste CPU y la caída de FPS del estallido.
- Integración consume todo el tiempo solicitado por subpasos; pruebas de momento heredado y volumen contable.
- Grilla dispersa con cobertura de nubes XYZ/fases de muestreo, presupuesto por superficie y normales exteriores en casos probados.
- Punción local estable durante la caída. Diez sectores de látex se abren progresivamente; proyección contra tablas evita penetración conocida.
- Disco visible/collider alineados, pies sobre tarima, control de profundidad transparente y cámara general fija con transición continua por proporción.
- Resultado de empate, nombre del jefe y reloj corregidos; anuncio retrasado para dejar ver el contacto.

## LAN y entrega

- Una autoridad de navegador; segunda pantalla recibe `HOST_BUSY`. No se añadió espejo ni espectador.
- Búfer de flancos, secuencias independientes, duplicados rechazados, heartbeat, neutralización y reconexión.
- Correcciones de input envejecido antes del servidor y rearme tras silencio con botón sostenido. La edad de origen conserva su vida restante hasta el paso; pruebas con relojes controlados no garantizan latencia física de Wi-Fi.
- Sesiones con claves por mando y TTL predeterminado de cuatro horas; al vencer exige reescanear.
- Paquete 1.1.0 y comandos `benchmark:fluid` / `pack:offline`.
- ZIP STORE reproducible, metadatos fijos, CRC32 y manifiesto SHA-256; pruebas con programa real y lector independiente sobre fixture temporal.
- Manual, matriz R1–R4, límites y registros retrospectivos. V1.0 se conserva como historia.

La secuencia incluyó rechazos y regresiones: consultar `audit/AUDITORIA_RONDA_1.md` a `4.md` y arbitrajes disponibles. `QA_EVIDENCIA.md` distingue capturas previas/R4, demo escenificada, mediciones y pendientes finales. Dos teléfonos físicos, sensores, balance con personas, accesibilidad asistiva y fidelidad visual final requieren validación específica.
