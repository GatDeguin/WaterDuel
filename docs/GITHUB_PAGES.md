# GitHub Pages

URL del juego: **https://gatdeguin.github.io/WaterDuel/**.

La web abre directamente la arena individual en el navegador, tanto desde el
teléfono como desde una computadora. En el teléfono conviene usar horizontal.
No depende de un servidor Node ni de una PC que ejecute la simulación. Incluye
duelo contra IA, campaña y las opciones de la versión móvil. La descarga inicial
de modelos y audio requiere conexión. El Versus con dos móviles y QR se ejecuta
con el servidor LAN; Pages sólo sirve archivos estáticos.

## Construcción

Con Node.js 20 o superior, sin instalar dependencias:

```sh
npm run build:pages
```

La salida es `.runtime/pages-site/`. Se puede servir esa carpeta desde cualquier
servidor estático, incluso montada en `/WaterDuel/`. El build usa `mobile.html`
para generar el índice, conserva los recursos binarios sin compresión ni cambios
de calidad y adapta el enlace LAN a sus instrucciones. Excluye las páginas de
QA y el mando que necesita WebSocket. No incluye certificados, sesiones,
servidor, pruebas ni archivos privados del repositorio. Cada build reemplaza
únicamente su carpeta de salida dedicada y rechaza enlaces simbólicos.

## Publicación automática

`.github/workflows/pages.yml` ejecuta la suite Node, construye el sitio y lo
publica con las acciones oficiales de GitHub, fijadas a sus commits. Se ejecuta
al cambiar `main` y permite ejecución manual desde Actions. El repositorio debe
usar GitHub Actions como fuente de Pages y permitir `main` en el entorno
`github-pages`. El despliegue usa el token temporal de Actions y OIDC.

Si falla una prueba o el build, no se ejecuta el despliegue. Para volver a una
versión anterior, revertí el commit correspondiente en `main`; la misma tarea
verificará y publicará esa versión sin reescribir el historial.
