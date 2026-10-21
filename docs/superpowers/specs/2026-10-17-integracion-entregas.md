# Integración de las cuatro entregas

Instrucción humana nueva: implementar completo lo entregado por Audio, Escenografía, Personajes e Items. La presentación sigue siendo PC sólo escena y todos los menús en móviles.

Audio: conectar eventos del motor, observación física y pausa inmediata con la API entregada, sin duplicar efectos. Música modal desde stems locales; las restricciones de audio del navegador se conservan.

Items: consumir los siete GLB con sus texturas/materiales reales, en los agarres y direcciones del rig. Las zonas de impacto y la defensa permanecen definidas por el catálogo físico. El mazo conserva agarre secundario a-.22m; sin escudo no se dibuja una defensa. La extensión de la hoja no desplaza arbitrariamente el agarre.

Personajes: consumir los cuerpos rígidos PBR v2 normal/ámbar/jefe mediante sus propias matrices de bind y retarget a los segmentos del motor. Ninguna pose estática sustituye articulaciones. El globo, nudo, agua, ruptura y látex siguen bajo el solver actual. Los estudios de agua/burst del asset no son otra simulación ni un vídeo del juego.

Escenografía: convertir la escena Blender editable a un asset de runtime con materiales visibles, agrupación razonable y tarima alineada con TABLE_TOP. Conservar origen/escala/transformación en contrato; excluir agua y gotas estáticas. El renderer usa el taller real para escena, sombras y reflexión de entorno. No usar renders offline como fondo para fingir integración3D.

Carga local asincrónica con límites/errores, limpieza de buffers/texturas, fallback temporal procedural mientras se carga o si falla, y estado de carga accesible en el móvil. No CDN ni decodificadores de red. Compatibilidad con replay/cámara/calidades y recuperación de contexto.

Aceptación: pruebas reales de GLB/índices/pesos/UV/materiales, sockets y rangos con motor; evidencia WebGL de las cuatro entregas en escena y cambios desde mando; volumen/score inalterados; recursos locales y memoria/draws medidos; regresión global posterior al corte conjunto. La nueva integración invalida usar el antecedente416/416 como certificación final, que sigue siendo válido para el corteUI previo.
