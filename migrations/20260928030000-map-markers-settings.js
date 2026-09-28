'use strict';

// Carte : réglages mémorisés par joueur (tailles, calques) et marquages de couleur (joueur, tribu, village).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.mapSettings) await qi.addColumn('Players', 'mapSettings', { type: DataTypes.JSON, allowNull: true });
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('MapMarkers')) return;
  await qi.createTable('MapMarkers', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    targetType: { type: DataTypes.STRING(8), allowNull: false },
    targetId: { type: DataTypes.INTEGER, allowNull: false },
    color: { type: DataTypes.STRING(7), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
  });
  await qi.addIndex('MapMarkers', ['playerId', 'targetType', 'targetId'], { unique: true });
}

async function down({ context: qi }) {
  await qi.dropTable('MapMarkers');
  await qi.removeColumn('Players', 'mapSettings');
}

module.exports = { up, down };
