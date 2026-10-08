'use strict';

// Récompenses de construction (comme sur Guerre Tribale) : BuildRewards, une ligne par bâtiment et niveau construit
// pour la première fois par un joueur, à récupérer (`collectedAt`).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('BuildRewards')) return;
  await qi.createTable('BuildRewards', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    villageId: { type: DataTypes.INTEGER, allowNull: true },
    building: { type: DataTypes.STRING(16), allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false },
    wood: { type: DataTypes.INTEGER, allowNull: false },
    stone: { type: DataTypes.INTEGER, allowNull: false },
    iron: { type: DataTypes.INTEGER, allowNull: false },
    earnedAt: { type: DataTypes.DATE, allowNull: false },
    collectedAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex('BuildRewards', ['playerId', 'building', 'level'], { unique: true });
  await qi.addIndex('BuildRewards', ['playerId', 'collectedAt']);
}

async function down({ context: qi }) {
  await qi.dropTable('BuildRewards');
}

module.exports = { up, down };
