'use strict';

// Peuple un monde de test avec des joueurs fictifs, leurs villages, des tribus et des villages barbares,
// pour tester le jeu en conditions réelles (carte chargée, classements, diplomatie…).
//
//   npm run populate                    → 1000 joueurs sur le monde « speed »
//   npm run populate -- skills 300      → 300 joueurs sur le monde « skills »
//   npm run populate -- speed 1000 --reset  → retire d'abord le peuplement précédent de ce monde
//   npm run populate -- speed 500 --add     → ajoute 500 joueurs à un monde déjà peuplé
//
// Une partie des comptes reçoit des cosmétiques, comme après des achats à la boutique (droits offerts sur ce monde) :
// design de village (vu par tous sur la carte), thème de jeu, premium, et un texte de profil.
//
// Les comptes fictifs ont l'adresse <nom>@bots.adarma.local et le mot de passe « motdepasse ».
// Sans --reset ni --add, le script refuse de peupler deux fois le même monde.

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize, User, World, Player, Village, Tribe, TribeRelation, Entitlement } = require('../src/models');
const { VILLAGE_DESIGNS, DEFAULT_VILLAGE_DESIGN } = require('../src/web/villageDesigns');
const { GAME_STYLES, DEFAULT_GAME_STYLE } = require('../src/web/gameStyles');
const { MapPlacer } = require('../src/game/MapPlacer');
const VillageState = require('../src/game/VillageState');
const registry = require('../src/game/registry');
const formulas = require('../src/game/formulas');

const BOT_DOMAIN = 'bots.adarma.local';
const PASSWORD = 'motdepasse';

// Générateur reproductible (mulberry32) : deux peuplements avec la même graine donnent la même carte.
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = ['Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gor', 'Hal', 'Is', 'Jor', 'Kal', 'Lor', 'Mor', 'Nor', 'Or', 'Pyr',
  'Quen', 'Rag', 'Sil', 'Tor', 'Ul', 'Val', 'Wol', 'Xan', 'Yr', 'Zer', 'Bran', 'Cael', 'Dun', 'Grim', 'Thal', 'Vor'];
const END = ['ak', 'an', 'ar', 'dor', 'en', 'eth', 'gar', 'ia', 'ic', 'ion', 'is', 'mir', 'nor', 'on', 'or', 'os', 'rim',
  'rok', 'th', 'us', 'wen', 'wyn', 'ax', 'ul'];
const TITLES = ['', '', '', '', 'Le', 'Sire', 'Dame', 'Baron', 'Lord', 'Kaiser', 'Don', 'Big'];
const TRIBE_WORDS = ['Loups', 'Corbeaux', 'Lions', 'Ours', 'Faucons', 'Dragons', 'Vipères', 'Sangliers', 'Aigles', 'Tigres',
  'Chacals', 'Béliers', 'Spectres', 'Titans', 'Barbares', 'Paladins', 'Templiers', 'Nomades', 'Vikings', 'Seigneurs'];
const TRIBE_ADJ = ['Noirs', 'Rouges', "d'Acier", 'du Nord', 'de Fer', 'Sanglants', "d'Or", 'du Sud', 'Sauvages', 'Éternels',
  'de Cendre', 'Libres', 'Gris', 'du Chaos'];
const VILLAGE_NAMES = ['Fort', 'Bastion', 'Colline', 'Rempart', 'Vallée', 'Moulin', 'Gué', 'Tour', 'Clairière', 'Forge',
  'Marais', 'Falaise', 'Port', 'Val', 'Camp', 'Donjon'];

function main() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const add = args.includes('--add');
  const [slug = 'speed', countArg = '1000'] = args.filter((a) => !a.startsWith('--'));
  const count = Math.max(1, Math.min(20000, Number.parseInt(countArg, 10) || 1000));
  return (reset ? unpopulate(slug) : Promise.resolve())
    .then(() => populate(slug, count, { add }))
    .finally(() => sequelize.close());
}

/**
 * Retire un peuplement : comptes fictifs, leurs joueurs, villages et tribus, et les villages barbares créés
 * avec eux (même lot : entre la création des comptes et celle du dernier village fictif).
 * Échoue (sans rien modifier) si de vrais joueurs ont déjà interagi avec ces villages (ordres, rapports…).
 */
async function unpopulate(slug) {
  const world = await World.findOne({ where: { slug } });
  if (!world) return;
  await sequelize.transaction(async (t) => {
    const players = await Player.findAll({
      where: { worldId: world.id }, include: [{ model: User, where: { email: { [Op.like]: `%@${BOT_DOMAIN}` } } }], transaction: t,
    });
    if (!players.length) return;
    const playerIds = players.map((p) => p.id);
    const from = new Date(Math.min(...players.map((p) => new Date(p.User.createdAt))));
    const lastBotVillage = await Village.max('createdAt', { where: { playerId: playerIds }, transaction: t });
    const to = new Date(new Date(lastBotVillage || from).getTime() + 60000);
    const tribeIds = [...new Set(players.map((p) => p.tribeId).filter(Boolean))];
    const humans = tribeIds.length ? await Player.count({ where: { tribeId: tribeIds, id: { [Op.notIn]: playerIds } }, transaction: t }) : 0;
    if (humans) throw new Error('Des joueurs réels sont membres de tribus fictives : quitter ces tribus avant --reset.');
    const barbIds = (await Village.findAll({
      where: { worldId: world.id, playerId: null, createdAt: { [Op.between]: [from, to] } }, attributes: ['id'], raw: true, transaction: t,
    })).map((v) => v.id);
    const villageIds = [...(await Village.findAll({ where: { playerId: playerIds }, attributes: ['id'], raw: true, transaction: t })).map((v) => v.id), ...barbIds];
    // Tout ce qui dépend de ces lignes (rapports, succès, ordres, forums de tribu…) : supprimé, ou détaché
    // quand la référence est facultative (messages d'un joueur réel à un joueur fictif, par exemple).
    // Droits de boutique offerts aux comptes fictifs (leur référence au compte est facultative : supprimés à part).
    await Entitlement.destroy({ where: { userId: players.map((p) => p.userId) }, transaction: t });
    await purge(t, { Villages: villageIds, Tribes: tribeIds, Players: playerIds, Users: players.map((p) => p.userId) });
    console.log(`Peuplement précédent retiré : ${players.length} joueurs fictifs, ${tribeIds.length} tribus.`);
  });
}

/**
 * Supprime des lignes et, d'abord, tout ce qui les référence (clés étrangères déclarées dans les modèles) :
 * suppression si la référence est obligatoire, mise à nul si elle est facultative. `targets` : { table: [ids] }.
 */
async function purge(t, targets) {
  const pending = new Map(Object.entries(targets).map(([table, ids]) => [table, new Set(ids)]));
  const order = [];
  const queue = Object.keys(targets);
  while (queue.length) {
    const table = queue.shift();
    const ids = [...pending.get(table)];
    if (!ids.length) continue;
    for (const model of Object.values(sequelize.models)) {
      for (const [attr, def] of Object.entries(model.rawAttributes)) {
        const ref = def.references && (typeof def.references.model === 'string' ? def.references.model : def.references.model && def.references.model.tableName);
        if (ref !== table) continue;
        const child = model.getTableName();
        const childName = typeof child === 'string' ? child : child.tableName;
        if (def.allowNull !== false) {
          if (!targets[childName]) await model.update({ [attr]: null }, { where: { [attr]: ids }, transaction: t, hooks: false });
          continue;
        }
        const rows = await model.findAll({ where: { [attr]: ids }, attributes: ['id'], raw: true, transaction: t });
        if (!rows.length) continue;
        if (!pending.has(childName)) pending.set(childName, new Set());
        const set = pending.get(childName);
        const before = set.size;
        rows.forEach((r) => set.add(r.id));
        if (set.size > before) queue.push(childName);
      }
    }
    order.push(table);
  }
  // Les dépendances d'abord (ordre inverse de la découverte), puis les lignes visées.
  const byTable = new Map(Object.values(sequelize.models).map((m) => { const n = m.getTableName(); return [typeof n === 'string' ? n : n.tableName, m]; }));
  for (const table of [...new Set(order)].reverse()) {
    const ids = [...pending.get(table)];
    if (ids.length) await byTable.get(table).destroy({ where: { id: ids }, transaction: t, hooks: false });
  }
}

async function populate(slug, count, { add = false } = {}) {
  const world = await World.findOne({ where: { slug } });
  if (!world) throw new Error(`Monde « ${slug} » introuvable (lancer le serveur une fois pour créer les mondes).`);
  const cfg = world.getConfig();
  const already = await Player.count({ where: { worldId: world.id }, include: [{ model: User, where: { email: { [Op.like]: `%@${BOT_DOMAIN}` } } }] });
  if (already && !add) throw new Error(`Le monde « ${slug} » est déjà peuplé (${already} joueurs fictifs) : --add pour en ajouter, --reset pour recommencer.`);

  // Graine différente à chaque ajout (sinon les mêmes noms reviendraient, déjà pris).
  const rng = rngFrom(world.id * 7919 + count + already * 104729);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const between = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const now = new Date();
  console.log(`Peuplement de « ${world.name} » : ${count} joueurs…`);

  // ---------------------------------------------------------------- Comptes et joueurs
  const taken = new Set((await User.findAll({ attributes: ['username'], raw: true })).map((u) => u.username.toLowerCase()));
  const names = [];
  while (names.length < count) {
    const title = pick(TITLES);
    let name = `${title}${pick(START)}${pick(END)}`;
    if (rng() < 0.45) name += between(1, 99);
    if (name.length > 24 || taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    names.push(name);
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // Profils : beaucoup de petits joueurs, quelques gros (loi de puissance sur le nombre de villages).
  const profiles = names.map((name) => {
    const power = Math.pow(rng(), 2.2);
    return { name, power, villages: Math.max(1, Math.round(1 + power * 40 * rng())) };
  });

  const players = await sequelize.transaction(async (t) => {
    await User.bulkCreate(
      names.map((n) => ({ username: n, email: `${n.toLowerCase()}@${BOT_DOMAIN}`, passwordHash })),
      { transaction: t },
    );
    const byName = new Map((await User.findAll({ where: { username: names }, attributes: ['id', 'username'], transaction: t })).map((u) => [u.username, u.id]));
    await Player.bulkCreate(names.map((n) => ({ userId: byName.get(n), worldId: world.id, name: n })), { transaction: t });
    return Player.findAll({ where: { worldId: world.id, name: names }, transaction: t });
  });
  const playerByName = new Map(players.map((p) => [p.name, p]));

  // ---------------------------------------------------------------- Villages
  const coords = await Village.findAll({ where: { worldId: world.id }, attributes: ['x', 'y'], raw: true });
  const placer = new MapPlacer(cfg, new Set(coords.map((c) => MapPlacer.key(c.x, c.y))), rng);
  // Villages suivants d'un joueur : autour du premier, comme après des conquêtes proches,
  // avec une case libre autour de chacun (comme un placement normal).
  const near = (x, y) => {
    for (let r = 5; r < 80; r += 3) {
      for (let i = 0; i < 40; i++) {
        const nx = x + between(-r, r);
        const ny = y + between(-r, r);
        if (placer.isFree(nx, ny, 1)) return placer.take(nx, ny);
      }
    }
    return placer.findSpot();
  };

  const villages = [];
  const order = [...profiles].sort((a, b) => b.power - a.power); // les gros joueurs d'abord, plus près du centre
  for (const prof of order) {
    const player = playerByName.get(prof.name);
    const first = placer.findSpot({ direction: 'random' });
    for (let i = 0; i < prof.villages; i++) {
      const spot = i === 0 ? first : near(first.x, first.y);
      const maturity = Math.min(1, Math.max(0.02, prof.power * (0.75 + rng() * 0.4) + rng() * 0.12));
      villages.push({
        ...villageData(cfg, maturity, rng, now),
        worldId: world.id, playerId: player.id, x: spot.x, y: spot.y, isFirst: i === 0,
        name: i === 0 ? `Village de ${prof.name}` : `${pick(VILLAGE_NAMES)} ${String(i + 1).padStart(3, '0')}`,
      });
    }
  }
  // Barbares : un peu plus d'un par joueur, dans la même zone ; certains sont d'anciens villages de joueurs.
  const barbarians = Math.round(count * 1.3);
  for (let i = 0; i < barbarians; i++) {
    const spot = placer.findSpot({ radius: placer.targetRadius() * rng(), margin: 0 });
    const maturity = rng() < 0.2 ? 0.1 + rng() * 0.35 : rng() * 0.08;
    const data = villageData(cfg, maturity, rng, now, { barbarian: true });
    villages.push({ ...data, worldId: world.id, playerId: null, x: spot.x, y: spot.y, name: 'Village barbare' });
  }
  for (let i = 0; i < villages.length; i += 500) await Village.bulkCreate(villages.slice(i, i + 500));

  // Points et nombre de villages des joueurs.
  const totals = new Map();
  for (const v of villages) {
    if (!v.playerId) continue;
    const t = totals.get(v.playerId) || { points: 0, villageCount: 0 };
    t.points += v.points;
    t.villageCount += 1;
    totals.set(v.playerId, t);
  }
  await sequelize.transaction(async (t) => {
    for (const p of players) await p.update(totals.get(p.id), { transaction: t });
  });

  // ---------------------------------------------------------------- Tribus
  // Environ 65 % des joueurs en tribu ; les meilleurs joueurs fondent les tribus.
  const limit = cfg.tribe.memberLimit;
  const tribeCount = Math.max(1, Math.round((count * 0.65) / (limit * 0.6)));
  const ranked = [...players].sort((a, b) => b.points - a.points);
  const founders = ranked.slice(0, tribeCount);
  const usedTags = new Set((await Tribe.findAll({ where: { worldId: world.id }, attributes: ['tag', 'name'], raw: true })).flatMap((x) => [x.tag, x.name]));
  const tribeRows = founders.map(() => {
    let name; let tag;
    do {
      const word = pick(TRIBE_WORDS);
      name = `Les ${word} ${pick(TRIBE_ADJ)}`;
      tag = (word.slice(0, 3) + between(1, 99)).toUpperCase().slice(0, 6);
    } while (usedTags.has(name) || usedTags.has(tag));
    usedTags.add(name);
    usedTags.add(tag);
    return { worldId: world.id, name, tag, description: `Tribu ${name}. Recrutement ouvert aux joueurs actifs.` };
  });
  const tribes = await sequelize.transaction(async (t) => {
    await Tribe.bulkCreate(tribeRows, { transaction: t });
    const created = await Tribe.findAll({ where: { worldId: world.id, tag: tribeRows.map((r) => r.tag) }, transaction: t });
    const byTag = new Map(created.map((tr) => [tr.tag, tr]));
    const list = tribeRows.map((r) => byTag.get(r.tag));
    // Membres : les tribus des meilleurs fondateurs sont les plus remplies.
    const members = list.map(() => []);
    founders.forEach((f, i) => members[i].push([f, 'duke']));
    const pool = ranked.slice(tribeCount).filter(() => rng() < 0.62);
    for (const p of pool) {
      const i = Math.min(list.length - 1, Math.floor(Math.pow(rng(), 1.4) * list.length));
      const slot = members[i].length < limit ? i : members.findIndex((m) => m.length < limit);
      if (slot < 0) break;
      members[slot].push([p, members[slot].length < 3 ? 'baron' : 'member']);
    }
    for (const [i, tribe] of list.entries()) {
      for (const [p, role] of members[i]) {
        await p.update({ tribeId: tribe.id, tribeRole: role, tribeJoinedAt: new Date(now - between(1, 30) * 86400000) }, { transaction: t });
      }
    }
    // Diplomatie : chaque tribu a quelques alliés, PNA et ennemis.
    const relations = new Map();
    for (const tribe of list) {
      for (const type of ['ally', 'nap', 'enemy', 'enemy']) {
        if (rng() < 0.4) continue;
        const other = pick(list);
        if (other.id !== tribe.id) relations.set(`${tribe.id}:${other.id}`, { tribeId: tribe.id, otherTribeId: other.id, type });
      }
    }
    await TribeRelation.bulkCreate([...relations.values()], { transaction: t });
    return list;
  });

  // ---------------------------------------------------------------- Cosmétiques et profils
  // Comme des achats sur ce monde : droit (Entitlement, portée monde, offert) et choix enregistré sur le compte.
  const designs = Object.keys(VILLAGE_DESIGNS).filter((id) => id !== DEFAULT_VILLAGE_DESIGN);
  const styles = Object.keys(GAME_STYLES).filter((id) => id !== DEFAULT_GAME_STYLE);
  const MOTTOS = ['Recrutement ouvert aux joueurs actifs.', 'On ne pille pas mes fermes, merci.', 'Actif le soir, en vacances jamais.',
    'Offres de commerce bienvenues : du fer contre du bois.', 'Mieux vaut un noble en route que deux en caserne.', 'Paix aux voisins, guerre aux autres.'];
  const rights = [];
  let designed = 0; let styled = 0; let premium = 0;
  await sequelize.transaction(async (t) => {
    for (const p of players) {
      const user = {};
      const right = (itemKey, days = null) => rights.push({
        userId: p.userId, worldId: world.id, scope: 'world', itemKey, startsAt: now, endsAt: days ? new Date(now.getTime() + days * 86400000) : null, source: 'gift',
      });
      // Les gros joueurs dépensent plus volontiers.
      const spender = rng() < 0.25 + 0.5 * (totals.get(p.id)?.points || 0) / (ranked[0].points || 1);
      if (spender || rng() < 0.12) { user.villageDesign = pick(designs); right(`design:${user.villageDesign}`); designed += 1; }
      if (spender && rng() < 0.4) { user.gameStyle = pick(styles); right(`theme:${user.gameStyle}`); styled += 1; }
      if (spender && rng() < 0.5) { right('premium', between(3, 30)); premium += 1; }
      if (Object.keys(user).length) await User.update(user, { where: { id: p.userId }, transaction: t });
      if (rng() < 0.3) await p.update({ profileText: pick(MOTTOS) }, { transaction: t });
    }
    for (let i = 0; i < rights.length; i += 500) await Entitlement.bulkCreate(rights.slice(i, i + 500), { transaction: t });
  });

  const inTribe = players.filter((p) => p.tribeId).length;
  console.log(`${players.length} joueurs, ${villages.length - barbarians} villages de joueurs, ${barbarians} villages barbares, ${tribes.length} tribus (${inTribe} membres).`);
  console.log(`Cosmétiques : ${designed} designs de village, ${styled} thèmes, ${premium} premiums.`);
  console.log(`Comptes : <nom>@${BOT_DOMAIN} / ${PASSWORD} (ex. ${ranked[0].name}, ${ranked[0].points} points).`);
}

/**
 * Bâtiments, troupes et ressources d'un village selon sa maturité (0 : village neuf, 1 : village complet).
 * Les prérequis des bâtiments et la ferme sont respectés.
 */
function villageData(cfg, maturity, rng, now, { barbarian = false } = {}) {
  const jitter = () => 0.8 + rng() * 0.4;
  const target = {
    main: 30, barracks: 25, stable: 20, garage: 11, smith: 20, market: 20, wood: 30, stone: 30, iron: 30,
    farm: 30, storage: 30, hide: 6, wall: 20,
  };
  const levels = {};
  for (const b of registry.buildingsFor(cfg)) {
    const lvl = target[b.id] ? Math.round(target[b.id] * maturity * jitter()) : 0;
    levels[b.id] = Math.max(b.minLevel, Math.min(b.maxLevel, lvl));
  }
  levels.place = 1;
  if (levels.statue !== undefined) levels.statue = !barbarian && maturity > 0.15 ? 1 : 0;
  if (levels.snob !== undefined) levels.snob = !barbarian && maturity > 0.75 && rng() < 0.6 ? 1 : 0;
  if (barbarian) for (const id of ['stable', 'garage', 'market', 'snob', 'statue']) if (levels[id] !== undefined) levels[id] = 0;
  // Prérequis : on retire ce qui n'est pas constructible, jusqu'à stabilité.
  for (let changed = true; changed;) {
    changed = false;
    for (const b of registry.buildingsFor(cfg)) {
      if (levels[b.id] > b.minLevel && b.missingRequirements(levels).length) { levels[b.id] = b.minLevel; changed = true; }
    }
  }
  // Ferme : assez de place pour les bâtiments.
  const buildingPop = () => Object.entries(levels).reduce((s, [id, l]) => s + registry.building(id).popAt(l), 0);
  while (levels.farm < 30 && formulas.farmCapacity(levels.farm) < buildingPop() * 1.15) levels.farm += 1;

  // Troupes : une partie de la place libre, en armée offensive ou défensive.
  const units = {};
  const research = {};
  const free = formulas.farmCapacity(levels.farm) - buildingPop();
  const offensive = !barbarian && rng() < 0.45;
  const mix = offensive
    ? { axe: 0.55, light: 0.3, marcher: 0.05, ram: 0.05, catapult: 0.02, spy: 0.03 }
    : { spear: 0.45, sword: 0.35, archer: 0.1, heavy: 0.07, spy: 0.03 };
  const budget = barbarian && !cfg.barbarian.troops ? 0 : free * (barbarian ? 0.1 + rng() * 0.2 : 0.3 + rng() * 0.6);
  const usable = Object.entries(mix)
    .map(([id, share]) => [registry.UNITS.get(id), share])
    .filter(([u]) => u && u.isAvailableIn(cfg) && !u.missingRequirements(levels, cfg).length);
  const shares = usable.reduce((s, [, share]) => s + share, 0);
  for (const [u, share] of usable) {
    const n = Math.floor((budget * share) / shares / u.pop);
    if (n > 0) units[u.id] = n;
    if (u.needsResearch(cfg)) research[u.id] = true;
  }

  const state = new VillageState({ buildings: levels, units, research, wood: 0, stone: 0, iron: 0, resourcesAt: now }, cfg);
  const cap = formulas.storageCapacity(levels.storage);
  for (const r of ['wood', 'stone', 'iron']) state.resources[r] = Math.floor(cap * rng() * 0.8);
  return { ...state.toData(), points: state.points() };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { populate, purge, villageData };
