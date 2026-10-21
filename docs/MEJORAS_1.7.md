# WaterDuel 1.7 · alcance solicitado

Selección humana de la lista de 50 propuestas: **1, 2, 3, 4, 5, 6, 9, 10,
12, 15, 16, 17, 27, 29, 31, 32, 35, 36, 37, 38, 39, 40**.

## Entregables y aceptación

- 1: medición separada de cuadros estables, choques, desprendimientos y ruptura;
  conservar picos, intervalos RAF y tiempos CPU, resolución y alcance. 60 FPS es
  un objetivo medido, nunca una afirmación derivada sólo de pruebas Node.
- 2–4: preparación antes del combate, reutilización acotada y agrupación de
  geometría repetida. Conservar triángulos, texturas, materiales, sombras,
  resolución y todas las funciones; comparar contra el corte 1.6.0.
- 5–6: hojas que ceden con carga física y recuperan su forma; reajuste del agarre
  mediante movimientos existentes para liberar cruces. La punta y la colisión
  usan la misma forma, sin generar ataques o impactos ficticios.
- 9: holgura de uniones que crece con el daño antes de romper, sin ruido añadido
  al estado autoritativo ni energía creada por el efecto.
- 10, 12: observación limitada de amenazas por visibilidad/atención y decisiones
  tácticas según alcance, masa y defensa del rival. Se mantienen errores humanos,
  límites de reacción y protección de aparición.
- 15–17: escuela de paradas y aprovechamiento de apertura, blancos oscilantes y
  ejercicios de profundidad. Progreso sólo por desviación, pinchazo o esquiva
  observados físicamente; accesibles desde ambos menús móviles.
- 27: emblemas reconocibles además del color en globo, falda y mando.
- 29: propagación del desgarro según tensión y energía, con contabilidad y
  conservación de masa; sin agujeros o fragmentos inventados por el renderer.
- 31–32: adherencia capilar en cuello/pliegues y profundidad óptica que excluya
  los huecos entre volúmenes separados. Capacidades GPU y fallback explícitos.
- 35: corriente localizada del ventilador sobre polvo, humo y banderines, usando
  el mismo origen/eje que su rotor; no una deriva uniforme de toda la habitación.
- 36: palma y dedos ajustados a la empuñadura de cada arma/defensa.
- 37–38: marcas de contactos efectivos y lubricación/desgaste localizado en
  uniones; estado acotado y reproducido en replay.
- 39: humedad de la falda desde agua en contacto, con secado, material y caída
  coherentes; no moja toda la prenda por estar cerca de una explosión.
- 40: sombras de contacto integradas, sin hacer opaca el agua/látex ni pintar
  sombras separadas de los objetos que las originan.

## Integración

Combate e IA poseen engine/rig; agua posee membrana/fluidos/óptica; entrenamiento
posee SinglePlayerSession. Principal integra renderer, materiales, mandos,
estado de superficie y rendimiento. Pruebas existentes se conservan. Revisión
cruzada y suite completa después de congelar las fuentes, seguida de navegador
y publicación por el workflow existente. La PC conserva exclusivamente escena
y QR; los diagnósticos y opciones pertenecen al menú del móvil.

## Cambios integrados

La curva física de espada/lanza también deforma su malla y sus segmentos de
colisión. La empuñadura conserva la tangente de raíz; la longitud usada es la
del arco. Hacha y mazo permanecen rígidos. La recuperación del jefe pasa de
1,15 a 1,27 s para conservar su oportunidad de contraataque con la nueva
respuesta elástica; la punta sigue colisionando durante toda esa ventana.

La percepción conserva por separado cabeza y punta. Una amenaza oculta caduca
en lugar de provocar una retirada indefinida; la IA espera visibilidad antes
de consumir su única estocada de una preparación. No recibe equipo nuevo de
un rival todavía oculto. Los ejercicios conservan los equipos personales al
salir y necesitan sucesos físicos para completar sus objetivos.

Pigmentos y arañazos se anclan a triángulos reales. La proyección se cachea por
propietario para seguir huesos, flexión y fragmentos. El mojado diferencia dos
regiones de tela, seca en 24 s y aumenta su amortiguación pasiva; no retira agua
del balance de volumen. El aire sólo actúa delante y cerca del rotor sobre
polvo/humo y los paños alcanzados; las varillas y las fuentes permanecen fijas.

La fractura es un modelo reducido con gasto de energía, sin calibración de
tenacidad experimental. La capilaridad conserva volumen e intercambia impulso
con el látex; la resolución de parcelas no representa películas microscópicas.
La óptica integra interfaces de componentes cerrados a lo largo de un rayo
recto visible; no es trazado refractivo global. Requiere EXT_color_buffer_float
y EXT_float_blend; sin soporte informa y conserva el modo anterior. El guard
de interfaz cercana compara bins DEPTH24: superficies en el mismo bin no son
distinguibles. La prueba GPU real mide 0,474244 m frente a 0,474201 m de
intersección CPU, con 11 assets completos y cero errores WebGL.

Los personajes reales ya tenían 61 partes agrupadas cada uno: el agrupador
compatible mantiene 61→61, sin reducción de detalle ni ahorro atribuido. El
taller conserva sus 355.284 triángulos; separar los paños móviles lleva sus
36 partes a 48. Es un coste funcional declarado, no un ahorro fabricado.
Los buffers de streaming y sus staging arrays reutilizan capacidad; los
diagnósticos distinguen reservas iniciales de reservas posteriores.

Se actualizaron los hashes exactos del renderer procedural por tres sombras
genéricas eliminadas de los pases de profundidad, los dedos para el mango de
mazo de 0,054 m y los nuevos shaders de flexión, humedad y óptica. Se conservan
las verificaciones de huesos, geometría, fragmentos, repeticiones y colisiones.

## Verificación

La suite local del corte congelado aprobó **1.166/1.166 pruebas en 167 archivos**, sin
omisiones, con exit 0 y fuentes estables durante 277,239 s. El paquete Pages
compila con 413 archivos. [Recibo resumido](verification-1.7.json). Los diagnósticos
de navegador conservan todos los cuadros muestreados y los eventos de contacto.
La limitación de callbacks del navegador integrado impide certificar 60 FPS;
los tiempos CPU medidos incluyen múltiples pasos físicos por callback y no
son una medición de scanout ni de un teléfono físico.

Las primeras capturas de 24 cuadros (49 para completar ruptura) muestran mayor
coste CPU por callback en desprendimiento y ruptura del candidato. La referencia
y el candidato no siguen los mismos contactos en el caso de choque; tampoco
hay repeticiones ABBA ni aislamiento de otras cargas. Se conservan los datos
originales y no se atribuye una mejora global ni porcentajes a un subsistema.
Las capturas preceden a la corrección de los snapshots redundantes de superficie.
En la primera fixture el aire sólo se configuró para su primer HostSession;
se corrigió esa configuración para futuras mediciones. La aplicación normal
conserva su misma sesión durante todos los encuentros y sí mantiene el aire.

Después del perfil se quitaron temporales del contacto capilar conservando
bit a bit 1.500 consultas y 1.920 pasos de parcela contra su oráculo congelado.
Un único ensayo Node sin renderer midió el coste capilar muestreado en
1,654→0,434 s y la secuencia de ruptura en 9,379→6,803 s; no acredita FPS ni
una mejora global. Los apoyos de fragmentos también se memoizan con invalidación
exacta y copias propias: una sesión instrumentada reutilizó 960 de sus 1.440
consultas, conservando 480 reconstrucciones necesarias. El ensayo aislado
favorece consultas repetidas; cuando cambia cada consulta hay coste adicional
de validación. Se mantienen los resultados y limitaciones de las capturas
anteriores, sin reemplazar datos desfavorables.

En el cierre posterior se adelantó la reserva del target óptico flotante y se
restauró el programa principal antes de los dibujos de preparación. La prueba
comprueba ahora el propietario de cada uniforme y el tamaño preparado; 36/36
pruebas específicas pasan. El despliegue exige volver a aprobar toda la suite
en GitHub Actions sobre el commit publicado.
