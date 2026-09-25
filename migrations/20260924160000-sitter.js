'use strict';

// Mode vacances : remplaçant d'un joueur.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.sitterAcceptedAt) await qi.addColumn('Players', 'sitterAcceptedAt', { type: DataTypes.DATE, allowNull: true });
  if (!players.sitterId) {
    await qi.addColumn('Players', 'sitterId', {
      type: DataTypes.INTEGER, allowNull: true, references: { model: 'Players', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE',
    });
  }
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'sitterId');
  await qi.removeColumn('Players', 'sitterAcceptedAt');
}

module.exports = { up, down };
