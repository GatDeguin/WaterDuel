# Escenografía WaterDuel — entrega GLB para runtime

Fecha: 17-10-2026. Estado: **GLB estable para integrar; parseo, reimportación y preview revisados**. Este documento acompaña la versión del taller derivada de las referencias `docs/referencias/w1.png` a `w4.png`. La integración en el renderer y el ajuste de la cámara pertenecen a Principal.

## Fuente preservada y alcance

La fuente editable es `output/blender/WaterDuel_Atelier.blend`. SHA-256 comprobado antes de preparar la exportación: `2e92513be1f17a2e2d5cc357dddc8cd8d0e1dd62abbde226f4ec09c3a717b755`. El exportador debe abrirla en un proceso Blender propio con `--background`, trabajar sobre copias evaluadas y conservar ese archivo sin volver a guardarlo.

El manifiesto de autoría `output/blender/scene_manifest.json` registra 1.330.576 triángulos evaluados, 36 materiales, 22 luces y tres cámaras. Son métricas de la fuente Cycles, **no del GLB ni del juego**. La exportación debe retener arquitectura, mesa, ventanas, lámparas y utilería del taller; excluir la colección `05 | Water / puddles, droplets and rings`, referencias ocultas, cámaras, guías y geometría de presentación. El agua del combate la produce el runtime. Las luces se documentan para reconstrucción en el renderer; no se da por supuesto soporte de luces Blender en GLB.

## Rutas previstas

| Función | Ruta |
|---|---|
| Fuente editable preservada | `output/blender/WaterDuel_Atelier.blend` |
| Exportador reproducible | `scripts/export-workshop-runtime.py` |
| Namespace exclusivo de entrega | `public/assets/environment/workshop/` |
| GLB autocontenido | `public/assets/environment/workshop/workshop-runtime.glb` |
| Contrato y recibo | `public/assets/environment/workshop/asset-contract.json`, `export-receipt.json` |
| Validación independiente del binario | `public/assets/environment/workshop/verification.json` |
| Reimportación de GLB | `public/assets/environment/workshop/reimport-verification.json` |
| Preview real del GLB en Eevee | `public/assets/environment/workshop/preview-glb-eevee.png` |
| Caché de bakes completos, fuera de public | `output/blender/runtime-bake-cache/` |

No se modifican archivos del motor, renderer, personajes, equipamiento ni releases congelados desde la exportación del escenario.

## Ejes, escala y anclaje

En Blender, X recorre horizontalmente la tarima, +Y apunta al fondo del taller y +Z apunta arriba. El origen de autoría está en el centro horizontal de la mesa a nivel del suelo del taller. En glTF/runtime, +Y apunta arriba, +Z apunta al frente y +X conserva el sentido del duelo.

La escala uniforme autorizada ajusta el ancho de las tablas, 11,76 m, a 7,60 unidades de mundo:

```text
s = 7.6 / 11.76 = 95 / 147 = 0.6462585034013605
tY = TABLE_TOP - 1.15 * s
   = 0.3245 - 1.15 * s = -0.4186972789115646

world.x =  s * source.x
world.y =  s * source.z + tY
world.z = -s * source.y
```

Matriz afín source→world, escrita por filas:

```text
| s  0  0   0  |
| 0  0  s   tY |
| 0 -s  0   0  |
| 0  0  0   1  |
```

Así, el centro nominal de superficie source `(0,0,1.15)` queda en world `(0,0.3245,0)`; los extremos source X ±5,88 quedan en world X ±3,80. Los tableros tienen una variación de altura artística pequeña, por lo que el anclaje es nominal. El faldón y las molduras sobresalen del ancho de tablas: **7,60 no es el ancho total del GLB**.

Con `export_yup=True`, Blender ya convierte `(x,y,z)` en `(x,z,-y)`. Sobre la copia Blender se aplica solamente escala `s` y desplazamiento vertical Blender `Z=tY`; no se vuelve a girar el modelo manualmente. Las transformaciones de objetos fuente deben evaluarse antes de consolidar. `export_apply=True` aplica modificadores en el exportador 5.2, pero por sí solo no congela la matriz del objeto. Para una entrega aplicada se transforma la geometría o se ejecuta `transform_apply` sobre las copias, y se comprueban matrices del GLB. Si el archivo final conserva una transformación de raíz, el contrato debe declararla y el cargador respetarla exactamente una vez.

Referencia espacial conservadora proveniente del manifiesto de autoría:

| Zona | Blender fuente | World derivado |
|---|---|---|
| Tablas, horizontal | X ±5,88 | X ±3,80 |
| Mesa, profundidad nominal | Y ±2,60 | Z ±1,680272109 |
| Volumen libre documentado, horizontal | X ±4,80 | X ±3,102040816 |
| Volumen libre documentado, profundidad | Y ±1,80 | Z ±1,163265306 |
| Volumen libre documentado, altura | Z 1,15 a 5,15 | Y 0,3245 a 2,909534014 |

El renderer inspeccionado usa `TABLE_TOP=.3245` en `public/physics/dimensions.js` y un dominio de agua X ±3,7 y Z ±1,31. La reimportación final midió el archivo GLB real, no sólo el volumen conservador de autoría: cero triángulos intersectan X ±3,7, Z ±1,31 y altura Y de 0,36 a 3,50. Se comprobó con descarte por AABB y prueba de ejes separadores de triángulo/caja. La altura nominal de mesa es 0,3245; su máximo medido es 0,3244612217, por la variación artesanal de las tablas. La geometría decorativa nunca se convierte automáticamente en colisión.

## Materiales y formato

El formato previsto es GLB 2.0 autocontenido, con triángulos indexados y materiales metallic-roughness. Se requieren posiciones, normales y UV0 para texturas; tangentes si se emplean normales tangenciales. Las imágenes se guardan como PNG/JPEG embebidos en bufferViews. No se requieren Draco, Meshopt, KTX2, descargas ni decodificadores adicionales.

Los nodos procedurales de madera, metal y pared en la fuente no equivalen a texturas exportables. La copia runtime debe convertir su apariencia a mapas locales de base color, normal y roughness, o combinar color por vértice con mapas locales. Si se usa `COLOR_0`, el contrato y el cargador deben multiplicarlo por el factor/material de base color; la presencia del atributo por sí sola no prueba que se dibuje. Base color y emisivo se interpretan en sRGB; normal y metallic-roughness se interpretan como datos lineales. En la textura metallic-roughness glTF, G es roughness y B es metallic. Una normal tangencial debe reconstruirse con UV/tangentes y orientación coherente.

La iluminación fría de ventanas y cálida de lámparas requiere reconstrucción de luces del juego. Los albedos exportados no contienen sombras ni destellos horneados. Las superficies emisivas conservan la apariencia de luminarias, pero no iluminan el entorno por sí mismas en un renderer rasterizado. `asset-contract.json` contiene posiciones, colores e intensidades orientativas de las luces; no se exportan luces, cámaras, fog, agua ni animaciones.

En la lectura de `public/render3d.js` y `public/rendering/` realizada para este contrato aún no existía un cargador GLB con texturas PBR. Principal implementará esa integración. El contrato de assets no certifica soporte actual de extensiones ni calidad de render. Toda extensión `KHR_*` exportada debe registrarse y tener soporte comprobado o factor de reserva suficiente.

## Presupuesto y verificación de entrega

Objetivo autorizado: **≤60 primitivas/grupos dibujables y ≤500.000 triángulos**, medidos sobre la escena instanciada del GLB final. Consolidar o reutilizar materiales para reducir grupos; varias mallas con el mismo material todavía pueden producir varios dibujos. Unir por material no reduce triángulos. La simplificación debe priorizar superficies curvas densas, elementos repetidos y detalles pequeños, conservando las siluetas de ventanas, taller y tarima.

Checklist antes de declarar estable:

- [x] Exportar desde la fuente preservada y comparar de nuevo su hash.
- [x] Excluir agua estática, gotas, anillos, referencias, cámaras y guías; conservar geometría útil de objetos curve/font mediante evaluación.
- [x] Comprobar que los modificadores y transformaciones fuente están evaluados y que posiciones, normales y UV son finitos.
- [x] Revisar las UV tras consolidar y simplificar, evitando pérdida de veta, juntas y variación de materiales.
- [x] Contar triángulos de las primitivas realmente instanciadas, primitivas dibujables, materiales, imágenes, vértices, bytes y dimensiones de texturas del GLB final.
- [x] Comprobar que todas las imágenes y buffers están embebidos; registrar extensiones y ausencia de dependencia de red.
- [x] Reimportar el GLB final en una escena Blender temporal; comparar bounds, conteos, textura, altura de mesa y sentido de ejes.
- [x] Comprobar el campo central completo del juego y documentar obstáculos por coordenadas reales del exportado.
- [x] Inspeccionar un preview offline Eevee del archivo GLB reimportado a 1280×720, antes y después de optimizar mapas.
- [x] Registrar recibo y contrato con métricas reales, hashes, modo de materiales y transformaciones aplicadas.
- [ ] Validar en el cargador runtime y medir dibujos/triángulos por frame cuando Principal integre. Los contadores de assets no incluyen pasadas de sombras, reflejos, agua ni postproceso.

## Métricas finales

| Dato medido en el GLB final | Resultado |
|---|---:|
| Triángulos instanciados | 355.284 / límite 500.000 |
| Grupos dibujables y materiales | 35 / límite 60 |
| Vértices de atributos | 361.137 |
| Tamaño | 40.334.028 bytes = 38,47 MiB |
| Imágenes embebidas usadas | 59 |
| Objetos texture usados | 60; una imagen compartida |
| Extensiones usadas / requeridas | ninguna / ninguna |
| RGBA8 + mipmaps por imágenes únicas | 120,17 MiB teóricos |
| RGBA8 + mipmaps por objetos texture, conservador | 125,50 MiB teóricos |
| Reimportación | pasa; error de bounds 0 |
| Intersecciones con volumen de combate | 0 |

SHA-256 final: `1eb31ceef5913e3cce87cdc4397b5223ad678028957933de78e9b930c950c66d`.

Bounds world Y arriba: mínimo `[-7.7542600632, -0.9033911228, -10.0170078278]`, máximo `[7.7542600632, 6.8840241432, 6.1385474205]`. Incluyen el suelo del taller y toda su arquitectura; no confundirlos con la extensión jugable de la tarima.

Se conservó la geometría de la primera exportación. Su GLB de 121.191.036 bytes se redujo reutilizando los bakes, sin rehacer ni reducir de nuevo la malla: albedo hasta 1024 para madera, pared, latón y ventanas; otros albedos 512/256; normales 512/256 y metallic-roughness 512/256/128. Los canales constantes de color/rugosidad usan factores PBR equivalentes, y las normales se renormalizan después del resize. Los bakes originales 2048/1024/512 permanecen en la caché de autoría. En `public/.../textures/` sólo quedan los PNG optimizados opcionales; el GLB no depende de ellos porque ya los contiene.

Para conservar los procedurales al unir por material se almacenaron las coordenadas Generated/Object de cada pieza en atributos de trabajo. Los nodos de la copia horneada leen esos atributos; así la madera no cambia de orientación al consolidar. La simplificación reduce sobre todo letras y telas muy subdivididas, además de superficies pequeñas. El GLB contiene sólo atributos estándar de render, no esos atributos auxiliares.

Reproducir: abrir la fuente con Blender en background y ejecutar `scripts/export-workshop-runtime.py`. El checkpoint `output/blender/WaterDuel_Runtime_Working.blend` permite reusar geometría/UV ya preparadas. Ejecutar después `node scripts/verify-workshop-glb.mjs` y `blender -b --factory-startup --python scripts/reimport-workshop-runtime.py -- --preview`. El preview usa Eevee y no ejecuta el juego ni repite los renders Cycles de la fuente. No se instalaron herramientas o decodificadores ni se descargaron recursos. La exportación emplea el exportador glTF incluido en Blender; simplificación, consolidación y packaging se realizan localmente.
