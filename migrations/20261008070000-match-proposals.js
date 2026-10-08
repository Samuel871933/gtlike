'use strict';

// Matchup : parties trouvées en attente d'acceptation (fenêtre « Accepter » de 15 s, voir MatchService).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('MatchProposals')) return;
  await qi.createTable('MatchProposals', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    format: { type: DataTypes.STRING(4), allowNull: false },
    teams: { type: DataTypes.JSON, allowNull: false },
    accepted: { type: DataTypes.JSON, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
}

async function down({ context: qi }) {
  await qi.dropTable('MatchProposals');
}

module.exports = { up, down };
