'use strict';

// Attaques entrantes, comme sur Guerre Tribale : le défenseur renomme ou étiquette un ordre entrant, l'annote ou
// l'ignore (Commands.incomingName, incomingNote, incomingIgnored), et règle le format du bouton « Étiqueter »
// (Players.incomingLabelFormat).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const commands = await qi.describeTable('Commands');
  if (!commands.incomingName) await qi.addColumn('Commands', 'incomingName', { type: DataTypes.STRING(64), allowNull: true });
  if (!commands.incomingNote) await qi.addColumn('Commands', 'incomingNote', { type: DataTypes.TEXT, allowNull: true });
  if (!commands.incomingIgnored) {
    await qi.addColumn('Commands', 'incomingIgnored', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }
  const players = await qi.describeTable('Players');
  if (!players.incomingLabelFormat) await qi.addColumn('Players', 'incomingLabelFormat', { type: DataTypes.STRING(120), allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'incomingLabelFormat');
  for (const col of ['incomingIgnored', 'incomingNote', 'incomingName']) await qi.removeColumn('Commands', col);
}

module.exports = { up, down };
