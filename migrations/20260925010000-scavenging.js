'use strict';

// Collecte : options débloquées par village et expéditions en cours.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const villages = await qi.describeTable('Villages');
  if (!villages.scavenging) await qi.addColumn('Villages', 'scavenging', { type: DataTypes.JSON, allowNull: false, defaultValue: {} });
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('ScavengeRuns')) return;
  await qi.createTable('ScavengeRuns', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    option: { type: DataTypes.INTEGER, allowNull: false },
    units: { type: DataTypes.JSON, allowNull: false },
    resources: { type: DataTypes.JSON, allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    villageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
  });
  await qi.addIndex('ScavengeRuns', ['villageId']);
  await qi.addIndex('ScavengeRuns', ['endsAt']);
}

async function down({ context: qi }) {
  await qi.dropTable('ScavengeRuns');
  await qi.removeColumn('Villages', 'scavenging');
}

module.exports = { up, down };
