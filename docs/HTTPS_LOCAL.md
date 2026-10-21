# HTTPS para los móviles de WaterDuel

La PC conserva `http://localhost:8787`. Cuando hay certificados válidos, el mismo proceso sirve HTTPS en el puerto 8788 y ambos protocolos comparten una única sesión, autoridad y dos cupos. Los QR de la arena apuntan por defecto a `https://IP-LAN:8788/controller.html`; el mando selecciona WSS automáticamente.

Con TLS activo, HTTP ofrece la aplicación completa sólo a loopback real. Desde la LAN, API, códigos, controladores y WebSocket HTTP responden 426 con la dirección HTTPS; sólo la descarga de CA y `/https` quedan disponibles para preparación. La excepción se basa en la dirección del socket, sin confiar en `Host` o cabeceras de proxy. No se redirigen credenciales ni se amplía CORS.

## Preparación por instalación

En Windows, `INICIAR_WINDOWS.bat` comprueba Node.js 20 o superior y reutiliza los certificados locales cuando son válidos. En ese caso no necesita PowerShell ni vuelve a generar las claves. Para comprobar el arranque sin abrir los puertos:

```powershell
node scripts/windows-start.mjs --check
```

PowerShell 7.2 o superior sólo se necesita para crear los certificados o renovar el certificado de servidor si falta, caducó o cambió su dirección de red. El lanzador busca instalaciones en el PATH y en rutas habituales, comprueba su versión y conserva la misma autoridad local. Windows PowerShell 5.1 no sirve para esta preparación. También se puede ejecutar manualmente desde la carpeta del juego:

```powershell
pwsh -NoProfile -File scripts/prepare-local-https.ps1
node server.mjs
```

La preparación sólo crea archivos en `.local/tls`: CA local y certificado de servidor con SAN `localhost`, `127.0.0.1`, `::1` e IPv4 actuales de la PC. Usa RSA de 3072 bits y SHA-256; la CA dura diez años y el servidor 365 días. Al preparar de nuevo se conserva la CA y se renueva el servidor con las direcciones actuales. No necesita Internet, OpenSSL, elevación, un almacén de certificados ni instalar confianza en el sistema. Las claves tienen permisos de archivo restringidos al usuario actual. Cada instalación genera su propia identidad; el ZIP no contiene `.local`, certificados o claves de esta PC.

En una plataforma sin PowerShell 7.2 se pueden reutilizar certificados válidos o proporcionar certificados propios mediante las variables siguientes. Si el lanzador de Windows necesita preparar TLS y no encuentra PowerShell compatible, se detiene con ese diagnóstico. Los certificados configurados expresamente, una CA inválida o un permiso denegado no se sustituyen automáticamente. El juego no descarga dependencias ni instala confianza.

`HTTPS=1` exige TLS válido y falla si no está disponible. `HTTPS=0` desactiva expresamente HTTPS, como hacen las pruebas aisladas del servidor HTTP. El inicio directo con `node server.mjs` conserva su comportamiento anterior: sin archivos ni configuración TLS puede ofrecer sólo HTTP; para exigir HTTPS debe usarse el lanzador de Windows o `HTTPS=1`.

## Error de permisos al iniciar

Las claves creadas desde otra cuenta, incluida una cuenta aislada de herramientas, pueden no ser legibles por el usuario que abre el juego. En ese caso el inicio informa **Sin permiso para leer los archivos TLS** y se detiene. El usuario que inicia o renueva WaterDuel necesita acceso a las claves de `.local/tls`. Corregir ese acceso conserva la CA y los certificados ya conocidos por los móviles; no requiere borrarlos ni desactivar HTTPS. Las claves continúan fuera del directorio público y del ZIP.

| Variable | Uso |
| --- | --- |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | PEM de servidor/cadena y clave correspondientes; deben configurarse juntos. |
| `TLS_CA_FILE` | CA pública opcional para descarga; nunca una clave. |
| `HTTPS_PORT` | Puerto HTTPS; 8788 por defecto y distinto del puerto HTTP. |
| `PUBLIC_URL` | Origen HTTPS anunciado cuando TLS está activo, sin ruta, usuario, contraseña, query o fragmento. El certificado debe cubrir su hostname/IP. |
| `PORT` | Puerto HTTP; 8787 por defecto. |

Certificado caducado, clave incorrecta, SAN ausente, configuración incompleta o fallo del puerto TLS producen un error de inicio; no se anuncia HTTPS hasta que el listener TLS arranca. Si cambia la IP de Wi-Fi, preparar otra vez el certificado y reiniciar el servidor conserva la CA que los móviles ya conocen.

## Único paso manual en cada móvil

Una CA creada en esta PC todavía no es de confianza para el teléfono. Descargar **sólo la CA pública** desde la dirección `/certs/waterduel-local-ca.crt` mostrada por la consola, comparar su huella SHA-256 con la consola de la PC y confiar manualmente en esa CA en el dispositivo. Después, escanear el QR J1 o J2. No copiar `ca.key` o `server.key`, ni continuar ignorando una advertencia TLS.

- iPhone/iPad: un perfil instalado manualmente requiere habilitar además la confianza SSL de su raíz en Ajustes → General → Información → Ajustes de confianza de certificados. [Instrucciones oficiales de Apple](https://support.apple.com/en-ca/102390).
- Android: instalar la CA desde los ajustes de seguridad/credenciales del dispositivo; la ubicación depende del fabricante. [Instrucciones oficiales de Google para Pixel](https://support.google.com/pixelphone/answer/2844832/add-amp-remove-certificates).

El servidor ofrece únicamente el certificado público de la CA; no instala confianza ni modifica ajustes del navegador, la PC o los móviles. Un certificado propio que ya sea de confianza puede evitar este paso. La disponibilidad de sensores sigue dependiendo del navegador, sus permisos y el dispositivo; HTTPS no demuestra por sí mismo un ensayo físico de sensores.

## Verificación realizada

Los clientes de prueba de Node validan la cadena con la CA explícita y verifican los SAN; las conexiones sin confianza o con hostname incorrecto fallan. WSS autenticado se comunica con la autoridad HTTP, ambos cupos son compartidos y un segundo host se rechaza también entre puertos. La rotación TTL cierra ambos protocolos y crea una sola sesión nueva. Las pruebas no desactivan la verificación TLS, no importan una CA al sistema y no equivalen a confiar o escanear en teléfonos reales.

Referencias técnicas: [HTTPS de Node](https://nodejs.org/api/https.html), [TLS de Node](https://nodejs.org/api/tls.html), [X509Certificate](https://nodejs.org/api/crypto.html#class-x509certificate) y [CertificateRequest de .NET](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.x509certificates.certificaterequest?view=net-9.0).
