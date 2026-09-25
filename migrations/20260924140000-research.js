'use strict';

// Recherche à la forge : unités recherchées par village et file de recherche.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const villages = await qi.describeTable('Villages');
  if (!villages.research) {
    await qi.addColumn('Villages', 'research', { type: DataTypes.JSON, allowNull: false, defaultValue: {} });
  }

  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('ResearchOrders')) return;
  await qi.createTable('ResearchOrders', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    unit: { type: DataTypes.STRING(16), allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    villageId: {
      type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE',
    },
  });
  await qi.addIndex('ResearchOrders', ['villageId']);
  await qi.addIndex('ResearchOrders', ['endsAt']);
}

async function down({ context: qi }) {
  await qi.dropTable('ResearchOrders');
  await qi.removeColumn('Villages', 'research');
}

module.exports = { up, down };
