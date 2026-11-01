# Duelo, música y rotura Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Entregar los cinco cambios pedidos, la eliminación de `wood-contact` y las entradas PC/LAN y móvil.
**Architecture:** Equipamiento físico/visual compartido; nueva capa de audio sobre el banco grabado; ajustes tipados desde móvil al host; cámara de presentación independiente del solver y perfil medido del agua.
**Tech Stack:** JavaScript ES modules, WebGL2, Web Audio, HTMLAudioElement, Node tests y Python/NumPy para inspección de assets.
**Spec:** ../specs/2026-11-01-duel-audio-matrix-design.md

## Global Constraints

- Preservar calidad, geometría, partículas, física y controles. La PC muestra sólo escena y QR.
- Apertura de duelo de 3,8 unidades; contra el jefe, 4,0. Ejercicios e IA conservan sus comportamientos históricos.
- Solver de rotura fijo a 120 Hz y cámara lenta existente de 0,3×; no vincular el tiempo a los FPS.
- Volúmenes/mezcla ajustables desde menú móvil, transporte validado y estado aplicado confirmado.
- Copias exactas de los cuatro MP3 del usuario; no cargar música vieja en el juego real.
- Excluir `wood-contact` de toda reproducción, incluidos eventos y fallback. Conservar `wood`, `joint` y los eventos físicos de daño.

## Review Focus

- Hacha reflejada J2 y arma desprendida: visual y colisión coinciden.
- Boss/lanza al iniciar: separación suficiente y sin impacto gratuito.
- Sliders durante combate/reconexión: sólo cambia audio tras estado autoritativo.
- Mute/pausa/contexto cerrado: no quedan voces, pistas o reverb antiguas sonando.
- Rotura/replay/movimiento reducido: cámara finita, sin cortes ni oclusión por el escenario y sin mutar solver; impacto visible en el primer plano y composición completa al retornar.
- Puente de ronda: continuidad real de `burst` en la ronda actual a `countdown` en la siguiente, con reloj continuo.

## Task 1: Posiciones y hacha

**Files:** public/engine.js, public/equipment.js, public/rendering/equipment.js, public/rendering/asset-rig.js y tramo de cabezal en public/physics/articulated-rig.js; pruebas nuevas de apertura y hacha.
**Interfaces:** mismas poses, equipo y API de contactos. `#startRound` aplica la apertura de 3,8/4,0 sólo a los duelos; los ejercicios conservan su colocación. Modelo y colisión comparten la transformación asimétrica del hacha.
- [ ] Reproducir fallo y agregar tests RED para ambos lados/reset.
- [ ] Implementar separación y orientación.
- [ ] Verificar contactos, armas desprendidas y campañas.

## Task 2: Música y procesamiento

**Files:** public/audio/workshop-game-audio.js y módulos auxiliares, public/music/*.mp3; tests de música y DSP.
**Interfaces:** `WorkshopGameAudio.configure(enabled, master, {music, effects, distortion, reverb, reverbDecay})`; `master` de 0 a 100, los cuatro primeros ajustes de 0 a 1 y `reverbDecay` de 0,2 a 2,4 s.
- [ ] Tests RED de playlists, lifecycle, orden DSP y memoria.
- [ ] Implementar streaming, FX compartidos y copias exactas.
- [ ] Verificar sin cambios en guardas históricas.
- [ ] Excluir `wood-contact` en llamadas directas, eventos, escena y fallback; verificar que `wood`, `joint` y los eventos de daño conservan sus demás capas.

## Task 3: Menú y persistencia

**Files:** public/host-session.js, public/remote-menu.js, public/controller.js, public/mobile.html, public/controller.html, public/game.js y public/audio/sound-settings.js; tests de host, protocolo y controlador.
**Interfaces:** comandos `setMusicVolume`, `setEffectsVolume`, `setDistortion`, `setReverb` con enteros de 0 a 100; `setReverbDecay` con enteros de 200 a 2400 ms. El estado utiliza los mismos campos sin el prefijo `set`. El host transforma los valores para la API normalizada.
- [ ] Tests RED de tipos/límites, almacenamiento, ACK y restore.
- [ ] Añadir sección Sonido con valores por defecto del diseño.
- [ ] Conectar clase real de audio y verificar flujo PC/móvil.

## Task 4: Cámara y rendimiento

**Files:** public/rendering/matrix-camera.js, public/rendering/cinematic-camera.js, import e invocación en public/render3d.js, pruebas de cámara, consultas de paneles en public/physics/articulated-rig.js y benchmark en .runtime/release-1.10.0.
**Interfaces:** la cámara recibe un snapshot con `phase`, `phaseClock`, `clock`, `round` y `fighters`; funde el foco desde el impacto guardado hacia el centro volumétrico de las parcelas de agua, sin mutar el snapshot ni depender de historial.
- [ ] Tests RED de órbita amplia, primer plano del agua en caída, altura segura, continuidad entre rondas, retorno y reducedMotion/replay.
- [ ] Implementar barridos, cambios de altura y aproximación en espera/entrada; órbita de unos 62° y detalle en la rotura; restaurar el combate original antes del puente de ronda.
- [ ] Medir candidato de CPU, conservar sólo mejora fuera del ruido con equivalencia.

## Task 5: Integración y entrega

- [ ] Revisar diffs y ejecutar pruebas focales y build.
- [ ] QA navegador real, screenshots y audio; cerrar procesos temporales.
- [ ] Promover allowlist al clon Git limpio y ejecutar suite general/publicación autorizada.
- [ ] Verificar bytes públicos y comunicar resultados con límites medidos.
