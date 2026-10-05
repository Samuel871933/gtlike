'use strict';

// Répartit les joueurs sans tribu d'un monde dans des tribus de test (tailles inégales, comme une vraie partie),
// pour tester la dominance, les classements de tribus, la messagerie de tribu…
//
//   node scripts/seed-tribes.js                → monde « speed », 12 tribus
//   node scripts/seed-tribes.js w1 5           → monde « w1 », 5 tribus
//
// Les vrais joueurs (hors comptes fictifs @bots.adarma.local) deviennent ducs des premières tribus.
// Chaque tribu a un duc, jusqu'à deux barons, un diplomate, ses sous-forums par défaut et quelques relations.

const { Op } = require('sequelize');
const { sequelize, World, Player, User, Tribe, TribeRelation } = require('../src/models');
const TribeService = require('../src/services/TribeService');

const BOT_DOMAIN = 'bots.adarma.local';
const TRIBES = [
  ['OKLM', 'Ordre des Loups'], ['ReVo', 'La Révolte'], ['LTQS', 'Les Terres du Sud'], ['0KLM', 'Garde de Fer'],
  ['AEGIS', 'Aegis'], ['HELLO', 'Les Hérauts'], ['FT', 'Frères de Taverne'], ['L.G', 'Légion Grise'],
  ['NWO', 'Nouvel Ordre'], ['MK', 'Main du Roi'], ['Lf', 'Les Fougères'], ['HDL', 'Horde du Levant'],
  ['LNA', 'Lames du Nord'], ['LR', 'Lions Rouges'], ['UMBRA', 'Umbra'], ['CPT', 'Compagnie Pourpre'],
];

async function main() {
  const [slug = 'speed', countArg = '12'] = process.argv.slice(2);
  const world = await World.findOne({ where: { slug } });
  if (!world) throw new Error(`Monde introuvable : ${slug}`);
  const limit = world.getConfig().tribe.memberLimit;
  const players = await Player.findAll({
    where: { worldId: world.id, tribeId: null },
    include: [{ model: User, attributes: ['email'] }],
    order: [['points', 'DESC'], ['id', 'ASC']],
  });
  if (!players.length) return console.log(`Aucun joueur sans tribu sur « ${slug} ».`);
  const taken = new Set((await Tribe.findAll({ where: { worldId: world.id }, attributes: ['tag'] })).map((t) => t.tag));
  const free = TRIBES.filter(([tag]) => !taken.has(tag));
  const count = Math.max(1, Math.min(Number(countArg) || 12, free.length, players.length));

  // Vrais joueurs d'abord (ducs des premières tribus), puis les comptes fictifs.
  const real = players.filter((p) => !p.User || !p.User.email.endsWith(`@${BOT_DOMAIN}`));
  const bots = players.filter((p) => !real.includes(p));
  const founders = [...real, ...bots].slice(0, count);
  const pool = [...real, ...bots].slice(count);
  // Tailles décroissantes : la première tribu est nettement devant (dominance lisible), environ 70 % des joueurs en tribu.
  const weights = founders.map((_, i) => 1 / (i + 1.5));
  const sum = weights.reduce((a, b) => a + b, 0);
  const seats = Math.round(pool.length * 0.7);
  const sizes = weights.map((w) => Math.min(limit - 1, Math.round((w / sum) * seats)));

  const created = [];
  for (const [i, founder] of founders.entries()) {
    const [tag, name] = free[i];
    const tribe = await TribeService.create(founder.id, { name, tag });
    // Monde à factions : seulement des joueurs de la faction du fondateur.
    const members = pool.filter((p) => (p.faction || null) === (founder.faction || null)).slice(0, sizes[i]);
    for (const m of members) pool.splice(pool.indexOf(m), 1);
    await sequelize.transaction(async (t) => {
      for (const [j, m] of members.entries()) {
        const role = j < 2 ? 'baron' : 'member';
        await m.update({ tribeId: tribe.id, tribeRole: role, tribeRights: j === 2 ? ['diplomacy'] : null, tribeJoinedAt: new Date() }, { transaction: t });
      }
    });
    created.push({ tribe, members: members.length + 1, founder: founder.name });
  }
  // Diplomatie : chaque tribu a un allié et un ennemi parmi les autres.
  for (const [i, { tribe }] of created.entries()) {
    if (created.length < 3) break;
    const ally = created[(i + 1) % created.length].tribe;
    const enemy = created[(i + 2) % created.length].tribe;
    await TribeRelation.findOrCreate({ where: { tribeId: tribe.id, otherTribeId: ally.id }, defaults: { type: 'ally' } });
    await TribeRelation.findOrCreate({ where: { tribeId: tribe.id, otherTribeId: enemy.id }, defaults: { type: 'enemy' } });
  }
  for (const c of created) console.log(`[${c.tribe.tag}] ${c.tribe.name} : ${c.members} membres (duc ${c.founder})`);
  const inTribe = await Player.count({ where: { worldId: world.id, tribeId: { [Op.ne]: null } } });
  console.log(`${created.length} tribus créées sur « ${slug} » ; ${inTribe} joueurs en tribu sur ${await Player.count({ where: { worldId: world.id } })}.`);
}

main()
  .catch((err) => { console.error(err.message || err); process.exitCode = 1; })
  .finally(() => sequelize.close());
