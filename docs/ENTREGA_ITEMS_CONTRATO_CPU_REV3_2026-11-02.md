# Ítems: contrato CPU de sockets, revisión 3

Addendum del 2026-11-02 a [la entrega de Items](ENTREGA_ITEMS_SELECCIONADOS_2026-11-02.md). Esta revisión distingue la alineación geométrica de la cuantización de los datos de render. No amplía globalmente la tolerancia para absorber diferencias Float32.

## Alcance y tres comprobaciones

El cambio del ensayo de integración se limita al bloque de sockets y a las recetas invertidas: `aim:0` para J1 y `aim:-.4` para J2. Se agregan el helper independiente `tests/helpers/knife-socket-reference.mjs` y sus pruebas estáticas `tests/knife-socket-reference-113.test.mjs`. El `near` general conserva **1e-7**, al igual que los **285 pasos de combate**.

Para las dagas GLB v2 y v3, ambos jugadores y ambos agarres, el bloque de sockets exige por separado:

1. **Geometría F64:** el punto local producido por `deformEquipmentPoint([0,.42,0], transform)`, evaluado con la matriz de referencia independiente, debe coincidir por componente con la punta física a **menos de 1e-7**. También se comprueba el extremo ideal de la referencia.
2. **Matriz enviada:** los 16 coeficientes de la matriz productiva `Float32Array` deben ser exactamente `Math.fround` de la referencia F64 reconstruida desde mano, punta y contrato canónico. La referencia no importa helpers productivos ni toma de ellos su extensión o sus extremos de deformación.
3. **Datos cuantizados:** el extremo virtual calculado en CPU con el socket parseado y `deformStart`, `deformEnd`, `extension` cuantizados a Float32 debe quedar dentro de una cota propagada por componente. Incluye cuantización de socket, coeficientes, traslación y uniforms, y evaluación JS mediante términos γ3/γ7. La cota depende de los datos; no es un epsilon fijo ajustado al error observado.

Este contrato cubre una **daga recta, sin flex y con padres authored identidad**. Comprueba por separado los datos authored y los índices/matrices del parser. Evalúa datos binarios de 32 bits mediante aritmética JS de 64 bits; **no afirma que la GPU ejecute F64** ni acota su aritmética de shader, proyección o imagen final.

## Evidencia de esta revisión

La ejecución focal pasó **16/16**, sin omisiones: **8 de integración + 8 estáticas**, en **18 815.1822 ms**. No es una pasada global. El recibo conserva **51 fuentes estables** durante esa ejecución, con digest `2c0ce9b6c8c73fb042b18aa099a278285616ec8e7f193827349894484200cf94`.

- `public/engine.js`: SHA-256 `ab55912da7216cdb3e8a5c8c52d5fcf9f68026e6981f3e19c8471b33f7dd9d2d`.
- `public/physics/articulated-rig.js`: SHA-256 `e02e42100d66b8d25b3d525d0d4a53f54edcdeabaf04152091bc3eccfa8e518b`.

Los archivos de esta revisión están en [`audit/items-knife-contract-113-revision3/`](../audit/items-knife-contract-113-revision3/):

- `receipt.json` vincula el resultado, el comando, las fuentes y las instantáneas probadas.
- `functional-16of16.stdout.txt` conserva **verbatim la salida visible de la herramienta, recibida en dos chunks**. No se presenta como captura binaria cruda del stdout del proceso.
- `knife-defense-integration.tested.mjs.txt`, `knife-socket-reference.tested.mjs.txt` y `knife-socket-reference-113.tested.mjs.txt` conservan las tres instantáneas probadas.
- `recipe-closure-summary.json` y `recipe-final-results.json` conservan el diagnóstico offline de recetas. Su corte anterior declara **42 fuentes**, engine `9f19e08250c7823a888ad2bef795f12bde89bac63a35933cb8a964db3c5468b5` y rig E02. Son evidencia separada de la ejecución nueva de 16 pruebas; las copias JSON permiten inspección y reproducción offline sin depender de `.runtime`.
- `MANIFEST.before-revision3.json`, `seal-selected-items.before-revision3.mjs.txt` y `ENTREGA_ITEMS_SELECCIONADOS.before-revision3.md.txt` preservan recibo v2, sellador y guía anteriores.

## Historia y límites

**206/206 y 104/104** corresponden al corte histórico de Items. El **8/8 N16 anterior** conserva su propia instantánea y log en `audit/items-n16-test-migration-113/`. Ninguna de esas cifras se reasigna al contrato CPU nuevo; su evidencia es el **16/16** descrito arriba.

La integración activa sigue como `sharedReference`. El helper y la prueba estática quedan curados, y las tres instantáneas probadas quedan protegidas. El sellador exige los **51 originales históricos**, los **56 archivos del recibo v2 con dos redirecciones explícitas** y los archivos del recibo actual. `node scripts/seal-selected-items.mjs --verify` verifica tamaños y hashes; no ejecuta pruebas ni reescribe los archivos históricos.

La revisión GPU y **Global 2** siguen pendientes de coordinación con Principal. Este addendum no acredita una pasada visual, una prueba de hardware ni una nueva publicación. Los resultados de IA pertenecen a su entrega independiente y no se suman a Items.
