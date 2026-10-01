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

/** Droits du compte seul (portée compte), pour marquer ce qu'il possède déjà partout. */
const accountRights = (req) => ShopService.rightsFor(req.user.id, null);

router.get('/shop', ah(async (req, res) => {
  const rights = await accountRights(req);
  res.render('shop', { lobbyPage: 'shop', items: catalog.ITEMS, rights, world: String(req.query.world || '') });
}));

router.get('/shop/item/:key', ah(async (req, res) => {
  const item = catalog.item(req.params.key);
  if (!item) throw new GameError('Article introuvable.', 404);
  const [rights, targets] = await Promise.all([accountRights(req), ShopService.targets(req.user.id)]);
  // Monde présélectionné : celui d'où l'on vient (lien de la barre du jeu, ?world=slug).
  const preset = String(req.query.world || '');
  res.render('shop-item', { lobbyPage: 'shop', item, rights, targets, preset, SCOPES: catalog.SCOPES, durationLabel: catalog.durationLabel });
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
  res.redirect('/shop/purchases');
}));

router.get('/shop/adartons', (req, res) => res.render('shop-adartons', { lobbyPage: 'shop', packs: catalog.PACKS }));

// Paiement pas encore disponible.
router.get('/shop/coming-soon', (req, res) => res.render('shop-coming-soon', { lobbyPage: 'shop', pack: catalog.PACKS.find((p) => p.id === req.query.pack) || null }));

router.get('/shop/purchases', ah(async (req, res) => {
  const history = await ShopService.history(req.user.id);
  res.render('shop-purchases', { lobbyPage: 'shop', ...history, SCOPES: catalog.SCOPES });
}));

module.exports = router;
