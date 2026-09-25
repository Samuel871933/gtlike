'use strict';

// Paladins à compétences.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('Knights')) return;
  await qi.createTable('Knights', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    name: { type: DataTypes.STRING(32), allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    xp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    skills: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    alive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    homeVillageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
  });
  await qi.addIndex('Knights', ['playerId']);
  await qi.addIndex('Knights', ['homeVillageId'], { unique: true });
}

async function down({ context: qi }) {
  await qi.dropTable('Knights');
}

module.exports = { up, down };
