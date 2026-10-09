'use strict';

// Mode Zeppelin (src/modes/zeppelin) : vols des vaisseaux.

const { DataTypes } = require('sequelize');

const ref = (model) => ({ type: DataTypes.INTEGER, allowNull: false, references: { model, key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('ShipFlights')) return;
  await qi.createTable('ShipFlights', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    fromX: { type: DataTypes.INTEGER, allowNull: false },
    fromY: { type: DataTypes.INTEGER, allowNull: false },
    toX: { type: DataTypes.INTEGER, allowNull: false },
    toY: { type: DataTypes.INTEGER, allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    arrivesAt: { type: DataTypes.DATE, allowNull: false },
    landedAt: { type: DataTypes.DATE, allowNull: true },
    villageId: ref('Villages'),
    worldId: ref('Worlds'),
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex('ShipFlights', ['villageId'], { unique: true });
  await qi.addIndex('ShipFlights', ['worldId', 'landedAt']);
  await qi.addIndex('ShipFlights', ['arrivesAt']);
}

async function down({ context: qi }) {
  await qi.dropTable('ShipFlights');
}

module.exports = { up, down };
