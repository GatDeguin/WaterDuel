# WaterDuel1.4.2 — adaptación gráfica opcional

En el móvil, **MENÚ → Imagen y sonido → Fluidez → Adaptativa experimental** activa una política privada del renderer. Calidad fija es el valor inicial y el fallback ante un modo ausente o inválido. El selector conserva confirmación por ACK y estado aplicado.

La adaptación usa los perfiles gráficos existentes, con escala interna entre100% y70%, histéresis y recuperación gradual. Durante ruptura comienza en ECO como precaución; nunca cambia `game.quality`, cantidad de parcelas, física120Hz, colisiones, controles, RNG ni datos de repetición. Conserva las reglas y el código de efectos/audio; la cadencia de voces y la escucha física no quedaron acreditadas. Las repeticiones y barreras de carga usan calidad fija. La PC conserva únicamente escena y dos QR.

Las escalas adicionales del extractor de agua se descartaron al alterar conectividad/cierre. `surfaces.js` se conserva exactamente como1.4.1. También permanece descartada la vía whole-Host Worker.

Los20 episodios controlados conservaron795 updates,282 pasos físicos incluido flush,135 capturas y estado final exacto. Las cinco comparaciones mostraron menor CPU medio por callback y mejor frescura, pero el ahorro mediano23,319% no superó la variación AA máxima32,003%. El gate de promoción falló; no se excluyeron controles ni se repitió la prueba. CPU medio por callback no equivale a ahorro total de trabajo. La opción queda experimental y requiere elección explícita. **60FPS sostenidos no se alcanzaron ni se certificaron.**

Ver `audit/adaptive-quality-post1.4.1/paired-summary.json`, los veinte raws y los criterios previos `paired-scope.md`. Los cambios de defaults finales se conservan aparte con sus inversas exactas en `measured-source/`; los recorridos medidos configuraban ambos modos explícitamente.

La suite completa aprobó **864/864 pruebas en108 archivos**, sin omisiones y con fuentes estables (`audit/corte-1.4.2-adaptive-02/receipt.json`). El primer intento862/864 se conserva: dos contratos históricos de fuente completa debían reconocer las tres adiciones de render, mediante inversas exactas, manteniendo el shader actual idéntico al anterior. El archivo offline y su reproducción/verificación se registran fuera del ZIP en `release/`.
