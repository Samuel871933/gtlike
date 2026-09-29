'use strict';

// Fil d'événements des tribus (aperçu comme sur GT : anoblissements, diplomatie, membres, divers)
// et annonces internes, distinctes de la description publique.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('TribeEvents')) {
    await qi.createTable('TribeEvents', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      type: { type: DataTypes.STRING(20), allowNull: false },
      category: { type: DataTypes.STRING(12), allowNull: false },
      data: { type: DataTypes.JSON, allowNull: false },
      happenedAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      tribeId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Tribes', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    });
    await qi.addIndex('TribeEvents', ['tribeId', 'happenedAt']);
  }
  const tribes = await qi.describeTable('Tribes');
  if (!tribes.announcement) await qi.addColumn('Tribes', 'announcement', { type: DataTypes.TEXT, allowNull: true });

  // Tribus existantes : leur fil commence par l'arrivée des membres actuels.
  const [[{ n }]] = await qi.sequelize.query('SELECT COUNT(*) AS n FROM "TribeEvents"');
  if (Number(n) > 0) return;
  const [members] = await qi.sequelize.query('SELECT id, name, "tribeId", "tribeJoinedAt", "createdAt" FROM "Players" WHERE "tribeId" IS NOT NULL');
  const now = new Date();
  const rows = members.map((m) => {
    const at = new Date(m.tribeJoinedAt || m.createdAt || now);
    return {
      tribeId: m.tribeId, type: 'joined', category: 'members', data: JSON.stringify({ actor: { id: m.id, name: m.name } }),
      happenedAt: at, createdAt: now, updatedAt: now,
    };
  });
  if (rows.length) await qi.bulkInsert('TribeEvents', rows);
}

async function down({ context: qi }) {
  await qi.removeColumn('Tribes', 'announcement');
  await qi.dropTable('TribeEvents');
}

module.exports = { up, down };
