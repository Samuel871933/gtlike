'use strict';

// Catalogue de la boutique (voir services/ShopService) : articles, offres et packs d'Adartons.
//
// Un article a une clé ('premium', 'theme:<id>', 'design:<id>', 'cosmetics:all') et des offres. Une offre fixe la
// portée du droit, sa durée et son prix en Adartons :
//   - scope 'world'   : pour son joueur, sur un monde choisi ;
//   - scope 'account' : pour son compte, sur tous les mondes (officiels et privés) ;
//   - scope 'server'  : pour tous les joueurs d'un serveur privé, achat réservé à son créateur.
//   `days` : durée en jours ; nul : sans fin (compte) ou jusqu'à la fin du monde (monde, serveur).
// Les thèmes et designs par défaut restent gratuits et ne sont pas vendus.
//
// Prix calés sur Guerre Tribale (1 Adarton = 1 point premium) : compte premium d'un monde à 30 / 60 / 100 / 200 points
// pour 3 / 7 / 14 / 30 jours, apparences de village d'un monde à 200 (rares) ou 400 points (épiques, prix retenu pour tous les cosmétiques), packs de points
// de 200 pour 4,99 € à 7 800 pour 79,99 €. GT ne vend ni portée compte, ni portée serveur, ni thème d'interface :
// compte = 2 mondes pour le premium, 3 pour un cosmétique permanent ; serveur entier = 10 joueurs.

const { GAME_STYLES, DEFAULT_GAME_STYLE } = require('../web/gameStyles');
const { VILLAGE_DESIGNS, DEFAULT_VILLAGE_DESIGN } = require('../web/villageDesigns');

const SCOPES = {
  world: { name: 'Un monde', hint: 'Pour ton joueur, sur le monde choisi.' },
  account: { name: 'Tout le compte', hint: 'Pour toi, sur tous les mondes, officiels et privés.' },
  server: { name: 'Tout mon serveur', hint: 'Pour tous les joueurs d’un de tes serveurs privés.' },
};

// Premium : pour l'instant, une file de construction plus longue (WorldConfig.premium.buildQueueBonus).
const PREMIUM = {
  key: 'premium', kind: 'premium', name: 'Premium',
  description: 'File de construction plus longue : 3 emplacements de plus dans chaque village.',
  offers: [
    { id: 'world-3', scope: 'world', days: 3, price: 30 },
    { id: 'world-7', scope: 'world', days: 7, price: 60 },
    { id: 'world-14', scope: 'world', days: 14, price: 100 },
    { id: 'world-30', scope: 'world', days: 30, price: 200 },
    { id: 'account-7', scope: 'account', days: 7, price: 120 },
    { id: 'account-14', scope: 'account', days: 14, price: 200 },
    { id: 'account-30', scope: 'account', days: 30, price: 400 },
    { id: 'server-30', scope: 'server', days: 30, price: 2000 },
    { id: 'server-life', scope: 'server', days: null, price: 8000 },
  ],
};

// Cosmétique : prix d'un monde (comme une apparence de GT), compte = 3 mondes, serveur entier = 10 joueurs.
const cosmeticOffers = (world) => [
  { id: 'world', scope: 'world', days: null, price: world },
  { id: 'account', scope: 'account', days: null, price: world * 3 },
  { id: 'server', scope: 'server', days: null, price: world * 10 },
];
// Un seul prix pour tous les thèmes et tous les designs : celui d'une apparence épique de GT.
const COSMETIC = 400;

const THEMES = Object.values(GAME_STYLES).filter((s) => s.id !== DEFAULT_GAME_STYLE).map((s) => ({
  key: `theme:${s.id}`, kind: 'theme', name: `Thème ${s.name}`, description: s.description, styleId: s.id,
  offers: cosmeticOffers(COSMETIC),
}));

const DESIGNS = Object.values(VILLAGE_DESIGNS).filter((d) => d.id !== DEFAULT_VILLAGE_DESIGN).map((d) => ({
  key: `design:${d.id}`, kind: 'design', name: `Design ${d.name}`, description: d.description, designId: d.id,
  offers: cosmeticOffers(COSMETIC),
}));

// Pack : tous les thèmes et tous les designs, présents et à venir ; environ moitié prix de tout acheter à l'unité.
const ALL_COSMETICS = {
  key: 'cosmetics:all', kind: 'bundle', name: 'Tous les cosmétiques',
  description: 'Tous les thèmes de jeu et tous les designs de village, y compris ceux qui sortiront plus tard.',
  offers: cosmeticOffers(2000),
};

const ITEMS = [PREMIUM, ALL_COSMETICS, ...THEMES, ...DESIGNS];
const BY_KEY = new Map(ITEMS.map((i) => [i.key, i]));

// Packs d'Adartons (prix TTC, affichés seulement : pas encore de moyen de paiement).
const PACKS = [
  { id: 'pack-200', adartons: 200, price: '4,99 €' },
  { id: 'pack-560', adartons: 560, price: '9,99 €', bonus: '+12 %' },
  { id: 'pack-1400', adartons: 1400, price: '19,99 €', bonus: '+40 %' },
  { id: 'pack-4300', adartons: 4300, price: '49,99 €', bonus: '+72 %' },
  { id: 'pack-7800', adartons: 7800, price: '79,99 €', bonus: '+95 %' },
];

/** Article d'une clé, ou nul. */
const item = (key) => BY_KEY.get(key) || null;

/** Clé de cosmétique (thème ou design) : couverte par le pack « Tous les cosmétiques ». */
const isCosmetic = (key) => key.startsWith('theme:') || key.startsWith('design:');

/** « 30 jours », « jusqu'à la fin du serveur », « pour toujours »… */
function durationLabel(offer) {
  if (offer.days) return `${offer.days} jours`;
  return offer.scope === 'account' ? 'pour toujours' : offer.scope === 'server' ? 'toute la durée du serveur' : 'toute la durée du monde';
}

module.exports = { SCOPES, ITEMS, PACKS, item, isCosmetic, durationLabel };
