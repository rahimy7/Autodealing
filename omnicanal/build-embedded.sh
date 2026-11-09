#!/bin/sh
# Compila Omnicanal para correr dentro del sitio de Premier, publicado en /omnicanal/ del
# mismo dominio (server/omni-embed.js). Lo usan el Dockerfile de la raíz y `npm run
# omnicanal:build`. Requiere las dependencias ya instaladas (pnpm install).
set -eu
cd "$(dirname "$0")"

# El panel se compila con su prefijo y con el botón para entrar con la cuenta del sitio.
BASE_PATH=/omnicanal/ VITE_SITE_LOGIN_URL=/omnicanal/entrar \
  pnpm --filter @workspace/omnicanal run build
pnpm --filter @workspace/api-server run build

# El servidor sirve el panel desde dist/public, junto a su bundle.
rm -rf artifacts/api-server/dist/public
cp -R artifacts/omnicanal/dist/public artifacts/api-server/dist/public
