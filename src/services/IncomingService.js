'use strict';

const { Op } = require('sequelize');
const { sequelize, Player, Village, Command, Tribe } = require('../models');
const incomingLabel = require('../game/incomingLabel');
const GameError = require('./GameError');

const TYPES = { attacks: ['attack'], supports: ['support'], all: ['attack', 'support'] };
const SORTS = ['arrival', 'name', 'target', 'origin', 'player', 'distance'];
const MAX_NOTE = 500;
const MAX_FORMAT = 120;
// Attaques d'un même village vers la même cible à moins de cet écart : train possible (nobles envoyés d'un coup).
const TRAIN_GAP_MS = 1000;

const withVillages = [
  { association: 'origin', include: [{ model: Player, include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }] },
  { association: 'target' },
];

/** Nom affiché d'un ordre entrant : celui donné par le défenseur, sinon « Attaque » / « Soutien ». */
const displayName = (cmd) => cmd.incomingName || (cmd.type === 'attack' ? 'Attaque' : 'Soutien');

/**
 * Attaques et soutiens entrants vus par le défenseur (propriétaire du village visé), comme l'aperçu « Arrivant » de
 * Guerre Tribale : liste du compte, page d'un ordre, renommage, étiquetage, notes et ordres ignorés. Les troupes et
 * l'heure de départ restent cachées : seuls l'origine, la cible et l'heure d'arrivée sont connues.
 */
class IncomingService {
  /** Ordres entrants des villages de `playerId` (ids parmi eux si `ids` est donné). */
  static async find(playerId, { ids = null, types = TYPES.all, targetId = null } = {}) {
    const villages = await Village.findAll({ where: { playerId, ...(targetId ? { id: targetId } : {}) }, attributes: ['id'], raw: true });
    if (!villages.length) return [];
    return Command.findAll({
      where: {
        targetVillageId: { [Op.in]: villages.map((v) => v.id) },
        type: { [Op.in]: types },
        ...(ids ? { id: { [Op.in]: ids } } : {}),
      },
      include: withVillages,
      order: [['arrivesAt', 'ASC'], ['id', 'ASC']],
    });
  }

  /**
   * Aperçu Arrivant : ordres filtrés et triés, avec les compteurs des onglets.
   * `type` attacks | supports | all ; `ignored` : afficher aussi les ordres ignorés ; `q` : texte cherché dans le nom ;
   * `target` : un seul village visé ; `sort` (voir SORTS) et `dir` asc | desc.
   */
  static async list(playerId, {
    type = 'all', ignored = false, q = '', target = null, origin = null, player = null, sort = 'arrival', dir = 'asc',
  } = {}, cfg = null) {
    const all = await IncomingService.find(playerId);
    const counts = {
      all: all.filter((c) => !c.incomingIgnored).length,
      attacks: all.filter((c) => !c.incomingIgnored && c.type === 'attack').length,
      supports: all.filter((c) => !c.incomingIgnored && c.type === 'support').length,
      ignored: all.filter((c) => c.incomingIgnored).length,
    };
    const marks = IncomingService.marks(all, cfg);
    const needle = String(q || '').trim().toLowerCase();
    const shown = all
      .filter((c) => (TYPES[type] || TYPES.all).includes(c.type))
      .filter((c) => ignored || !c.incomingIgnored)
      .filter((c) => !needle || displayName(c).toLowerCase().includes(needle));
    // Totaux par joueur, village d'origine et village visé, avant les filtres qu'ils posent (pour en changer d'un clic).
    const totals = IncomingService.totals(shown);
    let rows = shown
      .filter((c) => !target || c.targetVillageId === target)
      .filter((c) => !origin || c.originVillageId === origin)
      .filter((c) => !player || (player === 'barb' ? !c.origin.playerId : c.origin.playerId === player))
      .map((c) => ({ cmd: c, name: displayName(c), distance: incomingLabel.distance(c.origin, c.target), ...marks.get(c.id) }));
    const key = {
      arrival: (r) => +new Date(r.cmd.arrivesAt),
      name: (r) => r.name.toLowerCase(),
      target: (r) => r.cmd.target.name.toLowerCase(),
      origin: (r) => r.cmd.origin.name.toLowerCase(),
      player: (r) => (r.cmd.origin.Player ? r.cmd.origin.Player.name.toLowerCase() : ''),
      distance: (r) => r.distance,
    }[SORTS.includes(sort) ? sort : 'arrival'];
    const sign = dir === 'desc' ? -1 : 1;
    rows = rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka < kb) return -sign;
      if (ka > kb) return sign;
      return +new Date(a.cmd.arrivesAt) - +new Date(b.cmd.arrivesAt);
    });
    return { rows, counts, totals };
  }

  /**
   * Repères des scripts de défense de GT, sur les attaques non ignorées :
   *   - `dup` { i, n } : i-ième des n attaques parties du même village (doublons « 1/3 », « 2/3 »…) ;
   *   - `train` { k, i, n } : i-ième attaque du train numéro k, attaques du même village vers la même cible arrivées à
   *     moins de TRAIN_GAP_MS l'une de l'autre, comme un train de nobles envoyé d'un coup (au moins deux).
   */
  static marks(cmds, cfg) {
    const out = new Map(cmds.map((c) => [c.id, {}]));
    const attacks = cmds.filter((c) => c.type === 'attack' && !c.incomingIgnored);
    const groupBy = (list, key) => {
      const m = new Map();
      for (const c of list) {
        const k = key(c);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(c);
      }
      return [...m.values()].map((g) => g.sort((a, b) => +new Date(a.arrivesAt) - +new Date(b.arrivesAt) || a.id - b.id));
    };
    for (const g of groupBy(attacks, (c) => c.originVillageId)) {
      if (g.length > 1) g.forEach((c, i) => { out.get(c.id).dup = { i: i + 1, n: g.length }; });
    }
    const gap = Math.max(TRAIN_GAP_MS, (cfg && cfg.arrivalStepMs) || 0);
    const trains = [];
    for (const g of groupBy(attacks, (c) => `${c.originVillageId}>${c.targetVillageId}`)) {
      let run = [g[0]];
      const flush = () => { if (run.length > 1) trains.push(run); };
      for (const c of g.slice(1)) {
        if (+new Date(c.arrivesAt) - +new Date(run[run.length - 1].arrivesAt) <= gap) run.push(c);
        else { flush(); run = [c]; }
      }
      flush();
    }
    // Trains numérotés dans l'ordre d'arrivée de leur première attaque : « Train 2 · 3/4 », pour ne pas les confondre.
    trains.sort((x, y) => +new Date(x[0].arrivesAt) - +new Date(y[0].arrivesAt) || x[0].id - y[0].id);
    trains.forEach((run, k) => run.forEach((c, i) => { out.get(c.id).train = { k: k + 1, i: i + 1, n: run.length }; }));
    return out;
  }

  /** Nombre d'ordres par joueur, village d'origine et village visé, du plus grand au plus petit. */
  static totals(cmds) {
    const count = (key, label) => {
      const m = new Map();
      for (const c of cmds) {
        const k = key(c);
        const e = m.get(k) || { key: k, label: label(c), attacks: 0, supports: 0 };
        e[c.type === 'attack' ? 'attacks' : 'supports'] += 1;
        m.set(k, e);
      }
      return [...m.values()].sort((a, b) => b.attacks + b.supports - (a.attacks + a.supports) || String(a.label.name).localeCompare(String(b.label.name)));
    };
    return {
      players: count((c) => c.origin.playerId || 'barb', (c) => ({ name: c.origin.Player ? c.origin.Player.name : 'Barbares' })),
      origins: count((c) => c.originVillageId, (c) => ({ name: c.origin.name, x: c.origin.x, y: c.origin.y })),
      targets: count((c) => c.targetVillageId, (c) => ({ name: c.target.name, x: c.target.x, y: c.target.y })),
    };
  }

  /**
   * Alertes (en-tête, titre de l'onglet, son) : nombre d'attaques entrantes non arrivées et plus grand identifiant,
   * qui augmente à chaque nouvelle attaque même si une autre vient d'arriver.
   */
  static async alertState(playerId) {
    const cmds = await IncomingService.find(playerId, { types: TYPES.attacks });
    return { attacks: cmds.length, lastId: cmds.reduce((m, c) => Math.max(m, c.id), 0) };
  }

  /**
   * Texte proposé pour une demande de soutien à la tribu : village visé (muraille, loyauté), puis chaque attaque
   * sélectionnée avec son arrivée, son nom, son origine et la note du défenseur.
   */
  static async supportDraft(playerId, ids, { now = new Date(), when }) {
    const cmds = (await IncomingService.owned(playerId, ids)).filter((c) => c.type === 'attack');
    if (!cmds.length) throw new GameError('Sélectionnez au moins une attaque.');
    const villages = await Village.findAll({ where: { id: [...new Set(cmds.map((c) => c.targetVillageId))] }, attributes: ['id', 'name', 'x', 'y', 'buildings', 'loyalty'] });
    const lines = [];
    for (const v of villages) {
      const list = cmds.filter((c) => c.targetVillageId === v.id);
      lines.push(`${v.name} (${v.x}|${v.y}) : ${list.length} attaque${list.length > 1 ? 's' : ''} · muraille niveau ${(v.buildings && v.buildings.wall) || 0} · loyauté ${Math.floor(v.loyalty)}`);
      for (const c of list) {
        const from = `${c.origin.name} (${c.origin.x}|${c.origin.y})${c.origin.Player ? ` de ${c.origin.Player.name}` : ''}`;
        lines.push(`- ${when(c.arrivesAt, now)} · ${displayName(c)} · ${from}${c.incomingNote ? ` · ${c.incomingNote.replace(/\s+/g, ' ')}` : ''}`);
      }
      lines.push('');
    }
    const first = villages[0];
    return {
      cmds,
      subject: villages.length === 1 ? `Soutien demandé : ${first.name} (${first.x}|${first.y})` : `Soutien demandé : ${villages.length} villages`,
      body: `${lines.join('\n').trim()}\n\nMerci d'envoyer du soutien avant les arrivées.`,
    };
  }

  /** Envoie la demande de soutien à toute la tribu (permise à chaque membre, sans le droit de courrier circulaire). */
  static async requestSupport(playerId, { subject, body }) {
    const player = await Player.findByPk(playerId, { attributes: ['id', 'tribeId'] });
    if (!player.tribeId) throw new GameError("Vous n'êtes dans aucune tribu : la demande de soutien est envoyée à votre tribu.");
    return require('./MessageService').start(playerId, { group: 'tribe', subject, body }, { supportRequest: true });
  }

  /** Un ordre entrant d'un village du joueur, avec son tableau des temps de trajet et l'unité estimée ; 404 sinon. */
  static async detail(playerId, commandId, cfg, now = new Date()) {
    const [cmd] = await IncomingService.find(playerId, { ids: [Number(commandId) || 0] });
    if (!cmd) throw new GameError('Ordre introuvable.', 404);
    const table = incomingLabel.travelTable(cmd.origin, cmd.target, cfg, cmd.type);
    const remaining = (new Date(cmd.arrivesAt) - now) / 1000;
    const guess = incomingLabel.estimate(table, remaining, cfg);
    return { cmd, name: displayName(cmd), distance: incomingLabel.distance(cmd.origin, cmd.target), table, remaining, guess };
  }

  static async owned(playerId, ids) {
    const list = [].concat(ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!list.length) throw new GameError('Aucun ordre sélectionné.');
    return IncomingService.find(playerId, { ids: list });
  }

  /**
   * Bouton « Étiqueter » : nomme d'après l'unité estimée tous les ordres sélectionnés, en remplaçant leur nom actuel
   * (étiquette précédente ou nom donné à la main). Renvoie le nombre d'ordres étiquetés.
   */
  static async label(playerId, ids, cfg, now = new Date()) {
    const [cmds, player] = await Promise.all([IncomingService.owned(playerId, ids), Player.findByPk(playerId, { attributes: ['incomingLabelFormat'] })]);
    const todo = cmds;
    // Une seule transaction : un millier d'ordres étiquetés d'un coup reste rapide.
    await sequelize.transaction(async (transaction) => {
      for (const cmd of todo) {
        await cmd.update({ incomingName: incomingLabel.label(cmd, cfg, { now, format: player && player.incomingLabelFormat }) }, { transaction });
      }
    });
    return todo.length;
  }

  /** Renomme les ordres (nom vide : nom par défaut). */
  static async rename(playerId, ids, name) {
    const cmds = await IncomingService.owned(playerId, ids);
    const value = String(name || '').replace(/\s+/g, ' ').trim().slice(0, incomingLabel.MAX_NAME) || null;
    if (cmds.length) await Command.update({ incomingName: value }, { where: { id: cmds.map((c) => c.id) } });
    return cmds.length;
  }

  static async setIgnored(playerId, ids, ignored) {
    const cmds = await IncomingService.owned(playerId, ids);
    if (cmds.length) await Command.update({ incomingIgnored: Boolean(ignored) }, { where: { id: cmds.map((c) => c.id) } });
    return cmds.length;
  }

  /** Note du défenseur sur un ordre (vide : supprimée), partagée avec la tribu comme ses notes de village. */
  static async setNote(playerId, commandId, text) {
    const [cmd] = await IncomingService.owned(playerId, [commandId]);
    if (!cmd) throw new GameError('Ordre introuvable.', 404);
    const value = String(text || '').replace(/\r\n/g, '\n').trim();
    if (value.length > MAX_NOTE) throw new GameError(`La note fait au plus ${MAX_NOTE} caractères.`);
    await cmd.update({ incomingNote: value || null });
  }

  /** Format du bouton « Étiqueter » (vide : format par défaut). */
  static async setFormat(playerId, format) {
    const value = String(format || '').replace(/\s+/g, ' ').trim();
    if (value.length > MAX_FORMAT) throw new GameError(`Le format fait au plus ${MAX_FORMAT} caractères.`);
    await Player.update({ incomingLabelFormat: value || null }, { where: { id: playerId } });
  }

  /**
   * Ordres entrants annotés ou renommés d'un village d'un membre de la tribu, visibles par `viewer` quand ce membre
   * partage ses notes et que `viewer` affiche celles de la tribu (mêmes réglages que les notes de village).
   */
  static async sharedFor(viewer, village) {
    if (!village.playerId || village.playerId === viewer.id || !viewer.tribeId || !viewer.showTribeNotes) return [];
    const owner = await Player.findByPk(village.playerId, { attributes: ['id', 'tribeId', 'shareVillageNotes'] });
    if (!owner || owner.tribeId !== viewer.tribeId || !owner.shareVillageNotes) return [];
    const cmds = await Command.findAll({
      where: {
        targetVillageId: village.id, type: { [Op.in]: TYPES.all }, incomingIgnored: false,
        [Op.or]: [{ incomingName: { [Op.ne]: null } }, { incomingNote: { [Op.ne]: null } }],
      },
      include: withVillages,
      order: [['arrivesAt', 'ASC']],
    });
    return cmds.map((c) => ({ cmd: c, name: displayName(c) }));
  }
}

IncomingService.TYPES = TYPES;
IncomingService.SORTS = SORTS;
IncomingService.MAX_NOTE = MAX_NOTE;
IncomingService.TRAIN_GAP_MS = TRAIN_GAP_MS;
IncomingService.displayName = displayName;

module.exports = IncomingService;
