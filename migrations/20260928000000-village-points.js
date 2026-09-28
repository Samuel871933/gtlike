'use strict';

// Points des villages : le total d'un bâtiment au niveau n est `base × 1.2^(n-1)` (village complet : 12 154),
// et non la somme de ces valeurs sur tous les niveaux. Recalcule les points stockés des villages et des joueurs.
// Les points de base sont recopiés ici pour que la migration ne dépende pas du code du jeu.

const BASE = {
  main: 10, barracks: 16, stable: 20, garage: 24, snob: 512, smith: 19, place: 0, statue: 24, market: 10,
  wood: 6, stone: 6, iron: 6, farm: 5, storage: 6, hide: 5, wall: 8,
};

const pointsOf = (buildings, total) => Object.entries(buildings || {})
  .reduce((sum, [id, lvl]) => sum + (lvl > 0 ? total(BASE[id] || 0, lvl) : 0), 0);

async function recompute(qi, total) {
  const sequelize = qi.sequelize;
  await sequelize.transaction(async (transaction) => {
    const [villages] = await sequelize.query('SELECT id, buildings FROM "Villages"', { transaction });
    for (const v of villages) {
      const buildings = typeof v.buildings === 'string' ? JSON.parse(v.buildings) : v.buildings;
      await sequelize.query('UPDATE "Villages" SET points = :points WHERE id = :id', {
        replacements: { id: v.id, points: pointsOf(buildings, total) }, transaction,
      });
    }
    await sequelize.query(
      'UPDATE "Players" SET points = COALESCE((SELECT SUM(v.points) FROM "Villages" v WHERE v."playerId" = "Players".id), 0)',
      { transaction },
    );
  });
}

async function up({ context: qi }) {
  await recompute(qi, (base, lvl) => Math.round(base * Math.pow(1.2, lvl - 1)));
}

async function down({ context: qi }) {
  await recompute(qi, (base, lvl) => {
    let sum = 0;
    for (let i = 1; i <= lvl; i++) sum += Math.round(base * Math.pow(1.2, i - 1));
    return sum;
  });
}

module.exports = { up, down };
