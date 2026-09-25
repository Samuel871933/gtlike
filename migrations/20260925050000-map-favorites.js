'use strict';

// Villages favoris des joueurs (menu et panneau « Favoris » de la carte).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('MapFavorites')) return;
  await qi.createTable('MapFavorites', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    villageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
  });
  await qi.addIndex('MapFavorites', ['playerId', 'villageId'], { unique: true });
}

async function down({ context: qi }) {
  await qi.dropTable('MapFavorites');
}

module.exports = { up, down };
