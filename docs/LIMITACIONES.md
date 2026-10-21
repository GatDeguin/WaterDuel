# Límites y evidencia — desarrollo1.4 / entrega anterior1.3

Registro: 2026-10-18. El estado de aceptación pertenece al informe independiente más reciente. Una aprobación de archivos/hashes anteriores no certifica modificaciones posteriores.

La PC presenta la escena completa y, por petición posterior, los dos QR pequeños de vinculación en las esquinas inferiores. El HUD y los menús viven en móviles autenticados. Los GLB detallados de personajes/equipo/taller y Audio están integrados. Ver `INTERFAZ_MOVIL.md` y `CHANGELOG_1.4.md`. La evidencia automatizada separa GPU real, diseño móvil aislado y comandosNode→hostGPU. Siguen pendientes el mando web autenticado en teléfonos físicos y la pruebaWi-Fi con ambos jugadores.

## Personaje y combate

**IMPLEMENTADO / APROXIMADO:** multibody planar de 14 coordenadas, masas e inercias por segmento, matriz acoplada, motores amortiguados, límites, muñeca dinámica, gravedad, carga del agua e impulsos entre armas. IK genera intención; la pose física alimenta render y colisión. Autocontacto unilateral de paneles extruidos con profundidad fija, excluyendo vecinos y capas separadas; no incluye todos los herrajes ni colisión espacial general. **No es un active ragdoll tridimensional generalista.** Los motores compensan parte del peso; esa compensación no elimina masa/inercia ni el efecto del COM del agua.

`lean` combina postura y avance limitado 1D. Hay zancada alterna y apoyos anclados en mundo, con restricción ideal sin deslizamiento; no es fricción de Coulomb calibrada ni locomoción autónoma. La longitud de la hoja aún cambia con lunge como actuación prescrita; su extensión no es otra coordenada dinámica.

El eje vertical izquierdo baja el objetivo de pelvis hasta0,29u normales, con rodillas y contacto de suelo. Las tibias emplean una envolvente medida de los GLB y la suela horizontal conserva su Jacobiana propia. El solver trata suelo/topes como desigualdades; no corrige el render con una traslación global. Arriba inicia una finta de0,85segundos, con inclinación del torso y cuello reducido hacia profundidad negativa; vuelve aunque se mantenga y requiere centrar antes de repetir. El cuerpo continúa siendo planar y la finta no lo convierte en un ragdoll espacial general. No existe inmunidad: la punta sigue consultando el globo desplazado.

La cabeza usa **elipsoideXYZ barrido**, con radios nominales y piel `.006 × escala`; no consulta cada triángulo deformado de látex. El cuello conserva una articulación espacial reducida sobre el cuerpo planar. Inicio interior: `t=0`, efectos sobre superficie radial más próxima; en el centro exacto, lado opuesto al movimiento entrante. Es una política de solapamiento inicial, no reconstrucción de una trayectoria histórica perdida.

El contacto continuo entre armas usa prismas finitosXYZ y transmite impulsos acotados a sus cadenas. Comparte resolución con madera y contacto corporal; una ligadura puede desplazar el arma y permitir un ataque real. Escudos y daga usan proxies de profundidad finita alineados con sus montajes. No equivale a fricción/elasticidad de cada triángulo ni a presión de acero calibrada. Empate significa impactos en el mismo paso, aunque sus tiempos subpaso sean distintos. Una punta alcanza y pincha el globo sin exigir botón, velocidad artificial o valor de extensión mínimo.

## Agua y látex

Partículas de **volumen contable**, subpasos, gravedad, cohesión, viscosidad y contacto con plano/límites. El agua liberada consulta sólidos extruidos del muñeco en movimiento mediante avance conservador y cotas de trayectoria; el radio deriva del volumen individual. Es contacto de una vía: el cuerpo desplaza agua sin recibir un impulso hidrodinámico de retorno. Conservar su suma no prueba volumen exacto de la malla, conservación energética o calibración de densidad. **No es CFD validado**, Navier–Stokes ni validación industrial. Agitación confinada y carga corporal son modelos reducidos.

El interior usa llenado del **65% en volumen** de una capacidad nominal `.2732954387403816 u³`: `HEAD_VOLUME=.17764203518124805 u³` normal y factor cúbico con escala. No son litros calibrados ni 65% de altura. Cap cerrado, superficie libre y partículas comparten ese contrato; el error poligonal contenido observado depende del perfil (aproximadamente −1.338% ECO, −.635% ALTA y −.336% ULTRA).

La herencia de inercia interna al liberar corrigió el contraejemplo R4-02. R4-03 se corrigió mediante campo ponderado por volumen, calibración por componente y cierre en planos de contacto. Crítico y Árbitro reprodujeron cierre, escala, volumen/2, suelo/paredes y fallback. El error geométrico observado en esos fixtures es menor del 0,05%; no es una garantía universal. La reconstrucción es más costosa: ver `RENDIMIENTO.md`. El fallback conserva volúmenes individuales, sin garantizar volumen de unión de gotas solapadas. La secuencia real final `estallido-ronda4/` usa una demo con contacto escenificado, no una colisión competitiva validada por vídeo.

La isosuperficie dispersa tiene regresiones de cobertura XYZ/fases y normales. No demuestran todas las nubes posibles. El presupuesto es por superficie/llamada, no un presupuesto global certificado con dos estallidos. Calidad altera detalle/cadencia y destellos sin volumen; viscosidad, rig, membrana y descarga son comunes. La integración comparada ECO/ULTRA conserva todas las partículas físicas y poses en el fixture ensayado.

El látex usa **162 nodos XPBD**, restricciones de aristas/área/volumen, pretensión y cambio de conectividad por punción/deformación. Su render interpola 1280 triángulos; los fragmentos conservan masa. No es látex hiperelástico ni fractura constitutiva calibrada, y faltan autocolisión/fricción textil. La descarga responde a apertura, presión reducida y pérdida de capacidad por retracción. Desde R7 se comprueban además triángulos reales: AABB y cinco cruces orientados de una componente conectada. Esta consulta conservadora puede rechazar una bolsa cóncava válida y sólo valida centros de parcelas; no acredita colisión continua de toda la isosuperficie con la piel. La cota de área sigue siendo un límite adicional. El transporte interior CDF y la presión adimensional siguen siendo aproximaciones; no hay boquilla/CFD bidireccional ni litros/Pa calibrados. La densidad corporal explícita es 10 unidades de masa por u³; no se confunde con la densidad estadística del fluido.

## Render y contenido

Materiales procedurales con propiedades diferenciadas, barniz/relieve, metales y dieléctricos. Hay **refracción aproximada del color/profundidad de escena** y reflexión del taller capturado en cubemap. Composición/captura lineal RGBA16F HDR cuando la extensión existe; fallback RGBA8 lineal recorta radiancia superior a uno. En R8 el espesor óptico es nodal y continuo; su integral sobre los triángulos físicos conserva el volumen material de reposo. La interpolación geométrica de render sigue siendo una aproximación. El pigmento dispersa luz incidente de las lámparas, con constantes artísticas en unidades de escena, no medidas de látex comercial. La interfaz posterior del agua se captura por objeto en GPU: su envolvente puede incluir aire entre componentes disjuntos; los fallbacks/gotas conservan espesores aproximados. No es trazado de rayos ni refracción multicapa físicamente exacta; la captura de entorno no contiene actores dinámicos. Shadowmap512/1024/1536 atenúa la lámpara principal con PCF3×3; no equivale a GI ni sombras volumétricas coloreadas. Agua/aire/látex aún se separan poco y el agua parece opalescente en varias vistas. Acabados, GI, profundidad de campo y densidad de taller siguen lejos de las referencias.

La integración1.4 incorpora GLB PBR, UV/normal/roughness/metales/emisión y sheen, cámara frontal y22fuentes orientadas. La key tiene sombra dinámica y tres fuentes dominantes usan oclusión estática del taller; las otras prácticas no tienen visibilidad geométrica completa. Las áreas son emisores direccionales suavizados, no rectángulos integrados exactamente. El retorno difuso por mip del cubemap no es irradiancia convolucionada ni GI.

El taller v3 corrige los cruces reportados del plano y banderines mediante traslación de conjuntos completos, con separaciones geométricas verificadas y los materiales v2 conservados. El color de la falda aleatoria sólo se ajusta en Duelo IA J2; su albedo opaco es más oscuro que el globo transmisivo aunque comparten matiz. La carga atómica y las texturas compartidas reducen presentación parcial y memoria; no acreditan por sí mismas60FPS. El reloj físico de ruptura corrige redundancia de llamadas, pero su fixture parcial presenta una regresión deCPU documentada en `audit/RELOJ_FISICO_PRESENTACION_1.4.md`.

WebGL simulado comprueba geometría, pases y matrices; no sustituye GPU, capturas ni juicio de material bajo luz neutral/final. Una captura no acredita estabilidad temporal ni rendimiento. Audio conserva35WAV, doce stems por estado y añade diez cues de foleyv2 con paneo/ducking/límite de voces. El contacto decide material/energía/deslizamiento; los observadores de movimiento son acotados. Su QA específica de Chromium no acredita audición en todos los equipos. Vibración/sensor dependen del móvil y sus permisos; el pad táctil de cabeza es la alternativa al sensor. La muñeca se controla desde el joystick derecho.

Versus local3/5, cuatro dificultades, jefe y siete estilos tácticos. R8 añade entrenamiento7etapas, práctica continua, precisión3zonas y campaña7encuentros con progreso validado en almacenamiento local. Tres zonas se completan en una prueba usando motores, muñeca y contactos reales; no constituye playtest con personas ni balance certificado. El progreso local no es una cuenta remota ni protección contra edición manual del navegador.

Replay visual de contactos recientes a20Hz, hasta tres clips y64MiB de datos contabilizados. El presupuesto incluye buffers/metadatos propios; no es un límite total de heap/VRAM. Captura poses, parcelas y membrana, sin recalcular la física. La reproducción pausa el motor y admite scrub/velocidad; no graba una partida completa ni genera vídeo exportable. No hay torneo completo, rollback ni multijugador de Internet. Las siete piezas de equipo entregadas ya siguen sus agarres y geometría competitiva reducida; los adornos no crean superficies de impacto adicionales.

## Autoridad, red y dispositivos

Node sirve/retransmite; la simulación vive en **un único navegador anfitrión**. Otra arena recibe `HOST_BUSY`. **Tablet como segunda pantalla no es mirror ni espectador.** Si es la única anfitriona, ella simula; no es PC simulando y enviando vídeo.

HTTP/WS en loopback y HTTPS/WSS para móviles, con certificado local validado, claves por cupo y sesión de cuatro horas por defecto. La confianza de la CA pública requiere un paso manual en cada teléfono; no se instala automáticamente ni se eluden intersticiales. El HTTP en LAN sólo permite la preparación pública del certificado. No hay endurecimiento para servicio público. Reinicio/caducidad rota invitaciones; las claves privadas se excluyen del paquete.

**No se ha medido latencia física extremo a extremo ≤430 ms.** El límite lógico de edad usa `sentAt` y conserva la vida restante al pasar por relay/búfer; las regresiones con relojes controlados cubren el retraso acumulado. La sincronización de offset también tiene pruebas VM. Eso no equivale a radio Wi-Fi, input-to-photon, jitter térmico, suspensión de pantalla ni dos teléfonos físicos.

En la QA automatizada de navegador, la política de seguridad de URL bloqueó el acceso al mando LAN con sesión autenticada. La revisión visual del mando sin sesión y las pruebas VM/protocolo son evidencia separada; no acreditan una partida autenticada desde ese navegador ni desde teléfonos físicos.

| Dimensión | Disponible | Pendiente / NO MEDIDO |
|---|---|---|
| Dos teléfonos físicos | Protocolo/búfer y servidores aislados | Partida offline real, ergonomía, pérdidas y reconexión física |
| Tablet | Responsive y proyección comprobados por tests | Rendimiento/compatibilidad real; mirror no implementado |
| GPU/frame time | Ventanas reales de300RAF y timerGPU a1280×720 en ALTA/Chromium; perfiles CPU separados | Las ventanas anteriores no incluyen ruptura suficiente ni certifican60FPS globales; GPU/hardware físico no identificado |
| Memoria/carga/térmica | Sin garantía derivable de pruebas lógicas | Sesión larga, pico, fugas y carga |
| Fidelidad visual | Componentes y matriz trazable | Comparación completa con capturas equivalentes |
| Accesibilidad/audio | Teclado, etiquetas y eventos básicos | Lectores de pantalla, contraste medido, audición y uso físico |

Capturas o mediciones posteriores pueden acreditar casos concretos, no toda la tabla automáticamente. No se afirma calidad AAA, compatibilidad universal ni física industrial validada.

`QA_EVIDENCIA.md` separa los cortes previos/R4, demo de ruptura, capturas de mando sin sesión y ventanas de medición. `RENDIMIENTO.md` detalla método y resultados; no se extrapolan sus cinco segundos quietos a estallidos o dispositivos físicos.
