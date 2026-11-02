# Oráculos de física: migración N14 → N16

Fecha: 2026-11-02. Alcance: `rig-goal-y-only-exact`, `rig-passive-equivalence`, `head-contact-pose-exact` y referencia numérica de tests. No se modificó runtime ni un fixture histórico.

## Diagnóstico y conservación histórica

La ejecución inicial de las tres suites sin migrar produjo **1 aprobado, 8 fallidos, 0 omitidos/TODO**. La prueba de `resolvePair` sin construir poses ya pasaba. Los otros casos exigían igualdad completa con una implementación de 14 coordenadas: esa implementación conserva velocidad/matriz de 14 elementos y apoyos antiguos, incluso si el test le copia un `q` de 16 elementos. Los cuerpos de pie, sus inercias y los apoyos unilaterales cambian físicamente trayectorias e impulsos. Comparar esas resoluciones como si fueran equivalentes ocultaría el cambio de contrato.

Se conservan y comprueban los bytes originales:

| Fixture | SHA-256 |
| --- | --- |
| `tests/fixtures/articulated-rig-pre-goal-y-only-1.7.4.js.txt` | `11fd0cc7fb655b404b4e911f8adea509ef9d37a742c169f13dcd9eb496398d60` |
| `audit/articulated-rig-passive-spikes-before.js` | `c56c5ebaeb9aa28c7ec55540bb4ad4b836fb158539786f44153f7c5264f2d0bd` |

Los imports históricos siguen pasando por la capa reversible de orientación del hacha, con su comprobación de hash. Se comprueba explícitamente que el histórico conserva N14. Ya no se crea un módulo temporal en `public/physics` para importarlo.

## Independencia del nuevo oráculo

`tests/fixtures/rig-v4-numerical-reference.mjs` no importa código del solver, tablas de índices rotacionales, Jacobianas analíticas ni su factorización. Para cada coordenada se toman muestras centrales en `q ± 2e-6` de los centros públicos de `diagnostics().bodies` y los ángulos de `pose().bodyFrames`. El agua usa la orientación pública del cuello; la pelvis tiene su propio frame.

De esas diferencias se construye `Mnum = Σ[m Jcomᵀ Jcom + I grad(ángulo) grad(ángulo)ᵀ] + 1e-6 I`. Se comparan las 256 entradas de la matriz N16 con tolerancia absoluta `3e-8` más relativa `3e-7`. Además se exige simetría exacta y Cholesky estricta con pivotes positivos, sin pisos que oculten una matriz indefinida.

Las velocidades de un punto material se verifican independientemente: se sigue un punto por rotaciones finitas del frame alrededor del COM, se diferencian sus posiciones y se contrasta `pointVelocity` para cada una de las 16 velocidades base. Se comprueban tanto el COM como un punto desplazado, en todos los cuerpos presentes, incluidos pies y agua. Los probes restauran coordenadas y velocidades, incluidos los ceros con signo.

El soporte gravitatorio Y-only tiene además un oráculo directo: el gradiente central de la energía potencial del objetivo predice la diferencia de torque entre gravedad normal y gravedad cero. Se verifican los pesos de soporte especificados (100% brazos, 85% soporte superior, 65% carga nominal de agua), cada uno de los 16 motores y los motores anulados por desprendimiento. Los 32 casos mantienen igual estado inicial y aíslan ese componente con las plantas en el aire. Los corpus principales siguen usando apoyos físicos normales.

El primer intento de este test nuevo, en suelo, detectó una contribución adicional real: el actuador interno cadera-pie también compensa peso. Se identificó su causa y se aisló el componente Y-only elevando ambos estados iniciales; no se amplió ninguna tolerancia ni se eliminó una aserción.

**Límite explícito:** las masas, inercias y geometría públicas son las entradas del oráculo numérico. Este valida su ensamblado mecánico y derivadas; no certifica por sí solo que una masa declarada o una geometría de asset sea la de diseño. Esa validación corresponde a las suites de assets y pies.

## Cobertura conservada y ampliada

| Suite | Corpus y garantías |
| --- | --- |
| Goal/Y-only | 4 armas × 2 espejos × 2 escalas × 32 ticks; flexión, agua, daño parcial, desprendimiento y colapso en los mismos ticks; excitación adicional de ambos tobillos. Igualdad completa y Float64 bit a bit con caché preparada vs caché invalidada; paneles/sólidos interpolados a 0, .13, .5 y 1. Referencia numérica en ticks 0, 5, 12, 20, 26 y 31. |
| Alias/snapshots | 2 estados de calentamiento × `target===q`/Array × 12 ticks. Alias conservado, tipo Array conservado, signed zero en articulaciones, tobillos y agua, comparación de bits, snapshots retenidos y mutaciones de snapshots sin efecto interno. Los frames de pies y matrices también tienen prueba de propiedad del llamador. |
| Objetivos y cargas | Se mantienen las 5 mutaciones de objetivo, masa/COM/inercia del agua, escala de masa y cuello lateral; matriz/J independientes después de cada una. |
| Soporte Y-only | 4 armas × 2 espejos × 2 escalas × intacto/desprendido = 32 contrastes de gravedad, con predicción numérica de torque. |
| Pasivo | 4 armas × normal/boss × 2 espejos × activo/pasivo × 60 frames = 1.920 comparaciones de estado completas; agua variable, marcha activa, velocidad inicial en ambos tobillos, geometría/sólidos interpolados a 0, .37 y 1. Matriz/J independientes en frames 0, 30 y 59. Motores pasivos cero, motores de raíz cero, reacciones unilaterales no negativas y estado finito. |
| Cabeza | Se conserva sin cambios la prueba que exige cero llamadas a `pose()` durante `resolvePair`. Se conservan los 12 casos de espejo, escala, yaw y daño. La cabeza inicial se compara exactamente con N14 en las mismas 14 coordenadas superiores. Se compara N16 con distinta historia de caché, más matriz/J independientes antes/después. Los contactos finales y eventos de látex deben coincidir con la sección de elipsoides calculada desde posiciones públicas; impulsos positivos/finitos, aproximación positiva, normal y punto medio correctos. Se exige que el corpus produzca eventos de cabeza. |

Las comparaciones Current contra Current acreditan únicamente **invariancia de caché N16**. Los oráculos independientes son las diferencias finitas mecánicas, el gradiente de peso y la geometría de elipsoides. La evidencia histórica N14 queda limitada al fixture inmutable, su dimensión original y la geometría inicial de cabeza con coordenadas compartidas. No se acredita equivalencia histórica de trayectorias, impulsos ni del solver de 1.11 con N16. Ningún test tiene `skip`, `todo` ni tolerancias añadidas para disimular diferencias N14/N16.

## Límites pendientes de revisión Principal

- **Energía:** SPD y gradiente de peso verifican propiedades instantáneas. No demuestran conservación/disipación energética de la integración completa, restitución de contactos ni balance de energía de fragmentos.
- **Topología:** se ejercitan daño parcial y desprendimiento de hombro secundario, con matriz/J de los cuerpos que siguen presentes. No se certifican aquí todas las combinaciones de cortes, conservación de masa/momento al separar fragmentos ni exclusión geométrica de toda parte amputada.
- **CCD:** paneles, sólidos e interpolación se comparan entre historias de caché. Esa comparación no es un oráculo independiente del tiempo del primer impacto, ni prueba ausencia de tunneling a alta velocidad. Los controles elipsoidales validan los contactos de cabeza que se reportan; no certifican que ningún contacto continuo se pierda.

Estas limitaciones requieren revisión Principal e integración con las suites especializadas. El resultado focal no constituye aprobación del cambio físico completo.

## Verificación

Comando: `node --test tests/rig-goal-y-only-exact.test.mjs tests/rig-passive-equivalence.test.mjs tests/head-contact-pose-exact.test.mjs`

Resultado tras precisar los títulos y límites de evidencia: **11/11 aprobados, 0 fallidos, 0 omitidos, 0 TODO**, 9.991 s. La ejecución anterior también pasó (11.004 s) y comprobó nuevamente ambos hashes históricos.

Controles negativos ejecutados en procesos de prueba, sin cambiar archivos runtime: sumar `.01` a `M[14][14]` y sumar `.01 * velocity[14]` a `frontFoot`/`pointVelocity.x`. El oráculo rechazó ambos, respectivamente en `M[14,14]` y `frontFoot/Jx[14]`.
