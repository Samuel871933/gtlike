'use strict';

// Marché (pages d'un village, montées par ./index.js).

const express = require('express');
const VillageService = require('../../../services/VillageService');
const TradeService = require('../../../services/TradeService');
const PaginationService = require('../../../services/PaginationService');
const GameError = require('../../../services/GameError');
const { ah, back, flash } = require('../../middleware');
const { base, me, RESOURCE_IDS } = require('./shared');

const router = express.Router({ mergeParams: true });

// ------------------------------------------------------------ Marché

// Marché, agencé comme sur GT (sans le centre d'échange premium) : menu à gauche, en-tête marchands / transport /
// ressources arrivantes et sortantes. « mine » : ancienne adresse de la création d'offres (liens des rapports).
const MARKET_TABS = ['offers', 'create', 'mass', 'send', 'transports', 'merchants', 'own', 'request'];

router.get('/market', ah(async (req, res) => {
  const asked = req.query.tab === 'mine' ? 'create' : req.query.tab;
  const tab = MARKET_TABS.includes(asked) ? asked : 'offers';
  const cap = req.ctx.cfg.market.merchantCapacity;
  const [merchants, lists, flows] = await Promise.all([
    VillageService.withVillage(req.ctx.village.id, (ctx, t) => TradeService.merchants(ctx, t)),
    TradeService.overview(req.ctx.village.id),
    TradeService.flows(req.ctx.village.id),
  ]);
  const locals = {
    page: 'market', tab, merchants, flows, cap,
    outgoing: lists.outgoing, incoming: lists.incoming, ownOffers: lists.offers,
    form: { x: req.query.x || '', y: req.query.y || '' },
  };

  if (tab === 'offers') {
    // Je veux (ressource que donne l'offre) / J'offre (ressource qu'elle demande), durée maximale, filtre, pagination.
    const filters = {
      sell: RESOURCE_IDS.includes(req.query.sell) ? req.query.sell : '',
      buy: RESOURCE_IDS.includes(req.query.buy) ? req.query.buy : '',
      maxHours: Math.max(0, Math.floor(Number(req.query.hours)) || 0),
      filter: ['all', 'possible', 'tribe'].includes(req.query.filter) ? req.query.filter : 'all',
    };
    const all = await TradeService.listOffers(req.ctx, filters);
    const pg = PaginationService.paginate(all.length, req.query.page, PaginationService.perPage(res.locals.player, 'market'));
    Object.assign(locals, { filters, offers: all.slice(pg.offset, pg.offset + pg.perPage), total: all.length, pagination: pg });
  }
  if (tab === 'create') {
    // Préremplissage : la ressource qu'on a le plus contre celle qu'on a le moins (ou l'offre d'un rapport à recréer).
    const byAmount = [...RESOURCE_IDS].sort((x, y) => req.ctx.state.resources[y] - req.ctx.state.resources[x]);
    const most = byAmount[0];
    const least = byAmount[byAmount.length - 1] === most ? byAmount[1] : byAmount[byAmount.length - 1];
    const pick = (v, fallback) => (RESOURCE_IDS.includes(v) ? v : fallback);
    locals.offerForm = {
      sellResource: pick(req.query.sellResource, most), sellAmount: req.query.sellAmount || cap,
      buyResource: pick(req.query.buyResource, least), buyAmount: req.query.buyAmount || cap,
      count: req.query.count || 1, maxHours: req.query.maxHours || '', tribeOnly: req.query.tribeOnly === '1',
    };
  }
  if (['mass', 'merchants', 'request', 'own'].includes(tab)) {
    const ids = res.locals.myVillages.map((v) => v.id);
    if (tab === 'own') locals.playerOffers = await TradeService.playerOffers(ids);
    else {
      locals.villages = await TradeService.villagesSummary(req.ctx.village.playerId);
      locals.moving = await TradeService.movingByVillage(ids);
      locals.travelTo = (v) => TradeService.travelSeconds(v, req.ctx.village, req.ctx.cfg);
    }
  }
  res.render('market', locals);
}));

// Nombre de lignes par page d'une liste (rapports, messages, offres du marché) : formulaire commun
// (partials/pagination), retour sur la liste, à la première page.
router.post('/per-page', ah(async (req, res) => {
  await PaginationService.setPerPage(me(req), req.body.list, req.body.perPage);
  flash(req, 'success', 'Réglage enregistré.');
  const url = new URL(back(req, base(req)), 'http://local');
  url.searchParams.delete('page');
  res.redirect(url.pathname + url.search);
}));

// Offres en masse : la même offre depuis plusieurs de tes villages (champ count_<id> par village).
router.post('/market/mass', ah(async (req, res) => {
  const mine = new Set(res.locals.myVillages.map((v) => v.id));
  const spec = { sellResource: req.body.sellResource, sellAmount: req.body.sellAmount, buyResource: req.body.buyResource, buyAmount: req.body.buyAmount, maxHours: req.body.maxHours, tribeOnly: req.body.tribeOnly };
  const done = [];
  const errors = [];
  for (const [key, value] of Object.entries(req.body)) {
    const id = Number(key.startsWith('count_') ? key.slice(6) : NaN);
    const count = Math.floor(Number(value));
    if (!mine.has(id) || !(count > 0)) continue;
    const name = res.locals.myVillages.find((v) => v.id === id).name;
    try {
      await TradeService.createOffer(id, { ...spec, count });
      done.push(`${name} (${count})`);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      errors.push(`${name} : ${err.message}`);
    }
  }
  if (!done.length && !errors.length) throw new GameError('Indiquez un nombre d’offres pour au moins un village.');
  flash(req, errors.length ? 'error' : 'success', [done.length ? `Offres publiées : ${done.join(', ')}.` : '', ...errors].filter(Boolean).join(' '));
  res.redirect(`${base(req)}/market?tab=${done.length ? 'own' : 'mass'}`);
}));

// Demande : tes autres villages envoient des ressources au village courant (champs <ressource>_<id>).
router.post('/market/request', ah(async (req, res) => {
  const target = req.ctx.village;
  const done = [];
  const errors = [];
  for (const v of res.locals.myVillages) {
    if (v.id === target.id) continue;
    const resources = Object.fromEntries(RESOURCE_IDS.map((r) => [r, Math.max(0, Math.floor(Number(req.body[`${r}_${v.id}`])) || 0)]));
    if (!RESOURCE_IDS.some((r) => resources[r] > 0)) continue;
    try {
      await TradeService.send(v.id, { x: target.x, y: target.y, resources });
      done.push(v.name);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      errors.push(`${v.name} : ${err.message}`);
    }
  }
  if (!done.length && !errors.length) throw new GameError('Indiquez des ressources à faire venir.');
  flash(req, errors.length ? 'error' : 'success', [done.length ? `Marchands en route depuis : ${done.join(', ')}.` : '', ...errors].filter(Boolean).join(' '));
  res.redirect(`${base(req)}/market?tab=${done.length ? 'transports' : 'request'}`);
}));

router.post('/market/send', ah(async (req, res) => {
  const tr = await TradeService.send(req.ctx.village.id, {
    x: Number.parseInt(req.body.x, 10),
    y: Number.parseInt(req.body.y, 10),
    resources: TradeService.parseResources(req.body),
  });
  flash(req, 'success', `Marchands en route, arrivée ${res.locals.when(tr.arrivesAt)}.`);
  res.redirect(`${base(req)}/market?tab=transports`);
}));

router.post('/market/offers', ah(async (req, res) => {
  await TradeService.createOffer(req.ctx.village.id, req.body);
  flash(req, 'success', 'Offre publiée.');
  res.redirect(`${base(req)}/market?tab=create`);
}));

router.post('/market/offers/:offerId/cancel', ah(async (req, res) => {
  await TradeService.cancelOffer(req.ctx.village.id, req.params.offerId);
  flash(req, 'success', 'Offre retirée, ressources rendues.');
  res.redirect(back(req, `${base(req)}/market?tab=create`));
}));

router.post('/market/offers/:offerId/accept', ah(async (req, res) => {
  await TradeService.acceptOffer(req.ctx.village.id, req.params.offerId, req.body.count);
  flash(req, 'success', 'Échange accepté : les marchands sont en route.');
  res.redirect(`${base(req)}/market?tab=transports`);
}));

module.exports = router;
