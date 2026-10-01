'use strict';

const express = require('express');
const ShopService = require('../../services/ShopService');
const GameError = require('../../services/GameError');
const catalog = require('../../game/shopCatalog');
const { ah, flash, requireAuth } = require('../middleware');

// Boutique (hors partie) : catalogue, offres d'un article, achat en Adartons, packs d'Adartons et « Mes achats ».
// Pas encore de moyen de paiement : acheter des Adartons mène à une page « En construction ».
const router = express.Router();
router.use('/shop', requireAuth);
// Monde d'où l'on vient (?world=slug, liens du jeu) : gardé de page en page et présélectionné pour les achats « un monde ».
router.use('/shop', (req, res, next) => {
  res.locals.world = String(req.query.world || '').slice(0, 16);
  res.locals.shopQuery = res.locals.world ? `?world=${encodeURIComponent(res.locals.world)}` : '';
  // Happy hour des Adartons (vendredi et samedi, 19 h-20 h) : annoncée sur les pages de la boutique.
  res.locals.happy = catalog.happyHour(new Date());
  next();
});

/** Droits du compte seul (portée compte), pour marquer ce qu'il possède déjà partout. */
const accountRights = (req) => ShopService.rightsFor(req.user.id, null);

router.get('/shop', ah(async (req, res) => {
  const rights = await accountRights(req);
  res.render('shop', { lobbyPage: 'shop', items: catalog.ITEMS, rights });
}));

router.get('/shop/item/:key', ah(async (req, res) => {
  const item = catalog.item(req.params.key);
  if (!item) throw new GameError('Article introuvable.', 404);
  const [rights, targets] = await Promise.all([accountRights(req), ShopService.targets(req.user.id)]);
  res.render('shop-item', { lobbyPage: 'shop', item, rights, targets, preset: res.locals.world, SCOPES: catalog.SCOPES, durationLabel: catalog.durationLabel });
}));

router.post('/shop/buy', ah(async (req, res) => {
  const item = catalog.item(String(req.body.itemKey || ''));
  const offer = item && item.offers.find((o) => o.id === req.body.offerId);
  await ShopService.purchase(req.user.id, {
    itemKey: req.body.itemKey,
    offerId: req.body.offerId,
    // Une liste de mondes par portée : celle de l'offre choisie compte.
    worldId: offer && offer.scope === 'server' ? req.body.serverId : req.body.worldId,
    waiver: req.body.waiver === '1',
  });
  flash(req, 'success', `${item.name} débloqué.`);
  res.redirect(`/shop/purchases${res.locals.shopQuery}`);
}));

router.get('/shop/adartons', (req, res) => res.render('shop-adartons', { lobbyPage: 'shop', packs: catalog.PACKS, packCredit: catalog.packCredit }));

// Paiement pas encore disponible.
router.get('/shop/coming-soon', (req, res) => res.render('shop-coming-soon', { lobbyPage: 'shop', pack: catalog.PACKS.find((p) => p.id === req.query.pack) || null }));

router.get('/shop/purchases', ah(async (req, res) => {
  const history = await ShopService.history(req.user.id);
  res.render('shop-purchases', { lobbyPage: 'shop', ...history, SCOPES: catalog.SCOPES });
}));

module.exports = router;
