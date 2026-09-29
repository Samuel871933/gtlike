'use strict';

// Anime le marché d'un monde de test autour d'un joueur, avec les vraies règles (TradeService) :
//   node scripts/seed-market.js                     → monde « speed », joueur « cacayobeme »
//   node scripts/seed-market.js speed MonPseudo
// 1. Les villages de joueurs fictifs qui ont un marché reçoivent des ressources (60 % de l'entrepôt).
// 2. Une quarantaine d'offres variées sont publiées (quelques-unes limitées en durée ou réservées à la tribu).
// 3. Le joueur publie trois offres ; des joueurs fictifs en acceptent → rapports « a accepté votre offre ».
// 4. Le joueur accepte deux offres de joueurs fictifs → ses marchands partent, le paiement arrive.
// 5. Des joueurs fictifs lui livrent des ressources, de près et de loin (livraisons visibles plusieurs minutes).

const { Op } = require('sequelize');
const { sequelize, World, Player, Village, MarketOffer } = require('../src/models');
const TradeService = require('../src/services/TradeService');
const VillageService = require('../src/services/VillageService');
const formulas = require('../src/game/formulas');

const RES = ['wood', 'stone', 'iron'];
let seed = 42;
const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (list) => list[Math.floor(rng() * list.length)];
const between = (a, b) => a + Math.floor(rng() * (b - a + 1));

async function main() {
  const [slug = 'speed', name = 'cacayobeme'] = process.argv.slice(2);
  const world = await World.findOne({ where: { slug } });
  if (!world) throw new Error(`Monde introuvable : ${slug}`);
  const me = await Player.findOne({ where: { worldId: world.id, name } });
  if (!me) throw new Error(`Joueur introuvable sur ${slug} : ${name}`);
  const home = await Village.findOne({ where: { playerId: me.id }, order: [['id', 'ASC']] });
  const now = new Date();
  const log = (...a) => console.log(...a);

  // 1. Joueurs fictifs avec marché : ressources à 60 % de l'entrepôt.
  const traders = (await Village.findAll({ where: { worldId: world.id, playerId: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: me.id }] } } }))
    .filter((v) => (v.buildings.market || 0) > 0);
  for (const v of traders) {
    const cap = formulas.storageCapacity(v.buildings.storage || 1);
    await v.update({ wood: Math.floor(cap * 0.6), stone: Math.floor(cap * 0.6), iron: Math.floor(cap * 0.6), resourcesAt: now });
  }
  const dist = (v) => Math.hypot(v.x - home.x, v.y - home.y);
  const near = [...traders].sort((a, b) => dist(a) - dist(b));
  const far = near.filter((v) => dist(v) >= 100);
  log(`${traders.length} villages marchands ; le plus proche à ${dist(near[0]).toFixed(1)} cases, ${far.length} à plus de 100 cases.`);

  // 2. Offres variées (ratios de 0,75 à 1,33, 1 à 5 lots ; limites sur une offre sur cinq).
  let published = 0;
  for (let i = 0; i < 40; i++) {
    const v = i < 25 ? near[i % Math.min(near.length, 30)] : pick(near);
    const sell = pick(RES);
    const buy = pick(RES.filter((r) => r !== sell));
    const sellAmount = pick([500, 1000, 1000, 1500, 2000]);
    const buyAmount = Math.round((sellAmount * pick([0.75, 0.9, 1, 1, 1, 1.1, 1.2, 1.33])) / 100) * 100;
    const owner = await Player.findByPk(v.playerId, { attributes: ['tribeId'] });
    const limits = i % 5 === 0 ? { maxHours: pick([1, 2, 5]) } : i % 7 === 0 && owner.tribeId === me.tribeId ? { tribeOnly: '1' } : {};
    try {
      await TradeService.createOffer(v.id, { sellResource: sell, sellAmount, buyResource: buy, buyAmount, count: between(1, 5), ...limits });
      published += 1;
    } catch (err) { /* marchands ou ressources insuffisants : on passe */ }
  }
  log(`${published} offres publiées par les joueurs fictifs.`);

  // 3. Offres du joueur, acceptées par des joueurs fictifs (proches et lointains).
  await Village.update({ wood: Math.max(home.wood, 20000), stone: Math.max(home.stone, 20000), iron: Math.max(home.iron, 20000), resourcesAt: now }, { where: { id: home.id } });
  const mine = [];
  for (const [sell, buy, n] of [['wood', 'stone', 3], ['iron', 'stone', 2], ['wood', 'iron', 2]]) {
    try {
      mine.push(await TradeService.createOffer(home.id, { sellResource: sell, sellAmount: 1000, buyResource: buy, buyAmount: 1000, count: n }));
    } catch (err) { log(`Offre de ${name} impossible : ${err.message}`); }
  }
  const buyers = [near[1], far[0] || near[5], far[3] || near[8]].filter(Boolean);
  for (const [i, offer] of mine.slice(0, 2).entries()) {
    try {
      await TradeService.acceptOffer(buyers[i].id, offer.id, 1);
      log(`Offre ${offer.id} de ${name} acceptée depuis ${buyers[i].name} (${dist(buyers[i]).toFixed(0)} cases).`);
    } catch (err) { log(`Acceptation impossible : ${err.message}`); }
  }

  // 4. Le joueur accepte deux offres de joueurs fictifs.
  const options = await VillageService.withVillage(home.id, (ctx) => TradeService.listOffers(ctx, { filter: 'possible' }));
  for (const { offer } of [options[0], options.find((r) => r.distance >= 50) || options[1]].filter(Boolean)) {
    try {
      await TradeService.acceptOffer(home.id, offer.id, 1);
      log(`${name} accepte l'offre ${offer.id} (${offer.sellAmount} ${offer.sellResource} contre ${offer.buyAmount} ${offer.buyResource}).`);
    } catch (err) { log(`Acceptation par ${name} impossible : ${err.message}`); }
  }

  // 5. Livraisons directes vers le joueur, de près et de loin.
  const senders = [near[0], near[2], far[1], far[5], far[10]].filter(Boolean);
  for (const v of senders) {
    const resources = { wood: 0, stone: 0, iron: 0, [pick(RES)]: pick([1000, 2000, 3000]) };
    try {
      const tr = await TradeService.send(v.id, { x: home.x, y: home.y, resources });
      log(`Livraison depuis ${v.name} (${dist(v).toFixed(0)} cases), arrivée ${tr.arrivesAt.toLocaleTimeString('fr-FR')}.`);
    } catch (err) { log(`Livraison impossible depuis ${v.name} : ${err.message}`); }
  }
  log(`Offres en ligne sur ${slug} : ${await MarketOffer.count({ where: { worldId: world.id } })}.`);
}

main()
  .catch((err) => { console.error(err.message || err); process.exitCode = 1; })
  .finally(() => sequelize.close());
