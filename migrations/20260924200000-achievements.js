'use strict';

// Succès : compteurs par joueur, date d'entrée dans la tribu, paliers atteints.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.stats) await qi.addColumn('Players', 'stats', { type: DataTypes.JSON, allowNull: false, defaultValue: {} });
  if (!players.tribeJoinedAt) await qi.addColumn('Players', 'tribeJoinedAt', { type: DataTypes.DATE, allowNull: true });

  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('PlayerAchievements')) return;
  await qi.createTable('PlayerAchievements', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    key: { type: DataTypes.STRING(24), allowNull: false },
    tier: { type: DataTypes.INTEGER, allowNull: false },
    unlockedAt: { type: DataTypes.DATE, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    playerId: {
      type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE',
    },
  });
  await qi.addIndex('PlayerAchievements', ['playerId', 'key'], { unique: true });
}

async function down({ context: qi }) {
  await qi.dropTable('PlayerAchievements');
  await qi.removeColumn('Players', 'tribeJoinedAt');
  await qi.removeColumn('Players', 'stats');
}

module.exports = { up, down };
