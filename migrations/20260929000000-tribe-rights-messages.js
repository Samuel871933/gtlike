'use strict';

// Titres et pouvoirs de tribu comme sur GT : fondateur → duc, chef → baron, droits individuels des membres ;
// messagerie : auteur et groupe destinataire (courrier circulaire) des conversations, messages par page.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.tribeRights) await qi.addColumn('Players', 'tribeRights', { type: DataTypes.JSON, allowNull: true });
  if (!players.messagesPerPage) await qi.addColumn('Players', 'messagesPerPage', { type: DataTypes.INTEGER, allowNull: true });
  const conversations = await qi.describeTable('Conversations');
  if (!conversations.authorId) await qi.addColumn('Conversations', 'authorId', { type: DataTypes.INTEGER, allowNull: true });
  if (!conversations.recipientGroup) await qi.addColumn('Conversations', 'recipientGroup', { type: DataTypes.STRING(12), allowNull: true });
  await qi.sequelize.query(`UPDATE "Players" SET "tribeRole" = 'duke' WHERE "tribeRole" = 'founder'`);
  await qi.sequelize.query(`UPDATE "Players" SET "tribeRole" = 'baron' WHERE "tribeRole" = 'leader'`);
}

async function down({ context: qi }) {
  await qi.sequelize.query(`UPDATE "Players" SET "tribeRole" = 'founder' WHERE "tribeRole" = 'duke'`);
  await qi.sequelize.query(`UPDATE "Players" SET "tribeRole" = 'leader' WHERE "tribeRole" = 'baron'`);
  await qi.removeColumn('Conversations', 'recipientGroup');
  await qi.removeColumn('Conversations', 'authorId');
  await qi.removeColumn('Players', 'messagesPerPage');
  await qi.removeColumn('Players', 'tribeRights');
}

module.exports = { up, down };
