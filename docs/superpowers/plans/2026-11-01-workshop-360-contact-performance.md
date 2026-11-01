# Taller completo y contactos fluidos · 1.11

El usuario solicita completar el escenario para los ángulos revelados por las cámaras cinematográficas y resolver las caídas de rendimiento durante el contacto de armas.

1. Añadir una extensión GLB independiente al taller existente: cerramientos laterales, nave frontal, pared opuesta, techo, vigas, mobiliario y detalles de uso. Conservar los assets históricos y los elementos móviles existentes.
2. Integrar la extensión en la carga del taller, los pases de sombras y la captura de reflejos. Agrupar geometría estática sin recortar detalle. Registrar límites y presupuesto del asset.
3. Mantener la cámara dentro de un volumen interior seguro. Conservar los resultados actuales cuando ya están dentro y adaptar el campo visual en pantallas estrechas después de limitar la posición.
4. Medir y reducir el coste de proyectar las marcas de contacto sobre el equipo real. Conservar triángulos elegidos, materiales, deformación, marcas, daño y geometría resultante.
5. Medir el solver durante choques y fricción reales; eliminar únicamente trabajo redundante con guardas exactas y comparaciones A/B y A/A. No reducir frecuencia física, iteraciones, calidad ni funcionalidades.
6. Revisar el taller desde los ángulos nuevos, la continuidad de cámaras y las interacciones. Ejecutar pruebas focales y suite de CI; publicar un corte separado del 1.10 ya congelado.

La arena de PC conserva únicamente la escena y sus QR. La configuración permanece en el móvil. Los resultados de CPU y GPU se comunicarán por separado; una mejora aislada no acredita 60 FPS sostenidos en todos los dispositivos.
