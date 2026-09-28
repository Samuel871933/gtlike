'use strict';

// Design des villages choisi par le compte (images des villages sur la carte, voir src/web/villageDesigns.js).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const users = await qi.describeTable('Users');
  if (!users.villageDesign) await qi.addColumn('Users', 'villageDesign', { type: DataTypes.STRING(16), allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Users', 'villageDesign');
}

module.exports = { up, down };
