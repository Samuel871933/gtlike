'use strict';

// Formation des paladins à compétences.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const knights = await qi.describeTable('Knights');
  if (!knights.trainingEndsAt) await qi.addColumn('Knights', 'trainingEndsAt', { type: DataTypes.DATE, allowNull: true });
  if (!knights.trainingXp) await qi.addColumn('Knights', 'trainingXp', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  const indexes = (await qi.showIndex('Knights')).map((i) => i.fields.map((f) => f.attribute).join(','));
  if (!indexes.includes('trainingEndsAt')) await qi.addIndex('Knights', ['trainingEndsAt']);
}

async function down({ context: qi }) {
  await qi.removeColumn('Knights', 'trainingEndsAt');
  await qi.removeColumn('Knights', 'trainingXp');
}

module.exports = { up, down };
