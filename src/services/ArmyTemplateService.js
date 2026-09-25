'use strict';

const { ArmyTemplate } = require('../models');
const registry = require('../game/registry');
const GameError = require('./GameError');

const MAX_TEMPLATES = 20;

/** Unités d'un formulaire (ou d'une requête) limitées aux unités du monde : { spear: 10, … } sans zéros. */
function unitsFrom(input, cfg) {
  const out = {};
  for (const u of registry.unitsFor(cfg)) {
    const n = Math.floor(Number(input && input[u.id]));
    if (Number.isFinite(n) && n > 0) out[u.id] = Math.min(n, 1000000);
  }
  return out;
}

/** Modèles d'armée d'un joueur (« Ordres rapides »). */
class ArmyTemplateService {
  static list(playerId) {
    return ArmyTemplate.findAll({ where: { playerId }, order: [['name', 'ASC'], ['id', 'ASC']] });
  }

  static async create(playerId, { name, ...input }, cfg) {
    const label = String(name || '').trim().slice(0, 32);
    if (!label) throw new GameError('Donne un nom au modèle.');
    const units = unitsFrom(input, cfg);
    if (!Object.keys(units).length) throw new GameError('Un modèle doit contenir au moins une unité.');
    if (await ArmyTemplate.count({ where: { playerId } }) >= MAX_TEMPLATES) throw new GameError(`${MAX_TEMPLATES} modèles au maximum.`);
    return ArmyTemplate.create({ playerId, name: label, units });
  }

  static async remove(playerId, id) {
    const n = await ArmyTemplate.destroy({ where: { playerId, id: Number(id) } });
    if (!n) throw new GameError('Modèle introuvable.', 404);
  }
}

ArmyTemplateService.MAX_TEMPLATES = MAX_TEMPLATES;
ArmyTemplateService.unitsFrom = unitsFrom;

module.exports = ArmyTemplateService;
