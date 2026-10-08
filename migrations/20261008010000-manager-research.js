'use strict';

// Gestionnaire de forge (gestionnaire de compte) : modèle de recherche appliqué à un village (clé 'sys:…' ou
// 'tpl:<id>', modèles ManagerTemplates de type « research »), et sa pause.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const columns = await qi.describeTable('ManagerVillages');
  if (!columns.researchTemplate) await qi.addColumn('ManagerVillages', 'researchTemplate', { type: DataTypes.STRING(16), allowNull: true });
  if (!columns.researchPaused) await qi.addColumn('ManagerVillages', 'researchPaused', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
}

async function down({ context: qi }) {
  await qi.removeColumn('ManagerVillages', 'researchPaused');
  await qi.removeColumn('ManagerVillages', 'researchTemplate');
}

module.exports = { up, down };
