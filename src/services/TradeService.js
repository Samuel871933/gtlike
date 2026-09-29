'use strict';

const { Op } = require('sequelize');
const { sequelize, Player, Village, Transport, MarketOffer, Report } = require('../models');
const formulas = require('../game/formulas');
const { distance } = require('../game/movement');
const VillageService = require('./VillageService');
const GameError = require('./GameError');

const RESOURCES = ['wood', 'stone', 'iron'];

function total(res) {
  return RESOURCES.reduce((n, r) => n + (res[r] || 0), 0);
}

function villageLabel(v) {
  return `${v.name} (${v.x}|${v.y})`;
}

/** Partie d'un rapport de commerce : joueur et village (rendus comme « Vendeur : … / Village : … » sur GT). */
function party(village, player) {
  return {
    playerId: player ? player.id : null, playerName: player ? player.name : null,
    villageId: village.id, name: village.name, x: village.x, y: village.y,
  };
}

function positiveInt(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

class TradeService {
  /** Durée (s) d'un trajet de marchands entre deux villages. */
  static travelSeconds(from, to, cfg) {
    const minutesPerField = cfg.market.merchantSpeed / (cfg.speed * cfg.unitSpeed);
    return Math.round(distance(from, to) * minutesPerField * 60);
  }

  static merchantsNeeded(amount, cfg) {
    return Math.ceil(amount / cfg.market.merchantCapacity);
  }

  /** Marchands du village : total selon le marché, occupés (en route ou réservés par une offre), libres. */
  static async merchants(ctx, t) {
    const totalCount = formulas.merchantCount(ctx.state.level('market'));
    const [moving, reserved] = await Promise.all([
      Transport.sum('merchants', { where: { originVillageId: ctx.village.id }, transaction: t }),
      MarketOffer.findAll({ where: { villageId: ctx.village.id }, attributes: ['count', 'merchantsPerOffer'], transaction: t }),
    ]);
    const busy = (moving || 0) + reserved.reduce((n, o) => n + o.count * o.merchantsPerOffer, 0);
    return { total: totalCount, busy, free: Math.max(0, totalCount - busy) };
  }

  static assertMarket(ctx) {
    if (ctx.state.level('market') < 1) throw new GameError('Il faut un marché.');
  }

  static parseResources(input) {
    return Object.fromEntries(RESOURCES.map((r) => [r, positiveInt(input?.[r])]));
  }

  // ---------------------------------------------------------------- Envoi direct

  static async send(villageId, { x, y, resources }, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      TradeService.assertMarket(ctx);
      const amount = total(resources);
      if (amount <= 0) throw new GameError('Aucune ressource à envoyer.');
      if (!ctx.state.canAfford(resources)) throw new GameError('Ressources insuffisantes.');

      const target = await Village.findOne({ where: { worldId: ctx.village.worldId, x: Number(x), y: Number(y) }, transaction: t });
      if (!target) throw new GameError(`Aucun village en ${x}|${y}.`);
      if (target.id === ctx.village.id) throw new GameError('Impossible de livrer son propre village.');
      if (!target.playerId) throw new GameError('Les villages barbares ne commercent pas.');

      const needed = TradeService.merchantsNeeded(amount, ctx.cfg);
      const { free } = await TradeService.merchants(ctx, t);
      if (needed > free) throw new GameError(`Il faut ${needed} marchand(s), ${free} disponible(s).`);

      ctx.state.pay(resources);
      await ctx.village.update(ctx.state.resources, { transaction: t });
      return TradeService.dispatch(ctx.village, target, resources, needed, ctx.now, ctx.cfg, t);
    }, { now });
  }

  static dispatch(from, to, resources, merchants, now, cfg, t) {
    const seconds = TradeService.travelSeconds(from, to, cfg);
    return Transport.create({
      worldId: from.worldId,
      type: 'delivery',
      originVillageId: from.id,
      targetVillageId: to.id,
      resources,
      merchants,
      startsAt: now,
      arrivesAt: new Date(now.getTime() + seconds * 1000),
    }, { transaction: t });
  }

  // ---------------------------------------------------------------- Offres

  /**
   * Publie `count` lots. Limites comme sur GT : `maxHours` durée maximale du voyage (vide : aucune),
   * `tribeOnly` réservée aux membres de la tribu du vendeur.
   */
  static async createOffer(villageId, { sellResource, sellAmount, buyResource, buyAmount, count, maxHours, tribeOnly }, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      TradeService.assertMarket(ctx);
      const sell = positiveInt(sellAmount);
      const buy = positiveInt(buyAmount);
      const n = positiveInt(count) || 1;
      const hours = positiveInt(maxHours) || null;
      const onlyTribe = tribeOnly === true || tribeOnly === '1' || tribeOnly === 'on';
      if (onlyTribe) {
        const owner = await Player.findByPk(ctx.village.playerId, { attributes: ['tribeId'], transaction: t });
        if (!owner.tribeId) throw new GameError('Commerce de tribu uniquement : vous n’êtes dans aucune tribu.');
      }
      if (!RESOURCES.includes(sellResource) || !RESOURCES.includes(buyResource)) throw new GameError('Ressource inconnue.');
      if (sellResource === buyResource) throw new GameError('Choisissez deux ressources différentes.');
      if (!sell || !buy) throw new GameError('Indiquez les quantités.');
      const { maxRatio } = ctx.cfg.market;
      if (sell / buy > maxRatio || buy / sell > maxRatio) {
        throw new GameError(`Le rapport entre les deux quantités ne peut pas dépasser 1:${maxRatio}.`);
      }

      const perOffer = TradeService.merchantsNeeded(sell, ctx.cfg);
      const { free } = await TradeService.merchants(ctx, t);
      if (perOffer * n > free) throw new GameError(`Il faut ${perOffer * n} marchand(s), ${free} disponible(s).`);
      const reserved = { wood: 0, stone: 0, iron: 0, [sellResource]: sell * n };
      if (!ctx.state.canAfford(reserved)) throw new GameError('Ressources insuffisantes.');

      ctx.state.pay(reserved);
      await ctx.village.update(ctx.state.resources, { transaction: t });
      return MarketOffer.create({
        worldId: ctx.village.worldId, villageId: ctx.village.id,
        sellResource, sellAmount: sell, buyResource, buyAmount: buy, count: n, merchantsPerOffer: perOffer,
        maxHours: hours, tribeOnly: onlyTribe,
      }, { transaction: t });
    }, { now });
  }

  /** Retire des lots d'une offre : ressources rendues, marchands libérés. */
  static async cancelOffer(villageId, offerId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const offer = await MarketOffer.findOne({ where: { id: Number(offerId), villageId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!offer) throw new GameError('Offre introuvable.', 404);
      ctx.state.resources[offer.sellResource] += offer.sellAmount * offer.count;
      await ctx.village.update(ctx.state.resources, { transaction: t });
      await offer.destroy({ transaction: t });
    }, { now });
  }

  /**
   * Accepte `count` lots d'une offre : chaque village envoie ses marchands vers l'autre.
   */
  static async acceptOffer(villageId, offerId, count, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      TradeService.assertMarket(ctx);
      const offer = await MarketOffer.findByPk(Number(offerId), { transaction: t, lock: t.LOCK.UPDATE });
      if (!offer || offer.worldId !== ctx.village.worldId) throw new GameError("Cette offre n'existe plus.", 404);
      const seller = await Village.findByPk(offer.villageId, { transaction: t });
      if (seller.playerId === ctx.village.playerId) throw new GameError('Vous ne pouvez pas accepter vos propres offres.');
      const blocker = await TradeService.offerBlocker(offer, seller, ctx, t);
      if (blocker) throw new GameError(blocker);

      const n = Math.min(positiveInt(count) || 1, offer.count);
      const pay = { wood: 0, stone: 0, iron: 0, [offer.buyResource]: offer.buyAmount * n };
      if (!ctx.state.canAfford(pay)) throw new GameError('Ressources insuffisantes.');
      const needed = TradeService.merchantsNeeded(offer.buyAmount, ctx.cfg) * n;
      const { free } = await TradeService.merchants(ctx, t);
      if (needed > free) throw new GameError(`Il faut ${needed} marchand(s), ${free} disponible(s).`);

      ctx.state.pay(pay);
      await ctx.village.update(ctx.state.resources, { transaction: t });
      const goods = { wood: 0, stone: 0, iron: 0, [offer.sellResource]: offer.sellAmount * n };
      await TradeService.dispatch(seller, ctx.village, goods, offer.merchantsPerOffer * n, ctx.now, ctx.cfg, t);
      const payment = await TradeService.dispatch(ctx.village, seller, pay, needed, ctx.now, ctx.cfg, t);
      if (offer.count > n) await offer.update({ count: offer.count - n }, { transaction: t });
      else await offer.destroy({ transaction: t });

      const AchievementService = require('./AchievementService');
      for (const id of [seller.playerId, ctx.village.playerId]) await AchievementService.addStats(id, { tradesCompleted: 1 }, t);
      await AchievementService.evaluateMany([seller.playerId, ctx.village.playerId], { now: ctx.now, t });
      const buyer = await Player.findByPk(ctx.village.playerId, { transaction: t });
      const sellerPlayer = await Player.findByPk(seller.playerId, { transaction: t });
      await Report.create({
        playerId: seller.playerId, type: 'trade', happenedAt: ctx.now,
        title: `${buyer.name} a accepté votre offre`,
        data: {
          perspective: 'trade', kind: 'offer', from: villageLabel(ctx.village), village: villageLabel(seller),
          seller: party(seller, sellerPlayer), buyer: party(ctx.village, buyer), lots: n,
          sell: { resource: offer.sellResource, amount: offer.sellAmount }, buy: { resource: offer.buyResource, amount: offer.buyAmount },
          // Paiement de l'acheteur : il arrive au village du vendeur à cette heure.
          arrivesAt: payment.arrivesAt,
          sent: goods, received: pay,
        },
      }, { transaction: t });
    }, { now });
  }

  /** Pourquoi le village de `ctx` ne peut pas accepter l'offre (durée du voyage, tribu), ou null. */
  static async offerBlocker(offer, sellerVillage, ctx, t) {
    if (offer.maxHours && TradeService.travelSeconds(ctx.village, sellerVillage, ctx.cfg) > offer.maxHours * 3600) {
      return `Trop loin : cette offre est limitée à ${offer.maxHours} h de voyage.`;
    }
    if (offer.tribeOnly) {
      const [seller, buyer] = await Promise.all([
        Player.findByPk(sellerVillage.playerId, { attributes: ['tribeId'], transaction: t }),
        Player.findByPk(ctx.village.playerId, { attributes: ['tribeId'], transaction: t }),
      ]);
      if (!seller || !seller.tribeId || seller.tribeId !== buyer.tribeId) return 'Offre réservée à la tribu du vendeur.';
    }
    return null;
  }

  /**
   * Recherche d'offres (onglet Échange de GT) : offres des autres joueurs, les plus proches d'abord.
   * `sell` : ressource voulue (celle que l'offre donne), `buy` : ressource offerte (celle qu'elle demande),
   * `maxHours` : durée de voyage maximale, `filter` : all | possible (acceptables maintenant) | tribe (de ta tribu).
   * Les offres limitées à la tribu ou à une durée de voyage ne sont montrées qu'à ceux qui peuvent les accepter.
   */
  static async listOffers(ctx, { sell, buy, maxHours, filter = 'all' } = {}) {
    const where = { worldId: ctx.village.worldId };
    if (RESOURCES.includes(sell)) where.sellResource = sell;
    if (RESOURCES.includes(buy)) where.buyResource = buy;
    const me = await Player.findByPk(ctx.village.playerId, { attributes: ['id', 'tribeId'] });
    const offers = await MarketOffer.findAll({
      where,
      include: [{ association: 'village', include: [Player], where: { playerId: { [Op.ne]: ctx.village.playerId } } }],
      limit: 500,
    });
    const { free } = await TradeService.merchants(ctx);
    const limit = positiveInt(maxHours) * 3600 || Infinity;
    return offers
      .map((o) => {
        const seconds = TradeService.travelSeconds(ctx.village, o.village, ctx.cfg);
        const perLot = TradeService.merchantsNeeded(o.buyAmount, ctx.cfg);
        const max = Math.max(0, Math.min(o.count, Math.floor(ctx.state.resources[o.buyResource] / o.buyAmount), Math.floor(free / perLot)));
        const sameTribe = Boolean(me.tribeId) && o.village.Player && o.village.Player.tribeId === me.tribeId;
        return { offer: o, distance: distance(ctx.village, o.village), seconds, max, sameTribe, ratio: o.sellAmount / o.buyAmount };
      })
      .filter((r) => (!r.offer.maxHours || r.seconds <= r.offer.maxHours * 3600) && (!r.offer.tribeOnly || r.sameTribe))
      .filter((r) => r.seconds <= limit && (filter !== 'possible' || r.max > 0) && (filter !== 'tribe' || r.sameTribe))
      .sort((a, b) => a.distance - b.distance);
  }

  /**
   * Résumé de plusieurs villages du joueur (statut des marchands, offres en masse, demande) : ressources à jour,
   * marchands, entrepôt, livraisons en cours.
   */
  static async villagesSummary(villageIds, now = new Date()) {
    const out = [];
    for (const id of villageIds) {
      out.push(await VillageService.withVillage(id, async (ctx, t) => ({
        village: ctx.village,
        resources: { ...ctx.state.resources },
        storage: ctx.state.storageCapacity(),
        market: ctx.state.level('market'),
        merchants: await TradeService.merchants(ctx, t),
      }), { now }));
    }
    return out;
  }

  /** Ressources en route vers le village (Arrivant) et envoyées par lui (Sortant), comme l'en-tête du marché de GT. */
  static async flows(villageId) {
    const [incoming, outgoing] = await Promise.all([
      Transport.findAll({ where: { targetVillageId: villageId, type: 'delivery' }, attributes: ['resources'] }),
      Transport.findAll({ where: { originVillageId: villageId, type: 'delivery' }, attributes: ['resources'] }),
    ]);
    const sum = (list) => Object.fromEntries(RESOURCES.map((r) => [r, list.reduce((n, tr) => n + (tr.resources[r] || 0), 0)]));
    return { incoming: sum(incoming), outgoing: sum(outgoing) };
  }

  /** Par village : marchands en route (livraisons et retours) et marchands réservés par des offres (statut des marchands). */
  static async movingByVillage(villageIds) {
    const [moving, reserved] = await Promise.all([
      Transport.findAll({ where: { originVillageId: villageIds }, attributes: ['originVillageId', 'type', 'merchants'], raw: true }),
      MarketOffer.findAll({ where: { villageId: villageIds }, attributes: ['villageId', 'count', 'merchantsPerOffer'], raw: true }),
    ]);
    const out = new Map(villageIds.map((id) => [id, { delivery: 0, return: 0, offers: 0 }]));
    for (const tr of moving) out.get(tr.originVillageId)[tr.type === 'return' ? 'return' : 'delivery'] += tr.merchants;
    for (const o of reserved) out.get(o.villageId).offers += o.count * o.merchantsPerOffer;
    return out;
  }

  /** Toutes les offres des villages du joueur (onglet « Toutes tes propres offres »). */
  static async playerOffers(villageIds) {
    return MarketOffer.findAll({ where: { villageId: villageIds }, include: [{ association: 'village', attributes: ['id', 'name', 'x', 'y'] }], order: [['villageId', 'ASC'], ['id', 'ASC']] });
  }

  static async overview(villageId) {
    const withVillages = [
      { association: 'origin', include: [Player] },
      { association: 'target', include: [Player] },
    ];
    const [outgoing, incoming, offers] = await Promise.all([
      Transport.findAll({ where: { originVillageId: villageId }, include: withVillages, order: [['arrivesAt', 'ASC']] }),
      Transport.findAll({ where: { targetVillageId: villageId, type: 'delivery' }, include: withVillages, order: [['arrivesAt', 'ASC']] }),
      MarketOffer.findAll({ where: { villageId }, order: [['id', 'ASC']] }),
    ]);
    return { outgoing, incoming, offers };
  }

  // ---------------------------------------------------------------- Arrivées

  static async process(transportId) {
    return sequelize.transaction(async (t) => {
      const tr = await Transport.findByPk(transportId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!tr) return;
      if (tr.type === 'delivery') await TradeService.deliver(tr, t);
      await tr.destroy({ transaction: t });
    });
  }

  /** Livraison : les ressources au-delà de l'entrepôt sont perdues ; les marchands repartent. */
  static async deliver(tr, t) {
    const at = new Date(tr.arrivesAt);
    const ctx = await VillageService.refresh(tr.targetVillageId, t, at);
    const cap = ctx.state.storageCapacity();
    for (const r of RESOURCES) {
      const cur = ctx.state.resources[r];
      ctx.state.resources[r] = Math.max(cur, Math.min(cap, cur + (tr.resources[r] || 0)));
    }
    await ctx.village.update(ctx.state.resources, { transaction: t });

    await Transport.create({
      worldId: tr.worldId,
      type: 'return',
      originVillageId: tr.originVillageId,
      targetVillageId: tr.targetVillageId,
      resources: {},
      merchants: tr.merchants,
      startsAt: at,
      arrivesAt: new Date(at.getTime() + (at - new Date(tr.startsAt))),
    }, { transaction: t });

    const origin = await Village.findByPk(tr.originVillageId, { include: [Player], transaction: t });
    if (ctx.village.playerId && ctx.village.playerId !== origin.playerId) {
      const recipient = await Player.findByPk(ctx.village.playerId, { transaction: t });
      await Report.create({
        playerId: ctx.village.playerId, type: 'trade', happenedAt: at,
        title: `${origin.Player ? origin.Player.name : 'Un joueur'} fournit ${ctx.village.name}`,
        data: {
          perspective: 'trade', kind: 'delivery', from: villageLabel(origin), village: villageLabel(ctx.village),
          sender: party(origin, origin.Player), recipient: party(ctx.village, recipient), received: tr.resources,
        },
      }, { transaction: t });
    }
  }
}

module.exports = TradeService;
