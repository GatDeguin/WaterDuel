# WaterDuel 1.5.0 · Articulaciones que se desgastan y se separan

Los impactos físicos pueden dañar hombros, codos, muñeca principal, caderas y rodillas. El daño disminuye la rigidez y la recuperación de sus motores; al agotarse una unión, su rama se separa. La cabeza y el torso conservan su estructura y la victoria sigue dependiendo del pinchazo real del globo.

## Daño y combate

- El motor recibe los impulsos, velocidades de cierre y puntos del solver, antes de los límites de frecuencia del audio. La energía de impacto y la palanca respecto de la junta determinan un daño acotado; no hay daño aleatorio.
- El apoyo, la gravedad, los autocontactos, una parada quieta y el contacto mantenido no consumen resistencia repetidamente. El mismo episodio se rearma después de una separación de 0,12 segundos. Fuentes duplicadas se agregan por el mayor daño de cada articulación y paso.
- La rotura se aplica después de resolver todas las colisiones y clasificar ambos pinchazos simultáneos. Ninguna lista de geometría cambia durante sus iteraciones.
- El brazo separado deja de transmitir masa, fuerza y colisiones a través del muñeco. No quedan armas ni escudos invisibles. La espada caída mantiene su punta física y puede perforar un globo con su movimiento real.
- Una pierna separada libera su apoyo y detiene la marcha normal. Al perder ambos apoyos, el balance vertical deja de sostener el cuerpo en el aire. Una amputación por sí sola no otorga puntos ni termina la ronda.
- Al romper un brazo se libera el agarre secundario del mazo. El arma pertenece a la mano principal: cae con esa rama si se pierde, o sigue en la mano principal si se pierde la secundaria.
- Una nueva ronda restaura todas las articulaciones y limpia los fragmentos y episodios pendientes.

## Presentación

Las juntas dañadas muestran marcas y fisuras locales. Los miembros caídos usan la misma geometría y materiales del muñeco y del equipo, transformados por su movimiento físico. Los eventos de daño y rotura añaden astillas, crujidos y vibración únicamente en el mando de la víctima. Las repeticiones conservan copias propias de las piezas; sus matrices se interpolan como movimientos rígidos y los cambios de topología permanecen discretos.

La PC conserva la escena y los QR; las opciones continúan en los móviles. El fixture independiente `/qa/joint-damage.html` permite verificar sano, daño progresivo y separación sin abrir sesiones de jugadores.

Los escudos siguen a su antebrazo desprendido con su volumen de colisión y apoyos en la mesa. El agua también colisiona con las piezas caídas mediante su movimiento continuo y recibe su velocidad de superficie. Se mantiene el acoplamiento anterior de obstáculos lectores: el agua no devuelve un impulso al miembro.

## Alcance físico

Cada conjunto desprendido es inicialmente un compuesto rígido inelástico: conserva su masa y momentos lineal y angular al separarse, y puede disipar movimiento relativo interno. Se mueve en el plano XY del solver existente, con sus profundidades originales, gravedad, suelo, fricción y colisiones continuas con cuerpos y armas. Esto no equivale a una nueva simulación libre de todas sus juntas en tres dimensiones.

Los volúmenes de contacto son aproximaciones conservadoras. El escudo desprendido usa un panel rectangular que contiene su contorno. Al perder ambas piernas, el apoyo inferior de pelvis puede dejar entre 3,6 y 9,4 cm de separación respecto de la malla visible, según escala y orientación; no es un apoyo de los pies ni del motor de equilibrio. La coincidencia exacta de ese proxy con la pelvis visible queda pendiente.

## Rendimiento

El perfil de CPU incluye choque de armas, pinchazo y agua libre en un agregado mixto, sin aislar su coste por fase. Dos candidatos de optimización se descartaron por falta de mejora consistente. Las capturas de navegador terminaron incompletas y no certifican FPS ni tiempo de GPU. Se mantienen la calidad fija predeterminada, los efectos, el número de pasos físicos y las reglas del combate. Ver [mediciones y límites](PERFORMANCE_SPIKES_1.5.md).

## Verificación

La suite completa aprobó **960/960 pruebas en 120 archivos**, sin omitidas y con fuentes estables, en 193,197 segundos: [recibo](../audit/corte-1.5-articulaciones-02/receipt.json). El primer recibo conserva cuatro fallos de adaptación de fixtures anteriores; se mantuvieron sus aserciones, el límite de ejecución del VM y los hashes históricos del audio, validando mediante hunks reversibles exclusivamente los cambios autorizados posteriores.

La QA de navegador independiente cargó 11/11 assets y verificó transformaciones finitas y geometría visible de miembros y equipo caídos, sin errores del fixture. No acredita rendimiento, vibración en teléfonos físicos ni escucha de hardware. Los servidores de pruebas quedaron cerrados; no se generó un ZIP nuevo.
