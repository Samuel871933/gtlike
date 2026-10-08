'use strict';

// Production avec PM2 : `pm2 start ecosystem.config.js` (voir « Mise en production » dans le README).
// Les deux processus lisent le .env eux-mêmes ; ici, seulement ce qui les distingue (WEB_INSTANCES, PM2_MAX_MEMORY).
require('dotenv').config({ path: `${__dirname}/.env`, quiet: true });

const common = {
  script: 'src/server.js',
  cwd: __dirname,
  // Relance après un plantage, avec une attente qui grandit si le processus replante aussitôt
  // (migration en attente, base injoignable…) au lieu de boucler à vide.
  autorestart: true,
  exp_backoff_restart_delay: 200,
  max_memory_restart: process.env.PM2_MAX_MEMORY || '1G',
  // Laisse finir les requêtes et le tour de boucle en cours avant de tuer le processus.
  kill_timeout: 10000,
  time: true,
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      ...common,
      // Boucle de jeu seule, sans pages. Processus « principal » : crée la table des sessions et les mondes.
      name: 'adarma-loop',
      exec_mode: 'fork',
      instances: 1,
      env: { NODE_ENV: 'production', HTTP: '0' },
    },
    {
      ...common,
      // Pages, en cluster sur le même port. Aucun n'est principal : PM2 numérote ses instances dans
      // PM2_INSTANCE et NODE_APP_INSTANCE reste à 1 (sinon l'instance 0 referait le travail de la boucle).
      name: 'adarma-web',
      exec_mode: 'cluster',
      instances: Number(process.env.WEB_INSTANCES) || 2,
      instance_var: 'PM2_INSTANCE',
      env: { NODE_ENV: 'production', GAME_LOOP: '0', NODE_APP_INSTANCE: '1' },
    },
  ],
};
