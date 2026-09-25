'use strict';

const { Sequelize } = require('sequelize');
const config = require('./config');

// PostgreSQL si DATABASE_URL est défini, sinon SQLite local (dev / tests).
const sequelize = config.databaseUrl
  ? new Sequelize(config.databaseUrl, { logging: false })
  : new Sequelize({
    dialect: 'sqlite',
    storage: config.sqliteStorage,
    logging: false,
    // Verrou d'écriture dès le début de la transaction : évite les doubles dépenses.
    transactionType: 'IMMEDIATE',
  });

module.exports = sequelize;
