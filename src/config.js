'use strict';

require('dotenv').config({ quiet: true });

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || null,
  sqliteStorage: process.env.SQLITE_STORAGE || 'data/game.sqlite',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-a-changer',
  isProduction: process.env.NODE_ENV === 'production',
  gameLoopIntervalMs: Number(process.env.GAME_LOOP_MS) || 5000,
};
