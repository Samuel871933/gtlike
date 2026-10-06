'use strict';

// Forums cachés (TribeForumSections.hidden, droit « Forum caché ») et forums partagés entre tribus (TribeForumShares :
// proposition de la tribu propriétaire, acceptée par la tribu invitée, qui peut en faire un forum caché chez elle).

const { DataTypes } = require('sequelize');

const ref = (model) => ({ type: DataTypes.INTEGER, allowNull: false, references: { model, key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

async function up({ context: qi }) {
  const section = await qi.describeTable('TribeForumSections');
  if (!section.hidden) await qi.addColumn('TribeForumSections', 'hidden', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('TribeForumShares')) {
    await qi.createTable('TribeForumShares', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      sectionId: ref('TribeForumSections'),
      tribeId: ref('Tribes'),
      accepted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('TribeForumShares', ['sectionId', 'tribeId'], { unique: true });
    await qi.addIndex('TribeForumShares', ['tribeId']);
  }
}

async function down({ context: qi }) {
  await qi.dropTable('TribeForumShares');
  await qi.removeColumn('TribeForumSections', 'hidden');
}

module.exports = { up, down };
