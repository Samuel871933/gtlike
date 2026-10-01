'use strict';

require('dotenv').config({ quiet: true });

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || null,
  sqliteStorage: process.env.SQLITE_STORAGE || 'data/game.sqlite',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-a-changer',
  isProduction: process.env.NODE_ENV === 'production',
  // Origine publique utilisée pour les URL canoniques et les aperçus sociaux.
  siteUrl: process.env.SITE_URL ? new URL(process.env.SITE_URL).origin : null,
  // Images envoyées par les joueurs (profils), servies sous /uploads.
  uploadsDir: process.env.UPLOADS_DIR || 'data/uploads',
  gameLoopIntervalMs: Number(process.env.GAME_LOOP_MS) || 5000,
  // Tests : happy hour des Adartons forcée en permanence (HAPPY_HOUR_FORCE=1), jamais en production.
  happyHourForce: process.env.NODE_ENV !== 'production' && process.env.HAPPY_HOUR_FORCE === '1',
};
