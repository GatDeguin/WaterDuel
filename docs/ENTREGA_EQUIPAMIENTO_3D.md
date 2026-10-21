# Entrega a Principal · Arsenal detallado del taller

Siete modelos originales de equipamiento, creados para WaterDuel a partir del vocabulario artesanal de W1–W4. Los modelos están preparados para su integración; esta entrega de GLB no implica que el renderizador del juego ya los cargue.

## Archivos

Todos los GLB están en `public/assets/equipment/workshop/` y son autocontenidos: materiales PBR, texturas de color y normales embebidas, sin enlaces a servicios o bibliotecas externas.

| Archivo | Pieza | Detalle de construcción | Triángulos |
| --- | --- | --- | ---: |
| `sword.glb` | Estoque del taller | Hoja diamantada fina, cazoleta hueca torneada, arco protector, cuero enrollado y costura, pomo y virolas. | 12 566 |
| `spear.glb` | Aguja de presión | Punta foliada facetada, asta de madera, casquillos y pasadores de latón, agarre de cuero. | 10 190 |
| `axe.glb` | Hacha del carpintero | Cabezal forjado, filo biselado, ojo y cuña de bloqueo, mango y herrajes. | 9 270 |
| `maul.glb` | Mazo de bancada | Bloque de madera laminada, zapatas de acero, abrazaderas y tornillos, emblema del taller, dos empuñaduras. | 17 308 |
| `short.glb` | Broquel de latón | Cuenco de acero, umbo, anillos y remaches, duelas y refuerzos traseros, mango de cuero. | 19 932 |
| `long.glb` | Escudo de duelas | Siete duelas curvadas, borde de latón, tornillos, blasón hidráulico, travesaños, mango y correa posterior. | 23 380 |
| `knife.glb` | Daga de parada | Hoja diamantada, guarda con anillo, empuñadura y espiral de cuero, virolas y pomo. Solo secundaria. | 6 790 |

**Sin escudo** es ausencia de modelo y de bloqueo: no se entrega una malla vacía ni un escudo invisible.

La fuente editable está en `docs/assets/equipment/workshop-arsenal.blend`. Conserva las piezas de construcción separadas y nombradas; sus raíces se distribuyen en un tablero de presentación. El exportador genera cada GLB antes de aplicar esas traslaciones de presentación, evalúa los biseles y consolida las mallas y los materiales. Las imágenes de textura de 512×512 también están en `docs/assets/equipment/textures/` y empacadas en Blender.

## Contrato de integración

`public/assets/equipment/workshop/asset-contract.json` incluye dimensiones, triángulos, materiales, SHA-256 y todos los sockets. Las unidades son metros. En GLB el eje longitudinal es **+Y**, el ancho es **X** y el frente del escudo es **+Z**. El origen es el centro real del agarre, con raíz identidad.

- Armas: unir `Socket_Grip_Main` al `Socket_MainHand` del personaje y alinear **+Y** con la dirección real `tip - mainHand` del motor.
- Defensas y daga: unir `Socket_Grip_Secondary` a `Socket_SecondaryHand`. Orientar el escudo con su frente **+Z** hacia el plano de presentación. Para la daga, alinear **+Y** con `defenseTip - offHand`.
- Mazo: además del agarre principal, `Socket_Grip_Secondary` está en **(0, −0.22, 0)** local GLB. Exige ambas manos y excluye escudos y daga.
- `Socket_Strike` marca el alcance nominal de reposo: espada 1.02, lanza 1.35, hacha 0.92, mazo 1.08 y daga 0.42. La daga conserva el comportamiento de parada secundaria.
- Ocultar los nodos `Preview_Rapier_*` del personaje antes de adjuntar un arma. Su contrato está en `public/assets/characters/water-mannequin/rig-contract.json`.

Las geometrías decorativas no crean colisión automáticamente. `public/equipment.js` y el rig mantienen la autoridad sobre alcance, volumen de defensa, muestras de filo/cabezal, energía y resultado. El origen, los sockets y el perfil principal de hacha/mazo están alineados con el equipo procedural; los biseles, tornillos y ornamentos no deben ampliar la zona de impacto.

El motor actual es WebGL propio. Principal debe conectar su cargador GLB y materiales PBR o adaptar las mallas a su formato de geometría, manteniendo los controladores, colisiones y agarres existentes. Los modelos son rígidos, sin animaciones incorporadas: se mueven mediante sus sockets y el rig. Se conserva el equipo procedural como alternativa de menor coste. No se añadió dependencia de Draco o Meshopt.

## Reproducir y verificar

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/create-workshop-equipment.py
node scripts/validate-workshop-equipment.mjs
node scripts/validate-workshop-equipment.mjs --self-test
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/inspect-workshop-roundtrip.py
```

El validador independiente revisa GLB, buffers, índices, normales, transformaciones, presupuestos, texturas y sockets, además de contrastar el manifiesto con los bytes exportados. El script de roundtrip reimporta los archivos entregados, compara geometría y dimensiones y genera `workshop-arsenal-glb-preview.png` desde esos GLB. Los renders de inspección muestran los modelos bajo iluminación de estudio; no son capturas de integración en el juego.

La evidencia está en `validation.json`, `roundtrip-validation.json`, `audit/BLENDER_EQUIPMENT_BUILD.txt` y las imágenes de `previews/`.
