'use strict';

// Happy hour des Adartons : créneau déjà annoncé au compte par la popup du jeu (une seule fois par créneau).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const cols = await qi.describeTable('Users');
  if (!cols.happyHourSeen) await qi.addColumn('Users', 'happyHourSeen', { type: DataTypes.STRING(32), allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Users', 'happyHourSeen');
}

module.exports = { up, down };
