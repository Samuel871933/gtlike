'use strict';

// Réglage du compte : afficher ou non les encarts de rappel de la quête en cours (Compte → Quêtes).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const users = await qi.describeTable('Users');
  if (!users.questReminders) await qi.addColumn('Users', 'questReminders', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Users', 'questReminders');
}

module.exports = { up, down };
