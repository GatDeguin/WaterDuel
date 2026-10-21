# WaterDuel: separación geométrica de paneles y banderines, v3

Estado: **estable y lista para integrar**. `asset-contract-v3.json` tiene `version:3`, `ready:true` y `stable:true` después de cerrar las comprobaciones y revisar las cinco vistas del GLB final.

La v3 corrige los cruces físicos del plano del fondo y los banderines con vigas, repisas, galería, frente de mesa y suelo. Se trasladaron conjuntos completos: tela, bordados, letras, postes, remates, ojales, marco, papel, dibujo y chinchetas. La cámara y las luces entregadas se conservaron. Los cinco conjuntos se comprobaron contra toda la geometría exportada mediante BVH y SAT de triángulos: **cero cruces externos**. Los contactos internos de bordado y herrajes con su propio soporte se conservan.

## Entrega

- Editable: `output/blender/WaterDuel_Atelier_v3.blend`.
- Runtime: `public/assets/environment/workshop/workshop-runtime-v3.glb`.
- Contrato: `public/assets/environment/workshop/asset-contract-v3.json`.
- SHA-256 del GLB: `1a947c7e2a5b2387e5a0db4cd55169445dad91d2a0fda59bac5c51c0751bb930`.
- 40.556.884 bytes; 355.284 triángulos; 36 grupos; 35 materiales; texturas RGBA8+mips conservadoras132,50MiB.

El editable tiene55.020.583 bytes y SHA-256 `8a693a0c42e75f3f1316ca4f22d687ea3df6ce30c0fbb600991c5803b54544ff`. `output/blender/verification-editable-v3.json` confirma22luces,3cámaras,36meshes y bucle nativo LINEAR/CYCLES de7,2rad/s, con pivote fijo y poses0/90/180/360/450°. Sus cámaras y luces son iguales a v2. El render nativo `WaterDuel_Atelier_v3_duelo.png` y el recibo `preview-editable-v3.json` comprueban que renderizar no cambió el archivo.

La fuente original, el editable v2 y ambos GLB anteriores mantienen sus SHA. Las 68 imágenes PNG embebidas y los 35 materiales son idénticos a v2 por hash/JSON. La comparación confirma UV idénticas por esquina de triángulo y el mismo número de triángulos por nodo. La deduplicación de atributos del exportador redujo185 vértices de atributos, sin reducir triángulos ni cambiar UV. Se conservaron los vértices no seleccionados y el rotor.

## Corrección en la escala de autoría

| Conjunto | Delta fuente X/Y/Z | Motivo |
|---|---|---|
| Plano completo del fondo | 0 / −0,93 / +0,281 m | Delante de la repisa y por encima de follaje y herrajes inferiores |
| Banderín trasero izquierdo | 0 / −2,35 / 0 m | Delante del canto de la galería |
| Banderín trasero derecho | 0 / −2,35 / 0 m | Delante del canto de la galería |
| Banderín frontal izquierdo | 0 / −0,14 / +0,025 m | Delante del frente de mesa y separado del suelo |
| Banderín frontal derecho | 0 / −0,14 / +0,025 m | Delante del frente de mesa y separado del suelo |

El estandarte central y el banderín delantero del taller no cambian. Las pertenencias se determinaron con componentes conectados y proximidad BVH a las superficies de autoría. Una selección por caja y material habría incluido dos remaches ajenos y una ambigüedad; esos falsos positivos están documentados y excluidos del mapa exacto.

## Separaciones del GLB real

| Par | Separación mínima medida, unidades runtime |
|---|---:|
| Plano / arquitectura | 0,029443 m |
| Banderín trasero izquierdo / galería | 0,029015 m |
| Banderín trasero derecho / galería | 0,030027 m |
| Banderín frontal izquierdo / estructura | 0,036320 m |
| Banderín frontal derecho / estructura | 0,032645 m |
| Banderín frontal izquierdo / suelo | 0,008542 m |
| Banderín frontal derecho / suelo | 0,007386 m |

Las selecciones son ordinales de triángulos del GLB final, agrupados en componentes completos y soldados por posición a tolerancia1e−5m. Los intervalos completos separados por eje prueban que las piezas auditadas no se cruzan, con independencia de la cámara. Además, `geometric-reimport-v3.json` comprueba cada conjunto contra todos los otros meshes exportados mediante BVH y SAT, incluido follaje y utilería que no formaban parte de los primeros obstáculos.

## Evidencia

En `public/assets/environment/workshop/`:

- `verification-v3.json`: parser independiente, siete separaciones, cuatro SHA anteriores y rotor.
- `geometry-verification-v3.json`: selecciones y distancias del GLB real.
- `geometry-preservation-v3.json`: UV, conectividad, materiales, vértices no seleccionados, cámaras y luces conservados.
- `material-comparison-v3.json`: comparación binaria de materiales, imágenes, UV y rotor con v2.
- `geometric-reimport-v3.json`: cero cruces externos en los cinco conjuntos corregidos.
- `reimport-verification-v3.json`: GLB reabierto en Blender, texturas decodificadas, volumen activo libre y rotor válido.
- `preview-glb-v3-eevee.png`: frontal, mismo encuadre entregado.
- `preview-glb-v3-oblique.png`: vista general oblicua.
- `preview-board-v3.png`, `preview-apron-left-v3.png`, `preview-apron-right-v3.png`: detalles laterales.

Las cinco imágenes proceden del GLB reimportado. Son QA offline; no acreditan la integración del juego. Los detalles conservan sombras de área y usan contribución de las luces puntuales sin sus sombras para evitar el límite de buffers de Eevee. No se alteró la iluminación de la fuente.

## Integración

La escala y los ejes son los de v2, ya aplicados. El único nodo animable sigue siendo `Workshop_FanRotor`, con el mismo pivote, eje runtime+Z y velocidad7,2rad/s. Su matriz de reposo es `T(pivot)`. Aplicar el giro una sola vez a ese nodo. No hay aspas duplicadas, agua estática, cámaras ni luces exportadas. Principal cambia la ruta del asset; desde esta entrega no se modifica renderer, motor ni física.

## Reproducción

1. Ejecutar `scripts/inspect-workshop-crossings-v3.py` en Blender background para el mapa exacto de fuente/v2, sin guardarlas.
2. Abrir el editable v2 y ejecutar `scripts/export-workshop-runtime-v3.py`. Escribe únicamente v3 y conserva los recursos PBR.
3. Ejecutar `node scripts/build-workshop-clearance-v3.mjs` para derivar selecciones del GLB final.
4. Ejecutar `node scripts/verify-workshop-runtime-v3.mjs`.
5. En Blender vacío ejecutar `scripts/reimport-workshop-runtime-v3.py --preview` y revisar las cinco imágenes.
6. Marcar ready sólo después de comprobar informes, imágenes y hash del binario final.

El cierre reproducible es `node scripts/mark-workshop-v3-ready.mjs --visuals-reviewed`. Para verificar/renderizar la copia editable sin guardarla: `scripts/verify-preview-workshop-editable-v3.py`, abriendo el `.blend` v3 en otro proceso.
