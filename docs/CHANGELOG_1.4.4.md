# 1.4.4 · Arranque HTTPS en Windows

El lanzador anterior buscaba PowerShell únicamente en el PATH y continuaba cuando faltaba. Después, un permiso denegado al leer una clave TLS se convertía en un error genérico de certificado y el BAT sugería revisar el puerto, aunque éste estuviera libre.

El lanzador ahora fija el ejecutable Node.js que encontró, comprueba que sea 20 o superior y ejecuta un preflight local. Reutiliza TLS válido sin exigir PowerShell. Sólo prepara certificados por ausencia, caducidad del servidor o cambio de SAN; verifica PowerShell Core 7.2+ antes de usarlo y vuelve a validar el resultado. Los certificados explícitos incorrectos, errores de CA o permisos se detienen sin regenerar claves ni degradar la conexión a HTTP. `HTTPS=0` sigue siendo una elección explícita.

El preflight y el servidor comparten la misma selección de direcciones de red. `--check` comprueba la configuración sin abrir listeners. El arranque normal importa el servidor en el mismo proceso Node. Los mensajes distinguen permisos de lectura/metadatos, archivos ausentes y material inválido, sin mostrar claves ni mensajes internos del parser.

La reparación local de esta instalación concedió acceso a las dos claves al usuario propietario del perfil que abre el juego, manteniendo la protección de los archivos y sin añadir permisos grupales. No se cambió la identidad de la CA ni se instaló confianza en el sistema o en los móviles. Este ajuste local no forma parte de los archivos distribuidos.

Las regresiones incluyen detección/versiones de dependencias, reutilización TLS sin PowerShell, rechazo de errores de permisos y CA, preparación/revalidación, rutas con espacios y signos de exclamación, origen público y modos del CLI. Las pruebas HTTPS/WSS existentes mantienen validación de cadena, SAN, autenticación y aislamiento HTTP de la LAN.

La suite completa aprobó **898/898 pruebas**, en 112 archivos, sin omisiones ni cambios de las fuentes durante la ejecución: `audit/corte-1.4.4-arranque-01/receipt.json`. El guard de fuentes incluye ahora también los tres lanzadores raíz.

El BAT pasó `--check` con el PATH persistente de Windows, sin PowerShell 7 disponible. Un arranque real del bootstrap en puertos temporales verificó HTTP local, HTTPS autorizado con la CA existente, sesión compartida y ambos QR HTTPS. CA, certificado y claves quedaron intactos, y el proceso se cerró. El recibo saneado está en `audit/corte-1.4.4-arranque-01/windows-start-smoke.json`; no contiene invitaciones personales ni claves.
