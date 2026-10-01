'use strict';

// Images de profil des joueurs et des tribus : nom du fichier WebP (dans le dossier des envois), nul sans image.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  for (const table of ['Players', 'Tribes']) {
    const cols = await qi.describeTable(table);
    if (!cols.avatar) await qi.addColumn(table, 'avatar', { type: DataTypes.STRING(64), allowNull: true });
  }
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'avatar');
  await qi.removeColumn('Tribes', 'avatar');
}

module.exports = { up, down };
