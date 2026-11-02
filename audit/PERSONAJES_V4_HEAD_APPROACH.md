# Acercamiento de globos: diagnóstico N14 frente a N16

2026-11-02. Reproducción sin cambios de producción, tests, protocolo ni umbrales. Evidencia numérica: `PERSONAJES_V4_HEAD_APPROACH.json`.

Se ejecutó exactamente «Dos humanos con armas bajas»: defensa `none` en ambos, modo versus, `start()`, 81 actualizaciones de `.04` y 390 de `STEP`; `mainX=mainY=wrist=-1`; lean/head neutros durante 90 ticks y luego lean=1, headX=+1/-1. N14 usa motor y rig archivados como módulos `data:`, con el import del rig explícitamente redirigido al N14. Otros imports se resuelven bajo `public/`, igual que en la recuperación del corpus legacy. N16 usa los módulos actuales. No se forzaron poses ni coordenadas.

| Medición | N14 archivado | N16 actual |
| --- | ---: | ---: |
| Distancia normalizada mínima | 1.024719334697024 | 1.165962725975689 |
| Tick del mínimo, índice desde cero | 250 | 362 |
| Distancia normalizada final | 1.1185676624281695 | 1.186071138520212 |
| Globos intactos durante todo el protocolo | sí | sí |
| Marcador final | 0–0 | 0–0 |
| Máximo error de apoyo reportado | 1.345e-9 | 8.893e-10 |

Una segunda ejecución reprodujo ambos mínimos exactamente. N14 satisface el guard `<1.15`; N16 mantiene no solapamiento y globos vivos, pero no llega a esa cercanía en los 390 ticks.

## Qué cambia en la postura lograda

Al final los targets de base/pelvis/torso/cuello coinciden entre motores dentro de 4.48e-8. La separación de bases intentada sigue siendo 2.7: `f.baseX=±1.35`. El target de hip/base física es `±1.280664` por el desplazamiento de lean del protocolo original. Las posiciones logradas difieren:

| Coordenada final | Target P1 / P2 | N14 P1 / P2 | N16 P1 / P2 |
| --- | --- | --- | --- |
| q0 baseX | −1.280664 / +1.280664 | −1.275067 / +1.274770 | −1.256775 / +1.263275 |
| q1 baseY | 1.304500 / 1.304500 | 1.282804 / 1.282858 | 1.216238 / 1.217278 |
| q2 pelvis | 0 / 0 | −.090676 / −.088604 | −.013627 / −.027256 |
| q3 torso relativo | −.515340 / −.494942 | −.433543 / −.418708 | −.440379 / −.439649 |
| q12 cuello relativo | −.277640 / −.322173 | −.336406 / −.386394 | −.397222 / −.400000 |

La inclinación absoluta del torso depende de `q2+q3`. N16 logra un q3 más inclinado, pero pierde el giro adicional de pelvis de N14; el cuello llega al stop en P2 y en ambos durante el mínimo N16. Descomponiendo la X de cabeza con los mismos largos de torso/cuello, el cambio N16 respecto a N14 al final es:

- Base: **+2.979 cm** de aproximación conjunta, favorable.
- Alcance horizontal de torso/hombros: **−7.374 cm** conjunto.
- Alcance horizontal de cuello: **−1.301 cm** conjunto.

El saldo es **5.696 cm más de separación horizontal**: `.944048 m` en N14 frente a `1.001010 m` en N16. La pérdida final no viene de que el nuevo motor deje la base más atrás; viene de la postura angular alcanzada, sobre todo pelvis más erguida.

También hay una demora transitoria importante. En tick250 ambos piden q0≈±1.28055, pero N14 ya logra ≈±1.2843 y N16 todavía ≈±1.5596. N14 pasa su mínimo con pelvis≈−.1446; N16 aproxima sus bases después y alcanza el mínimo en tick362. Los controles son idénticos; los targets no lo son durante todo el transitorio: por feedback del sistema, el máximo delta de targets es `.00508` en q0, `.02820` en q3 y `.00412` en q12. No debe describirse la trayectoria completa como un ensayo de targets perfectamente iguales.

## Diferencia física respaldada por las fuentes

El rig N14 archivado, línea797, usa `K=[500,1800,...]`: sus motores actúan directamente sobre las coordenadas libres baseX/baseY. Al final `motorTorque[0:2]` es `[-.634,40.156]` para P1 y `[+.661,40.260]` para P2. El apoyo anterior fijaba el punto de pie tanto en X como en Y mediante restricciones bilaterales (`#contactRows`, línea544). En su mínimo, la reacción Y trasera registrada es aproximadamente `−13.33/−13.47`, compatible con ese apoyo bilateral.

N16, línea853, usa `K=[0,0,...]`. El actuador de posición de pelvis se expresa como fuerza interna hip-to-foot y sólo suma sobre coordenadas `i>=2` (líneas905–920): los motores de base son **exactamente cero durante los 390 ticks**. El peso y la propulsión pasan por los contactos físicos. Las normales unilaterales de los hulls son positivas en el mínimo: `28.52/27.81` para P1, `28.67/27.80` para P2. N16 añade además `.24` de masa total por actor y los grados de libertad de tobillo. La masa total medida cambia de `6.27642` a `6.51642`.

La vía anterior de soporte mundial directo y anclaje XY no es físicamente equivalente a la cadena interna con pie articulado y contacto unilateral. El cambio de postura y de velocidad de aproximación observado concuerda con esa diferencia. Este diagnóstico no aísla un único coeficiente como causa exclusiva: motor, masa, tobillos y restricciones cambiaron conjuntamente. Las métricas de reacción tampoco son el mismo acumulador: N14 publica el primer solve de igualdad; N16 acumula reacciones de las proyecciones. No deben compararse como balances estáticos exactos.

Los contactos rivales registrados en los mínimos/final son acero arma–arma, no cabeza–cabeza; no hay evidencia de que un globo bloquee prematuramente el acercamiento. En tick250 N16 aún no tiene ese contacto. El JSON conserva los contactos y coordenadas en ticks emparejados250 y362, no sólo en mínimos de tiempos distintos.

Los SHA-256 de motor, rig y test se guardan en el JSON y permanecieron iguales antes/después de la medición. Los pins del corpus legacy y del test de render se preservaron. No se modificaron `minSeparation=2.7`, el deadline, los umbrales ni la receta del test.
