#!/data/data/com.termux/files/usr/bin/bash
# Tablet Android usada como HOST. Requiere Termux y Node.js instalados previamente.
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Necesitás Node.js dentro de Termux. No se requiere instalar paquetes al ejecutar la arena."
  exit 1
fi
echo "WATER DUEL · TABLET ANDROID COMO HOST"
echo "Mantené Termux activo; abrí http://127.0.0.1:8787 en la tablet."
node server.mjs
