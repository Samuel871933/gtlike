#!/usr/bin/env bash
# Mise à jour en production : code, dépendances, CSS, migrations, puis relance des processus PM2.
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
# Dépendances de dev comprises : Tailwind sert à compiler le CSS.
npm ci
npm run build:css
NODE_ENV=production npm run migrate

if pm2 describe adarma-web > /dev/null 2>&1; then
  # Relance sans coupure des pages (une instance après l'autre), puis la boucle.
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save
