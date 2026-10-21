# Entrega a Principal · Materiales del arsenal v2

Los siete modelos detallados del taller reciben una revisión de materiales inspirada en W1–W4: madera clara trabajada, cuero de agarre, latón y acero. La v2 está lista para que Principal cambie la ruta de carga a `public/assets/equipment/workshop/v2/`. Su integración y la comprobación visual dentro del juego corresponden al runtime de Principal.

## Piezas y reglas

| GLB | Pieza | Uso |
| --- | --- | --- |
| `sword.glb` | Estoque del taller: hoja diamantada, cazoleta, arco protector y empuñadura cosida. | Principal |
| `spear.glb` | Aguja de presión: punta facetada, asta y casquillos. | Principal |
| `axe.glb` | Hacha del carpintero: filo biselado, ojo, cuña y mango. | Principal |
| `maul.glb` | Mazo de bancada: bloque laminado, zapatas, abrazaderas y dos agarres. | Dos manos; excluye defensa secundaria |
| `short.glb` | Broquel: cuenco de acero, umbo, anillos, remaches y reverso de madera. | Secundaria |
| `long.glb` | Escudo de duelas: siete tablas curvadas, herrajes, blasón, mango y correa. | Secundaria |
| `knife.glb` | Daga de parada: hoja, guarda con anillo, cuero y pomo. | Exclusivamente secundaria |

«Sin escudo» conserva la ausencia de modelo y de bloqueo. Cada GLB es autocontenido y conserva los sockets, dimensiones, ejes, nombres, índices, UV y geometría de v1. El contrato de integración está en `public/assets/equipment/workshop/v2/asset-contract.json`. La v1 y sus fuentes siguen congeladas.

## Materiales

La madera tiene veta longitudinal, pequeñas diferencias de brillo y rozaduras leves. El cuero combina poro fino con brillo de manipulación. El acero tiene líneas de trabajo finas y variación gris discreta; el latón presenta desgaste y pátina tenue. El esmalte conserva su lectura oscura. La revisión mantiene la silueta y los biseles originales.

Se entregan 15 PNG únicos de 512×512, RGB8, con bordes periódicos: color, normales tangentes y mapas ORM compartidos por familia. ORM usa R=1, G=rugosidad y B=metal. La rugosidad final es `G × roughnessFactor`; cada factor conserva la base específica del material v1. La metalicidad final es `B × metallicFactor`. Las normales usan escala 0.35–0.45. No se añadieron desplazamiento, sombras horneadas ni extensiones de decodificación.

## Fuentes y evidencia

- Fuente editable v2: `docs/assets/equipment/v2/workshop-arsenal-materials-v2.blend`, con las texturas empacadas. Importa las mallas exactas entregadas; no reexporta geometría.
- Texturas y parámetros: `docs/assets/equipment/v2/textures/` y `docs/assets/equipment/v2/texture-manifest.json`.
- Comparación binaria: `v2/material-revision.json` y `v2/validation.json`.
- Reimportación Blender: `v2/roundtrip-validation.json`.
- Presupuesto compartido: `v2/texture-budget.json`.
- Integridad de entrega: `v2/delivery-sha256.json`.
- Lámina: `v2/workshop-materials-v2-preview.png`; detalles en `v2/previews/`.

La validación independiente pasó **7/7 modelos**, con **17/17 casos del propio validador**. Conserva los bytes y descriptores de **267 vistas de geometría/IBM**. La prueba usa el parser y las funciones de retarget actuales del juego: compara **492 660 vértices en 42 poses**, con diferencia de posición v1/v2 igual a cero. Los sockets quedan dentro de 1.2×10⁻⁷ m. Blender reimportó los siete GLB con el mismo número de triángulos y diferencia de dimensiones cero. Total del arsenal: **99 436 triángulos**.

Los renders son inspecciones bajo iluminación de estudio. El tablero y los rótulos pertenecen a la presentación de Blender; los GLB contienen solamente las piezas y sus sockets.

## Presupuesto

Los GLB suman **16 759 996 bytes**. Cada archivo crece menos de **0.09 %** respecto de v1: el empaquetador reutiliza los huecos de imágenes anteriores y elimina sus copias obsoletas, sin mover los datos de geometría. Los 15 PNG únicos suman **1 373 962 bytes** comprimidos.

| Pieza | Texturas RGBA8 base | Estimación con mipmaps |
| --- | ---: | ---: |
| Espada | 9 MiB | 12 MiB |
| Lanza, hacha, broquel, daga, cada una | 12 MiB | 16 MiB |
| Mazo y escudo largo, cada uno | 15 MiB | 20 MiB |

Esas filas cuentan cada archivo aislado. Los siete juntos, sin compartir imágenes, sumarían 87 MiB base y aproximadamente 116 MiB con mipmaps. La caché actual `SharedTextures` comparte imágenes idénticas por bytes, MIME, sampler e interpretación color/datos. El inspector del conjunto verifica esas identidades con el módulo real: el conjunto compartido requiere **15 MiB base y aproximadamente 20 MiB con mipmaps**. Es una estimación de asignaciones de textura; no mide memoria total del proceso ni incluye buffers geométricos o costes del controlador.

## Contactos para Audio y FX

`docs/assets/equipment/contact-materials-v1.json` y `docs/CONTACTO_MATERIALES_ITEMS.md` documentan las superficies reales de los siete modelos. El mapa también aplica a v2 porque la geometría y la identidad de materiales se conservan. Incluye la inversión de la deformación longitudinal actual para recuperar la posición de reposo del contacto.

El asta de lanza y los mangos son madera; la cabeza del mazo mezcla madera, acero y latón; la cara del escudo largo es madera. `weapon` o `weapon-head` no identifican metal por sí solos. Los rangos son aproximaciones de superficies expuestas, no una clasificación exacta por triángulo. Audio y Principal ya recibieron este contrato.

## Reproducción

Ejecutar desde la raíz del proyecto, con Blender 5.2 disponible:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/generate-equipment-textures-v2.py
node scripts/create-equipment-materials-v2.mjs
node scripts/validate-equipment-materials-v2.mjs --self-test
node scripts/validate-equipment-materials-v2.mjs
node scripts/inspect-equipment-texture-budget-v2.mjs
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/inspect-equipment-materials-v2.py
node scripts/seal-equipment-delivery-v2.mjs
node scripts/seal-equipment-delivery-v2.mjs --verify
```

La fuente v1 detallada sigue en `docs/assets/equipment/workshop-arsenal.blend`; su construcción se describe en `docs/ENTREGA_EQUIPAMIENTO_3D.md`. La revisión v2 se genera por separado y no requiere regenerar v1.
