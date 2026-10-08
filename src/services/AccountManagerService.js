'use strict';

const { Op } = require('sequelize');
const {
  sequelize, User, Player, Village, Command, Transport, ManagerTemplate, ManagerVillage, TradeRoute,
} = require('../models');
const VillageService = require('./VillageService');
const ShopService = require('./ShopService');
const GameError = require('./GameError');
const registry = require('../game/registry');
const managerTemplates = require('../game/managerTemplates');
const { distance } = require('../game/movement');

const RESOURCES = ['wood', 'stone', 'iron'];
const MINUTE = 60000;
// Prochaine vérification d'un village : entre 1 et 15 minutes (plus tôt si une construction se libère avant).
const CHECK_MIN = MINUTE;
const CHECK_MAX = 15 * MINUTE;
// Réserve du marché : un équilibrage toutes les 8 heures, comme sur Guerre Tribale.
const RESERVE_EVERY = 8 * 60 * MINUTE;
// Notifications « seulement si je ne suis pas connecté » : sans page vue depuis ce délai.
const OFFLINE_AFTER = 10 * MINUTE;
// Unités que le gestionnaire de troupes ne recrute pas : le paladin (unique), le noble (pièces d'or), la milice.
const NOT_MANAGED = new Set(['knight', 'snob', 'militia']);
const RESERVE_ROLES = ['both', 'send', 'receive', 'off'];
// Gestionnaire de troupes : recrutement par petits lots de même coût quelle que soit l'unité, réglé en ressources par
// modèle (4 500 par défaut, le prix de 50 lanciers ; voir managerTemplates.splitBatch). Un nouveau lot ne part dans un
// bâtiment que quand ce qui reste dans sa file vaut moins d'un demi-lot ; les ressources ne sont pas bloquées dans des
// milliers d'unités et la construction passe.
// Routes commerciales : intervalle minimal entre deux envois (minutes).
const ROUTE_MIN_MINUTES = 10;
const NOTIFY_WHEN = ['first', 'count', 'hours'];
const NOTIFY_GROUPS = ['none', 'attacker', 'target'];

const DEFAULTS = {
  // Réserve : villages sous `low` approvisionnés par ceux au-dessus de `high` (en % de l'entrepôt ou en valeur fixe).
  reserve: { enabled: false, mode: 'percent', low: 25, high: 70 },
  // Notifications d'attaque par e-mail : à la première attaque, toutes les `count` attaques ou au plus une toutes les
  // `hours` heures ; regroupées par attaquant ou par village visé, `perGroup` attaques par groupe.
  notify: { enabled: false, when: 'first', count: 10, hours: 1, offlineOnly: true, group: 'none', perGroup: 10 },
};

const int = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const checked = (v) => v === true || v === '1' || v === 'on';
const ids = (list) => [].concat(list || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const clean = (name) => String(name || '').trim().replace(/\s+/g, ' ').slice(0, 32);

/**
 * Gestionnaire de compte (premium), sur le modèle de celui de Guerre Tribale, sans minimum de villages :
 *   - gestionnaire de villages : modèles de construction (listes ordonnées de niveaux), appliqués aux villages ;
 *     l'entrepôt, la ferme et les bâtiments requis manquants sont ajoutés d'eux-mêmes ; démolition en option ;
 *   - gestionnaire de troupes : troupes voulues au total par village (ou par modèle), avec tampons de population et de
 *     ressources ; la prochaine construction du gestionnaire de villages passe avant ;
 *   - gestionnaire de marché : routes commerciales hebdomadaires, et réserve qui équilibre les ressources des villages
 *     toutes les 8 heures ;
 *   - notifications d'attaque par e-mail.
 * Tout tourne dans la boucle de jeu (runDue) ; seules les places de la file au prix normal sont utilisées.
 */
class AccountManagerService {
  // ---------------------------------------------------------------- Réglages du joueur

  /** Réglages (réserve, notifications) complétés par les valeurs par défaut. */
  static settings(player) {
    const saved = (player && player.managerSettings) || {};
    return {
      reserve: { ...DEFAULTS.reserve, ...(saved.reserve || {}) },
      notify: { ...DEFAULTS.notify, ...(saved.notify || {}) },
      notifyState: saved.notifyState || {},
    };
  }

  static async saveSettings(playerId, patch) {
    const player = await Player.findByPk(playerId);
    const next = { ...(player.managerSettings || {}), ...patch };
    await player.update({ managerSettings: next });
    return AccountManagerService.settings(player);
  }

  /** Réserve du marché (formulaire) : activée, mode (percent, fixed), seuils bas et haut. */
  static async saveReserve(playerId, input) {
    const player = await Player.findByPk(playerId);
    const current = AccountManagerService.settings(player).reserve;
    const mode = input.mode === 'fixed' ? 'fixed' : 'percent';
    const max = mode === 'percent' ? 100 : 10000000;
    const low = int(input.low, 0, max, current.low);
    const high = int(input.high, 0, max, current.high);
    if (high <= low) throw new GameError('Le seuil d’excédent doit être plus haut que le seuil de manque.');
    return AccountManagerService.saveSettings(playerId, { reserve: { ...current, enabled: checked(input.enabled), mode, low, high } });
  }

  /** Notifications d'attaque (formulaire). L'état (attaques déjà signalées) repart de maintenant. */
  static async saveNotify(playerId, input, now = new Date()) {
    const player = await Player.findByPk(playerId);
    const { notify } = AccountManagerService.settings(player);
    const next = {
      enabled: checked(input.enabled),
      when: NOTIFY_WHEN.includes(input.when) ? input.when : notify.when,
      count: int(input.count, 1, 1000, notify.count),
      hours: int(input.hours, 1, 72, notify.hours),
      offlineOnly: checked(input.offlineOnly),
      group: NOTIFY_GROUPS.includes(input.group) ? input.group : notify.group,
      perGroup: int(input.perGroup, 1, 100, notify.perGroup),
    };
    // État des notifications : les attaques déjà connues sont repérées par l'identifiant des commandes (croissant),
    // plus sûr qu'une date (deux commandes peuvent tomber dans la même milliseconde).
    const count = await AccountManagerService.incomingAttacks(playerId, now).then((l) => l.length);
    const lastId = (await Command.max('id')) || 0;
    return AccountManagerService.saveSettings(playerId, {
      notify: next, notifyState: { lastId, pendingFromId: lastId, pending: 0, lastCount: count },
    });
  }

  // ---------------------------------------------------------------- Modèles

  /** Compte d'un joueur : les modèles lui appartiennent (tous ses mondes). Nul pour un bot. */
  static async userOf(playerId, t) {
    const p = await Player.findByPk(playerId, { attributes: ['userId'], transaction: t });
    return p ? p.userId : null;
  }

  /** Compte d'un joueur qui crée un modèle (un bot n'en a pas). */
  static async ownerUser(playerId) {
    const userId = await AccountManagerService.userOf(playerId);
    if (!userId) throw new GameError('Modèles réservés aux comptes.');
    return userId;
  }

  /** Condition « modèles du compte du joueur » (aucun pour un bot). */
  /** `userId` : compte du joueur s'il est déjà connu (passage du gestionnaire), sinon lu. */
  static async ownWhere(playerId, t, userId) {
    return { userId: (userId !== undefined ? userId : await AccountManagerService.userOf(playerId, t)) || -1 };
  }

  /**
   * Modèles du joueur : construction, troupes et forge, ceux du système (troupes : ceux possibles sur le monde `cfg`)
   * puis les siens.
   */
  static async templates(playerId, cfg = null) {
    const own = await ManagerTemplate.findAll({ where: await AccountManagerService.ownWhere(playerId), order: [['name', 'ASC'], ['id', 'ASC']] });
    const build = [
      ...managerTemplates.SYSTEM,
      ...own.filter((t) => t.kind === 'build').map(AccountManagerService.buildView),
    ];
    const troops = [
      ...(cfg ? managerTemplates.troopsFor(cfg) : managerTemplates.TROOPS),
      ...own.filter((t) => t.kind === 'troops').map((t) => AccountManagerService.troopView(t, cfg)),
    ];
    const research = [
      ...managerTemplates.RESEARCH.map((t) => AccountManagerService.researchView(t, cfg)),
      ...own.filter((t) => t.kind === 'research').map((t) => AccountManagerService.researchView(t, cfg)),
    ];
    return { build, troops, research };
  }

  /** Unités qui se recherchent à la forge sur ce monde, dans l'ordre de la forge (vide sans recherche). */
  static researchUnits(cfg) {
    return cfg ? registry.unitsFor(cfg).filter((u) => u.needsResearch(cfg)) : [];
  }

  /**
   * Modèle de forge (système, ou ligne ManagerTemplate du joueur) vu depuis le monde `cfg` : `units`, les unités à
   * rechercher sur ce monde dans l'ordre de la forge ; `ignored`, celles du modèle absentes de ce monde (gardées pour
   * les mondes qui les ont) ; `allUnits`, toutes celles du modèle.
   */
  static researchView(t, cfg = null) {
    const here = AccountManagerService.researchUnits(cfg).map((u) => u.id);
    if (t.system) return { key: t.key, id: null, name: t.name, system: true, description: t.description, units: here, ignored: [], allUnits: here };
    const all = [].concat(t.data.units || []);
    return {
      key: `tpl:${t.id}`, id: t.id, name: t.name, system: false,
      units: here.filter((id) => all.includes(id)), ignored: cfg ? all.filter((id) => !here.includes(id)) : [], allUnits: all,
    };
  }

  /** Modèle de forge d'une clé ('sys:research' ou 'tpl:<id>' du joueur), vu depuis le monde `cfg`, ou nul. */
  static async researchTemplate(playerId, key, cfg, t, userId) {
    key = String(key || '');
    const system = managerTemplates.researchSystem(key);
    if (system) return AccountManagerService.researchView(system, cfg);
    const id = Number(key.startsWith('tpl:') ? key.slice(4) : key);
    const row = id ? await ManagerTemplate.findOne({ where: { id, kind: 'research', ...(await AccountManagerService.ownWhere(playerId, t, userId)) }, transaction: t }) : null;
    return row ? AccountManagerService.researchView(row, cfg) : null;
  }

  /** Nouveau modèle de forge, vide ou copié d'un autre (`from` : clé d'un modèle ; le modèle système : ses unités du monde). */
  static async createResearchTemplate(playerId, { name, from }, cfg) {
    const label = clean(name);
    if (!label) throw new GameError('Donne un nom au modèle.');
    const source = from ? await AccountManagerService.researchTemplate(playerId, from, cfg) : null;
    if (from && !source) throw new GameError('Modèle à copier introuvable.', 404);
    return ManagerTemplate.create({
      userId: await AccountManagerService.ownerUser(playerId), kind: 'research', name: label,
      data: { units: source ? [...source.allUnits] : [] },
    });
  }

  /** Coche ou décoche une unité d'un modèle de forge à soi (case enregistrée aussitôt). */
  static async setResearchUnit(playerId, id, unitId, on, cfg) {
    const row = await AccountManagerService.ownTemplate(playerId, id, 'research');
    if (!AccountManagerService.researchUnits(cfg).some((u) => u.id === unitId)) throw new GameError('Recherche inconnue.');
    const units = [].concat(row.data.units || []).filter((u) => u !== unitId);
    if (checked(on)) units.push(unitId);
    await row.update({ data: { ...row.data, units } });
    // Les villages de ce modèle sont revus au prochain passage.
    await ManagerVillage.update({ checkAt: null }, { where: { researchTemplate: `tpl:${row.id}` } });
    return AccountManagerService.researchView(row, cfg);
  }

  static buildView(t) {
    return { key: `tpl:${t.id}`, id: t.id, name: t.name, system: false, steps: t.data.steps || [], demolish: Boolean(t.data.demolish) };
  }

  /**
   * Modèle de troupes du joueur, vu depuis le monde `cfg` : les unités absentes de ce monde (archers…) sont mises à
   * part (`ignored`) et ne comptent ni dans les troupes visées ni dans la population.
   */
  static troopView(t, cfg = null) {
    const all = t.data.units || {};
    const here = cfg ? new Set(AccountManagerService.managedUnits(cfg).map((u) => u.id)) : null;
    const units = here ? Object.fromEntries(Object.entries(all).filter(([id]) => here.has(id))) : all;
    const ignored = here ? Object.keys(all).filter((id) => !here.has(id) && all[id] > 0) : [];
    return {
      key: `tpl:${t.id}`, id: t.id, name: t.name, system: false, units, ignored, allUnits: all,
      popBuffer: t.data.popBuffer || 0, resBuffer: t.data.resBuffer || 0, batchCost: managerTemplates.batchCostOf(t.data),
      dismiss: Boolean(t.data.dismiss),
    };
  }

  /** Modèle de troupes d'une clé ('sys:…' possible sur le monde `cfg`, ou 'tpl:<id>' du joueur), ou nul. */
  static async troopTemplate(playerId, key, cfg) {
    key = String(key || '');
    if (key.startsWith('sys:')) {
      const system = managerTemplates.troopSystem(key);
      return system && (!cfg || managerTemplates.troopsFor(cfg).includes(system)) ? system : null;
    }
    const id = Number(key.startsWith('tpl:') ? key.slice(4) : key);
    const row = id ? await ManagerTemplate.findOne({ where: { id, kind: 'troops', ...(await AccountManagerService.ownWhere(playerId)) } }) : null;
    return row ? AccountManagerService.troopView(row, cfg) : null;
  }

  /** Nouveau modèle de troupes, vide ou copié d'un autre (`from` : clé d'un modèle). */
  static async createTroopTemplate(playerId, { name, from }, cfg) {
    const label = clean(name);
    if (!label) throw new GameError('Donne un nom au modèle.');
    const source = from ? await AccountManagerService.troopTemplate(playerId, from, cfg) : null;
    if (from && !source) throw new GameError('Modèle à copier introuvable.', 404);
    return ManagerTemplate.create({
      userId: await AccountManagerService.ownerUser(playerId), kind: 'troops', name: label,
      data: source
        ? { units: { ...(source.allUnits || source.units) }, popBuffer: source.popBuffer || 0, resBuffer: source.resBuffer || 0, batchCost: managerTemplates.batchCostOf(source), dismiss: Boolean(source.dismiss) }
        : { units: {}, popBuffer: 0, resBuffer: 0, batchCost: managerTemplates.BATCH_COST },
    });
  }

  /** Modèle de construction d'une clé ('sys:…' ou 'tpl:<id>' du joueur), ou nul. */
  static async buildTemplate(playerId, key, t, userId) {
    if (!key) return null;
    if (key.startsWith('sys:')) return managerTemplates.system(key);
    const id = Number(key.slice(4));
    const row = key.startsWith('tpl:') && id ? await ManagerTemplate.findOne({ where: { id, kind: 'build', ...(await AccountManagerService.ownWhere(playerId, t, userId)) }, transaction: t }) : null;
    return row ? AccountManagerService.buildView(row) : null;
  }

  static async ownTemplate(playerId, id, kind) {
    const row = await ManagerTemplate.findOne({ where: { id: Number(id), kind, ...(await AccountManagerService.ownWhere(playerId)) } });
    if (!row) throw new GameError('Modèle introuvable.', 404);
    return row;
  }

  /** Nouveau modèle de construction, vide ou copié d'un autre (`from` : clé d'un modèle). */
  static async createBuildTemplate(playerId, { name, from }) {
    const label = clean(name);
    if (!label) throw new GameError('Donne un nom au modèle.');
    const source = from ? await AccountManagerService.buildTemplate(playerId, from) : null;
    if (from && !source) throw new GameError('Modèle à copier introuvable.', 404);
    return ManagerTemplate.create({
      userId: await AccountManagerService.ownerUser(playerId), kind: 'build', name: label,
      data: { steps: source ? source.steps.map((s) => ({ ...s })) : [], demolish: source ? source.demolish : false },
    });
  }

  static async renameTemplate(playerId, id, name) {
    const label = clean(name);
    if (!label) throw new GameError('Donne un nom au modèle.');
    const row = await ManagerTemplate.findOne({ where: { id: Number(id), ...(await AccountManagerService.ownWhere(playerId)) } });
    if (!row) throw new GameError('Modèle introuvable.', 404);
    await row.update({ name: label });
    return row;
  }

  /** Supprime un modèle : les villages qui l'utilisaient n'ont plus de modèle (construction, forge) ou plus de troupes visées. */
  static async deleteTemplate(playerId, id) {
    const row = await ManagerTemplate.findOne({ where: { id: Number(id), ...(await AccountManagerService.ownWhere(playerId)) } });
    if (!row) throw new GameError('Modèle introuvable.', 404);
    await sequelize.transaction(async (t) => {
      // Le modèle est au compte : ses villages sur tous les mondes perdent le modèle.
      if (row.kind === 'build') await ManagerVillage.update({ buildTemplate: null, checkAt: null }, { where: { buildTemplate: `tpl:${row.id}` }, transaction: t });
      else if (row.kind === 'research') await ManagerVillage.update({ researchTemplate: null, checkAt: null }, { where: { researchTemplate: `tpl:${row.id}` }, transaction: t });
      else await ManagerVillage.update({ troopTemplateId: null, checkAt: null }, { where: { troopTemplateId: row.id }, transaction: t });
      await row.destroy({ transaction: t });
    });
    return row;
  }

  /**
   * Modifie la liste d'un modèle de construction à soi :
   *   { op: 'add', building, levels, at } : `levels` niveaux de plus (depuis le niveau visé jusque-là), en fin de liste
   *     ou avant l'étape `at` ;
   *   { op: 'remove' | 'up' | 'down' | 'top' | 'bottom', index } ; { op: 'demolish', on } ; { op: 'clear' }.
   */
  static async editBuildSteps(playerId, id, change, cfg) {
    const row = await AccountManagerService.ownTemplate(playerId, id, 'build');
    const steps = (row.data.steps || []).map((s) => ({ ...s }));
    let demolish = Boolean(row.data.demolish);
    const index = int(change.index, 0, steps.length - 1, -1);
    const move = (to) => { const [s] = steps.splice(index, 1); steps.splice(to, 0, s); };
    switch (change.op) {
      case 'add': {
        const type = registry.BUILDINGS.get(change.building);
        if (!type || !type.isAvailableIn(cfg)) throw new GameError('Bâtiment inconnu.');
        const levels = int(change.levels, 1, type.maxLevel, 1);
        const at = change.at === '' || change.at == null ? steps.length : int(change.at, 0, steps.length, steps.length);
        // Niveau atteint par les étapes qui précèdent la position d'insertion (au moins le niveau de départ).
        const before = managerTemplates.targets(steps.slice(0, at), { [type.id]: type.minLevel })[type.id];
        if (before >= type.maxLevel) throw new GameError(`${type.name} : niveau ${type.maxLevel} déjà atteint par le modèle.`);
        steps.splice(at, 0, { building: type.id, level: Math.min(type.maxLevel, before + levels) });
        break;
      }
      case 'remove': if (index >= 0) steps.splice(index, 1); break;
      case 'up': if (index > 0) move(index - 1); break;
      case 'down': if (index >= 0 && index < steps.length - 1) move(index + 1); break;
      case 'top': if (index > 0) move(0); break;
      case 'bottom': if (index >= 0) move(steps.length - 1); break;
      case 'demolish': demolish = checked(change.on); break;
      case 'clear': steps.length = 0; break;
      default: throw new GameError('Action inconnue.');
    }
    if (steps.length > 500) throw new GameError('500 étapes au plus par modèle.');
    await row.update({ data: { ...row.data, steps, demolish } });
    // Les villages de ce modèle sont revus au prochain passage.
    await ManagerVillage.update({ checkAt: null }, { where: { buildTemplate: `tpl:${row.id}` } });
    return AccountManagerService.buildView(row);
  }

  /** Troupes d'un formulaire : { units, popBuffer, resBuffer } (unités recrutables du monde seulement). */
  static parseTroops(input, cfg) {
    const units = {};
    for (const u of AccountManagerService.managedUnits(cfg)) {
      const n = int(input[u.id], 0, 1000000, 0);
      if (n > 0) units[u.id] = n;
    }
    return {
      units, popBuffer: int(input.popBuffer, 0, 1000000, 0), resBuffer: int(input.resBuffer, 0, 10000000, 0),
      // Taille des lots (ressources) ; vide : la valeur par défaut.
      batchCost: String(input.batchCost ?? '').trim() === '' ? managerTemplates.BATCH_COST
        : int(String(input.batchCost).replace(/\s/g, ''), managerTemplates.BATCH_COST_MIN, managerTemplates.BATCH_COST_MAX, managerTemplates.BATCH_COST),
      dismiss: checked(input.dismiss),
    };
  }

  /** Unités que le gestionnaire de troupes sait recruter sur ce monde. */
  static managedUnits(cfg) {
    return registry.unitsFor(cfg).filter((u) => !NOT_MANAGED.has(u.id) && registry.RECRUIT_BUILDINGS.includes(u.building));
  }

  /** Crée (sans `id`) ou modifie un modèle de troupes. */
  static async saveTroopTemplate(playerId, input, cfg) {
    const label = clean(input.name);
    if (!label) throw new GameError('Donne un nom au modèle.');
    const data = AccountManagerService.parseTroops(input, cfg);
    if (!Object.keys(data.units).length) throw new GameError('Indique au moins une unité.');
    if (input.id) {
      const row = await AccountManagerService.ownTemplate(playerId, input.id, 'troops');
      // Modèle du compte : les unités absentes de ce monde (archers…) restent pour les mondes qui les ont.
      const here = new Set(AccountManagerService.managedUnits(cfg).map((u) => u.id));
      for (const [id, n] of Object.entries(row.data.units || {})) if (!here.has(id)) data.units[id] = n;
      await row.update({ name: label, data });
      await ManagerVillage.update({ checkAt: null }, { where: { troopTemplateId: row.id } });
      return row;
    }
    return ManagerTemplate.create({ userId: await AccountManagerService.ownerUser(playerId), kind: 'troops', name: label, data });
  }

  // ---------------------------------------------------------------- Villages

  /** Lignes du gestionnaire des villages `villageIds` du joueur (créées au besoin). */
  static async rowsFor(playerId, villageIds, t) {
    const wanted = ids(villageIds);
    if (!wanted.length) throw new GameError('Sélectionne au moins un village.');
    const villages = await Village.findAll({ where: { id: wanted, playerId }, attributes: ['id'], transaction: t });
    if (!villages.length) throw new GameError('Village introuvable.', 404);
    const rows = await ManagerVillage.findAll({ where: { villageId: villages.map((v) => v.id) }, transaction: t });
    const have = new Set(rows.map((r) => r.villageId));
    for (const v of villages) {
      if (!have.has(v.id)) rows.push(await ManagerVillage.create({ villageId: v.id, playerId }, { transaction: t }));
    }
    return rows;
  }

  /**
   * Action sur des villages du gestionnaire de villages : { action: 'use', template } (clé du modèle), 'remove',
   * 'pause', 'resume'.
   */
  static async applyBuild(playerId, villageIds, { action, template }) {
    if (action === 'use' && !(await AccountManagerService.buildTemplate(playerId, template))) throw new GameError('Modèle introuvable.', 404);
    return sequelize.transaction(async (t) => {
      const rows = await AccountManagerService.rowsFor(playerId, villageIds, t);
      const patch = {
        use: { buildTemplate: template, buildPaused: false },
        remove: { buildTemplate: null, buildPaused: false },
        pause: { buildPaused: true },
        resume: { buildPaused: false },
      }[action];
      if (!patch) throw new GameError('Action inconnue.');
      for (const r of rows) await r.update({ ...patch, checkAt: null }, { transaction: t });
      return rows.length;
    });
  }

  /**
   * Action sur des villages du gestionnaire de troupes : { action: 'use', template } (modèle de troupes, ou 'custom'
   * avec les valeurs du formulaire), 'remove', 'pause', 'resume'.
   */
  static async applyTroops(playerId, villageIds, input, cfg) {
    const { action } = input;
    let patch;
    if (action === 'use') {
      if (input.template && input.template !== 'custom') {
        const tpl = await AccountManagerService.troopTemplate(playerId, input.template, cfg);
        if (!tpl) throw new GameError('Modèle introuvable.', 404);
        // Modèle système : seule sa clé compte, ses troupes sont relues à chaque passage.
        patch = tpl.system
          ? { troopTemplateId: null, troops: { units: { ...tpl.units }, popBuffer: 0, resBuffer: 0, system: tpl.key }, troopsPaused: false }
          : { troopTemplateId: tpl.id, troops: null, troopsPaused: false };
      } else {
        const troops = AccountManagerService.parseTroops(input, cfg);
        if (!Object.keys(troops.units).length) throw new GameError('Indique au moins une unité.');
        patch = { troopTemplateId: null, troops, troopsPaused: false };
      }
    } else {
      patch = { remove: { troopTemplateId: null, troops: null, troopsPaused: false }, pause: { troopsPaused: true }, resume: { troopsPaused: false } }[action];
    }
    if (!patch) throw new GameError('Action inconnue.');
    return sequelize.transaction(async (t) => {
      const rows = await AccountManagerService.rowsFor(playerId, villageIds, t);
      for (const r of rows) await r.update({ ...patch, checkAt: null }, { transaction: t });
      return rows.length;
    });
  }

  /** Action sur des villages du gestionnaire de forge : { action: 'use', template } (clé du modèle), 'remove', 'pause', 'resume'. */
  static async applyResearch(playerId, villageIds, { action, template }, cfg) {
    if (action === 'use' && !(await AccountManagerService.researchTemplate(playerId, template, cfg))) throw new GameError('Modèle introuvable.', 404);
    const patch = {
      use: { researchTemplate: template, researchPaused: false },
      remove: { researchTemplate: null, researchPaused: false },
      pause: { researchPaused: true },
      resume: { researchPaused: false },
    }[action];
    if (!patch) throw new GameError('Action inconnue.');
    return sequelize.transaction(async (t) => {
      const rows = await AccountManagerService.rowsFor(playerId, villageIds, t);
      for (const r of rows) await r.update({ ...patch, checkAt: null }, { transaction: t });
      return rows.length;
    });
  }

  /** Rôle de villages dans la réserve du marché : both, send (donne seulement), receive (reçoit seulement), off. */
  static async applyReserveRole(playerId, villageIds, role) {
    if (!RESERVE_ROLES.includes(role)) throw new GameError('Rôle inconnu.');
    return sequelize.transaction(async (t) => {
      const rows = await AccountManagerService.rowsFor(playerId, villageIds, t);
      for (const r of rows) await r.update({ reserve: role }, { transaction: t });
      return rows.length;
    });
  }

  /** Pastille de l'aperçu : met en pause ou relance un gestionnaire (build, troops, research) d'un village. */
  static async toggle(playerId, villageId, which) {
    const row = await ManagerVillage.findOne({ where: { villageId: Number(villageId), playerId } });
    if (!row) throw new GameError('Ce village n’est pas géré.', 404);
    if (which === 'build' && row.buildTemplate) await row.update({ buildPaused: !row.buildPaused, checkAt: null });
    else if (which === 'troops' && (row.troopTemplateId || row.troops)) await row.update({ troopsPaused: !row.troopsPaused, checkAt: null });
    else if (which === 'research' && row.researchTemplate) await row.update({ researchPaused: !row.researchPaused, checkAt: null });
    else if (which === 'market') await row.update({ reserve: row.reserve === 'off' ? 'both' : 'off' });
    else throw new GameError('Rien à mettre en pause.');
    return row;
  }

  /**
   * Villages du joueur pour les écrans du gestionnaire, une page à la fois (comptes à des centaines de villages) :
   * ligne du gestionnaire (ou nulle), modèle de construction, troupes visées (vues depuis le monde `cfg`), modèle de
   * forge, routes au départ, et l'état de chacun des gestionnaires (active, paused, none).
   * Aussi, sur tous ses villages : l'usage des modèles (`usage`) et le nombre de villages gérés (`managed`).
   * @returns {{ rows, pagination, usage: { build: Map, troops: Map, research: Map }, managed: number }}
   */
  static async villages(playerId, { cfg = null, page = 1, perPage = null, only = null } = {}) {
    const PaginationService = require('./PaginationService');
    // `only` : villages du groupe actif (ids) ; l'usage des modèles reste compté sur tous les villages.
    const scope = only ? { playerId, id: only } : { playerId };
    const inScope = only ? new Set(only) : null;
    const [total, all, own, player] = await Promise.all([
      Village.count({ where: scope }),
      ManagerVillage.findAll({ where: { playerId }, attributes: ['villageId', 'buildTemplate', 'buildPaused', 'troopTemplateId', 'troops', 'troopsPaused', 'researchTemplate', 'researchPaused', 'status'], raw: true }),
      AccountManagerService.ownWhere(playerId).then((where) => ManagerTemplate.findAll({ where })),
      Player.findByPk(playerId, { attributes: ['id', 'managerSettings', 'managerPerPage'] }),
    ]);
    const pagination = PaginationService.paginate(total, page, perPage || PaginationService.perPage(player, 'manager'));
    const villages = await Village.findAll({
      where: scope, attributes: ['id', 'name', 'x', 'y', 'points', 'buildings'], order: [['name', 'ASC'], ['id', 'ASC']],
      offset: pagination.offset, limit: pagination.perPage,
    });
    const ids = villages.map((v) => v.id);
    const [rows, routes] = await Promise.all([
      ids.length ? ManagerVillage.findAll({ where: { villageId: ids } }) : [],
      ids.length ? TradeRoute.findAll({ where: { playerId, originVillageId: ids }, attributes: ['originVillageId'], raw: true }) : [],
    ]);
    const byVillage = new Map(rows.map((r) => [r.villageId, r]));
    const tplName = (key) => {
      if (!key) return null;
      const sys = managerTemplates.system(key) || managerTemplates.researchSystem(key);
      if (sys) return sys.name;
      const row = own.find((t) => `tpl:${t.id}` === key);
      return row ? row.name : null;
    };
    const troopTpl = new Map(own.filter((t) => t.kind === 'troops').map((t) => [t.id, t]));
    const troopKey = (r) => (r.troopTemplateId ? `tpl:${r.troopTemplateId}` : r.troops && r.troops.system ? r.troops.system : null);
    // Usage des modèles sur tous les villages : villages, villages en pause, améliorations lancées.
    const usage = { build: new Map(), troops: new Map(), research: new Map() };
    let managed = 0;
    for (const r of all) {
      const troopsOn = Boolean(r.troopTemplateId || r.troops);
      if ((r.buildTemplate || troopsOn || r.researchTemplate) && (!inScope || inScope.has(r.villageId))) managed += 1;
      if (r.researchTemplate) usage.research.set(r.researchTemplate, (usage.research.get(r.researchTemplate) || 0) + 1);
      if (r.buildTemplate) {
        const u = usage.build.get(r.buildTemplate) || { villages: 0, paused: 0, built: 0 };
        u.villages += 1;
        if (r.buildPaused) u.paused += 1;
        u.built += (r.status && r.status.built) || 0;
        usage.build.set(r.buildTemplate, u);
      }
      const k = troopKey(r);
      if (k) usage.troops.set(k, (usage.troops.get(k) || 0) + 1);
    }
    const routesFrom = new Map();
    for (const r of routes) routesFrom.set(r.originVillageId, (routesFrom.get(r.originVillageId) || 0) + 1);
    const reserveOn = AccountManagerService.settings(player).reserve.enabled;
    const out = villages.map((village) => {
      const row = byVillage.get(village.id) || null;
      const troopsTpl = row && row.troopTemplateId ? troopTpl.get(row.troopTemplateId) : null;
      const system = row && row.troops && row.troops.system ? managerTemplates.troopSystem(row.troops.system) : null;
      const troops = troopsTpl ? AccountManagerService.troopView(troopsTpl, cfg) : system || (row && row.troops ? row.troops : null);
      const state = (on, paused) => (!on ? 'none' : paused ? 'paused' : 'active');
      const routeCount = routesFrom.get(village.id) || 0;
      const role = row ? row.reserve : 'both';
      return {
        village, row,
        buildTemplate: row && row.buildTemplate ? { key: row.buildTemplate, name: tplName(row.buildTemplate) } : null,
        troops, troopsTemplate: troopsTpl ? troopsTpl.name : system ? system.name : null, troopsKey: row ? troopKey(row) : null, routeCount, reserveRole: role,
        status: row && row.status ? row.status : {},
        build: state(Boolean(row && row.buildTemplate), row && row.buildPaused),
        troopsState: state(Boolean(troops), row && row.troopsPaused),
        researchTemplate: row && row.researchTemplate ? { key: row.researchTemplate, name: tplName(row.researchTemplate) } : null,
        research: state(Boolean(row && row.researchTemplate), row && row.researchPaused),
        market: routeCount || (reserveOn && role !== 'off') ? 'active' : reserveOn ? 'paused' : 'none',
      };
    });
    return { rows: out, pagination, usage, managed };
  }

  // ---------------------------------------------------------------- Routes commerciales

  /** Anciennes routes (une fois par jour) : prochain envoi après `from`, un des jours `days` (0 = dimanche) à `minute`. */
  static nextRun(days, minute, from) {
    for (let d = 0; d <= 7; d += 1) {
      const at = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d, 0, minute);
      if (days.includes(at.getDay()) && at > from) return at;
    }
    return null;
  }

  /**
   * Prochain envoi d'une route à intervalle libre : `interval` minutes après `last`, en sautant les créneaux qui
   * tombent un jour non choisi, jusqu'à dépasser `now`.
   */
  static nextEvery(days, interval, last, now = last) {
    const step = interval * MINUTE;
    let at = new Date(last).getTime() + step;
    // Au plus une semaine de créneaux (au-delà, aucun jour ne convient).
    for (let i = 0; i < 2000 && (at <= now.getTime() || !days.includes(new Date(at).getDay())); i += 1) at += step;
    return new Date(at);
  }

  /**
   * Nouvelle route : village de départ `origin` (à soi ; sinon `originVillageId`), destinataire `target` (id d'un de
   * ses villages) ou `coords` (« x|y », tout village de joueur), ressources, jours (0 à 6) et intervalle `every` en
   * `unit` (minutes ou heures). Premier envoi tout de suite si c'est un jour choisi, sinon au premier créneau qui l'est.
   */
  static async createRoute(playerId, originVillageId, input, { now = new Date() } = {}) {
    const at = (text) => /^\s*(\d+)\s*[|,;:\s]\s*(\d+)\s*$/.exec(String(text || ''));
    const from = at(input.originCoords);
    const origin = from
      ? await Village.findOne({ where: { playerId, x: Number(from[1]), y: Number(from[2]) } })
      : await Village.findOne({ where: { id: Number(input.origin || originVillageId), playerId } });
    if (!origin) throw new GameError(from ? 'Le village de départ doit être un de tes villages.' : 'Village introuvable.', 404);
    const coords = at(input.coords);
    const target = coords
      ? await Village.findOne({ where: { worldId: origin.worldId, x: Number(coords[1]), y: Number(coords[2]) } })
      : input.target
        ? await Village.findOne({ where: { id: Number(input.target), worldId: origin.worldId } })
        : input.x != null ? await Village.findOne({ where: { worldId: origin.worldId, x: Number(input.x), y: Number(input.y) } }) : null;
    if (!target && !coords && !input.target && input.x == null) throw new GameError('Choisis le village destinataire.');
    if (!target) throw new GameError('Aucun village à ces coordonnées.');
    if (target.id === origin.id) throw new GameError('Le village de départ et la destination sont le même village.');
    if (!target.playerId) throw new GameError('Les villages barbares ne commercent pas.');
    const resources = Object.fromEntries(RESOURCES.map((r) => [r, int(input[r], 0, 10000000, 0)]));
    if (!RESOURCES.some((r) => resources[r] > 0)) throw new GameError('Indique les ressources à envoyer.');
    const days = [...new Set([].concat(input.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!days.length) throw new GameError('Choisis au moins un jour.');
    const amount = Number(String(input.every || '').replace(',', '.'));
    const every = Math.round(amount * (input.unit === 'minutes' ? 1 : 60));
    if (!Number.isFinite(amount) || amount <= 0) throw new GameError('Indique la fréquence des envois.');
    if (every < ROUTE_MIN_MINUTES) throw new GameError(`Un envoi toutes les ${ROUTE_MIN_MINUTES} minutes au plus souvent.`);
    if (every > 7 * 1440) throw new GameError('Un envoi par semaine au moins.');
    if (await TradeRoute.count({ where: { playerId } }) >= 200) throw new GameError('200 routes commerciales au plus.');
    const first = days.includes(now.getDay()) ? now : AccountManagerService.nextEvery(days, every, now);
    return TradeRoute.create({
      playerId, originVillageId: origin.id, targetVillageId: target.id, resources, days,
      minute: first.getHours() * 60 + first.getMinutes(), intervalMinutes: every, nextAt: first,
    });
  }

  static async deleteRoutes(playerId, routeIds) {
    const n = await TradeRoute.destroy({ where: { playerId, id: ids(routeIds) } });
    if (!n) throw new GameError('Route introuvable.', 404);
    return n;
  }

  static async routes(playerId) {
    return TradeRoute.findAll({
      where: { playerId },
      include: [{ association: 'origin', attributes: ['id', 'name', 'x', 'y'] }, { association: 'target', attributes: ['id', 'name', 'x', 'y', 'playerId'], include: [{ model: Player, attributes: ['id', 'name'] }] }],
      order: [['nextAt', 'ASC'], ['id', 'ASC']],
    });
  }

  // ---------------------------------------------------------------- Boucle de jeu

  /** Passage du gestionnaire (boucle de jeu) : villages à revoir, routes à envoyer, réserves et notifications. */
  static async runDue(now = new Date()) {
    const rights = new Map(); // premium par joueur, le temps d'un passage
    const users = new Map(); // compte de chaque joueur (modèles du joueur), le temps d'un passage
    const premium = async (playerId) => {
      if (!rights.has(playerId)) {
        const p = await Player.findByPk(playerId, { attributes: ['userId', 'worldId'] });
        users.set(playerId, p ? p.userId : null);
        rights.set(playerId, Boolean(p && p.userId && await ShopService.hasPremium(p.userId, p.worldId, { now })));
      }
      return rights.get(playerId);
    };
    // Par lots de 500 jusqu'à épuisement (chaque village traité repousse sa vérification, au moins CHECK_MIN plus
    // tard) ; un village en erreur n'est pas repris dans le même passage.
    const failed = new Set();
    for (;;) {
      const due = await ManagerVillage.findAll({
        where: {
          [Op.and]: [
            { [Op.or]: [{ checkAt: null }, { checkAt: { [Op.lte]: now } }] },
            { [Op.or]: [
              { buildTemplate: { [Op.ne]: null }, buildPaused: false }, { troopTemplateId: { [Op.ne]: null }, troopsPaused: false },
              { troops: { [Op.ne]: null }, troopsPaused: false }, { researchTemplate: { [Op.ne]: null }, researchPaused: false },
            ] },
            ...(failed.size ? [{ id: { [Op.notIn]: [...failed] } }] : []),
          ],
        },
        attributes: ['id', 'villageId', 'playerId'], order: [['checkAt', 'ASC']], limit: 500, raw: true,
      });
      for (const row of due) {
        try {
          if (await premium(row.playerId)) await AccountManagerService.runVillage(row.id, now, { userId: users.get(row.playerId) });
          else await ManagerVillage.update({ checkAt: new Date(now.getTime() + CHECK_MAX), status: { premium: false } }, { where: { id: row.id } });
        } catch (err) {
          failed.add(row.id);
          console.error('[AccountManager] village', row.villageId, err);
        }
      }
      if (due.length < 500) break;
    }
    await AccountManagerService.runRoutes(now, premium);
    const players = await Player.findAll({ where: { managerSettings: { [Op.ne]: null } }, attributes: ['id', 'managerSettings'] });
    for (const player of players) {
      const { reserve, notify } = AccountManagerService.settings(player);
      try {
        if (reserve.enabled && !(reserve.lastRunAt && now - new Date(reserve.lastRunAt) < RESERVE_EVERY) && await premium(player.id)) {
          await AccountManagerService.runReserve(player.id, now);
        }
        if (notify.enabled && await premium(player.id)) await AccountManagerService.runNotify(player.id, now);
      } catch (err) {
        console.error('[AccountManager] joueur', player.id, err);
      }
    }
  }

  /**
   * Un village : constructions du modèle (places au prix normal seulement), puis recrutement des troupes visées.
   * Enregistre l'état (ce qui a été lancé, ce qui bloque) et la prochaine vérification.
   */
  static async runVillage(rowId, now = new Date(), { userId } = {}) {
    const row = await ManagerVillage.findByPk(rowId);
    if (!row) return null;
    return VillageService.withVillage(row.villageId, async (ctx, t) => {
      // Village perdu : le gestionnaire ne le suit plus.
      if (ctx.village.playerId !== row.playerId) return row.destroy({ transaction: t });
      const status = { at: now.toISOString(), built: (row.status && row.status.built) || 0 };
      const waits = [];
      let reserved = null;
      if (row.buildTemplate && !row.buildPaused) {
        const tpl = await AccountManagerService.buildTemplate(row.playerId, row.buildTemplate, t, userId);
        if (!tpl) {
          await row.update({ buildTemplate: null }, { transaction: t });
        } else {
          const build = await AccountManagerService.runBuild(ctx, tpl, t);
          status.build = { queued: build.queued, reason: build.reason, done: build.done };
          status.built += build.queued.length;
          if (build.wait) waits.push(build.wait);
          reserved = build.reserved;
        }
      }
      // Forge : après la construction (ses ressources mises de côté), avant les troupes (qui laissent celles de la recherche).
      if (row.researchTemplate && !row.researchPaused) {
        const tpl = await AccountManagerService.researchTemplate(row.playerId, row.researchTemplate, ctx.cfg, t, userId);
        if (!tpl) {
          await row.update({ researchTemplate: null }, { transaction: t });
        } else {
          const res = await AccountManagerService.runResearch(ctx, tpl, reserved, t);
          status.research = { started: res.started, reason: res.reason, done: res.done };
          if (res.wait) waits.push(res.wait);
          if (res.reserved) reserved = Object.fromEntries(RESOURCES.map((r) => [r, ((reserved && reserved[r]) || 0) + res.reserved[r]]));
        }
      }
      if ((row.troopTemplateId || row.troops) && !row.troopsPaused) {
        const tplRow = row.troopTemplateId ? await ManagerTemplate.findOne({ where: { id: row.troopTemplateId, kind: 'troops', ...(await AccountManagerService.ownWhere(row.playerId, t, userId)) }, transaction: t }) : null;
        const system = row.troops && row.troops.system ? managerTemplates.troopSystem(row.troops.system) : null;
        const troops = tplRow ? AccountManagerService.troopView(tplRow, ctx.cfg) : system || row.troops;
        if (troops) {
          const res = await AccountManagerService.runTroops(ctx, troops, reserved, t);
          status.troops = { recruited: res.recruited, dismissed: res.dismissed || null, reason: res.reason, done: res.done };
          waits.push(new Date(now.getTime() + (res.done ? CHECK_MAX : 5 * MINUTE)));
        }
      }
      const next = waits.length ? Math.min(...waits.map((d) => new Date(d).getTime())) : now.getTime() + 10 * MINUTE;
      const checkAt = new Date(Math.max(now.getTime() + CHECK_MIN, Math.min(now.getTime() + CHECK_MAX, next)));
      await row.update({ status, checkAt }, { transaction: t });
      return status;
    }, { now });
  }

  /** Première étape du modèle pas encore atteinte (niveau du village ou déjà en file), ou nulle. */
  static nextStep(ctx, steps) {
    for (const s of steps) {
      const type = registry.BUILDINGS.get(s.building);
      if (!type || !type.isAvailableIn(ctx.cfg)) continue;
      if (VillageService.nextLevel(ctx, s.building) <= Math.min(s.level, type.maxLevel)) return type;
    }
    return null;
  }

  /**
   * Option de construction du bâtiment `type`, ou de ce qu'il lui faut d'abord : un bâtiment requis manquant,
   * l'entrepôt s'il est trop petit pour le coût, la ferme si elle est trop petite (comme le gestionnaire de GT).
   */
  static resolveOption(ctx, type, depth = 0) {
    const option = VillageService.buildOption(ctx, type);
    if (!option.blockers.length || depth > 4) return option;
    const instead = (id) => {
      const other = registry.BUILDINGS.get(id);
      return other && other.id !== type.id && VillageService.nextLevel(ctx, id) <= other.maxLevel ? AccountManagerService.resolveOption(ctx, other, depth + 1) : null;
    };
    // Bâtiment requis : on le monte s'il n'est pas déjà en file au niveau voulu.
    const missing = (option.missing || []).find((m) => VillageService.nextLevel(ctx, m.building) <= m.level);
    if (missing) return instead(missing.building) || option;
    if (option.blockers.includes("L'entrepôt est trop petit")) return instead('storage') || option;
    if (option.blockers.includes('La ferme est trop petite')) return instead('farm') || option;
    return option;
  }

  /**
   * Gestionnaire de villages : remplit la file (places au prix normal) avec les étapes du modèle.
   * @returns {{ queued: string[], reason: string|null, done: boolean, wait: Date|null, reserved: object|null }}
   *   `reserved` : coût de la prochaine construction, que le gestionnaire de troupes laisse de côté.
   */
  static async runBuild(ctx, tpl, t) {
    const out = { queued: [], reason: null, done: false, wait: null, reserved: null };
    const slots = ctx.buildQueueSlots ?? ctx.cfg.buildQueueSlots;
    for (let guard = 0; guard < 20; guard += 1) {
      if (ctx.buildOrders.length >= slots) {
        out.reason = 'File de construction pleine';
        out.wait = ctx.buildOrders[0].endsAt;
        break;
      }
      const type = AccountManagerService.nextStep(ctx, tpl.steps);
      if (!type) {
        out.done = true;
        if (tpl.demolish) await AccountManagerService.runDemolish(ctx, tpl, t, out);
        break;
      }
      const option = AccountManagerService.resolveOption(ctx, type);
      if (option.blockers.length) {
        out.reason = `${option.type.name} : ${option.blockers[0]}`;
        // Bâtiment requis en chantier : on attend la fin de la file.
        if (ctx.buildOrders.length) out.wait = ctx.buildOrders[0].endsAt;
        break;
      }
      if (option.lacksResources) {
        out.reason = `${option.type.name} niveau ${option.level} : ressources insuffisantes`;
        out.wait = option.availableAt;
        out.reserved = option.cost;
        break;
      }
      await VillageService.queueBuild(ctx, option, t);
      out.queued.push(`${option.type.name} ${option.level}`);
    }
    return out;
  }

  /**
   * Gestionnaire de forge : lance la première recherche du modèle possible, dans l'ordre de la forge (une à la fois,
   * comme à la forge) ; celles dont les bâtiments requis manquent attendent, les suivantes passent. Les ressources
   * mises de côté pour la prochaine construction (`reserved`) n'y passent pas.
   * @returns {{ started: string|null, reason: string|null, done: boolean, wait: Date|null, reserved: object|null }}
   *   `reserved` : coût de la recherche attendue faute de ressources, que le gestionnaire de troupes laisse de côté.
   */
  static async runResearch(ctx, tpl, reserved, t) {
    const out = { started: null, reason: null, done: false, wait: null, reserved: null };
    const todo = VillageService.researchOptions(ctx).filter((o) => tpl.units.includes(o.type.id) && !o.done);
    if (!todo.length) {
      out.done = true;
      return out;
    }
    const running = ctx.researchOrders[0];
    if (running) {
      out.reason = `Recherche en cours : ${registry.unit(running.unit).name}`;
      out.wait = running.endsAt;
      return out;
    }
    if (ctx.state.level('smith') < 1) {
      out.reason = 'Il faut une forge';
      return out;
    }
    const ready = todo.find((o) => !o.missing.length);
    if (!ready) {
      out.reason = `Bâtiments requis : ${todo.map((o) => `${o.type.name} (${o.blocker})`).join(' · ')}`;
      return out;
    }
    const left = Object.fromEntries(RESOURCES.map((r) => [r, ctx.state.resources[r] - ((reserved && reserved[r]) || 0)]));
    if (RESOURCES.some((r) => left[r] < ready.cost[r])) {
      out.reason = `${ready.type.name} : ressources insuffisantes`;
      out.reserved = { ...ready.cost };
      const need = Object.fromEntries(RESOURCES.map((r) => [r, ready.cost[r] + ((reserved && reserved[r]) || 0)]));
      out.wait = ctx.state.affordableAt(need, ctx.now);
      return out;
    }
    await VillageService.queueResearch(ctx, ready, t);
    out.started = ready.type.name;
    out.wait = new Date(ctx.now.getTime() + ready.duration * 1000);
    return out;
  }

  /** Démolition (option du modèle) : un niveau d'un bâtiment du modèle qui dépasse son niveau visé. */
  static async runDemolish(ctx, tpl, t, out) {
    const targets = managerTemplates.targets(tpl.steps);
    // Tous les bâtiments du village : un bâtiment absent du modèle (cachette d'un modèle offensif…) y est au niveau 0.
    for (const id of Object.keys(ctx.state.buildings)) {
      const type = registry.BUILDINGS.get(id);
      if (!type || ctx.state.level(id) <= Math.max(targets[id] || 0, type.minLevel)) continue;
      if (ctx.buildOrders.some((o) => o.building === id)) continue;
      const option = VillageService.demolishOption(ctx, type);
      if (option.blockers.length) {
        out.reason = `Démolition ${type.name} : ${option.blockers[0]}`;
        continue;
      }
      await VillageService.queueDemolish(ctx, option, t);
      out.queued.push(`Démolition ${type.name} ${option.level}`);
      out.done = false;
      return;
    }
  }

  /**
   * Gestionnaire de troupes : recrute ce qui manque pour atteindre les troupes visées (au village, hors du village et
   * en recrutement), dans la limite des ressources (moins le tampon et la prochaine construction) et de la ferme
   * (moins le tampon de population). Les unités en manque avancent ensemble, à proportion de ce qui manque.
   * @returns {{ recruited: object, reason: string|null, done: boolean }}
   */
  static async runTroops(ctx, troops, reserved, t) {
    const { state, cfg } = ctx;
    const out = { recruited: {}, reason: null, done: false };
    const have = { ...state.units };
    for (const [id, n] of Object.entries(ctx.awayUnits || {})) have[id] = (have[id] || 0) + n;
    for (const o of ctx.recruitOrders) have[o.unit] = (have[o.unit] || 0) + (o.count - o.done);
    if (troops.dismiss) {
      const dismissed = await AccountManagerService.dismissExtra(ctx, troops, have, t);
      if (Object.keys(dismissed).length) out.dismissed = dismissed;
    }

    const missing = [];
    const locked = [];
    for (const u of AccountManagerService.managedUnits(cfg)) {
      const want = (troops.units || {})[u.id] || 0;
      const need = want - (have[u.id] || 0);
      if (need <= 0) continue;
      if (state.level(u.building) < 1 || u.missingRequirements(state.buildings, cfg).length || !state.hasResearched(u)) {
        locked.push(u.name);
        continue;
      }
      missing.push({ type: u, need });
    }
    if (!missing.length) {
      out.done = !locked.length;
      out.reason = locked.length ? `Pas encore possible : ${locked.join(', ')}` : null;
      return out;
    }

    // Par bâtiment : un lot qui coûte au plus `batchCost` (le prix de `batch` lanciers), partagé entre ses unités à
    // proportion de ce qui manque, et seulement quand ce qui reste dans sa file vaut moins d'un demi-lot.
    // Chiffres ronds : à la dizaine (supérieure pour le lot, inférieure faute de ressources), sauf pour finir le modèle
    // (`rest` : ce qui manque encore, recruté au nombre exact quand il en reste moins).
    for (const m of missing) m.rest = m.need;
    const roundDown = (n, rest) => (n >= rest ? rest : Math.floor(n / 10) * 10);
    // Par bâtiment : un lot qui coûte au plus `batchCost`, partagé entre ses unités (managerTemplates.splitBatch, comme
    // l'aperçu du modèle), et seulement quand ce qui reste dans sa file vaut moins d'un demi-lot.
    const batchCost = managerTemplates.batchCostOf(troops);
    const price = (type) => RESOURCES.reduce((n, r) => n + type.cost[r], 0);
    const full = [];
    for (const building of new Set(missing.map((m) => m.type.building))) {
      const group = missing.filter((m) => m.type.building === building);
      const queuedCost = ctx.recruitOrders.filter((o) => o.building === building)
        .reduce((n, o) => n + (o.count - o.done) * price(registry.unit(o.unit)), 0);
      if (queuedCost >= batchCost / 2) {
        for (const m of group) m.need = 0;
        full.push(registry.building(building).name);
        continue;
      }
      const split = managerTemplates.splitBatch(group.map((m) => ({ key: m.type.id, need: m.need, price: price(m.type) })), batchCost);
      for (const m of group) m.need = split.get(m.type.id);
    }
    for (let i = missing.length - 1; i >= 0; i -= 1) if (missing[i].need <= 0) missing.splice(i, 1);
    if (!missing.length) {
      out.reason = `Lot en cours (${full.join(', ')}) : le suivant partira quand la file vaudra moins de ${(batchCost / 2).toLocaleString('fr-FR')} ressources`;
      return out;
    }

    const budget = {};
    for (const r of RESOURCES) budget[r] = Math.max(0, state.resources[r] - (troops.resBuffer || 0) - ((reserved && reserved[r]) || 0));
    const freePop = state.farmCapacity() - ctx.popUsed() - (troops.popBuffer || 0);
    const cost = { wood: 0, stone: 0, iron: 0 };
    let pop = 0;
    for (const { type, need } of missing) {
      for (const r of RESOURCES) cost[r] += type.cost[r] * need;
      pop += type.pop * need;
    }
    const factor = Math.min(1, ...RESOURCES.filter((r) => cost[r] > 0).map((r) => budget[r] / cost[r]), pop > 0 ? Math.max(0, freePop) / pop : 1);
    const counts = new Map(missing.map(({ type, need, rest }) => [type.id, roundDown(Math.floor(need * factor), rest)]));
    // Pas de quoi en faire une dizaine de chaque : une dizaine (ou ce qui reste à finir) des premières qui passent.
    if (![...counts.values()].some((n) => n > 0)) {
      let leftPop = freePop;
      const left = { ...budget };
      for (const { type, rest } of missing) {
        const n = Math.min(10, rest);
        if (type.pop * n > leftPop || RESOURCES.some((r) => type.cost[r] * n > left[r])) continue;
        counts.set(type.id, n);
        leftPop -= type.pop * n;
        for (const r of RESOURCES) left[r] -= type.cost[r] * n;
      }
    }
    if (![...counts.values()].some((n) => n > 0)) {
      out.reason = freePop <= 0 ? 'Ferme pleine (ou tampon de population atteint)' : 'Ressources insuffisantes';
      return out;
    }
    const byBuilding = new Map();
    for (const { type } of missing) {
      const n = counts.get(type.id);
      if (!n) continue;
      if (!byBuilding.has(type.building)) byBuilding.set(type.building, {});
      byBuilding.get(type.building)[type.id] = n;
    }
    for (const [building, list] of byBuilding) {
      try {
        await VillageService.queueRecruit(ctx, building, list, t);
        Object.assign(out.recruited, list);
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
        out.reason = err.message;
      }
    }
    if (!out.reason && locked.length) out.reason = `Pas encore possible : ${locked.join(', ')}`;
    return out;
  }

  /**
   * Option « renvoyer les unités en trop » d'un modèle de troupes (comme la démolition des modèles de construction) :
   * désaffecte, sans remboursement, les unités présentes au village au-delà du total visé (au village, en dehors et en
   * recrutement), y compris celles que le modèle ne contient pas. Jamais le paladin, les nobles ni la milice.
   * @returns {object} unités renvoyées
   */
  static async dismissExtra(ctx, troops, have, t) {
    const units = { ...ctx.state.units };
    const out = {};
    for (const [id, home] of Object.entries(units)) {
      if (NOT_MANAGED.has(id) || !(home > 0)) continue;
      const extra = Math.min(home, (have[id] || 0) - ((troops.units || {})[id] || 0));
      if (extra <= 0) continue;
      units[id] = home - extra;
      if (!units[id]) delete units[id];
      have[id] -= extra;
      out[id] = extra;
    }
    if (Object.keys(out).length) {
      ctx.state.units = units;
      await ctx.village.update({ units }, { transaction: t });
    }
    return out;
  }

  /** Routes commerciales arrivées à leur heure : envoi si le village a les ressources et les marchands. */
  static async runRoutes(now, premium) {
    const TradeService = require('./TradeService');
    const due = await TradeRoute.findAll({ where: { nextAt: { [Op.lte]: now } }, include: [{ association: 'origin', attributes: ['id', 'playerId'] }, { association: 'target', attributes: ['id', 'x', 'y'] }], limit: 500 });
    for (const route of due) {
      if (!route.origin || route.origin.playerId !== route.playerId) {
        await route.destroy();
        continue;
      }
      let result;
      if (!(await premium(route.playerId))) {
        result = 'Non envoyée : premium inactif';
      } else {
        try {
          await TradeService.send(route.originVillageId, { x: route.target.x, y: route.target.y, resources: route.resources }, { now, source: 'route' });
          result = 'Envoyée';
        } catch (err) {
          if (!(err instanceof GameError)) throw err;
          result = `Non envoyée : ${err.message}`.slice(0, 120);
        }
      }
      // Routes à intervalle : créneau suivant après celui prévu ; anciennes routes (une fois par jour) : à leur heure.
      const nextAt = route.intervalMinutes
        ? AccountManagerService.nextEvery(route.days, route.intervalMinutes, route.nextAt, now)
        : AccountManagerService.nextRun(route.days, route.minute, now);
      await route.update({ lastResult: result, nextAt });
    }
  }

  /**
   * Réserve : les villages au-dessus du seuil d'excédent livrent ceux sous le seuil de manque (jusqu'à mi-chemin des
   * deux seuils, livraisons déjà en route comprises), du plus proche au plus lointain, dans la limite de leurs
   * marchands. Rôle de chaque village : both, send, receive, off (ManagerVillages.reserve).
   * @returns {Promise<number>} livraisons envoyées
   */
  static async runReserve(playerId, now = new Date()) {
    const TradeService = require('./TradeService');
    const player = await Player.findByPk(playerId);
    const { reserve } = AccountManagerService.settings(player);
    const rows = (await require('./VillagesOverviewService').rows(playerId, now)).filter((r) => (r.buildings.market || 0) > 0);
    const roles = new Map((await ManagerVillage.findAll({ where: { playerId }, attributes: ['villageId', 'reserve'], raw: true })).map((r) => [r.villageId, r.reserve]));
    const incoming = await Transport.findAll({ where: { targetVillageId: rows.map((r) => r.village.id), type: 'delivery' }, attributes: ['targetVillageId', 'resources'], raw: true });
    const cfg = rows.length ? (await require('../models').World.findByPk(rows[0].village.worldId)).getConfig() : null;
    const limit = (r, value) => (reserve.mode === 'percent' ? Math.floor((r.storage * value) / 100) : Math.min(value, r.storage));

    const nodes = rows.map((r) => {
      const role = roles.get(r.village.id) || 'both';
      const low = limit(r, reserve.low);
      const high = limit(r, reserve.high);
      const fill = Math.floor((low + high) / 2);
      const coming = { wood: 0, stone: 0, iron: 0 };
      for (const tr of incoming) if (tr.targetVillageId === r.village.id) for (const res of RESOURCES) coming[res] += tr.resources[res] || 0;
      const node = { village: r.village, capacity: r.merchants.free * (cfg ? cfg.market.merchantCapacity : 1000), surplus: {}, need: {} };
      for (const res of RESOURCES) {
        const have = r.resources[res] + coming[res];
        node.surplus[res] = role === 'both' || role === 'send' ? Math.max(0, r.resources[res] - high) : 0;
        node.need[res] = (role === 'both' || role === 'receive') && have < low ? Math.min(fill, r.storage) - have : 0;
      }
      return node;
    });
    // Plans d'envoi : expéditeur → destinataire → ressources.
    const plans = new Map();
    const receivers = nodes.filter((n) => RESOURCES.some((res) => n.need[res] > 0));
    for (const to of receivers) {
      const senders = nodes.filter((n) => n !== to && n.capacity > 0 && RESOURCES.some((res) => n.surplus[res] > 0 && to.need[res] > 0))
        .sort((a, b) => distance(a.village, to.village) - distance(b.village, to.village));
      for (const from of senders) {
        for (const res of RESOURCES) {
          const amount = Math.min(to.need[res], from.surplus[res], from.capacity);
          if (amount <= 0) continue;
          to.need[res] -= amount;
          from.surplus[res] -= amount;
          from.capacity -= amount;
          if (!plans.has(from)) plans.set(from, new Map());
          const plan = plans.get(from);
          if (!plan.has(to)) plan.set(to, { wood: 0, stone: 0, iron: 0 });
          plan.get(to)[res] += amount;
        }
      }
    }
    let sent = 0;
    for (const [from, plan] of plans) {
      for (const [to, resources] of plan) {
        try {
          await TradeService.send(from.village.id, { x: to.village.x, y: to.village.y, resources }, { now, source: 'reserve' });
          sent += 1;
        } catch (err) {
          if (!(err instanceof GameError)) throw err;
        }
      }
    }
    const fresh = await Player.findByPk(playerId);
    const settings = fresh.managerSettings || {};
    await fresh.update({ managerSettings: { ...settings, reserve: { ...AccountManagerService.settings(fresh).reserve, lastRunAt: now.toISOString(), lastSent: sent } } });
    return sent;
  }

  /** Attaques en approche sur les villages du joueur (plus anciennes d'abord). */
  static async incomingAttacks(playerId, now = new Date()) {
    const villages = await Village.findAll({ where: { playerId }, attributes: ['id'], raw: true });
    if (!villages.length) return [];
    return Command.findAll({
      where: { type: 'attack', cancelled: false, arrivesAt: { [Op.gt]: now }, targetVillageId: villages.map((v) => v.id) },
      include: [
        { association: 'origin', attributes: ['id', 'name', 'x', 'y', 'playerId'], include: [{ model: Player, attributes: ['id', 'name'] }] },
        { association: 'target', attributes: ['id', 'name', 'x', 'y'] },
      ],
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    });
  }

  /**
   * Notifications d'attaque : selon le réglage, un e-mail à la première attaque (le compteur passe de 0 à 1), toutes
   * les `count` nouvelles attaques, ou au plus un toutes les `hours` heures ; « seulement si je ne suis pas connecté » :
   * rien n'est envoyé pendant que le joueur joue (il voit ses attaques), et ces attaques comptent comme vues.
   * @returns {Promise<object|null>} le message envoyé
   */
  static async runNotify(playerId, now = new Date()) {
    const player = await Player.findByPk(playerId, { include: [{ model: User, attributes: ['id', 'email', 'username'] }] });
    if (!player || !player.User) return null;
    const { notify, notifyState } = AccountManagerService.settings(player);
    const attacks = await AccountManagerService.incomingAttacks(playerId, now);
    const state = { pending: 0, lastCount: 0, lastId: 0, ...notifyState };
    const unchanged = JSON.stringify(state);
    const pendingFromId = state.pendingFromId ?? state.lastId;
    const fresh = attacks.filter((c) => c.id > state.lastId);
    state.pending += fresh.length;
    state.lastId = Math.max(state.lastId, ...attacks.map((c) => c.id));
    let send = false;
    if (notify.when === 'first') send = state.lastCount === 0 && attacks.length > 0;
    else if (notify.when === 'count') send = state.pending >= notify.count;
    else send = state.pending > 0 && (!state.lastSentAt || now - new Date(state.lastSentAt) >= notify.hours * 3600000);
    const online = player.lastSeenAt && now - new Date(player.lastSeenAt) < OFFLINE_AFTER;
    let message = null;
    if (send && !(notify.offlineOnly && online)) {
      const list = notify.when === 'first' ? attacks : attacks.filter((c) => c.id > pendingFromId);
      message = await AccountManagerService.sendNotification(player, list.length ? list : attacks, notify);
      state.lastSentAt = now.toISOString();
    }
    if (send) {
      state.pending = 0;
      state.pendingFromId = state.lastId;
    }
    state.lastCount = attacks.length;
    // Vérifié chaque minute pour chaque joueur concerné : écrit seulement quand l'état change.
    if (JSON.stringify(state) === unchanged) return message;
    const settings = (await Player.findByPk(playerId, { attributes: ['id', 'managerSettings'] })).managerSettings || {};
    await Player.update({ managerSettings: { ...settings, notifyState: state } }, { where: { id: playerId } });
    return message;
  }

  /**
   * E-mail de notification (gabarit commun des e-mails, en-tête « attaque ») : les attaques, regroupées selon le
   * réglage, en tableau (HTML) et en liste (version texte) ; bouton vers l'aperçu Arrivant si SITE_URL est configuré.
   */
  static async sendNotification(player, attacks, notify) {
    const Mailer = require('./Mailer');
    const { World } = require('../models');
    const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const pad = (n) => String(n).padStart(2, '0');
    const at = (d) => { const x = new Date(d); return `${pad(x.getDate())}/${pad(x.getMonth() + 1)} à ${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`; };
    const vlabel = (v) => (v ? `${v.name} (${v.x}|${v.y})` : '?');
    const attacker = (c) => (c.origin && c.origin.Player ? c.origin.Player.name : 'Barbares');
    const groups = new Map();
    for (const c of attacks) {
      const key = notify.group === 'attacker' ? attacker(c) : notify.group === 'target' ? vlabel(c.target) : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const groupLabel = (key, n) => `${notify.group === 'attacker' ? 'Attaquant' : 'Village visé'} : ${key} (${n})`;
    // Version texte.
    const lines = [];
    for (const [key, list] of groups) {
      if (key) lines.push(groupLabel(key, list.length));
      lines.push(...list.slice(0, notify.perGroup).map((c) => `- ${attacker(c)}, de ${vlabel(c.origin)} vers ${vlabel(c.target)}, arrivée le ${at(c.arrivesAt)}`));
      if (list.length > notify.perGroup) lines.push(`  … et ${list.length - notify.perGroup} de plus`);
      lines.push('');
    }
    // Version HTML : un tableau par groupe.
    const th = 'padding:6px 8px;border-bottom:2px solid #1b1715;background:#efe4cc;font-size:13px;font-weight:600;color:#6b4f1d;text-align:left;';
    const td = 'padding:6px 8px;border-bottom:1px solid #e1d4b6;font-size:14px;color:#2b241c;vertical-align:top;';
    const tables = [...groups].map(([key, list]) => {
      const rows = list.slice(0, notify.perGroup).map((c) => `<tr><td style="${td}">${esc(attacker(c))}</td><td style="${td}">${esc(vlabel(c.origin))}</td><td style="${td}">${esc(vlabel(c.target))}</td><td style="${td}white-space:nowrap;">${esc(at(c.arrivesAt))}</td></tr>`).join('');
      const more = list.length > notify.perGroup ? `<p style="margin:6px 0 0;font-size:13px;color:#7a6e5e;">… et ${list.length - notify.perGroup} de plus</p>` : '';
      return `${key ? `<p style="margin:14px 0 6px;font-size:15px;font-weight:600;color:#8c2f1f;">${esc(groupLabel(key, list.length))}</p>` : ''}`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #d8c9a8;"><tr><th style="${th}">Attaquant</th><th style="${th}">Depuis</th><th style="${th}">Vers</th><th style="${th}">Arrivée</th></tr>${rows}</table>${more}`;
    }).join('');

    const [world, village] = await Promise.all([
      World.findByPk(player.worldId, { attributes: ['name'] }),
      Village.findOne({ where: { playerId: player.id }, attributes: ['id'], order: [['id', 'ASC']] }),
    ]);
    const n = attacks.length;
    const worldName = world ? world.name : 'monde';
    const link = village ? Mailer.siteLink(`/village/${village.id}/incomings?type=attacks`) : null;
    const intro = `${n} attaque${n > 1 ? 's arrivent' : ' arrive'} sur tes villages (${worldName}).`;
    const footer = 'Notification du gestionnaire de compte (premium). Pour la régler ou l’arrêter : Aperçu, Gestionnaire de compte, Notifications.';
    return Mailer.sendTemplate({
      to: player.User.email,
      subject: `Adarma · ${worldName} : ${n} attaque${n > 1 ? 's' : ''} en approche`,
      header: 'attack',
      preheader: intro,
      title: `${n > 1 ? `${n} attaques` : 'Une attaque'} en approche`,
      intro: `Bonjour ${player.name}, ${intro.charAt(0).toLowerCase()}${intro.slice(1)}`,
      body: tables,
      action: link ? { label: 'Voir les attaques en approche', url: link } : null,
      footer,
      text: [`Bonjour ${player.name},`, '', intro, '', ...lines, ...(link ? [`Voir les attaques : ${link}`, ''] : []), footer].join('\n'),
    });
  }

  // ---------------------------------------------------------------- Aperçu

  /**
   * Compte rendu du gestionnaire de marché (aperçu) : routes (envoyées ou non au dernier passage, prochain envoi),
   * les derniers passages, et la réserve (dernier équilibrage, livraisons).
   */
  static async marketReport(playerId, { limit = 6 } = {}) {
    const player = await Player.findByPk(playerId, { attributes: ['id', 'managerSettings'] });
    const routes = await TradeRoute.findAll({ where: { playerId }, attributes: ['id', 'lastResult', 'nextAt', 'updatedAt', 'resources'], raw: true });
    const recentIds = routes.filter((r) => r.lastResult).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, limit).map((r) => r.id);
    const recent = recentIds.length ? await TradeRoute.findAll({
      where: { id: recentIds },
      include: [{ association: 'origin', attributes: ['id', 'name', 'x', 'y'] }, { association: 'target', attributes: ['id', 'name', 'x', 'y'] }],
      order: [['updatedAt', 'DESC']],
    }) : [];
    const next = routes.map((r) => r.nextAt).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null;
    return {
      routes: routes.length,
      sent: routes.filter((r) => r.lastResult === 'Envoyée').length,
      failed: routes.filter((r) => r.lastResult && r.lastResult !== 'Envoyée').length,
      next, recent, reserve: AccountManagerService.settings(player).reserve,
    };
  }

  /**
   * Avertissements et recommandations de l'aperçu (comme sur GT) : ferme pleine, entrepôt plein, et villages dont le
   * gestionnaire est bloqué.
   */
  static async warnings(playerId, managed, now = new Date()) {
    // Villages de la page affichée seulement (`managed`) : un compte à 1 000 villages n'est pas relu en entier.
    const rows = await require('./VillagesOverviewService').rows(playerId, now, { ids: managed.map((m) => m.village.id) });
    const out = [];
    for (const r of rows) {
      if (r.pop.max - r.pop.used <= Math.max(10, r.pop.max * 0.02)) out.push({ village: r.village, kind: 'farm', text: 'La ferme est pleine.' });
      const full = RESOURCES.filter((res) => r.resources[res] >= r.storage);
      if (full.length) out.push({ village: r.village, kind: 'storage', text: `L’entrepôt est plein (${full.map((res) => ({ wood: 'bois', stone: 'argile', iron: 'fer' })[res]).join(', ')}).` });
    }
    for (const m of managed) {
      const s = m.status || {};
      if (s.premium === false) out.push({ village: m.village, kind: 'premium', text: 'Gestionnaire arrêté : le premium n’est plus actif.' });
      else if (m.build === 'active' && s.build && s.build.reason && !/ressources insuffisantes|File de construction pleine/.test(s.build.reason)) out.push({ village: m.village, kind: 'build', text: s.build.reason });
      // Forge bloquée (pas de forge, bâtiments requis) : comme un modèle de construction bloqué ; pas pour une attente
      // normale (recherche en cours, ressources).
      if (s.premium !== false && m.research === 'active' && s.research && s.research.reason && !/ressources insuffisantes|^Recherche en cours/.test(s.research.reason)) {
        out.push({ village: m.village, kind: 'research', text: `Forge : ${s.research.reason}` });
      }
    }
    return out;
  }
}

AccountManagerService.RESERVE_ROLES = RESERVE_ROLES;
AccountManagerService.NOTIFY_WHEN = NOTIFY_WHEN;
AccountManagerService.NOTIFY_GROUPS = NOTIFY_GROUPS;
AccountManagerService.DEFAULTS = DEFAULTS;

module.exports = AccountManagerService;
