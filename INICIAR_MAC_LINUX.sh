#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ no encontrado. Se requiere instalarlo una sola vez; después funciona sin Internet."
  exit 1
fi
if [ "${HTTPS:-}" != "0" ] && [ -z "${TLS_CERT_FILE:-}" ] && [ -z "${TLS_KEY_FILE:-}" ]; then
  if command -v pwsh >/dev/null 2>&1; then
    pwsh -NoProfile -File scripts/prepare-local-https.ps1
  else
    printf 'HTTPS: prepará certificados con PowerShell 7.2+ o configurá TLS_CERT_FILE/TLS_KEY_FILE. No se descarga ni instala nada.\n'
  fi
fi
printf '\nWATER DUEL · SERVIDOR DE ARENA OFFLINE\n'
printf 'Abrí http://localhost:8787 y compartí la Wi-Fi con los celulares.\n'
printf 'Escaneá J1/J2 en las esquinas de la arena. Sus menús controlan la partida.\n'
printf 'Una CA local requiere confianza manual en cada móvil; consultá docs/HTTPS_LOCAL.md.\n'
printf 'Ctrl+C detiene el servidor.\n\n'
node server.mjs
