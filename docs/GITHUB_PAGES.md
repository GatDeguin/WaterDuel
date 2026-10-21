# GitHub Pages

URL del juego: **https://gatdeguin.github.io/WaterDuel/**.

La entrada distingue el dispositivo. En el teléfono abre el juego individual con
dos joysticks en pantalla y menú; conviene usar horizontal. En PC muestra la
escenografía a pantalla completa, sin mandos ni menús. Los enlaces antiguos a
`mobile.html` también vuelven a la entrada de PC cuando se abren en computadora.
`?view=mobile` y `?view=desktop` permiten elegir la vista explícitamente.

El juego individual móvil incluye duelo contra IA, campaña y sus opciones sin
necesitar una PC. La descarga inicial de modelos y audio requiere conexión.
El Versus de PC con QR y dos móviles necesita el servidor LAN: Pages sólo sirve
archivos estáticos y no crea sesiones ni retransmite los mandos. Por eso la
entrada de PC publicada en Pages muestra la escena, pero no genera QR ficticios
ni inicia una partida sin servidor. Para jugar en PC, usá el lanzador local y
los QR de esa arena.

## Construcción

Con Node.js 20 o superior, sin instalar dependencias:

```sh
npm run build:pages
```

La salida es `.runtime/pages-site/`. Se puede servir esa carpeta desde cualquier
servidor estático, incluso montada en `/WaterDuel/`. El build conserva `index.html`
para PC, `mobile.html` para móviles y el selector compartido `entry.js`. Conserva
los recursos binarios sin compresión ni cambios de calidad y adapta el enlace
LAN móvil a sus instrucciones. Excluye las páginas de
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
