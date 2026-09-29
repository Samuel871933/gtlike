'use strict';

// Dernière attaque de chaque joueur sur chaque village (infobulle et gommette de la carte, comme sur GT) :
// résultat (sans perte, pertes partielles, pertes totales, espionnage), butin, date et rapport.
// Remplie à partir des rapports d'attaque déjà reçus.

const { DataTypes } = require('sequelize');
const { outcome } = require('../src/game/lastAttack');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('LastAttacks')) {
    await qi.createTable('LastAttacks', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      result: { type: DataTypes.STRING(8), allowNull: false },
      haul: { type: DataTypes.STRING(8), allowNull: true },
      happenedAt: { type: DataTypes.DATE, allowNull: false },
      reportId: { type: DataTypes.INTEGER, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      villageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    });
    await qi.addIndex('LastAttacks', ['playerId', 'villageId'], { unique: true });
  }

  const [[{ n }]] = await qi.sequelize.query('SELECT COUNT(*) AS n FROM "LastAttacks"');
  if (Number(n) > 0) return;
  const [reports] = await qi.sequelize.query(`SELECT id, "playerId", data, "happenedAt" FROM "Reports" WHERE type = 'attack' ORDER BY "happenedAt" ASC, id ASC`);
  const [villages] = await qi.sequelize.query('SELECT id FROM "Villages"');
  const exists = new Set(villages.map((v) => v.id));
  const last = new Map();
  for (const r of reports) {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    const villageId = data && data.defender && data.defender.villageId;
    if (!villageId || !exists.has(villageId)) continue;
    last.set(`${r.playerId}:${villageId}`, { r, data, villageId });
  }
  const now = new Date();
  const rows = [...last.values()].map(({ r, data, villageId }) => ({
    ...outcome(data), happenedAt: new Date(r.happenedAt), reportId: r.id, createdAt: now, updatedAt: now, playerId: r.playerId, villageId,
  }));
  if (rows.length) await qi.bulkInsert('LastAttacks', rows);
}

async function down({ context: qi }) {
  await qi.dropTable('LastAttacks');
}

module.exports = { up, down };
