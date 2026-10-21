# Materiales de contacto del arsenal v1 · Audio y FX

Contrato derivado de los **siete GLB reales congelados** de `public/assets/equipment/workshop/`. Se decodificaron sus buffers `POSITION`, se aplicaron las matrices de nodos y se recalculó la AABB de cada primitiva de material. El resultado reproducible está en [contact-materials-v1.json](assets/equipment/contact-materials-v1.json). No se modificó ningún GLB, contrato v1 ni archivo del runtime.

Las bandas siguientes son **aproximaciones de superficie expuesta**, no materiales por triángulo. Una primitiva está consolidada por material: su AABB puede abarcar varios anillos separados, huecos y piezas ocultas. La presencia de latón en esa AABB no convierte toda esa zona en latón.

## Regla mínima para el runtime

1. Conservar un material explícito ya resuelto por el contacto. En particular, `main-palm` y `off-palm` con `material:'wood'` son madera del personaje, aunque su cuerpo padre sea `weapon`. Quedan fuera de este contrato de ítems.
2. Resolver **id de equipo + key de proxy + along de reposo**. `weapon` no significa metal. `weapon-head` es la cabeza ancha de hacha/mazo, pero tampoco identifica por sí solo una cara, una abrazadera o una cuña.
3. Si falta posición, usar el fallback de la tabla. Si el resultado es mixto, conservarlo como mixto. Los nombres de zonas de este documento no añaden colliders ni eventos.

| Equipo | Proxy / fallback sin posición | Bandas aproximadas desde la mano, en metros de reposo |
|---|---|---|
| Espada | `weapon` → acero | Agarre cuero −.118–.108; guarda/cazoleta latón .108–.20; hoja acero .20–1.02. La hoja real empieza en .185 y se solapa con el collar. |
| Lanza | `weapon` → madera | Asta .128–.933; socket/virolas mixtos acero–latón–madera .933–1.082; punta acero 1.082–1.35. Banda pequeña de latón .381–.413 sobre el asta. |
| Hacha | `weapon` → madera; `weapon-head` → acero | Mango .118–.56; cabeza/ojo mixtos .56–.814; cabeza superior acero .814–.92. El filo siempre es acero; el ojo tiene retenes de latón y una pequeña cuña de madera .817–.843. |
| Mazo | `weapon` → madera; `weapon-head` → mixto madera–metal | Mango .095–.658; cuello mixto latón/madera .658–.733; bloque y herrajes mixtos .733–1.015; placa frontal de golpe acero 1.015–1.08. **La cabeza completa no es acero.** |
| Broquel | Guardia frontal → metal mixto | Cuenco/umbo de acero con anillos y remaches de latón; borde de latón, radio aprox .208–.23. Reverso de madera y agarre de cuero. |
| Escudo largo | Guardia frontal → madera | Cara principal de siete duelas; borde, herrajes y placa central de latón. Reverso con travesaños de latón, agarre/correa de cuero. Para detectar borde se necesita ubicación local respecto del contorno; las esquinas de su AABB no son escudo. |
| Daga secundaria | Parada → acero | Agarre cuero alrededor de 0; guarda/anillo/collar de latón aprox .074–.125; hoja acero .125–.42. Hoja real desde .11; los pequeños pines/inlay no cambian el fallback de la hoja. No es un ataque primario independiente. |

En el mazo, una ubicación sobre la placa frontal o una zapata lateral conocida permite elegir acero. Una ubicación sobre una abrazadera conocida permite elegir latón. Un contacto en el bloque expuesto puede ser madera. Sólo `weapon-head + along` no permite separar esas tres superficies: usar `wood_metal_mixed` con cuerpo de golpe de madera y, si corresponde, un acento metálico breve.

## Along de reposo y alcance de la pose

Los GLB usan metros, agarre en origen, **+Y longitudinal, +X transversal y +Z frontal**. Para armas, proyectar el contacto sobre `normalize(tip-mainHand)`; para la daga usar `defenseTip-offHand`. Sean `d` la distancia proyectada y `L` el alcance observado. `alphaPosed=d/L` sirve como coordenada de la pose, pero **no se compara directamente** con los límites normalizados de reposo del JSON.

El código actual de [asset-rig.js](../public/rendering/asset-rig.js) conserva el agarre y las cabezas; extiende solamente una banda longitudinal:

```text
R = alcance de reposo; E = L - R
F(s) = s + E * clamp((s-a)/(b-a), 0, 1)

Inversa para recuperar s, coordenada en el GLB de reposo:
  d <= a       : s = d
  d >= b + E   : s = d - E
  en otro caso : s = a + (d-a) / (1 + E/(b-a))

alphaRest = s/R
```

| Equipo | R | Banda de deformación `[a,b]` |
|---|---:|---:|
| Espada | 1.02 | [.18, 1.02] |
| Lanza | 1.35 | [.15, 1.00] |
| Hacha | .92 | [.18, .56] |
| Mazo | 1.08 | [.18, .725] |
| Daga | .42 | [.09, .42] |

Ejemplo: con mazo de alcance observado 1.48, la base de cabeza de reposo `.725` se traslada a `1.125` desde la mano: `alphaPosed≈.760`, frente a `alphaRest≈.671`. Tratar ambos como iguales clasificaría parte del mango extendido como cabeza. Estas bandas corresponden al código leído; si Principal cambia la deformación debe actualizar esta conversión.

Para escudos, invertir primero la escala X/Y de guardia alrededor de `offHand`; la profundidad GLB Z no recibe esa escala. El broquel tiene madera trasera en Z≈.035–.060 y cuenco de acero en Z≈.050–.125, con solapamiento. Hace falta saber el lado de contacto para distinguir cara y reverso. La daga y los escudos no tienen un `weapon-head` universal en los eventos actuales: usar el id de defensa y el contexto conocido de parada/cara/borde/reverso.

## Prioridad de familias para Audio y FX

- Metal expuesto contra metal expuesto: familia de impacto metálico; acero y latón pueden compartir base con variación de timbre. El material por sí solo no ordena generar chispas.
- Madera contra madera: golpe seco/madera.
- Madera contra metal, o cabeza mixta sin cara conocida: cuerpo de golpe seco y posible acento metálico breve; evitar convertir toda superposición en un clang sostenido.
- Cuero o tela identificados en la superficie real: amortiguación y roce. Los siete GLB v1 **no contienen primitivas de tela**; cuero no es prueba de tela.
- Esmalte fino, líneas grabadas y tornillos pequeños: prevalece el sustrato o superficie estructural expuesta; no generan impactos extra por decoración.

La intensidad, duración, polvo, agua y efectos visuales siguen dependiendo del evento físico y su impulso/velocidad. Este contrato no implementa audio, no duplica eventos de contacto y no cambia la autoridad de perforación del látex.

## Evidencia y reproducción

`node scripts/inspect-equipment-contact-materials.mjs` sólo escribe el JSON derivado. Guarda SHA-256 de cada GLB, dimensiones reales, sockets, parámetros PBR y AABB de sus 56 primitivas de material: espada 6, lanza 7, hacha 8, mazo 10, broquel 9, largo 9 y daga 7. Las dimensiones completas incluyen pomo y guarda: no deben confundirse con el alcance mano–punta.

Los hashes de los siete GLB coinciden con `public/assets/equipment/workshop/delivery-sha256.json`. El JSON separa medidas efectivas de las bandas semánticas aproximadas para que Audio/FX pueda revisar el criterio sin atribuir precisión inexistente al proxy físico.
