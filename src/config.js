'use strict';

require('dotenv').config({ quiet: true });

module.exports = {
  port: Number(process.env.PORT) || 3000,
  // MySQL / MariaDB si DB_DIALECT=mysql, sinon SQLite local (tests).
  db: {
    dialect: process.env.DB_DIALECT || 'sqlite',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME || 'adarma',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    // Connexions ouvertes vers MySQL : chaque page en garde une pendant sa transaction.
    poolMax: Number(process.env.DB_POOL_MAX) || 30,
  },
  sqliteStorage: process.env.SQLITE_STORAGE || 'data/game.sqlite',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-a-changer',
  isProduction: process.env.NODE_ENV === 'production',
  // Cookie de session réservé au HTTPS : oui en production, non ailleurs. SESSION_COOKIE_SECURE=false le coupe (serveur
  // de test servi en http), SESSION_COOKIE_SECURE=true le force.
  sessionCookieSecure: process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production',
  // Origine publique utilisée pour les URL canoniques et les aperçus sociaux.
  siteUrl: process.env.SITE_URL ? new URL(process.env.SITE_URL).origin : null,
  // Images envoyées par les joueurs (profils), servies sous /uploads.
  uploadsDir: process.env.UPLOADS_DIR || 'data/uploads',
  gameLoopIntervalMs: Number(process.env.GAME_LOOP_MS) || 5000,
  // Plusieurs processus (pm2 -i, NODE_APP_INSTANCE = 0, 1, 2…) : seul le premier fait tourner la boucle de jeu,
  // applique les migrations et crée les mondes. GAME_LOOP=0 la coupe aussi dans un processus seul.
  primaryInstance: !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0',
  gameLoop: process.env.GAME_LOOP !== '0',
  // HTTP=0 : processus sans pages, pour la seule boucle de jeu (à côté de processus web lancés avec GAME_LOOP=0). Sous
  // forte charge, la boucle a ainsi son propre fil et ses propres connexions au lieu de faire la queue derrière les pages.
  http: process.env.HTTP !== '0',
  // Tests : happy hour des Adartons forcée en permanence (HAPPY_HOUR_FORCE=1), jamais en production.
  happyHourForce: process.env.NODE_ENV !== 'production' && process.env.HAPPY_HOUR_FORCE === '1',
  // E-mails (services/Mailer.js) : envoi SMTP dès que SMTP_HOST est renseigné, sinon écrits dans les logs.
  mail: {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT) || 587,
    // true : TLS dès la connexion (port 465) ; sinon STARTTLS si le serveur le propose (port 587).
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1',
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    from: process.env.MAIL_FROM || 'Adarma <no-reply@localhost>',
  },
};
