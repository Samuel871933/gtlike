'use strict';

// Gestionnaire de compte : les modèles du joueur appartiennent au compte (ManagerTemplates.userId), sur tous ses
// mondes, et non plus à son joueur d'un monde (playerId, retiré). Réglage des villages par page des listes du
// gestionnaire (Players.managerPerPage).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const columns = await qi.describeTable('ManagerTemplates');
  if (!columns.userId) {
    await qi.addColumn('ManagerTemplates', 'userId', {
      type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE',
    });
  }
  if (columns.playerId) {
    await qi.sequelize.query('UPDATE ManagerTemplates SET userId = (SELECT userId FROM Players WHERE Players.id = ManagerTemplates.playerId) WHERE userId IS NULL');
    // Modèles de bots (sans compte) : rien à garder.
    await qi.sequelize.query('DELETE FROM ManagerTemplates WHERE userId IS NULL');
    if (qi.sequelize.getDialect() === 'mysql') {
      for (const fk of await qi.getForeignKeyReferencesForTable('ManagerTemplates')) {
        if (fk.columnName === 'playerId') await qi.removeConstraint('ManagerTemplates', fk.constraintName);
      }
      for (const index of await qi.showIndex('ManagerTemplates')) {
        if (!index.primary && index.fields.length === 1 && index.fields[0].attribute === 'playerId') await qi.removeIndex('ManagerTemplates', index.name);
      }
    }
    await qi.removeColumn('ManagerTemplates', 'playerId');
  }
  // Sous SQLite, removeColumn recrée la table sans ses index.
  const indexes = (await qi.showIndex('ManagerTemplates')).map((i) => i.fields.map((f) => f.attribute).join(','));
  if (!indexes.includes('userId')) await qi.addIndex('ManagerTemplates', ['userId']);
  const players = await qi.describeTable('Players');
  if (!players.managerPerPage) await qi.addColumn('Players', 'managerPerPage', { type: DataTypes.INTEGER, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'managerPerPage');
  await qi.addColumn('ManagerTemplates', 'playerId', { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
}

module.exports = { up, down };
