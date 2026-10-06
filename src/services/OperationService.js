'use strict';

const { Op } = require('sequelize');
const {
  Player, Tribe, Village, ArmyTemplate, TribeOperation, TribeOperationTarget, TribeOperationClaim,
} = require('../models');
const GameError = require('./GameError');
const TribeService = require('./TribeService');
const registry = require('../game/registry');
const { continent } = require('../game/MapPlacer');

/**
 * Opérations de tribu : organisation d'attaques groupées et de noblages, purement informative (aucun ordre n'est
 * envoyé). Les membres qui ont le droit « Opérations » créent une opération (nom, couleur de marquage, tribus visées)
 * et y ajoutent des villages cibles : nombre d'attaques, troupes par attaque, heure d'arrivée de la première et écart
 * en secondes entre les suivantes. Chaque attaque est une place (`slot`) qu'un membre revendique : il s'engage à
 * l'envoyer pour qu'elle arrive à son heure. Les cibles sont marquées sur la carte des membres.
 */
const MAX_OPERATIONS = 30;
const MAX_TARGETS = 2000;
const MAX_COUNT = 50;
// « Un modèle par attaque » : jusqu'à 10 attaques aux troupes différentes sur chaque village.
const MAX_EACH = 10;
const MAX_TRIBES = 10;
const MAX_SPACING = 3600;
const NAME_MAX = 60;
const NOTE_MAX = 2000;
const TARGET_NOTE_MAX = 120;
const PAGE_SIZE = 50;
const COLOR_RE = /^#[0-9a-f]{6}$/;
const DEFAULT_COLOR = '#e0452b';
const VIEWS = ['mine', 'open', 'all', 'player'];
// Tris des tableaux d'une opération (en-têtes cliquables) : sans tri choisi, demandes groupées par village et par heure.
const SORTS = ['village', 'joueur', 'arrivee', 'troupes', 'attaques'];
// Sens par défaut au premier clic sur un en-tête (les plus grosses attaques d'abord).
const SORT_DIRS = { village: 'asc', joueur: 'asc', arrivee: 'asc', troupes: 'desc', attaques: 'asc' };
// Type de demande (sous-filtre des cibles) : noblage (noble), faux (10 unités au plus), attaque (le reste).
const TYPES = { noble: 'Noblages', attack: 'Attaques', fake: 'Faux' };
const troopTotal = (units) => Object.values(units || {}).reduce((n, v) => n + (v > 0 ? v : 0), 0);
const typeOf = (x) => (isNoble(x) ? 'noble' : troopTotal(x.units) <= 10 ? 'fake' : 'attack');
const ownerName = (x) => (x.Village.Player ? x.Village.Player.name : '\uffff');
/** Comparateurs par colonne, sur une demande (`x`) ; `time` : heure de la ligne (place, sinon première arrivée). */
const SORTERS = {
  village: (a, b) => a.x.Village.y - b.x.Village.y || a.x.Village.x - b.x.Village.x,
  joueur: (a, b) => ownerName(a.x).localeCompare(ownerName(b.x), 'fr'),
  arrivee: (a, b) => (a.time ? a.time.getTime() : Infinity) - (b.time ? b.time.getTime() : Infinity),
  troupes: (a, b) => Number(isNoble(a.x)) - Number(isNoble(b.x)) || troopTotal(a.x.units) - troopTotal(b.x.units),
  attaques: (a, b) => (a.slot != null ? a.slot - b.slot : claimedOf(a.x) / a.x.count - claimedOf(b.x) / b.x.count || b.x.count - a.x.count),
};
function sortRows(rows, sort, dir) {
  const cmp = SORTERS[sort];
  const sign = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => sign * cmp(a, b) || SORTERS.arrivee(a, b) || a.x.id - b.x.id);
}

async function memberOf(playerId) {
  const player = await Player.findByPk(playerId);
  if (!player || !player.tribeId) throw new GameError("Vous n'êtes dans aucune tribu.", 403);
  return player;
}

async function organizerOf(playerId) {
  const player = await memberOf(playerId);
  if (!TribeService.can(player, 'operations')) throw new GameError('Il faut le droit Opérations.', 403);
  return player;
}

async function operationOf(player, operationId) {
  const op = await TribeOperation.findByPk(Number(operationId));
  if (!op || op.tribeId !== player.tribeId) throw new GameError('Opération introuvable.', 404);
  return op;
}

/** Troupes demandées : unités du monde (hors milice), sans zéros. */
function cleanUnits(input, cfg) {
  const out = {};
  for (const u of registry.unitsFor(cfg)) {
    const n = Math.floor(Number(input && input[u.id]));
    if (Number.isFinite(n) && n > 0) out[u.id] = Math.min(n, 1000000);
  }
  return out;
}

/** Heure d'arrivée saisie (« 2026-10-06T20:00:00 », heure du serveur) ; vide : aucune. */
function parseArrival(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) throw new GameError("Heure d'arrivée invalide.");
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) throw new GameError("Heure d'arrivée invalide.");
  return date;
}

const filled = (value) => value !== undefined && value !== null && String(value).trim() !== '';

function cleanCount(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > MAX_COUNT) throw new GameError(`Nombre d'attaques : 1 à ${MAX_COUNT}.`);
  return n;
}

function cleanSpacing(value) {
  const n = Math.floor(Number(value || 0));
  if (!Number.isFinite(n) || n < 0 || n > MAX_SPACING) throw new GameError(`Écart entre les attaques : 0 à ${MAX_SPACING} secondes.`);
  return n;
}

const cleanTargetNote = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, TARGET_NOTE_MAX) || null;

/** Tribus visées, par leurs tags (séparés par des espaces, virgules ou points-virgules). */
async function tribesByTags(player, text) {
  const tags = [...new Set(String(text || '').split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean))];
  if (tags.length > MAX_TRIBES) throw new GameError(`${MAX_TRIBES} tribus visées au maximum.`);
  const ids = [];
  for (const tag of tags) {
    const tribe = await Tribe.findOne({ where: { worldId: player.worldId, tag }, attributes: ['id'] });
    if (!tribe) throw new GameError(`Aucune tribu avec le tag ${tag}.`);
    if (tribe.id === player.tribeId) throw new GameError('Ta tribu ne peut pas être visée par ses propres opérations.');
    ids.push(tribe.id);
  }
  return ids;
}

function cleanFields(fields) {
  const name = String(fields.name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) throw new GameError("Nom de l'opération : 2 caractères minimum.");
  if (name.length > NAME_MAX) throw new GameError(`Nom de l'opération : ${NAME_MAX} caractères au maximum.`);
  const color = String(fields.color || '').trim().toLowerCase();
  if (!COLOR_RE.test(color)) throw new GameError('Couleur invalide (format #rrggbb).');
  const note = String(fields.note || '').replace(/\r\n/g, '\n').trim();
  if (note.length > NOTE_MAX) throw new GameError(`Consignes : ${NOTE_MAX} caractères au maximum.`);
  return { name, color, note: note || null };
}

/** Troupes d'un formulaire (un champ par unité : `axe`, `light`…) : les champs saisis, sinon le modèle d'armée choisi. */
async function unitsOf(player, input, cfg) {
  const units = cleanUnits(input, cfg);
  if (Object.keys(units).length || !input.template) return units;
  const tpl = await ArmyTemplate.findOne({ where: { id: Number(input.template), playerId: player.id } });
  if (!tpl) throw new GameError("Modèle d'armée introuvable.", 404);
  return cleanUnits(tpl.units, cfg);
}

/** Demande de noblage : les troupes de la cible comprennent un noble. */
const isNoble = (target) => Boolean(target.units && target.units.snob > 0);
/** Heure d'arrivée de l'attaque n° `slot` de la cible. */
const slotTime = (target, slot) => (target.arrivalAt ? new Date(target.arrivalAt.getTime() + slot * target.spacing * 1000) : null);
/** Places revendiquées encore demandées (une baisse du nombre d'attaques retire les autres). */
const liveClaims = (target) => (target.claims || []).filter((c) => c.slot < target.count);
const claimedOf = (target) => liveClaims(target).length;

/** Tri des cibles : heure d'arrivée (sans heure à la fin), puis ordre d'ajout. */
const byArrival = (a, b) => (a.arrivalAt ? a.arrivalAt.getTime() : Infinity) - (b.arrivalAt ? b.arrivalAt.getTime() : Infinity) || a.id - b.id;
const byTime = (a, b) => (a.at ? a.at.getTime() : Infinity) - (b.at ? b.at.getTime() : Infinity) || a.target.id - b.target.id || a.slot - b.slot;

function pageOf(list, page) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
  return { rows: list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pages, total: list.length };
}

async function destroyOperations(ids, t) {
  if (!ids.length) return;
  const targetIds = (await TribeOperationTarget.findAll({ where: { operationId: { [Op.in]: ids } }, attributes: ['id'], transaction: t })).map((x) => x.id);
  if (targetIds.length) await TribeOperationClaim.destroy({ where: { targetId: { [Op.in]: targetIds } }, transaction: t });
  await TribeOperationTarget.destroy({ where: { operationId: { [Op.in]: ids } }, transaction: t });
  await TribeOperation.destroy({ where: { id: { [Op.in]: ids } }, transaction: t });
}

/** Chiffres d'un ensemble de cibles : villages, attaques et noblages demandés / revendiqués, participants. */
function statsOf(targets, playerId) {
  const s = { villages: new Set(targets.map((x) => x.villageId)).size, wanted: 0, claimed: 0, nobles: 0, noblesClaimed: 0, mine: 0, mineNobles: 0, first: null, participants: new Map() };
  for (const x of targets) {
    const noble = isNoble(x);
    const claims = liveClaims(x);
    s.wanted += x.count;
    s.claimed += claims.length;
    if (noble) { s.nobles += x.count; s.noblesClaimed += claims.length; }
    if (x.arrivalAt && (!s.first || x.arrivalAt < s.first)) s.first = x.arrivalAt;
    for (const c of claims) {
      if (c.playerId === playerId) { s.mine++; if (noble) s.mineNobles++; }
      const entry = s.participants.get(c.playerId) || { player: c.Player || { id: c.playerId, name: '?' }, attacks: 0, nobles: 0 };
      entry.attacks++;
      if (noble) entry.nobles++;
      s.participants.set(c.playerId, entry);
    }
  }
  return s;
}

class OperationService {
  /** Opérations de la tribu du joueur, avec leurs chiffres et la prochaine arrivée. */
  static async list(playerId, now = new Date()) {
    const player = await memberOf(playerId);
    const ops = await TribeOperation.findAll({
      where: { tribeId: player.tribeId },
      include: [{ model: Player, as: 'organizer', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
    });
    const targets = ops.length ? await TribeOperationTarget.findAll({
      where: { operationId: { [Op.in]: ops.map((o) => o.id) } },
      attributes: ['id', 'operationId', 'villageId', 'count', 'units', 'arrivalAt', 'spacing'],
      include: [{ model: TribeOperationClaim, as: 'claims', attributes: ['playerId', 'slot'] }],
    }) : [];
    const tribes = await OperationService.tribesOf(ops);
    return {
      player,
      manager: TribeService.can(player, 'operations'),
      color: DEFAULT_COLOR,
      operations: ops.map((op) => {
        const own = targets.filter((x) => x.operationId === op.id);
        const next = own.map((x) => x.arrivalAt).filter((d) => d && d > now).sort((a, b) => a - b)[0] || null;
        return { op, tribes: op.targetTribeIds.map((id) => tribes.get(id)).filter(Boolean), stats: statsOf(own, player.id), next };
      }),
    };
  }

  /** Tribus visées par des opérations : Map id → tribu (les tribus dissoutes n'y sont plus). */
  static async tribesOf(ops) {
    const ids = [...new Set(ops.flatMap((o) => o.targetTribeIds || []))];
    const rows = ids.length ? await Tribe.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'tag', 'name'] }) : [];
    return new Map(rows.map((t) => [t.id, t]));
  }

  /**
   * Une opération. Vues (`vue`) : 'mine' (mes attaques, une ligne par attaque, par heure d'arrivée), 'player'
   * (celles du joueur `j`), 'open' (cibles avec des attaques à prendre) ou 'all' (toutes les cibles). Par défaut :
   * toutes pour un organisateur, sinon les siennes s'il en a, sinon celles à prendre. `k` : continent des cibles ;
   * `page` : page de 50 lignes. Pour un organisateur, les villages des tribus visées à ajouter, filtrés par continent
   * (`ak`) ou par joueur (`ap`).
   */
  static async detail(playerId, operationId, query = {}) {
    const player = await memberOf(playerId);
    const op = await operationOf(player, operationId);
    const manager = TribeService.can(player, 'operations');
    const [organizer, tribes, targets] = await Promise.all([
      op.playerId ? Player.findByPk(op.playerId, { attributes: ['id', 'name'] }) : null,
      OperationService.tribesOf([op]),
      TribeOperationTarget.findAll({
        where: { operationId: op.id },
        include: [
          { model: Village, attributes: ['id', 'name', 'x', 'y', 'points', 'playerId'], include: [{ model: Player, attributes: ['id', 'name', 'tribeId'], include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }] },
          { model: TribeOperationClaim, as: 'claims', include: [{ model: Player, attributes: ['id', 'name'] }] },
        ],
      }),
    ]);
    // Demandes regroupées par village (dans l'ordre de la première arrivée de chacun), puis par heure d'arrivée.
    targets.sort(byArrival);
    const firstOf = new Map();
    targets.forEach((x, i) => { if (!firstOf.has(x.villageId)) firstOf.set(x.villageId, i); });
    targets.sort((a, b) => firstOf.get(a.villageId) - firstOf.get(b.villageId) || byArrival(a, b));
    for (const x of targets) x.claims.sort((a, b) => a.slot - b.slot);
    const stats = statsOf(targets, player.id);
    const participants = [...stats.participants.values()].sort((a, b) => b.attacks - a.attacks || a.player.name.localeCompare(b.player.name, 'fr'));

    // Sous-filtres des cibles : continent, tribu ciblée, joueur ciblé, type de demande, recherche (nom ou x|y).
    const continents = [...new Set(targets.map((x) => continent(x.Village.x, x.Village.y)))].sort();
    const k = continents.includes(query.k) ? query.k : '';
    const ownerOf = (x) => x.Village.Player;
    const targetPlayers = [...new Map(targets.filter(ownerOf).map((x) => [ownerOf(x).id, ownerOf(x)])).values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const targetTribes = [...new Map(targetPlayers.filter((pl) => pl.Tribe).map((pl) => [pl.Tribe.id, pl.Tribe])).values()].sort((a, b) => a.tag.localeCompare(b.tag, 'fr'));
    const ct = targetTribes.some((tr) => tr.id === Number(query.ct)) ? Number(query.ct) : null;
    const cj = targetPlayers.some((pl) => pl.id === Number(query.cj)) ? Number(query.cj) : null;
    const type = Object.hasOwn(TYPES, query.type) ? query.type : '';
    const search = String(query.q || '').trim().slice(0, 40);
    const coords = /^(\d{1,4})\|(\d{1,4})$/.exec(search);
    const matches = (x) => (!k || continent(x.Village.x, x.Village.y) === k)
      && (!ct || (ownerOf(x) && ownerOf(x).tribeId === ct))
      && (!cj || x.Village.playerId === cj)
      && (!type || typeOf(x) === type)
      && (!search || (coords ? x.Village.x === Number(coords[1]) && x.Village.y === Number(coords[2]) : x.Village.name.toLowerCase().includes(search.toLowerCase())));
    const j = participants.some((e) => e.player.id === Number(query.j)) ? Number(query.j) : null;
    const sort = SORTS.includes(query.tri) ? query.tri : '';
    const dir = ['asc', 'desc'].includes(query.ordre) ? query.ordre : (SORT_DIRS[sort] || 'asc');
    let view = VIEWS.includes(query.vue) ? query.vue : (manager ? 'all' : stats.mine ? 'mine' : 'open');
    if (view === 'player' && !j) view = 'all';
    const inK = targets.filter(matches);
    const counts = {
      mine: inK.reduce((n, x) => n + liveClaims(x).filter((c) => c.playerId === player.id).length, 0),
      open: new Set(inK.filter((x) => claimedOf(x) < x.count).map((x) => x.villageId)).size,
      all: new Set(inK.map((x) => x.villageId)).size,
    };

    const out = {
      player, manager, op, organizer, tribes: op.targetTribeIds.map((id) => tribes.get(id)).filter(Boolean),
      stats, participants, continents, targetPlayers, targetTribes, types: TYPES, sortDirs: SORT_DIRS,
      filter: { view, k, j, sort, dir, ct, cj, type, q: search }, counts, candidates: null, templates: [],
    };
    if (view === 'mine' || view === 'player') {
      // Feuille de route : une ligne par attaque revendiquée, dans l'ordre des arrivées.
      const who = view === 'mine' ? player.id : j;
      const slots = inK.flatMap((x) => liveClaims(x).filter((c) => c.playerId === who).map((c) => ({ target: x, x, slot: c.slot, claim: c, at: slotTime(x, c.slot), time: slotTime(x, c.slot) })));
      out.slots = pageOf(sort ? sortRows(slots, sort, dir) : slots.sort(byTime), query.page);
    } else {
      const list = view === 'open' ? inK.filter((x) => claimedOf(x) < x.count) : inK;
      const sorted = sort ? sortRows(list.map((x) => ({ x, time: x.arrivalAt })), sort, dir).map((r) => r.x) : list;
      out.targets = pageOf(sorted, query.page);
    }

    if (manager) {
      const all = op.targetTribeIds.length ? await Village.findAll({
        attributes: ['id', 'name', 'x', 'y', 'points', 'playerId'],
        include: [{ model: Player, required: true, attributes: ['id', 'name', 'tribeId'], where: { tribeId: { [Op.in]: op.targetTribeIds } }, include: [{ model: Tribe, attributes: ['id', 'tag'] }] }],
        order: [['y', 'ASC'], ['x', 'ASC']],
      }) : [];
      const ks = [...new Set(all.map((v) => continent(v.x, v.y)))].sort();
      const players = [...new Map(all.map((v) => [v.Player.id, v.Player])).values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      const filter = { k: ks.includes(query.ak) ? query.ak : '', p: players.some((x) => x.id === Number(query.ap)) ? Number(query.ap) : '' };
      const taken = new Set(targets.map((x) => x.villageId));
      out.candidates = {
        continents: ks, players, filter,
        villages: all.filter((v) => (!filter.k || continent(v.x, v.y) === filter.k) && (!filter.p || v.playerId === filter.p)).map((v) => ({ village: v, taken: taken.has(v.id) })),
      };
      out.templates = await ArmyTemplate.findAll({ where: { playerId: player.id }, order: [['name', 'ASC']] });
    }
    return out;
  }

  static async create(organizerId, fields) {
    const player = await organizerOf(organizerId);
    const clean = cleanFields(fields);
    const targetTribeIds = await tribesByTags(player, fields.tags);
    if (await TribeOperation.count({ where: { tribeId: player.tribeId } }) >= MAX_OPERATIONS) throw new GameError(`${MAX_OPERATIONS} opérations au maximum : supprime d'abord une opération terminée.`);
    return TribeOperation.create({ tribeId: player.tribeId, playerId: player.id, ...clean, targetTribeIds });
  }

  static async update(organizerId, operationId, fields) {
    const player = await organizerOf(organizerId);
    const op = await operationOf(player, operationId);
    return op.update({ ...cleanFields(fields), targetTribeIds: await tribesByTags(player, fields.tags) });
  }

  static async remove(organizerId, operationId) {
    const player = await organizerOf(organizerId);
    const op = await operationOf(player, operationId);
    await TribeOperation.sequelize.transaction((t) => destroyOperations([op.id], t));
    return op;
  }

  /**
   * Ajouter des cibles : villages cochés (`ids`) et coordonnées saisies (`coords`, « 415|410 416|411 »). Pour chaque
   * village, selon `mode` :
   * - 'same' (défaut) : une demande de `count` attaques aux mêmes troupes (saisies ou d'un modèle), la première à
   *   l'heure d'arrivée, les suivantes `spacing` secondes plus tard l'une après l'autre ;
   * - 'each' : `count` demandes d'une attaque, chacune avec ses troupes (champs `a<i>_<unité>` ou modèle
   *   `a<i>_template`), aux mêmes heures décalées.
   * Un village peut recevoir plusieurs demandes (vagues) ; seul un doublon exact (même heure, mêmes troupes) est
   * ignoré. Renvoie { added (villages), requests (demandes créées), skipped (villages déjà demandés à l'identique) }.
   */
  static async addTargets(organizerId, operationId, input, cfg) {
    const player = await organizerOf(organizerId);
    const op = await operationOf(player, operationId);
    const each = input.mode === 'each';
    const count = filled(input.count) ? cleanCount(input.count) : 1;
    if (each && count > MAX_EACH) throw new GameError(`Un modèle par attaque : ${MAX_EACH} attaques au maximum.`);
    const arrivalAt = parseArrival(input.arrival);
    const spacing = count > 1 ? cleanSpacing(input.spacing) : 0;
    const note = cleanTargetNote(input.note);
    const at = (i) => (arrivalAt ? new Date(arrivalAt.getTime() + i * spacing * 1000) : null);
    const requests = [];
    if (each) {
      for (let i = 0; i < count; i++) {
        const prefix = `a${i}_`;
        const own = Object.fromEntries(Object.entries(input).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
        const units = await unitsOf(player, own, cfg);
        if (!Object.keys(units).length) throw new GameError(`Attaque ${i + 1} : saisis des troupes ou choisis un modèle.`);
        requests.push({ count: 1, units, spacing: 0, arrivalAt: at(i) });
      }
    } else {
      requests.push({ count, units: await unitsOf(player, input, cfg), spacing, arrivalAt });
    }

    const ids = [].concat(input.ids || []).map(Number).filter(Number.isInteger);
    const coords = [...String(input.coords || '').matchAll(/(\d{1,4})\|(\d{1,4})/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const byId = ids.length ? await Village.findAll({ where: { id: { [Op.in]: ids }, worldId: player.worldId }, attributes: ['id'] }) : [];
    const byCoords = coords.length ? await Village.findAll({ where: { worldId: player.worldId, [Op.or]: coords.map(([x, y]) => ({ x, y })) }, attributes: ['id', 'x', 'y'] }) : [];
    const missing = coords.filter(([x, y]) => !byCoords.some((v) => v.x === x && v.y === y));
    if (missing.length) throw new GameError(`Aucun village en ${missing.map(([x, y]) => `${x}|${y}`).join(', ')}.`);
    const villages = [...new Set([...ids.filter((id) => byId.some((v) => v.id === id)), ...coords.map(([x, y]) => byCoords.find((v) => v.x === x && v.y === y).id)])];
    if (!villages.length) throw new GameError('Coche des villages ou saisis des coordonnées.');

    // Doublons exacts (double clic, même ajout relancé) : même village, même heure, mêmes troupes.
    const keyOf = (villageId, r) => `${villageId}|${r.arrivalAt ? new Date(r.arrivalAt).getTime() : ''}|${JSON.stringify(r.units)}`;
    const existing = await TribeOperationTarget.findAll({ where: { operationId: op.id }, attributes: ['villageId', 'arrivalAt', 'units'] });
    const seen = new Set(existing.map((x) => keyOf(x.villageId, x)));
    const rows = [];
    const touched = new Set();
    for (const villageId of villages) {
      for (const r of requests) {
        if (seen.has(keyOf(villageId, r))) continue;
        rows.push({ operationId: op.id, villageId, note, ...r });
        touched.add(villageId);
      }
    }
    if (existing.length + rows.length > MAX_TARGETS) throw new GameError(`${MAX_TARGETS} demandes au maximum par opération.`);
    await TribeOperationTarget.bulkCreate(rows);
    return { added: touched.size, requests: rows.length, skipped: villages.length - touched.size };
  }

  /**
   * Modifier les cibles cochées : seuls les champs remplis changent (nombre d'attaques, troupes, heure d'arrivée,
   * écart, remarque) ; `clearArrival` retire l'heure. Moins d'attaques demandées : les places en trop sont libérées.
   */
  static async updateTargets(organizerId, operationId, input, cfg) {
    const player = await organizerOf(organizerId);
    const op = await operationOf(player, operationId);
    const ids = [].concat(input.ids || []).map(Number);
    const targets = await TribeOperationTarget.findAll({ where: { operationId: op.id, id: { [Op.in]: ids } } });
    if (!targets.length) throw new GameError('Coche au moins une cible.');
    const changes = {};
    if (filled(input.count)) changes.count = cleanCount(input.count);
    const units = await unitsOf(player, input, cfg);
    if (Object.keys(units).length) changes.units = units;
    if (filled(input.note)) changes.note = cleanTargetNote(input.note);
    if (filled(input.spacing)) changes.spacing = cleanSpacing(input.spacing);
    const arrival = parseArrival(input.arrival);
    if (arrival) changes.arrivalAt = arrival;
    else if (input.clearArrival) changes.arrivalAt = null;
    await TribeOperation.sequelize.transaction(async (t) => {
      await TribeOperationTarget.update(changes, { where: { id: { [Op.in]: targets.map((x) => x.id) } }, transaction: t });
      if (changes.count) {
        for (const x of targets) await TribeOperationClaim.destroy({ where: { targetId: x.id, slot: { [Op.gte]: changes.count } }, transaction: t });
      }
    });
    return targets.length;
  }

  static async removeTargets(organizerId, operationId, ids) {
    const player = await organizerOf(organizerId);
    const op = await operationOf(player, operationId);
    const list = [].concat(ids || []).map(Number);
    const targets = await TribeOperationTarget.findAll({ where: { operationId: op.id, id: { [Op.in]: list } }, attributes: ['id'] });
    if (!targets.length) throw new GameError('Coche au moins une cible.');
    await TribeOperation.sequelize.transaction(async (t) => {
      await TribeOperationClaim.destroy({ where: { targetId: { [Op.in]: targets.map((x) => x.id) } }, transaction: t });
      await TribeOperationTarget.destroy({ where: { id: { [Op.in]: targets.map((x) => x.id) } }, transaction: t });
    });
    return targets.length;
  }

  // ---------------------------------------------------------------- Revendications (tous les membres)

  static async targetOf(player, targetId, t) {
    const target = await TribeOperationTarget.findByPk(Number(targetId), {
      include: [{ model: TribeOperation, as: 'operation' }, { model: TribeOperationClaim, as: 'claims' }], transaction: t,
    });
    if (!target || target.operation.tribeId !== player.tribeId) throw new GameError('Cible introuvable.', 404);
    return target;
  }

  /**
   * Revendiquer `n` attaques (1 par défaut, 'all' : toutes celles qui restent) sur une cible : le joueur prend les
   * premières places libres, ou la place `slot` si elle est donnée (et libre). Renvoie { target, slots }.
   */
  static async claim(playerId, targetId, n = 1, slot = null) {
    const player = await memberOf(playerId);
    return TribeOperation.sequelize.transaction(async (t) => {
      const target = await OperationService.targetOf(player, targetId, t);
      const used = new Set(liveClaims(target).map((c) => c.slot));
      const free = [...Array(target.count).keys()].filter((i) => !used.has(i));
      if (!free.length) throw new GameError('Toutes les attaques demandées sur ce village sont déjà revendiquées.');
      if (filled(slot) && !free.includes(Number(slot))) throw new GameError('Cette attaque est déjà revendiquée.');
      const take = filled(slot) ? [Number(slot)] : n === 'all' ? free : free.slice(0, Math.max(1, Math.min(free.length, Math.floor(Number(n)) || 1)));
      // Places au-delà du nombre demandé (après une baisse) : libérées avant d'être reprises.
      await TribeOperationClaim.destroy({ where: { targetId: target.id, slot: { [Op.in]: take } }, transaction: t });
      await TribeOperationClaim.bulkCreate(take.map((slot) => ({ targetId: target.id, playerId: player.id, slot })), { transaction: t });
      return { target, slots: take };
    });
  }

  /**
   * Libérer une place : la sienne (la dernière prise si `slot` n'est pas donné), ou celle d'un autre membre pour un
   * organisateur.
   */
  static async unclaim(playerId, targetId, slot = null) {
    const player = await memberOf(playerId);
    const target = await OperationService.targetOf(player, targetId);
    let claim;
    if (filled(slot)) {
      claim = target.claims.find((c) => c.slot === Number(slot));
      if (!claim) throw new GameError("Cette attaque n'est pas revendiquée.");
      if (claim.playerId !== player.id && !TribeService.can(player, 'operations')) throw new GameError("Il faut le droit Opérations pour libérer l'attaque d'un autre membre.", 403);
    } else {
      claim = target.claims.filter((c) => c.playerId === player.id).sort((a, b) => b.slot - a.slot)[0];
      if (!claim) throw new GameError("Tu n'as pas revendiqué d'attaque sur ce village.");
    }
    await claim.destroy();
    return target;
  }

  /**
   * Aperçu d'un village : opérations de la tribu du joueur qui le ciblent, avec leurs places (heure, membre ou libre).
   * [{ op, target, claimed, free, mine, slots: [{ slot, at, claim }] }], opération la plus récente d'abord.
   */
  static async forVillage(playerId, villageId) {
    const player = await Player.findByPk(playerId, { attributes: ['id', 'tribeId', 'tribeRole', 'tribeRights'] });
    if (!player || !player.tribeId) return [];
    const targets = await TribeOperationTarget.findAll({
      where: { villageId: Number(villageId) },
      include: [
        { model: TribeOperation, as: 'operation', required: true, where: { tribeId: player.tribeId } },
        { model: TribeOperationClaim, as: 'claims', include: [{ model: Player, attributes: ['id', 'name'] }] },
      ],
    });
    targets.sort((a, b) => b.operation.createdAt - a.operation.createdAt || b.operation.id - a.operation.id);
    return targets.map((x) => {
      const live = liveClaims(x);
      const slots = [...Array(x.count).keys()].map((slot) => ({ slot, at: slotTime(x, slot), claim: live.find((c) => c.slot === slot) || null }));
      return { op: x.operation, target: x, claimed: live.length, free: x.count - live.length, mine: live.filter((c) => c.playerId === player.id).length, slots };
    });
  }

  /**
   * Libérer plusieurs attaques cochées (`picks` : « idCible:place », une ou plusieurs) : les siennes, ou celles des
   * autres membres pour un organisateur. Renvoie le nombre d'attaques libérées.
   */
  static async release(playerId, picks) {
    const player = await memberOf(playerId);
    const organizer = TribeService.can(player, 'operations');
    const wanted = [].concat(picks || []).map((p) => String(p).split(':').map(Number)).filter(([t, s]) => Number.isInteger(t) && Number.isInteger(s));
    if (!wanted.length) throw new GameError('Coche au moins une attaque à libérer.');
    return TribeOperation.sequelize.transaction(async (t) => {
      let n = 0;
      for (const targetId of new Set(wanted.map(([id]) => id))) {
        const target = await OperationService.targetOf(player, targetId, t);
        for (const [, slot] of wanted.filter(([id]) => id === targetId)) {
          const claim = target.claims.find((c) => c.slot === slot);
          if (!claim) continue;
          if (claim.playerId !== player.id && !organizer) throw new GameError("Il faut le droit Opérations pour libérer l'attaque d'un autre membre.", 403);
          await claim.destroy({ transaction: t });
          n++;
        }
      }
      if (!n) throw new GameError('Aucune de ces attaques n’est revendiquée.');
      return n;
    });
  }

  // ---------------------------------------------------------------- Carte

  /**
   * Cibles des opérations de la tribu du joueur, par village (carte et mini-carte) : Map villageId →
   * [{ name, color, count, claimed, noble, mine, mineAt, arrivalAt }] (opération la plus récente d'abord) ;
   * `mineAt` : heures d'arrivée des attaques revendiquées par le joueur.
   */
  static async mapTargets(player) {
    const out = new Map();
    if (!player || !player.tribeId) return out;
    const targets = await TribeOperationTarget.findAll({
      attributes: ['id', 'villageId', 'count', 'units', 'arrivalAt', 'spacing'],
      include: [
        { model: TribeOperation, as: 'operation', required: true, attributes: ['id', 'name', 'color', 'createdAt'], where: { tribeId: player.tribeId } },
        { model: TribeOperationClaim, as: 'claims', attributes: ['playerId', 'slot'] },
      ],
    });
    targets.sort((a, b) => b.operation.createdAt - a.operation.createdAt || b.operation.id - a.operation.id || byArrival(a, b));
    // Une entrée par opération et par village : ses demandes (vagues) additionnées.
    for (const x of targets) {
      if (!out.has(x.villageId)) out.set(x.villageId, []);
      const list = out.get(x.villageId);
      let entry = list.find((e) => e.id === x.operation.id);
      if (!entry) {
        entry = { id: x.operation.id, name: x.operation.name, color: x.operation.color, count: 0, claimed: 0, noble: false, mine: 0, mineAt: [], arrivalAt: null };
        list.push(entry);
      }
      const mine = liveClaims(x).filter((c) => c.playerId === player.id).sort((a, b) => a.slot - b.slot);
      entry.count += x.count;
      entry.claimed += claimedOf(x);
      entry.noble = entry.noble || isNoble(x);
      entry.mine += mine.length;
      entry.mineAt.push(...mine.map((c) => slotTime(x, c.slot)).filter(Boolean));
      if (x.arrivalAt && (!entry.arrivalAt || x.arrivalAt < entry.arrivalAt)) entry.arrivalAt = x.arrivalAt;
    }
    for (const list of out.values()) for (const e of list) e.mineAt.sort((a, b) => a - b);
    return out;
  }

  /**
   * Résumé des opérations d'un village (entrées de mapTargets) pour sa gommette : couleur de la plus récente, noblage,
   * attaque revendiquée par le joueur, attaques encore à prendre ; nul si aucune opération.
   */
  static summary(list) {
    if (!list || !list.length) return null;
    return {
      color: list[0].color, noble: list.some((o) => o.noble), mine: list.some((o) => o.mine > 0), open: list.some((o) => o.claimed < o.count),
      names: list.map((o) => o.name), claimed: list.reduce((n, o) => n + o.claimed, 0), count: list.reduce((n, o) => n + o.count, 0),
    };
  }

  // ---------------------------------------------------------------- Départs et dissolution

  /** Un membre quitte la tribu : ses revendications tombent. */
  static async leaveTribe(playerId, t) {
    await TribeOperationClaim.destroy({ where: { playerId }, transaction: t });
  }

  static async destroyTribe(tribeId, t) {
    const ids = (await TribeOperation.findAll({ where: { tribeId }, attributes: ['id'], transaction: t })).map((o) => o.id);
    await destroyOperations(ids, t);
  }
}

Object.assign(OperationService, {
  MAX_OPERATIONS, MAX_TARGETS, MAX_COUNT, MAX_EACH, SORTS, TYPES, MAX_SPACING, PAGE_SIZE, DEFAULT_COLOR, cleanUnits, claimedOf, isNoble, slotTime, liveClaims,
});

module.exports = OperationService;
