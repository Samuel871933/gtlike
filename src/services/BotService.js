'use strict';

const { Op } = require('sequelize');
const { World, Player, Bot, Village, User, Command, Report } = require('../models');
const registry = require('../game/registry');
const brain = require('../game/botBrain');
const VillageService = require('./VillageService');
const CommandService = require('./CommandService');
const WorldService = require('./WorldService');
const NobleService = require('./NobleService');
const GameError = require('./GameError');

// Bots : des joueurs sans compte (Player.userId nul, isBot), gérés par l'ordinateur. Le monde en garde
// `config.bots.count` en jeu. Chaque bot se réveille régulièrement (Bot.nextActionAt) et joue avec les mêmes services
// qu'un joueur : construction, recherche, recrutement, pillage des barbares proches et, selon la difficulté
// (config.bots.difficulty, voir game/botBrain), attaques sur les joueurs et conquête avec des nobles.

const NAMES = [
  'Aldric', 'Baudouin', 'Clovis', 'Dagobert', 'Enguerrand', 'Foulques', 'Gauvain', 'Hugues', 'Isambard', 'Jehan',
  'Lothaire', 'Mérovée', 'Norbert', 'Odon', 'Pépin', 'Raoul', 'Sigebert', 'Thibaut', 'Ulric', 'Vauquelin',
  'Aliénor', 'Berthe', 'Clotilde', 'Ermengarde', 'Frédégonde', 'Gisèle', 'Hildegarde', 'Iseut', 'Mahaut', 'Radegonde',
  'Brunehaut', 'Childéric', 'Eudes', 'Godefroy', 'Hérold', 'Lancelin', 'Robert le Fort', 'Tancrède', 'Wulfran', 'Yolande',
];

// Rayon de pillage (cases), vagues par réveil et par village ; une cible où une vague perd au moins AVOID_LOSSES de
// ses troupes est évitée pendant AVOID_MS.
const RAID_RADIUS = 12;
const MAX_WAVES = 8;
const AVOID_LOSSES = 0.3;
const AVOID_MS = 3 * 86400000;
// Rapports gardés pour un bot (personne ne les lit) : ils servent juste au suivi des dernières attaques.
const REPORTS_KEPT_MS = 86400000;
// Population de chaque unité.
const POP = Object.fromEntries([...registry.UNITS.values()].map((u) => [u.id, u.pop]));
// Bots traités par tour de boucle, pour ne pas bloquer les combats.
const PER_TICK = 10;

class BotService {
  /** Délai entre deux réveils : 15 minutes à vitesse 1, plus souvent sur les mondes rapides (1 minute au moins). */
  static wakeDelayMs(cfg, rng = Math.random) {
    const base = Math.min(15, Math.max(1, 15 / cfg.speed)) * 60000;
    return Math.round(base * (0.8 + 0.4 * rng()));
  }

  /** Nom libre sur ce monde (et qu'aucun compte ne porte, pour éviter les homonymes s'il rejoint le monde). */
  static async freeName(worldId, rng = Math.random) {
    const players = await Player.findAll({ where: { worldId }, attributes: ['name'], raw: true });
    const users = await User.findAll({ where: { username: NAMES }, attributes: ['username'], raw: true });
    const taken = new Set([...players.map((p) => p.name), ...users.map((u) => u.username)]);
    const free = NAMES.filter((n) => !taken.has(n));
    if (free.length) return free[Math.floor(rng() * free.length)];
    for (let i = 2; ; i += 1) {
      const name = `${NAMES[Math.floor(rng() * NAMES.length)]} ${i}`;
      if (!taken.has(name)) return name;
    }
  }

  /** Complète les bots d'un monde en cours jusqu'à `config.bots.count`. */
  static async ensureBots(world, { now = new Date(), rng = Math.random } = {}) {
    const cfg = world.getConfig();
    if (world.endedAt || !cfg.bots.count) return [];
    const missing = cfg.bots.count - (await Bot.count({ where: { worldId: world.id } }));
    const created = [];
    for (let i = 0; i < missing; i += 1) {
      const name = await BotService.freeName(world.id, rng);
      const { player } = await WorldService.joinBot(world, { name, now, rng });
      created.push(await Bot.create({ worldId: world.id, playerId: player.id, nextActionAt: now }));
    }
    return created;
  }

  /** Réveille les bots dont c'est l'heure (quelques-uns par tour). */
  static async processDue(now = new Date()) {
    const due = await Bot.findAll({ where: { nextActionAt: { [Op.lte]: now } }, order: [['nextActionAt', 'ASC']], limit: PER_TICK });
    for (const bot of due) {
      try {
        await BotService.wake(bot, { now });
      } catch (err) {
        console.error(`[Bot ${bot.id}]`, err);
      }
    }
    return due.length;
  }

  /** Un tour de jeu du bot : chacun de ses villages construit, recherche, recrute, pille, attaque et conquiert. */
  static async wake(bot, { now = new Date(), rng = Math.random } = {}) {
    const world = await World.findByPk(bot.worldId);
    const cfg = world.getConfig();
    await bot.update({ nextActionAt: new Date(now.getTime() + BotService.wakeDelayMs(cfg, rng)) });
    if (world.endedAt) return;
    const player = await Player.findByPk(bot.playerId);
    const villages = await Village.findAll({ where: { playerId: player.id }, attributes: ['id'], order: [['id', 'ASC']] });
    if (!villages.length) {
      // Tous ses villages perdus : il recommence, comme un joueur.
      if (world.isOpen) await WorldService.joinBot(world, { player, now, rng });
      return;
    }
    const memory = await BotService.learn(bot, now);
    const p = brain.profile(cfg.bots.difficulty);
    const turn = { bot, player, cfg, p, memory, avoid: new Set(Object.keys(memory.avoid).map(Number)), now };
    for (const { id } of villages) {
      // Armée et nobles d'abord, le pillage part avec ce qui reste.
      await BotService.develop(id, turn);
      await BotService.strike(id, turn);
      await BotService.conquer(id, turn);
      await BotService.raid(id, turn);
    }
    await bot.update({ memory: { ...memory } });
    await Report.destroy({ where: { playerId: player.id, happenedAt: { [Op.lt]: new Date(now.getTime() - REPORTS_KEPT_MS) } } });
  }

  /**
   * Mémoire du bot mise à jour d'après les rapports d'attaque reçus depuis le dernier réveil : `avoid` (id du village
   * → fin de l'évitement) pour les cibles où une vague a perdu trop de troupes ; `strikeAt` (id de son village →
   * prochaine attaque sur un joueur) ; `nobleTarget` (village visé par ses nobles).
   */
  static async learn(bot, now) {
    const memory = { avoid: {}, strikeAt: {}, nobleTarget: null, ...bot.memory };
    const since = memory.seenAt ? new Date(memory.seenAt) : new Date(0);
    const reports = await Report.findAll({ where: { playerId: bot.playerId, type: 'attack', happenedAt: { [Op.gt]: since, [Op.lte]: now } } });
    const total = (units) => Object.values(units || {}).reduce((n, x) => n + (x || 0), 0);
    for (const r of reports) {
      const { attacker, defender } = r.data;
      if (attacker && defender && total(attacker.losses) >= AVOID_LOSSES * total(attacker.units)) {
        memory.avoid[defender.villageId] = now.getTime() + AVOID_MS;
        if (memory.nobleTarget === defender.villageId) memory.nobleTarget = null;
      }
    }
    for (const [id, until] of Object.entries(memory.avoid)) if (until <= now.getTime()) delete memory.avoid[id];
    memory.seenAt = now.toISOString();
    return memory;
  }

  /** Lance une action du jeu ; un refus des règles (ressources, file pleine…) n'est pas une erreur pour un bot. */
  static async attempt(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GameError) return null;
      throw err;
    }
  }

  /**
   * Construction, recherche, pièces d'or et nobles, puis recrutement d'un village. Avec une académie et aucun noble
   * au village, le prochain noble passe d'abord : on frappe une pièce quand il n'y a plus d'emplacement libre, sinon
   * on forme le noble ; ce qui n'est pas encore payable est mis de côté, et le reste n'y touche pas.
   */
  static async develop(villageId, turn) {
    const { p, now } = turn;
    const plan = await VillageService.withVillage(villageId, async (ctx, t) => {
      const { state, cfg } = ctx;
      // Pas d'église dans le village de la première église (une seule église par village).
      const has = (id) => registry.BUILDINGS.get(id)?.isAvailableIn(cfg) && (id !== 'snob' || p.noble !== 'none')
        && (id !== 'church' || !state.level('church_f'));
      const building = brain.nextBuilding({
        level: (id) => VillageService.nextLevel(ctx, id) - 1,
        has,
        popRatio: ctx.popUsed() / state.farmCapacity(),
        storageRatio: Math.max(...Object.values(state.resources)) / state.storageCapacity(),
      });
      const option = building && ctx.buildOrders.length < Math.min(2, cfg.buildQueueSlots)
        ? VillageService.buildOption(ctx, registry.building(building)) : null;
      const wanted = brain.research(p);
      const research = VillageService.researchOptions(ctx)
        .find((o) => wanted.includes(o.type.id) && !o.done && !o.running && !o.blocker);
      let noble = null;
      // Un noble à la fois : pas de nouveau tant qu'un autre attend au village ou est en formation.
      const training = ctx.recruitOrders.some((o) => o.unit === 'snob');
      if (p.noble !== 'none' && state.level('snob') >= 1 && !training && !(state.units.snob > 0)) {
        const slots = await NobleService.slots(ctx.village.playerId, t);
        if (slots.free > 0) {
          const snob = registry.unit('snob');
          noble = { action: 'snob', cost: snob.cost, fits: ctx.popUsed() + snob.pop <= state.farmCapacity() };
        } else if (slots.free === 0) {
          noble = { action: 'coin', cost: cfg.snob.coin, fits: true };
        }
        if (noble) noble.affordable = noble.fits && state.canAfford(noble.cost);
      }
      return { option, research, noble, resources: { ...state.resources } };
    }, { now });

    const { option, research, noble, resources } = plan;
    let reserve = null;
    if (noble && noble.affordable) {
      if (noble.action === 'coin') await BotService.attempt(() => NobleService.mint(villageId, 1, { now }));
      else await BotService.attempt(() => VillageService.recruit(villageId, 'snob', { snob: 1 }, { now }));
    } else if (noble && noble.fits) {
      reserve = noble.cost;
    }
    const left = (cost) => ['wood', 'stone', 'iron'].every((r) => resources[r] - (reserve ? reserve[r] : 0) >= cost[r]);
    if (option && !option.blockers.length && !option.lacksResources && left(option.cost)) {
      await BotService.attempt(() => VillageService.build(villageId, option.type.id, { now }));
    }
    if (research && left(research.cost)) await BotService.attempt(() => VillageService.research(villageId, research.type.id, { now }));
    // Recrutement avec ce qui reste, sans entamer ce qui est mis de côté (nobles, ou prochain bâtiment).
    await BotService.recruit(villageId, reserve || (option && option.lacksResources ? option.cost : null), turn);
  }

  static async recruit(villageId, reserve, { p, now }) {
    const order = await VillageService.withVillage(villageId, async (ctx) => {
      const { state, cfg } = ctx;
      const canRecruit = (id) => {
        const type = registry.UNITS.get(id);
        return type && type.isAvailableIn(cfg) && state.level(type.building) >= 1 && state.hasResearched(type)
          && !type.missingRequirements(state.buildings, cfg).length;
      };
      const army = { ...state.units };
      for (const [id, n] of Object.entries(ctx.awayUnits)) army[id] = (army[id] || 0) + n;
      for (const o of ctx.recruitOrders) army[o.unit] = (army[o.unit] || 0) + o.count - o.done;
      const id = brain.nextRecruit({ canRecruit, army, pop: POP, offense: p.offense, rams: Boolean(p.strikeHours) });
      if (!id) return null;
      const type = registry.UNITS.get(id);
      // Pas plus d'une heure de file d'attente (à la vitesse du monde) dans le bâtiment.
      const queueEnd = Math.max(0, ...ctx.recruitOrders.filter((o) => o.building === type.building).map((o) => new Date(o.endsAt).getTime()));
      const unitMs = type.recruitTimeFor(state.level(type.building), cfg) * 1000;
      const room = (now.getTime() + 3600000 / cfg.speed - Math.max(queueEnd, now.getTime())) / unitMs;
      // 10 % de la ferme reste libre pour les bâtiments.
      const freePop = state.farmCapacity() * 0.9 - ctx.popUsed();
      const budget = (r) => state.resources[r] - (reserve ? reserve[r] : 0);
      const n = Math.floor(Math.min(room, freePop / type.pop, ...['wood', 'stone', 'iron'].map((r) => budget(r) / type.cost[r])));
      return n > 0 ? { building: type.building, counts: { [id]: n } } : null;
    }, { now });
    if (order) await BotService.attempt(() => VillageService.recruit(villageId, order.building, order.counts, { now }));
  }

  /** Villages dans un carré de `radius` cases autour de `village` puis dans le cercle, du plus proche au plus loin. */
  static async around(village, radius, where) {
    const rows = await Village.findAll({
      where: {
        // Jamais les villages spéciaux (villages de rune, quartiers du Grand Siège) : leur garnison écraserait le bot.
        worldId: village.worldId, special: null, ...where,
        x: { [Op.between]: [village.x - radius, village.x + radius] },
        y: { [Op.between]: [village.y - radius, village.y + radius] },
      },
      attributes: ['id', 'x', 'y', 'points', 'playerId'], raw: true,
    });
    const d2 = (v) => (v.x - village.x) ** 2 + (v.y - village.y) ** 2;
    return rows.filter((v) => v.id !== village.id && d2(v) <= radius ** 2).sort((a, b) => d2(a) - d2(b));
  }

  static async home(villageId) {
    return Village.findByPk(villageId, { attributes: ['id', 'worldId', 'x', 'y', 'points', 'units', 'buildings'] });
  }

  /** Pille les villages barbares proches qui ne se sont pas montrés dangereux, au plus proche d'abord. */
  static async raid(villageId, { p, avoid, now }) {
    const village = await BotService.home(villageId);
    // Un bot qui attaque les joueurs garde ses haches pour son armée dès qu'il pille avec la cavalerie.
    const keep = p.strikeHours && (village.buildings.stable || 0) >= 3 ? ['axe'] : [];
    const waves = brain.raidWaves(village.units || {}, MAX_WAVES, keep);
    if (!waves.length) return;
    const busy = new Set((await Command.findAll({
      where: { originVillageId: villageId, type: 'attack', cancelled: false }, attributes: ['targetVillageId'], raw: true,
    })).map((c) => c.targetVillageId));
    const targets = (await BotService.around(village, RAID_RADIUS, { playerId: null })).filter((v) => !busy.has(v.id) && !avoid.has(v.id));
    for (const [i, units] of waves.entries()) {
      const target = targets[i];
      if (!target) break;
      await BotService.attempt(() => CommandService.send(villageId, { x: target.x, y: target.y, type: 'attack', units }, { now }));
    }
  }

  /**
   * Attaque sur un joueur (bots normaux et agressifs) : toute l'armée offensive part quand elle est assez grande, au
   * plus une fois par `strikeHours` heures de jeu et par village. Les règles du jeu s'appliquent : un joueur sous
   * protection des débutants est refusé, et on passe au suivant ; un joueur endormi reçoit une simple visite.
   * Les bots agressifs envoient leurs nobles derrière l'armée.
   */
  static async strike(villageId, turn) {
    const { p, cfg, memory, avoid, player, now } = turn;
    if (!p.strikeHours || (memory.strikeAt[villageId] || 0) > now.getTime()) return;
    const village = await BotService.home(villageId);
    const army = brain.nuke(village.units || {}, POP);
    if (army.pop < p.minNuke) return;
    const targets = (await BotService.around(village, p.radius, { playerId: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: player.id }] } }))
      .filter((v) => !avoid.has(v.id));
    // Bots agressifs : l'escorte des nobles présents est prélevée sur l'armée avant son départ.
    const nobles = p.noble === 'all' ? village.units.snob || 0 : 0;
    const escorts = brain.escorts(army.units, nobles);
    const units = { ...army.units };
    for (const e of escorts) for (const [id, n] of Object.entries(e)) units[id] -= n;
    const order = [];
    let rest = [...targets];
    while (rest.length && order.length < 5) {
      const next = brain.strikeTarget(village, rest, village.points);
      order.push(next);
      rest = rest.filter((v) => v !== next);
    }
    for (const target of order) {
      const sent = await BotService.attempt(() => CommandService.send(villageId, { x: target.x, y: target.y, type: 'attack', units }, { now }));
      if (!sent) continue;
      memory.strikeAt[villageId] = now.getTime() + (p.strikeHours * 3600000) / cfg.speed;
      if (escorts.length) {
        memory.nobleTarget = target.id;
        await BotService.sendNobles(villageId, target, escorts, now);
      }
      return;
    }
  }

  /**
   * Conquête (bots normaux et agressifs) : les nobles présents partent, escortés, vers la cible en cours, sinon le
   * village barbare de plus de 200 points le plus proche. La cible est gardée jusqu'à la conquête.
   */
  static async conquer(villageId, turn) {
    const { p, cfg, memory, avoid, player, now } = turn;
    if (p.noble === 'none') return;
    const village = await BotService.home(villageId);
    if (!(village.units?.snob > 0)) return;
    const radius = Math.min(15, cfg.snob.maxDistance);
    let target = memory.nobleTarget ? await Village.findByPk(memory.nobleTarget, { attributes: ['id', 'x', 'y', 'playerId'], raw: true }) : null;
    const reachable = (v) => Math.hypot(v.x - village.x, v.y - village.y) <= cfg.snob.maxDistance;
    if (!target || target.playerId === player.id || avoid.has(target.id) || !reachable(target)
      || (target.playerId && p.noble !== 'all')) target = null;
    if (!target) {
      target = (await BotService.around(village, radius, { playerId: null, points: { [Op.gte]: 200 } })).find((v) => !avoid.has(v.id)) || null;
    }
    if (!target) return;
    // Jamais de noble sans escorte : il attend au village que les troupes reviennent.
    const escorts = brain.escorts(village.units, village.units.snob);
    if (!escorts.length) return;
    memory.nobleTarget = target.id;
    await BotService.sendNobles(villageId, target, escorts, now);
  }

  /** Un noble par attaque, chacun avec son escorte (voir botBrain.escorts). */
  static async sendNobles(villageId, target, escorts, now) {
    for (const escort of escorts) {
      const wave = { snob: 1, ...escort };
      if (!(await BotService.attempt(() => CommandService.send(villageId, { x: target.x, y: target.y, type: 'attack', units: wave }, { now })))) return;
    }
  }
}

BotService.NAMES = NAMES;

module.exports = BotService;
