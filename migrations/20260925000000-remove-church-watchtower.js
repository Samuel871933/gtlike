'use strict';

// L'église (et la première église) et la tour de guet sont retirées du jeu :
// on enlève leurs niveaux des villages et leurs constructions en file.

const REMOVED = ['church', 'church_f', 'watchtower'];

function parse(value) {
  return typeof value === 'string' ? JSON.parse(value) : value || {};
}

async function up({ context: qi }) {
  const { sequelize } = qi;
  const [villages] = await sequelize.query('SELECT id, buildings FROM "Villages"');
  for (const v of villages) {
    const buildings = parse(v.buildings);
    if (!REMOVED.some((id) => id in buildings)) continue;
    for (const id of REMOVED) delete buildings[id];
    await sequelize.query('UPDATE "Villages" SET buildings = :b WHERE id = :id', { replacements: { b: JSON.stringify(buildings), id: v.id } });
  }
  await sequelize.query('DELETE FROM "BuildOrders" WHERE building IN (:ids)', { replacements: { ids: REMOVED } });
}

async function down() {
  // Rien à restaurer : les niveaux supprimés sont perdus.
}

module.exports = { up, down };
