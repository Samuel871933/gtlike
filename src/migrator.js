'use strict';

const path = require('path');
const { Umzug, SequelizeStorage } = require('umzug');
const { sequelize } = require('./models');

/** Migrations du dossier migrations/, suivies dans la table SequelizeMeta (même format que sequelize-cli). */
function createMigrator(db = sequelize) {
  return new Umzug({
    migrations: { glob: path.join(__dirname, '..', 'migrations', '*.js').replace(/\\/g, '/') },
    context: db.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize: db }),
    logger: undefined,
  });
}

module.exports = { createMigrator };
