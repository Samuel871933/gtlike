'use strict';

// Raccourcis communs aux routes d'un village (req.ctx est posé par loadVillage, voir ./index.js).

const RESOURCE_IDS = ['wood', 'stone', 'iron'];

/** Adresse du village courant : /village/:id. */
const base = (req) => `/village/${req.ctx.village.id}`;
/** Joueur propriétaire du village courant (le titulaire, même quand un remplaçant joue). */
const me = (req) => req.ctx.village.playerId;

module.exports = { RESOURCE_IDS, base, me };
