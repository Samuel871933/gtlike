'use strict';

const { DataTypes } = require('sequelize');

// Serveurs privés : un monde créé par un joueur (ownerUserId), ouvert à tous ou réservé aux détenteurs du code.
async function up({ context: qi }) {
  const worlds = await qi.describeTable('Worlds');
  if (!worlds.ownerUserId) await qi.addColumn('Worlds', 'ownerUserId', { type: DataTypes.INTEGER, allowNull: true });
  if (!worlds.access) await qi.addColumn('Worlds', 'access', { type: DataTypes.STRING(8), allowNull: true });
  // SQLite ne sait pas ajouter une colonne UNIQUE : colonne simple, puis index unique (les codes nuls ne se gênent pas).
  if (!worlds.joinCode) await qi.addColumn('Worlds', 'joinCode', { type: DataTypes.STRING(12), allowNull: true });
  const indexes = await qi.showIndex('Worlds');
  if (!indexes.some((i) => i.fields.map((f) => f.attribute).join(',') === 'joinCode')) await qi.addIndex('Worlds', ['joinCode'], { unique: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Worlds', 'joinCode');
  await qi.removeColumn('Worlds', 'access');
  await qi.removeColumn('Worlds', 'ownerUserId');
}

module.exports = { up, down };
