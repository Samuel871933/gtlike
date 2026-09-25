'use strict';

// Suppression de compte : les messages d'un joueur supprimé restent, sans auteur.

const { DataTypes } = require('sequelize');

const AUTHOR = {
  type: DataTypes.INTEGER, allowNull: true, references: { model: 'Players', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE',
};

// Sous SQLite, changeColumn recrée la table et perd ses index : on les remet.
const INDEXES = { ConversationMessages: ['conversationId', 'createdAt'], TribeMessages: ['tribeId', 'createdAt'] };

async function change(qi, definition) {
  for (const [table, fields] of Object.entries(INDEXES)) {
    await qi.changeColumn(table, 'playerId', definition);
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
