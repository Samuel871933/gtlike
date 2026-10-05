'use strict';

const { Op } = require('sequelize');
const { ArmyTemplate } = require('../models');
const registry = require('../game/registry');
const GameError = require('./GameError');

const MAX_TEMPLATES = 20;
// Modèles favoris : raccourcis de la carte et boutons de l'assistant de pillage (emplacements 1 à 3).
const MAX_FAVORITES = 3;

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

  /** Modèles favoris, dans l'ordre de leurs emplacements (le premier mis en favori d'abord). */
  static favorites(playerId) {
    return ArmyTemplate.findAll({ where: { playerId, favorite: { [Op.ne]: null } }, order: [['favorite', 'ASC'], ['id', 'ASC']] });
  }

  /** Met un modèle en favori (premier emplacement libre) ou l'en retire ; renvoie le modèle. */
  static async toggleFavorite(playerId, id) {
    const tpl = await ArmyTemplate.findOne({ where: { playerId, id: Number(id) } });
    if (!tpl) throw new GameError('Modèle introuvable.', 404);
    if (tpl.favorite) return tpl.update({ favorite: null });
    const taken = new Set((await ArmyTemplateService.favorites(playerId)).map((f) => f.favorite));
    const slot = [...Array(MAX_FAVORITES)].map((_, i) => i + 1).find((n) => !taken.has(n));
    if (!slot) throw new GameError(`${MAX_FAVORITES} modèles favoris au maximum : retire d'abord un favori.`);
    return tpl.update({ favorite: slot });
  }

  /** Lettre d'un modèle sur ses raccourcis : la première lettre ou le premier chiffre de son nom, en capitale. */
  static letter(tpl) {
    const m = /[\p{L}\p{N}]/u.exec(tpl.name || '');
    return m ? m[0].toLocaleUpperCase('fr-FR') : '?';
  }

  static async remove(playerId, id) {
    const n = await ArmyTemplate.destroy({ where: { playerId, id: Number(id) } });
    if (!n) throw new GameError('Modèle introuvable.', 404);
  }
}

ArmyTemplateService.MAX_TEMPLATES = MAX_TEMPLATES;
ArmyTemplateService.MAX_FAVORITES = MAX_FAVORITES;
ArmyTemplateService.unitsFrom = unitsFrom;

module.exports = ArmyTemplateService;
