@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ==========================================================
echo       WATER DUEL - ARENA LOCAL SIN INTERNET
echo ==========================================================
set "WATERDUEL_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined WATERDUEL_NODE set "WATERDUEL_NODE=%%N"
if not defined WATERDUEL_NODE (
  echo.
  echo ERROR: No se encontro Node.js. Necesitas Node.js 20 o superior.
  echo Instalalo previamente. El juego no descarga dependencias.
  goto failed
)
"%WATERDUEL_NODE%" -e "if(Number(process.versions.node.split('.')[0])<20){console.error('ERROR: Se necesita Node.js 20 o superior. Version encontrada: '+process.versions.node);process.exit(1)}"
if errorlevel 1 goto failed
echo.
echo Los celulares ingresan escaneando J1/J2 en las esquinas de la arena.
echo En la PC se ve la escena y los QR. Todas las opciones estan en MENU del movil.
echo La consola anunciara las direcciones cuando TLS y el servidor esten listos.
echo No cierres esta ventana mientras quieras jugar.
echo.
"%WATERDUEL_NODE%" "%~dp0scripts\windows-start.mjs" %*
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo La arena no pudo iniciarse. Revisa el mensaje anterior: runtime, TLS o red.
pause
exit /b 1
