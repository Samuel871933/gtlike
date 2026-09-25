'use strict';

// Conditions de victoire : état de fin de partie des mondes, villages spéciaux (runes, Grand Siège).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const worlds = await qi.describeTable('Worlds');
  if (!worlds.victoryState) await qi.addColumn('Worlds', 'victoryState', { type: DataTypes.JSON, allowNull: false, defaultValue: {} });
  if (!worlds.endedAt) await qi.addColumn('Worlds', 'endedAt', { type: DataTypes.DATE, allowNull: true });
  if (!worlds.winnerTribeId) await qi.addColumn('Worlds', 'winnerTribeId', { type: DataTypes.INTEGER, allowNull: true });
  if (!worlds.winnerPlayerId) await qi.addColumn('Worlds', 'winnerPlayerId', { type: DataTypes.INTEGER, allowNull: true });
  const villages = await qi.describeTable('Villages');
  if (!villages.special) await qi.addColumn('Villages', 'special', { type: DataTypes.STRING(8), allowNull: true });
}

async function down({ context: qi }) {
  for (const c of ['victoryState', 'endedAt', 'winnerTribeId', 'winnerPlayerId']) await qi.removeColumn('Worlds', c);
  await qi.removeColumn('Villages', 'special');
}

module.exports = { up, down };
