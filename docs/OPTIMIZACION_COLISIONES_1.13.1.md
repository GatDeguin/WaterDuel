# Contactos de armas · optimización 1.13.1

Estado: implementación, medición y verificación local completadas; publicación verificada por separado en CI y Pages.

El objetivo es reducir las pausas al cruzar armas y durante el forcejeo. Se conservan el contacto continuo, la perforación física del globo, los desvíos, el daño, los apoyos, las ventanas de contraataque y todos los efectos. No se reducen calidad, iteraciones, muestras temporales, fuerzas ni tolerancias para obtener un resultado más rápido.

La referencia es el corte 1.13.0 `c060911a352afb37a7f40076fa11350455f7ac7a`. El perfil inicial del motor completo encontró un coste considerable en las colisiones de la tela con las piernas, además del trabajo de contacto de los rigs y las consultas de fricción. Las mediciones separan física Node, envío de render y consultas GPU; no se infieren FPS de la cadencia del navegador integrado.

## Registro de intentos

| Cambio | Verificación | Decisión |
|---|---|---|
| Proyecciones escalares de la tela y sus muestras interiores, sin arrays temporales por prueba de cápsula | 866 pasos completos idénticos, 324 con acero; cuatro rondas ABBA: 27,1–28,6 % menos tiempo de física en el conjunto medido | Conservar |
| No construir manifolds alternativos que no se consumen | Mecánica exacta; cuatro rondas del motor: −0,9 a +2,7 % de mejora, sin señal consistente | Descartar |
| Usar geometría seleccionada en las 14 bisecciones corporales | Mecánica y muestras exactas; cuatro rondas: −4,9 a +2,4 %, sin señal consistente | Descartar |
| Preparación efímera de las consultas de un mismo choque | Dos repeticiones de cuatro rondas ABBA: mediana 9,8 % menos CPU en la resolución aislada, rango 4,6–12,9 %. La diferencia del motor completo atribuible sólo a esta preparación queda dentro del ruido | Conservar para el tramo medido; no atribuirle una mejora global adicional |

Las alternativas descartadas se conservan como evidencia de experimentación y no forman parte del runtime final. Las cifras anteriores corresponden al motor Node completo en ocho recetas de cuatro armas; no son porcentajes de mejora global de FPS.

La tela conserva sus diez iteraciones y el orden aritmético original. Las pruebas comparan 428 estados, 480 muestras de superficie y 3.300 proyecciones, incluyendo extremos tipados, pesos cero y colliders que comparten nodos vivos. Las operaciones de compatibilidad mantienen la ruta anterior cuando sus entradas requieren redondeo de arrays tipados.

## Corte final y método

El conjunto final reduce el tiempo de física entre **28,1 % y 28,6 %**, con mediana **28,5 %**, en las cuatro rondas ABBA del motor completo. La prueba usa ocho recetas —espada, lanza, hacha y mazo, en neutro y con intención de forcejeo— con controles deterministas, paso de 1/120 s y un máximo de 180 pasos por receta. Es una escena de presión a distancia de práctica, preparada directamente en combate para medir el contacto; no acredita una victoria de campaña ni reemplaza las pruebas de cuenta atrás.

Constructores, restauraciones, snapshots y aserciones quedan fuera de los temporizadores de actualización. La comparación paso a paso verifica **866 actualizaciones**, **324 con acero**, incluyendo estado de replay, coordenadas, velocidades, apoyos, flexión, resultados, contactos y eventos. Las 16 ejecuciones cronometradas verifican además sus estados terminales completos e incluyen 13.856 pasos de física. Los datos corresponden a Node 24.20.0 en Windows, con los hashes de los 44 módulos registrados.

La preparación del contacto captura un snapshot privado con la masa, las Jacobianas, la velocidad inicial y la geometría de restricciones. Sus cachés contienen respuestas geométricas y métricas por orden exacto de apoyos liberados y filas activas. Cada impulso vuelve a calcular su RHS, liberación de apoyos, conjunto activo, reacciones y energía. La API anterior, los resultados propios y la aplicación del impulso se conservan; rigs antiguos o métodos sobreescritos usan la ruta compatible. No se comparten soluciones físicas entre contactos ni frames.

El ensayo aislado usa el `resolveWeaponBind` real con `project:false`, como la etapa de impulso del motor, y cuatro combinaciones de espejo/tamaño. Comprueba 8.192 llamadas cronometradas en dos repeticiones; cada repetición incluye un calentamiento idéntico por rama. La corrección de posición corporal se mide en la prueba del motor completo, no en ese porcentaje aislado. También se conserva el preflight con calentamiento más corto para exponer el efecto de JIT y la variación inicial.

## Reproducción

```powershell
node benchmarks/weapon-collisions-1.13.1.mjs verify
node benchmarks/weapon-collisions-1.13.1.mjs benchmark
node benchmarks/contact-query-1.13.1.mjs
```

Los grafos se generan en `.runtime/perf-collision-1.13.1`. Ambas ramas comparten las dependencias actuales y reemplazan únicamente los tres módulos congelados de 1.13 en la referencia; sus bytes y hashes se comprueban antes de ejecutarlos. No ejecutar otros perfiles, suites o sesiones GPU durante las mediciones de tiempo.

[Resumen y hashes](performance-1.13.1/summary.json) · [Datos completos del motor](performance-1.13.1/whole-engine-paired.json) · [Oráculo](performance-1.13.1/whole-engine-oracle.json) · [Fuentes](performance-1.13.1/sources.json) · [Contacto, repetición 1](performance-1.13.1/query-component-repetition1.json) · [Repetición 2](performance-1.13.1/query-component-repetition2.json).

## Navegador y límites

La fixture WebGL ejecutó 60 cuadros y 120 pasos con contacto real de mazos tanto en la referencia congelada como en el candidato. Conservó modelos, sombras, agua, marcas y efectos, sin errores de WebGL ni de consola. Las muestras del navegador integrado tienen calentamiento, planificación y temporización GPU variables; no constituyen una comparación estadística de FPS ni certifican 60 FPS sostenidos. Las cifras de mejora anteriores proceden de los ensayos CPU repetidos y separados.

Las máscaras de audio, los mandos móviles, los QR, las vibraciones, las reglas de ataque y las ventanas de contraataque no cambian. La suite global local aprobó **1.567/1.567 pruebas**, sin fallos, cancelaciones ni omisiones, en 384.164,3907 ms con concurrencia 2. CI repite las pruebas y el build sobre el clon promovido antes del despliegue; sus resultados y el cotejo de archivos públicos se registran en el recibo de release.
