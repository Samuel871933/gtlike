'use strict';

// Serveurs privés : mondes créés par les joueurs, avec leurs propres réglages (src/game/serverSettings.js).
// Accès 'open' : listé à l'accueil (les plus peuplés d'abord) et ouvert à tous ; 'code' : caché, on le rejoint avec
// son code. Un serveur privé fonctionne ensuite exactement comme un monde officiel. Il est immuable : aucune
// modification après la création (nom, accès, réglages ; garanti par le hook beforeUpdate du modèle World).

const crypto = require('crypto');
const { Op } = require('sequelize');
const { World } = require('../models');
const GameError = require('./GameError');
const serverSettings = require('../game/serverSettings');

const ACCESS = ['open', 'code'];
// Serveurs en cours (non terminés) qu'un compte peut posséder en même temps.
const MAX_OWNED = 3;
// Code d'accès : lettres et chiffres sans ambiguïté (ni 0/O, ni 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const randomCode = (n) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

class PrivateServerService {
  /** Crée un serveur privé ; `input` : saisie du formulaire (name, access, réglages). */
  static async create(user, input = {}) {
    const name = String(input.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 3 || name.length > 32) throw new GameError('Le nom du serveur doit faire 3 à 32 caractères.');
    const access = ACCESS.includes(input.access) ? input.access : null;
    if (!access) throw new GameError('Choisis l’accès au serveur : ouvert ou sur code.');
    const { config, error } = serverSettings.parse(input);
    if (error) throw new GameError(error);
    const owned = await World.count({ where: { ownerUserId: user.id, endedAt: null } });
    if (owned >= MAX_OWNED) throw new GameError(`Tu ne peux pas avoir plus de ${MAX_OWNED} serveurs privés en cours.`);

    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = `p${randomCode(6).toLowerCase()}`;
      const joinCode = access === 'code' ? randomCode(8) : null;
      if (await World.count({ where: { [Op.or]: [{ slug }, ...(joinCode ? [{ joinCode }] : [])] } })) continue;
      const world = await World.create({ slug, name, config, ownerUserId: user.id, access, joinCode });
      // Les bots demandés sont là dès l'ouverture (la boucle de jeu remplace ensuite ceux qui manquent).
      await require('./BotService').ensureBots(world);
      return world;
    }
    throw new GameError('Création impossible pour le moment, réessaie.');
  }

  /** Serveur privé correspondant à un code d'accès (null s'il n'existe pas ou est terminé). */
  static async findByCode(code) {
    const joinCode = normalizeCode(code);
    if (!joinCode) return null;
    return World.findOne({ where: { joinCode, endedAt: null } });
  }

  /**
   * Le compte peut-il voir et rejoindre ce monde ? Mondes officiels et serveurs ouverts : oui ; serveur sur code :
   * son créateur, ses joueurs, ou quiconque fournit le bon code.
   */
  static canAccess(world, { userId, isPlayer = false, code = null } = {}) {
    if (world.access !== 'code') return true;
    return world.ownerUserId === userId || isPlayer || (Boolean(code) && normalizeCode(code) === world.joinCode);
  }

  /** Serveurs ouverts en cours, les plus peuplés d'abord, avec leur nombre de joueurs. */
  static async popular(limit = 6) {
    const worlds = await World.findAll({ where: { access: 'open', endedAt: null } });
    const byWorld = await require('./WorldService').playerCounts(worlds.map((w) => w.id));
    return worlds
      .map((world) => ({ world, players: byWorld.get(world.id) || 0 }))
      .sort((a, b) => b.players - a.players || new Date(b.world.createdAt) - new Date(a.world.createdAt))
      .slice(0, limit);
  }
}

PrivateServerService.MAX_OWNED = MAX_OWNED;
PrivateServerService.normalizeCode = normalizeCode;

module.exports = PrivateServerService;
