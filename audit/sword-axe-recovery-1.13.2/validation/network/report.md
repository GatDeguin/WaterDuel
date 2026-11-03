La prueba LAN confundía el orden de llegada entre conexiones independientes con la identidad del jugador. En CI los controles aceptados llegaron como `[[2,3],[1,2]]`, con slots y secuencias correctos. La aserción esperaba el orden global inverso y el acceso por `seen[0]/seen[1]` asignaba los valores al mando equivocado. Al fallar, se omitía el cierre de sockets y el subtest siguiente encontraba la autoridad anterior todavía ocupada.

`tests/network.test.mjs` espera ahora los dos controles y valida el rol y slot confirmados en cada `welcome`. Conserva la comparación exacta del array completo de tuplas, ordenado sólo por slot, antes de construir el mapa usado para consultar `axes.mainY` y `guard`. Por eso un control repetido o una secuencia equivocada siguen produciendo un fallo.

El ping/pong de J1 se mantiene. Después se cierra J1 y se espera su `presence: offline` en el host: esa notificación llega por el mismo socket del host después de todos los relays anteriores de J1. Esta barrera impide afirmar sobre una lista todavía incompleta. El `finally` cierra también las conexiones adquiridas si falla una aserción.

Se conservaron `timeout=2500`, `SESSION_TTL_MS=2000`, `HEARTBEAT_MS=200`, `PEER_IDLE_MS=1500`, los mensajes enviados y los límites de los demás subtests. El archivo sigue descubriendo seis casos, incluyendo su contenedor; no se omitió ni eliminó ninguno. No se editó código de producción.

La reproducción fuerza que J2 sea recibido antes de enviar J1, usando barreras de mensajes sin pausas artificiales. Sólo modifica ese orden de preparación y la ruta de trabajo de la copia temporal:

```powershell
& 'C:/Program Files/nodejs/node.exe' audit/sword-axe-recovery-1.13.2/validation/network/reorder-repro.mjs before
# Resultado esperado: error de orden y timeout derivado del subtest siguiente.
& 'C:/Program Files/nodejs/node.exe' audit/sword-axe-recovery-1.13.2/validation/network/reorder-repro.mjs after
# Resultado esperado: 6/6 correctos.
& 'C:/Program Files/nodejs/node.exe' --test tests/network.test.mjs
# Prueba original: 6/6 correctos.
```

El recibo contiene hashes y tamaños de todos los artefactos portátiles. Los logs y el original archivado se copian sin reescribir sus bytes. La política de IA y el motor `B06CBB0B…` permanecen intactos.
