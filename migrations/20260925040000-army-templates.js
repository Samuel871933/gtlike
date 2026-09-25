'use strict';

// Modèles d'armée des joueurs (« Ordres rapides » de la carte et du point de ralliement).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('ArmyTemplates')) return;
  await qi.createTable('ArmyTemplates', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    name: { type: DataTypes.STRING(32), allowNull: false },
    units: { type: DataTypes.JSON, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
  });
  await qi.addIndex('ArmyTemplates', ['playerId']);
}

async function down({ context: qi }) {
  await qi.dropTable('ArmyTemplates');
}

module.exports = { up, down };
