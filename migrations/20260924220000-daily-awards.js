'use strict';

// Succès quotidiens : compteurs par joueur et par jour, succès attribués.

const { DataTypes } = require('sequelize');

const ref = (model) => ({
  type: DataTypes.INTEGER, allowNull: false, references: { model, key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE',
});
const counter = { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 };
const stamps = { createdAt: { type: DataTypes.DATE, allowNull: false }, updatedAt: { type: DataTypes.DATE, allowNull: false } };

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('DailyStats')) {
    await qi.createTable('DailyStats', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      day: { type: DataTypes.STRING(10), allowNull: false },
      plunders: counter, unitsKilledAttacker: counter, unitsKilledDefender: counter, unitsKilledSupporter: counter, conquests: counter, loot: counter,
      ...stamps,
      worldId: ref('Worlds'),
      playerId: ref('Players'),
    });
    await qi.addIndex('DailyStats', ['playerId', 'day'], { unique: true });
    await qi.addIndex('DailyStats', ['worldId', 'day']);
  }
  if (!tables.includes('DailyAwards')) {
    await qi.createTable('DailyAwards', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      day: { type: DataTypes.STRING(10), allowNull: false },
      key: { type: DataTypes.STRING(24), allowNull: false },
      value: { type: DataTypes.INTEGER, allowNull: false },
      ...stamps,
      worldId: ref('Worlds'),
      playerId: ref('Players'),
    });
    await qi.addIndex('DailyAwards', ['worldId', 'day', 'key'], { unique: true });
    await qi.addIndex('DailyAwards', ['playerId']);
  }
}

async function down({ context: qi }) {
  await qi.dropTable('DailyAwards');
  await qi.dropTable('DailyStats');
}

module.exports = { up, down };
