> **Actualización v1.0 (17/10/2026):** Los hitos de geometría articulada avanzada, materiales procedurales, malla de látex y partículas de fluido con superficie volumétrica ya tienen una implementación de prototipo. Consultar `IMPLEMENTACION_FISICA_V1.md` y `CHANGELOG_v1.md` para el alcance exacto, métricas y limitaciones. Las secciones siguientes conservan el plan arquitectónico original como historial, no describen necesariamente el estado actual.

# WATER DUEL — Arquitectura y plan de desarrollo por etapas

## 1. Topología de red offline

```text
              Wi-Fi / hotspot local, sin Internet
  ┌─────────────────────────────────────────────────┐
  │                                                 │
  │  PC o Android-Termux                             │
  │  Node.js server.mjs 0.0.0.0:8787                │
  │  ├─ HTTP: HTML / CSS / JS / QR                   │
  │  ├─ WebSocket: roles y rutas                    │
  │  └─ 2 slots de mandos con token                 │
  │              ↑                                  │
  │              │ Host WebSocket                   │
  │       Navegador de PC/tablet                     │
  │       Motor 3D + lógica + física                │
  │              ↑                                  │
  │          Input J1/J2                             │
  │        ┌──────┴──────┐                           │
  │   Móvil J1        Móvil J2                       │
  │   QR privado      QR privado                    │
  └─────────────────────────────────────────────────┘
```

El servidor es **relay de controles**, no simula la física. Solo la pestaña de la arena principal computa el mundo, los golpes y la puntuación. Los teléfonos nunca envían posición de colisión ni puntuación; solo mandos normalizados. Esto evita divergencia visual al no replicar solvers en múltiples navegadores.

## 2. Requerimientos, límites y decisiones

| Factor | Implementación actual | Futuro/decisión |
|---|---|---|
| Conectividad | HTTP + WebSocket local | HTTPS local opcional solo para sensores iOS / WebTransport |
| Render 3D | WebGL2 sin dependencias | Motor con render de agua avanzando a WebGPU cuando exista soporte |
| Movimiento | IK + resortes | PBD/XPBD con restricciones de articulaciones y masa real |
| Punción | CCD 2D sobre cabeza aproximada | CCD 3D cápsula/triángulos deformables |
| Agua | 105–265 gotas balísticas | SPH/PBF o solución híbrida GPU con conservación de volumen |
| Globo | Escala deformada por shader | Membrana elástica y desgarro de malla |
| Autoridad | Una pestaña del juego | Host determinista + replay |
| Personalización | 3 arenas y selector de calidad | Modelos y armas modulares |
| IA | 3 dificultades | Árbol de decisión + estimación de distancia, latencia y finta |

## 3. Pipeline de simulación avanzada objetivo

1. Recolectar `control` por jugador con número de secuencia y deadline de ~100–180 ms; al excederlo, interpolar o pasar a neutral según política.
2. Predecir las consignas de manos y del torso durante el siguiente substep.
3. Resolver posición objetivo de IK y velocidades articulares limitadas.
4. Resolver restricciones de rig con XPBD, límites angulares y masa inercial.
5. Ejecutar broad phase (AABB/cápsulas) y narrow phase con CCD de arma sobre globo, cuerpo y acero.
6. Avanzar la membrana deformable y comprobar tensión y corte; generar eventos topológicos de desgarro.
7. Si se abre una membrana, liberar fluido conservando cantidad de partículas o volumen en malla de densidad.
8. Resolver agua en GPU con método de partículas/grilla híbrida según capacidad; aplicar choques sólidos.
9. Escribir reacción de impulsos al torso y reorganizar centro de masa.
10. Renderizar sombras, materiales, refracción, destellos, atomización, charcos y partículas.
11. Publicar el estado (marcador, fases, audio y eventos de vibración) a teléfonos.
12. Guardar estados deterministas para el replay si la capacidad lo permite.

**Criterio de simulación:** no prometer "hiperrealismo" solo por aumentar el número de esferas. Requiere calibración de material, conservación, interacción sólido-fluido y pruebas de reproducibilidad física.

## 4. Plan de producción

### Hito 0 — Prototipo LAN (entregado)

Servidor en Node sin `npm install`; QR por cupo; dos mandos táctiles; 3D procedural; IA tres dificultades; Versus local; física aproximada; estallidos y agua con partículas; tres arenas; Alta/Eco; tests. Requiere prueba manual en hardware del usuario antes de considerarlo validado como producto.

### Hito 1 — Control y competencia

- Calibración individual de sensibilidad y zurdo/derecho.
- Medición real de input-to-photon, ping LAN y pérdida de paquetes.
- Trayectorias más consistentes en ataques cruzados; CCD de puntas y guardias móviles.
- Pausa por pérdida de mando y manejo de revancha con confirmación de J1/J2.
- Entrenamiento interactivo 5 etapas y modo accesible.
- Persistencia local de perfiles y ajustes (sin servicio externo).

### Hito 2 — Ragdoll y articulaciones

- Rig 3D con masa por hueso, 2 hombros/2 codos/2 muñecas, torso/cuello y puntos de apoyo.
- Solver XPBD/impulsos de contacto con unidades físicas, límites y amortiguación.
- Pruebas de conservación de energía dentro de cotas y estabilidad de deformaciones.
- Criterios: no penetración fuerte, no explosiones numéricas, IA no fuerza posiciones imposibles.

### Hito 3 — Globo membrana + fluido

- Malla con tensión y perforación localizada (estirar → puncture → tear).
- Fluido de volumen conservado por partículas PBF/SPH u otro método validado.
- Compartimentación entre fluido confinado y fluido liberado.
- Charcos que afectan agarre y pierden velocidad gradualmente.
- LOD de fluido diferenciado para escritorio/tablet.

### Hito 4 — Visual AAA estilizado

- Iluminación PBR, contactos, gotas anisótropas, refracción de látex/agua, microburbujas.
- Postproceso moderado: bloom selectivo, DOF en replay, motion blur calibrado.
- Animación procedural secundaria en brazos, cuello, membrana y fragmentos.
- Implementar replay con duración, ángulos y opción de saltarlo para reiniciar instantáneamente.

### Hito 5 — Contenido, accesibilidad, QA

- Campaña de 12 rivales, tutorial, desafíos, jefes y progresión.
- Balance competitivo con al menos 30 participantes de prueba.
- QA de 6 tipos de móviles y 3 categorías de pantallas host.
- Versión empaquetada con runtime de escritorio, certificados locales opcionales para sensores, instalador seguro y actualizaciones no obligatorias.

## 5. Contrato de paquetes LAN

Handshake de ejemplo de teléfono:

```json
{"type":"hello","role":"controller","slot":1,"key":"TOKEN_DEL_QR"}
```

Control periódico:

```json
{"type":"control","seq":83,"offX":0.12,"offY":0.50,"mainX":0.85,"mainY":0.65,"lean":0.4,"wrist":-0.1,"thrust":false,"guard":true}
```

`offX`/`offY` corresponden a brazo defensivo y `mainX`/`mainY` al brazo armado. `seq` es estrictamente creciente. El servidor satura los ejes en [-1,1] y no concede permisos extra al cliente. Los tokens se regeneran al reiniciar el servidor. La operación es local, sin TLS, únicamente para redes de confianza.

## 6. QA por capas

- **Unit:** vector de entrada inválido, contactos geométricos de borde, update de partículas, rebote, puntuación.
- **Integration:** dos WebSockets reales, reasignación de cupo, pérdida/reconexión de host, QR decodificable, API.
- **Browser:** compatibilidad WebGL2, tocar dos pads simultáneamente, gyro desactivado, safe areas en iPhone, fullscreen en Android.
- **Networking:** router offline, hotspot sin Internet, pérdida intermitente, cambio de IP, varias NIC, firewall y client isolation.
- **Load:** 120 Hz CPU con 2 personajes + 265 gotas y latencia de interacción observable; modo Eco para tablets.
- **Fair play:** repetición de eventos con seed fija, diferencia máxima de alcance permitida y tests de colisión simétrica.

## 7. Riesgos y mitigaciones

1. **Client isolation:** Wi-Fi de invitados bloquea conexiones; indicar usar LAN doméstica o hotspot sin aislamiento.
2. **HTTP / iOS Motion:** sensores podrían exigir HTTPS; mando de muñeca táctil siempre disponible.
3. **GPU móvil:** WebGL2 no garantiza 60 fps; ofrecer ECO y reducción escalonada de carga.
4. **Colisión 2D:** la simulación es una proyección física simplificada; no afirmar contacto 3D exacto.
5. **Tokens LAN:** no están cifrados; no exponer servidor al exterior.
6. **Tablets iOS:** Safari como host de simulación sí; como host servidor Node en la misma tablet, no por la vía estándar.
7. **Altas expectativas visuales:** hiperrealismo de agua requiere un hito específico y validación contra referencias.
