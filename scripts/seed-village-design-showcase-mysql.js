'use strict';

/** Add the two new six-stage design rows to the live test world gallery. */
const { Op } = require('sequelize');
const { sequelize, World, User, Player, Village, Entitlement } = require('../src/models');

const DESIGNS = [
  { id: 'christianisme', username: 'ApercuChristianisme', label: 'Christianisme', y: 529 },
  { id: 'islam', username: 'ApercuIslam', label: 'Islam', y: 530 },
];
const FIRST_X = 510;

async function main() {
  if (sequelize.getDialect() !== 'mysql') throw new Error('This script targets the MySQL test world.');
  await sequelize.transaction(async (transaction) => {
    const world = await World.findOne({ where: { slug: 'speed' }, transaction });
    if (!world) throw new Error('Monde rapide (test) introuvable.');

    const reference = await Village.findAll({
      where: { worldId: world.id, y: 528, x: { [Op.between]: [FIRST_X, FIRST_X + 5] } },
      order: [['x', 'ASC']], transaction,
    });
    if (reference.length !== 6 || reference.some((v, i) => v.x !== FIRST_X + i)) {
      throw new Error('La ligne de référence 510–515,528 est incomplète.');
    }
    const totalPoints = reference.reduce((sum, village) => sum + village.points, 0);
    const bot = await User.findOne({ where: { email: { [Op.like]: '%@bots.adarma.local' } }, transaction });
    if (!bot) throw new Error('Compte de test modèle introuvable.');

    for (const design of DESIGNS) {
      const email = `${design.username.toLowerCase()}@showcase.adarma.local`;
      let user = await User.findOne({ where: { [Op.or]: [{ username: design.username }, { email }] }, transaction });
      if (user) {
        if (user.username !== design.username || user.email !== email || user.villageDesign !== design.id) {
          throw new Error(`Compte de galerie incohérent : ${design.username}`);
        }
      } else {
        user = await User.create({ username: design.username, email, passwordHash: bot.passwordHash, villageDesign: design.id }, { transaction });
      }

      let player = await Player.findOne({ where: { userId: user.id, worldId: world.id }, transaction });
      if (!player) {
        player = await Player.create({ name: design.username, userId: user.id, worldId: world.id, points: totalPoints, villageCount: 6 }, { transaction });
      }
      const existing = await Village.findAll({ where: { worldId: world.id, y: design.y, x: { [Op.between]: [FIRST_X, FIRST_X + 5] } }, transaction });
      if (existing.length) {
        if (existing.length !== 6 || existing.some((v) => v.playerId !== player.id || v.x < FIRST_X || v.x > FIRST_X + 5)) {
          throw new Error(`Ligne ${design.y} déjà occupée par d'autres villages.`);
        }
      } else {
        const now = new Date();
        for (let i = 0; i < 6; i += 1) {
          await Village.create({
            name: `${design.label} N${i + 1}`, x: FIRST_X + i, y: design.y,
            isFirst: i === 0, buildings: reference[i].buildings, units: {},
            resourcesAt: now, points: reference[i].points, worldId: world.id, playerId: player.id,
          }, { transaction });
        }
      }

      const itemKey = `design:${design.id}`;
      const entitlement = await Entitlement.findOne({ where: { userId: user.id, worldId: world.id, scope: 'world', itemKey }, transaction });
      if (!entitlement) {
        await Entitlement.create({ userId: user.id, worldId: world.id, scope: 'world', itemKey, startsAt: new Date(), price: 0, source: 'showcase' }, { transaction });
      }
      console.log(`${design.label} : 510–515,${design.y} sur ${world.name}`);
    }
  });
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => sequelize.close());
