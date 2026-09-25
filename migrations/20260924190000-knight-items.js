'use strict';

// Armes du paladin.

const { DataTypes } = require('sequelize');

const COLUMNS = {
  knightItems: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  knightItem: { type: DataTypes.STRING(16), allowNull: true },
  knightProgress: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
  knightProgressAt: { type: DataTypes.DATE, allowNull: true },
  knightRecruited: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
};

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  for (const [name, def] of Object.entries(COLUMNS)) {
    if (!players[name]) await qi.addColumn('Players', name, def);
  }
}

async function down({ context: qi }) {
  for (const name of Object.keys(COLUMNS)) await qi.removeColumn('Players', name);
}

module.exports = { up, down };
