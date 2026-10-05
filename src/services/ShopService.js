'use strict';

const { Op } = require('sequelize');
const { sequelize, User, World, Player, Entitlement, AdartonTransaction } = require('../models');
const catalog = require('../game/shopCatalog');
const { DEFAULT_GAME_STYLE } = require('../web/gameStyles');
const { DEFAULT_VILLAGE_DESIGN } = require('../web/villageDesigns');
const GameError = require('./GameError');
const { factionDesign } = require('../game/factions');

// Articles toujours possédés : le thème et le design par défaut.
const FREE = new Set([`theme:${DEFAULT_GAME_STYLE}`, `design:${DEFAULT_VILLAGE_DESIGN}`]);

/** Droits d'un joueur dans un contexte (compte, et monde s'il y en a un) : quels articles il possède. */
class Rights {
  constructor(keys = []) {
    this.keys = new Set(keys);
  }

  /** Possède-t-il l'article (les cosmétiques sont aussi couverts par le pack « Tous les cosmétiques ») ? */
  has(key) {
    if (FREE.has(key) || this.keys.has(key)) return true;
    return catalog.isCosmetic(key) && this.keys.has('cosmetics:all');
  }

  get premium() {
    return this.keys.has('premium');
  }
}

/** Droits en cours à `now` (commencés, pas encore finis). */
const activeAt = (now) => ({ startsAt: { [Op.lte]: now }, [Op.or]: [{ endsAt: null }, { endsAt: { [Op.gt]: now } }] });

class ShopService {
  /**
   * Droits d'un compte : ceux du compte, et sur le monde `worldId` ceux de son joueur et ceux offerts à tout le serveur.
   * Sans compte (bots), seulement ceux du serveur.
   */
  static async rightsFor(userId, worldId = null, { now = new Date(), t } = {}) {
    const scopes = [];
    if (userId) scopes.push({ scope: 'account', userId });
    if (userId && worldId) scopes.push({ scope: 'world', userId, worldId });
    if (worldId) scopes.push({ scope: 'server', worldId });
    if (!scopes.length) return new Rights();
    const [rows, faction] = await Promise.all([
      Entitlement.findAll({ where: { ...activeAt(now), [Op.and]: [{ [Op.or]: scopes }] }, attributes: ['itemKey'], transaction: t }),
      userId && worldId ? ShopService.factionKeys(userId, worldId, t) : [],
    ]);
    return new Rights([...rows.map((r) => r.itemKey), ...faction]);
  }

  /** Monde à factions : le design de village de sa faction est offert au joueur sur ce monde. */
  static async factionKeys(userId, worldId, t) {
    const player = await Player.findOne({ where: { userId, worldId }, attributes: ['faction'], transaction: t });
    const design = factionDesign(player && player.faction);
    return design ? [`design:${design}`] : [];
  }

  /** Droits de plusieurs comptes sur un même monde (carte : design des villages de chaque propriétaire). */
  static async rightsByUser(userIds, worldId, { now = new Date() } = {}) {
    const ids = [...new Set(userIds.filter(Boolean))];
    const out = new Map(ids.map((id) => [id, []]));
    const server = [];
    const rows = await Entitlement.findAll({
      where: {
        ...activeAt(now),
        [Op.and]: [{ [Op.or]: [
          ...(ids.length ? [{ scope: 'account', userId: { [Op.in]: ids } }, { scope: 'world', worldId, userId: { [Op.in]: ids } }] : []),
          { scope: 'server', worldId },
        ] }],
      },
      attributes: ['scope', 'userId', 'itemKey'],
    });
    for (const r of rows) {
      if (r.scope === 'server') server.push(r.itemKey);
      else if (out.has(r.userId)) out.get(r.userId).push(r.itemKey);
    }
    // Monde à factions : design de sa faction offert à chaque joueur.
    if (ids.length) {
      const players = await Player.findAll({ where: { worldId, userId: { [Op.in]: ids }, faction: { [Op.ne]: null } }, attributes: ['userId', 'faction'], raw: true });
      for (const p of players) if (factionDesign(p.faction)) out.get(p.userId).push(`design:${factionDesign(p.faction)}`);
    }
    const rights = new Map([...out].map(([id, keys]) => [id, new Rights([...keys, ...server])]));
    rights.server = new Rights(server);
    return rights;
  }

  /** Le joueur (compte `userId`) a-t-il le premium sur ce monde ? */
  static async hasPremium(userId, worldId, opts) {
    return (await ShopService.rightsFor(userId, worldId, opts)).premium;
  }

  /** Mondes où l'on peut utiliser un achat : ceux où l'on joue (portée monde), ses serveurs privés (portée serveur). */
  static async targets(userId) {
    const players = await Player.findAll({ where: { userId }, include: [{ model: World, attributes: ['id', 'slug', 'name', 'endedAt'] }] });
    const servers = await World.findAll({ where: { ownerUserId: userId, endedAt: null }, attributes: ['id', 'slug', 'name'], order: [['name', 'ASC']] });
    return {
      world: players.map((p) => p.World).filter((w) => w && !w.endedAt).sort((a, b) => a.name.localeCompare(b.name)),
      server: servers,
    };
  }

  /**
   * Achat d'un article avec des Adartons. `waiver` : renonciation au droit de rétractation (contenu numérique fourni
   * tout de suite), obligatoire. Les durées s'ajoutent : un premium acheté pendant un premium en cours le prolonge.
   */
  static async purchase(userId, { itemKey, offerId, worldId, waiver }, { now = new Date() } = {}) {
    const item = catalog.item(String(itemKey || ''));
    const offer = item && item.offers.find((o) => o.id === offerId);
    if (!offer) throw new GameError('Offre inconnue.');
    if (!waiver) throw new GameError('Coche la renonciation au droit de rétractation pour confirmer l’achat.');

    return sequelize.transaction(async (t) => {
      const user = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!user) throw new GameError('Compte introuvable.', 404);
      let world = null;
      if (offer.scope !== 'account') {
        world = await World.findByPk(Number(worldId), { transaction: t });
        if (!world || world.endedAt) throw new GameError('Choisis un monde en cours.');
        if (offer.scope === 'world' && !(await Player.count({ where: { userId, worldId: world.id }, transaction: t }))) {
          throw new GameError('Tu ne joues pas sur ce monde.');
        }
        if (offer.scope === 'server' && world.ownerUserId !== userId) throw new GameError('Seul le créateur d’un serveur privé peut le débloquer pour tous ses joueurs.');
      }

      // Cosmétiques et droits sans fin : pas de double achat d'une chose déjà possédée dans cette portée (ou plus large).
      const target = { scope: offer.scope, ...(offer.scope === 'server' ? {} : { userId }), ...(world ? { worldId: world.id } : { worldId: null }) };
      if (!offer.days && item.key !== 'premium') {
        const owned = offer.scope === 'server'
          ? (await ShopService.rightsByUser([], world.id, { now })).server
          : await ShopService.rightsFor(userId, offer.scope === 'world' ? world.id : null, { now, t });
        if (owned.has(item.key)) throw new GameError('Tu possèdes déjà cet article pour cette portée (ou une portée plus large).');
      }
      if (!offer.days && item.key === 'premium' && await Entitlement.count({ where: { ...target, itemKey: 'premium', endsAt: null }, transaction: t })) {
        throw new GameError('Ce serveur a déjà le premium pour toute sa durée.');
      }
      if (user.adartons < offer.price) throw new GameError(`Il te manque ${offer.price - user.adartons} Adartons.`);

      // Durée : à la suite du même droit en cours (même article, même portée, même cible).
      let startsAt = now;
      if (offer.days) {
        const running = await Entitlement.findAll({ where: { ...target, itemKey: item.key, ...activeAt(now) }, transaction: t });
        if (running.some((r) => !r.endsAt)) throw new GameError('Ce droit est déjà actif sans limite de durée.');
        const last = running.reduce((m, r) => Math.max(m, new Date(r.endsAt).getTime()), 0);
        if (last > now.getTime()) startsAt = new Date(last);
      }
      const endsAt = offer.days ? new Date(startsAt.getTime() + offer.days * 86400000) : null;
      const right = await Entitlement.create({ ...target, userId, itemKey: item.key, offerId: offer.id, startsAt, endsAt, price: offer.price, source: 'purchase' }, { transaction: t });
      await user.update({ adartons: user.adartons - offer.price }, { transaction: t });
      const where = world ? ` · ${world.name}` : '';
      await AdartonTransaction.create({
        userId, amount: -offer.price, balanceAfter: user.adartons, reason: 'purchase', entitlementId: right.id,
        label: `${item.name} · ${catalog.SCOPES[offer.scope].name}${where} · ${catalog.durationLabel(offer)}`.slice(0, 160),
      }, { transaction: t });
      return right;
    });
  }

  /** Crédit (ou débit, montant négatif) d'Adartons hors boutique : administration, futurs packs payés. */
  static async credit(userId, amount, label, { reason = 'admin' } = {}) {
    const n = Math.trunc(Number(amount));
    if (!Number.isFinite(n) || !n) throw new GameError('Montant invalide.');
    return sequelize.transaction(async (t) => {
      const user = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!user) throw new GameError('Compte introuvable.', 404);
      if (user.adartons + n < 0) throw new GameError('Solde insuffisant.');
      await user.update({ adartons: user.adartons + n }, { transaction: t });
      await AdartonTransaction.create({ userId, amount: n, balanceAfter: user.adartons, reason, label: String(label).slice(0, 160) }, { transaction: t });
      return user.adartons;
    });
  }

  /**
   * Crédit d'un pack d'Adartons payé (à appeler par le futur paiement, une fois le paiement confirmé) : le pack, plus
   * le bonus de l'happy hour si le paiement tombe pendant (vendredi et samedi, 19 h-20 h).
   */
  static async creditPack(userId, packId, { now = new Date() } = {}) {
    const pack = catalog.PACKS.find((p) => p.id === packId);
    if (!pack) throw new GameError('Pack inconnu.');
    const { base, bonus, total } = catalog.packCredit(pack, now);
    const label = bonus ? `Pack de ${base} Adartons + ${bonus} offerts (happy hour)` : `Pack de ${base} Adartons`;
    await ShopService.credit(userId, total, label, { reason: 'pack' });
    return { base, bonus, total };
  }

  /** « Mes achats » : droits du compte (y compris ceux offerts à ses serveurs) et historique des Adartons. */
  static async history(userId, { now = new Date() } = {}) {
    const rights = await Entitlement.findAll({
      where: { userId }, include: [{ model: World, attributes: ['id', 'name', 'slug', 'endedAt'] }], order: [['createdAt', 'DESC'], ['id', 'DESC']],
    });
    const transactions = await AdartonTransaction.findAll({ where: { userId }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 100 });
    return {
      rights: rights.map((r) => ({ row: r, item: catalog.item(r.itemKey), active: new Date(r.startsAt) <= now && (!r.endsAt || new Date(r.endsAt) > now) })),
      transactions,
    };
  }

  /**
   * Suppression du compte : ses droits personnels et son solde disparaissent ; ce qu'il a offert à un serveur reste à
   * ses joueurs ; l'historique des Adartons est gardé sans compte (comptabilité).
   */
  static async forgetUser(userId, t) {
    await Entitlement.destroy({ where: { userId, scope: { [Op.ne]: 'server' } }, transaction: t });
    await Entitlement.update({ userId: null }, { where: { userId, scope: 'server' }, transaction: t });
    await AdartonTransaction.update({ userId: null }, { where: { userId }, transaction: t });
  }
}

ShopService.Rights = Rights;
ShopService.FREE = FREE;

module.exports = ShopService;
