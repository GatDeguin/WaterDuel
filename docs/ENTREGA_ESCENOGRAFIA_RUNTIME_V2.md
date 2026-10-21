# WaterDuel: taller usado y ventilador animable, v2

La revisión conserva el taller de w1–w4 y añade desgaste localizado por material. Las cinco aspas del ventilador forman un único nodo móvil. La jaula, el emblema, el motor y el pedestal siguen estáticos. Los archivos v1 y la fuente original se conservan con sus hashes.

Estado: **lista para integrar**, con `ready:true` y `stable:true`. Parseo independiente, transformaciones CPU, reimportación Blender y tres previews reales del GLB aprobados. La copia editable también se renderizó en Cycles sin modificar su archivo.

El GLB mide **40.565.764 bytes (38,69 MiB)**, con **355.284 triángulos, 36 grupos y 35 materiales**. Contiene 68 imágenes embebidas y 69 objetos de textura: estimación RGBA8+mipmaps de **127,17 MiB** por imagen única o **132,50 MiB** por objeto de textura. SHA-256: `cec471597e48f5df50d23a2b7c894d01c44bce4402c607d6b001e7dd8d8d99b5`.

El rotor tiene 500 triángulos, 260 posiciones únicas y 577 vértices de atributos. Radio medido 0,6798706 m. Cero triángulos y cero posiciones del rotor duplicados en los 35 grupos estáticos. Giros 0°/90°/180°/360° mantienen pivote, radio y profundidad. El máximo Y de la mesa es 0,3244612217 frente a 0,3245 nominal; el volumen de combate está libre.

## Archivos

- `public/assets/environment/workshop/workshop-runtime-v2.glb`: malla runtime con PBR y PNG embebidos.
- `public/assets/environment/workshop/asset-contract-v2.json`: coordenadas, pivote, eje, velocidad y presupuestos.
- `public/assets/environment/workshop/export-receipt-v2.json`: SHA y métricas del binario.
- `public/assets/environment/workshop/verification-v2.json`: parseo independiente, lector runtime y rotaciones CPU.
- `public/assets/environment/workshop/reimport-verification-v2.json`: importación Blender y área de combate.
- `public/assets/environment/workshop/preview-glb-v2-eevee.png`: GLB reimportado, iluminación offline de QA.
- `public/assets/environment/workshop/preview-fan-v2-000.png` y `preview-fan-v2-090.png`: poses con cámara fija.
- `output/blender/WaterDuel_Atelier_v2.blend`: copia editable de la geometría optimizada, texturas empaquetadas, cámaras, luces y bucle del rotor.
- `output/blender/WaterDuel_Atelier_v2_duelo.png`: render Cycles CPU de la copia editable, 960×540, 24 muestras y denoise.
- `output/blender/verification-editable-v2.json` y `preview-editable-v2.json`: bucle, luces/cámaras y comprobación de que el render no cambió el `.blend`.
- `output/blender/WaterDuel_Atelier.blend`: fuente original de mayor detalle, intacta.

## Integración del rotor

El GLB usa Y arriba y +Z hacia el frente. La conversión desde la fuente ya está aplicada; no se vuelve a escalar ni orientar. Los nodos estáticos tienen transformación identidad. La excepción es `Workshop_FanRotor`, con vértices locales alrededor de su pivote y `node.translation = pivot`.

El contrato `fanRotor` contiene `name`, `pivot`, `axis` y `angularSpeed`. El eje es `[0,0,1]` y la velocidad es **7,2 radianes/segundo**, aproximadamente 68,75 rpm. Aplicar `T(pivot) * Rz(7.2*time)` al rotor local, o bien `T(pivot) * Rz(7.2*time) * T(-pivot) * restWorld` si se parte de su matriz mundial de reposo. Aplicar una sola vez la traslación del nodo.

El GLB no incluye animaciones glTF: Principal anima este nodo por CPU mediante el contrato. La copia `.blend` sí incluye un bucle lineal para previsualizarlo en Blender. No hay una segunda copia de las aspas en el grupo estático de latón. Ambos grupos comparten material y atlas, con UV separados antes de hornear.

## Materiales y luz

Se conservan las vetas y patrones procedurales originales. Las nuevas capas aportan grasa y abrasión leve en contactos de madera, pátina y pulido en metal, polvo leve en tela/papel y pequeñas marcas en el revestimiento de pared. Las microfisuras son detalle de normal, sin desplazamiento geométrico ni grietas estructurales. Los vidrios, ventanas, textos, hojas y superficies emisivas están protegidos.

La suciedad de hendiduras usa una máscara AO de alcance 4 cm para modificar ligeramente la reflectancia y la rugosidad del depósito. No se hornea la iluminación del taller, sombras de las lámparas, niebla ni agua. El ORM conserva R=1, G=roughness lineal y B=metallic; las normales tangentes son OpenGL +Y. Los canales que no cambiaron reutilizan los PNG de v1.

La iluminación dinámica y el polvo/humo del juego corresponden a Principal. Las 22 luces de autoría están documentadas en el contrato y el archivo de direcciones existente. Los previews Eevee son evidencia del asset, no una prueba de rendimiento o iluminación del motor.

La copia editable tiene 55.021.547 bytes y SHA-256 `d9c9f0bdbd58bc59c1ab1ee16422ac8ff9b7315c8ecd7436795248d47fcc2117`. Sus tres cámaras y 22 luces están reescaladas a la geometría optimizada. Su bucle se comprobó también a 450°, con error angular inferior a 5×10⁻⁷ rad y pivote fijo. La fuente original y el GLB v1 mantienen los SHA publicados en la entrega anterior.

## Reproducción

Abrir en un proceso propio Blender 5.2 `output/blender/WaterDuel_Runtime_Working.blend` y ejecutar `scripts/export-workshop-runtime-v2.py`. No usar la escena GUI compartida. El exportador crea copias evaluadas, reconstruye sólo el grupo de latón para preservar la pertenencia de las aspas, hornea los canales modificados y exporta la pose de reposo.

Después ejecutar `node scripts/verify-workshop-runtime-v2.mjs` y Blender en una escena vacía con `scripts/reimport-workshop-runtime-v2.py --preview --fan-preview`. Finalizar la copia editable con `scripts/finalize-workshop-blender-v2.py`, abriendo únicamente `WaterDuel_Atelier_v2.blend`. El campo `ready` se activa después de revisar las imágenes y los informes.

El exportador usa explícitamente el fotograma actual para conservar la identidad del rotor en reposo; el valor predeterminado de Blender exportaba el fotograma 0, anterior a la primera clave. Los bakes se ejecutan en CPU tras una comparación local de 1,42 s frente a unos 140 s en OptiX para el mismo canal, sin cambiar calidad. El cierre reproducible es `node scripts/mark-workshop-v2-ready.mjs --visuals-reviewed`, únicamente después de inspeccionar los tres PNG del GLB. La preview nativa se reproduce con `scripts/preview-workshop-editable-v2.py`.

Las comprobaciones limitan el binario a 64 MiB, la estimación RGBA8+mipmaps a 200 MiB, la geometría a 500.000 triángulos y los grupos a 60. Comprueban pivote, radio, restauración tras 360°, ausencia de duplicados estáticos y ausencia de triángulos en el volumen de combate. No cambian colisiones ni física del juego.
