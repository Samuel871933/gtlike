'use strict';

// Suppression de compte : les messages d'un joueur supprimé restent, sans auteur.

const { DataTypes } = require('sequelize');

const AUTHOR = {
  type: DataTypes.INTEGER, allowNull: true, references: { model: 'Players', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE',
};

// Sous SQLite, changeColumn recrée la table et perd ses index : on les remet.
const INDEXES = { ConversationMessages: ['conversationId', 'createdAt'], TribeMessages: ['tribeId', 'createdAt'] };

/** Sous MySQL, changeColumn n'ajoute qu'une clé étrangère de plus : on remplace l'ancienne et on modifie la colonne. */
async function mysqlChange(qi, table, { references, onDelete, onUpdate, ...column }) {
  for (const fk of await qi.getForeignKeyReferencesForTable(table)) {
    if (fk.columnName === 'playerId') await qi.removeConstraint(table, fk.constraintName);
  }
  await qi.changeColumn(table, 'playerId', column);
  await qi.addConstraint(table, {
    type: 'foreign key', fields: ['playerId'], references: { table: references.model, field: references.key }, onDelete, onUpdate,
  });
}

async function change(qi, definition) {
  for (const [table, fields] of Object.entries(INDEXES)) {
    if (qi.sequelize.getDialect() === 'mysql') await mysqlChange(qi, table, definition);
    else await qi.changeColumn(table, 'playerId', definition);
    const existing = (await qi.showIndex(table)).map((i) => i.fields.map((f) => f.attribute).join(','));
    if (!existing.includes(fields.join(','))) await qi.addIndex(table, fields);
  }
}

async function up({ context: qi }) {
  await change(qi, AUTHOR);
}

async function down({ context: qi }) {
  await change(qi, { ...AUTHOR, allowNull: false, onDelete: 'NO ACTION' });
}

module.exports = { up, down };
