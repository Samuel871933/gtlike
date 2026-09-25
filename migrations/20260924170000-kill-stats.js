'use strict';

// Adversaires vaincus : ODA, ODD, ODS par joueur.

const { DataTypes } = require('sequelize');

const COLUMNS = ['killsAttacker', 'killsDefender', 'killsSupporter'];

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  for (const c of COLUMNS) {
    if (!players[c]) await qi.addColumn('Players', c, { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  }
}

async function down({ context: qi }) {
  for (const c of COLUMNS) await qi.removeColumn('Players', c);
}

module.exports = { up, down };
