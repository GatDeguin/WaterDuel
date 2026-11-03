# Archivos originales de diagnóstico

Los `.log` y `.patch` enumerados en los recibos de contactos, agua y descartes de IA, y en el overlay de alcance de la apertura, están publicados en [raw-artifacts.zip](raw-artifacts.zip), conservando sus rutas completas desde la raíz del repositorio. Al extraerlo en esa raíz se reconstruyen los archivos referidos por los recibos.

Se preservan exactamente sus bytes, incluidos los finales de línea y el contexto de los diffs. La compresión evita reescribir las pruebas originales para satisfacer comprobaciones de espacios del código. El [índice](raw-artifacts.json) fija el SHA-256 de cada miembro y del archivo comprimido; ambos se verifican antes de publicar. Los originales locales y los manifiestos de los agentes permanecen intactos.
