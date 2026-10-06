'use strict';

// Attaques entrantes (pages d'un village, montées par ./index.js) : aperçu « Arrivant » de tous les villages du compte,
// avec ses actions groupées (étiqueter, renommer, ignorer), et la page d'un ordre entrant (renommage, note).

const express = require('express');
const IncomingService = require('../../../services/IncomingService');
const incomingLabel = require('../../../game/incomingLabel');
const { Player } = require('../../../models');
const PaginationService = require('../../../services/PaginationService');
const { ah, back, flash } = require('../../middleware');
const GameError = require('../../../services/GameError');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Filtres de l'aperçu lus dans l'adresse (valeurs connues seulement). */
function readFilters(query) {
  return {
    type: Object.keys(IncomingService.TYPES).includes(query.type) ? query.type : 'all',
    ignored: query.ignored === '1',
    q: String(query.q || '').slice(0, 64),
    target: Number.parseInt(query.target, 10) || null,
    origin: Number.parseInt(query.origin, 10) || null,
    player: query.player === 'barb' ? 'barb' : Number.parseInt(query.player, 10) || null,
    sort: IncomingService.SORTS.includes(query.sort) ? query.sort : 'arrival',
    dir: query.dir === 'desc' ? 'desc' : 'asc',
  };
}

/** Adresse de l'aperçu avec ces filtres (patch : filtres changés ; null ou vide les retire). */
function filterHref(vid, filters) {
  return (patch) => {
    const o = { ...filters, ...patch };
    const p = {};
    if (o.type !== 'all') p.type = o.type;
    if (o.ignored) p.ignored = '1';
    if (o.q) p.q = o.q;
    if (o.target) p.target = o.target;
    if (o.origin) p.origin = o.origin;
    if (o.player) p.player = o.player;
    if (o.sort !== 'arrival') p.sort = o.sort;
    if (o.dir !== 'asc') p.dir = o.dir;
    if (o.page && o.page > 1) p.page = o.page;
    const s = new URLSearchParams(p).toString();
    return `/village/${vid}/incomings${s ? '?' + s : ''}`;
  };
}

router.get('/incomings', ah(async (req, res) => {
  const filters = readFilters(req.query);
  const [{ rows: all, counts, totals }, player] = await Promise.all([
    // Groupe actif (menu des groupes) : ordres vers ses villages seulement.
    IncomingService.list(me(req), { ...filters, villages: res.locals.activeGroup ? res.locals.navVillages.map((v) => v.id) : null }, req.ctx.cfg),
    Player.findByPk(me(req), { attributes: ['incomingLabelFormat', 'incomingsPerPage'] }),
  ]);
  // Compteurs seuls (game.js les relit régulièrement et après chaque action) : onglets, liste, ignorés et totaux.
  if (req.query.format === 'counts') {
    const byKey = (list) => Object.fromEntries(list.map((t) => [t.key, t.attacks + t.supports]));
    return res.set('Cache-Control', 'no-store').json({
      counts, total: all.length, totals: { player: byKey(totals.players), origin: byKey(totals.origins), target: byKey(totals.targets) },
    });
  }
  // Pages de l'aperçu (100 ordres par défaut, réglable) : les totaux et repères portent sur tous les ordres.
  const pagination = PaginationService.paginate(all.length, req.query.page, PaginationService.perPage(player, 'incomings'));
  const rows = all.slice(pagination.offset, pagination.offset + pagination.perPage);
  res.render('incomings', {
    page: 'incomings', rows, total: all.length, pagination, counts, totals, filters, qs: filterHref(req.ctx.village.id, filters),
    // Tous les ordres de la page, y compris ceux que le chargement progressif n'a pas encore affichés.
    pageIds: rows.map((r) => r.cmd.id),
    labelFormat: player.incomingLabelFormat || '',
    defaultFormat: incomingLabel.DEFAULT_FORMAT,
    variables: incomingLabel.VARIABLES,
  });
}));

const td = 'border-r border-bronze-900 last:border-r-0';
const wantsJson = (req) => req.get('accept') === 'application/json';

/**
 * Réponse d'une action sur des ordres. Formulaire classique : message et retour à la page. Appel AJAX de l'aperçu
 * (game.js, champ `view` : filtres de la page) : message, lignes à jour de ces ordres (HTML) et ordres sortis de la
 * liste (ignorés, ou qui ne correspondent plus à la recherche), pour mettre la page à jour sans la recharger.
 */
async function respond(req, res, { message, ids, to }) {
  if (!wantsJson(req)) {
    flash(req, 'success', message);
    return res.redirect(to);
  }
  const filters = readFilters(Object.fromEntries(new URLSearchParams(String(req.body.view || ''))));
  const { rows } = await IncomingService.list(me(req), filters, req.ctx.cfg);
  // Seules les lignes déjà affichées (champ `shown`) sont renvoyées : les autres arriveront à jour au défilement.
  const shown = new Set(String(req.body.shown || '').split(',').map(Number).filter(Boolean));
  const wanted = new Set([].concat(ids || []).map(Number).filter((id) => shown.has(id)));
  const kept = rows.filter((r) => wanted.has(r.cmd.id));
  const out = await new Promise((resolve, reject) => res.render('partials/incomings/rows', {
    rows: kept, vid: req.ctx.village.id, qs: filterHref(req.ctx.village.id, filters), td,
  }, (err, text) => (err ? reject(err) : resolve(text))));
  // Une ligne <tr data-row-id="…"> par ordre, dans l'ordre de `kept`.
  const html = {};
  out.split(/(?=<tr\b)/).filter((part) => part.startsWith('<tr')).forEach((part, i) => { html[kept[i].cmd.id] = part.trim(); });
  const keptIds = new Set(kept.map((r) => r.cmd.id));
  return res.json({ message, rows: html, removed: [...wanted].filter((id) => !keptIds.has(id)) });
}

// Actions groupées de l'aperçu : action label | ignore | unignore | support sur les cases cochées (ids).
router.post('/incomings', ah(async (req, res) => {
  const ids = req.body.ids;
  const to = back(req, `${base(req)}/incomings`);
  const action = req.body.action;
  if (action === 'support') {
    const list = [].concat(ids || []).map(Number).filter((n) => n > 0);
    if (!list.length) {
      flash(req, 'error', 'Sélectionnez au moins une attaque.');
      return res.redirect(to);
    }
    return res.redirect(`${base(req)}/incomings/support?ids=${list.join(',')}`);
  }
  if (action === 'label') {
    const n = await IncomingService.label(me(req), ids, req.ctx.cfg, req.ctx.now);
    return respond(req, res, { message: `${plural(n, 'ordre étiqueté', 'ordres étiquetés')}.`, ids, to });
  }
  if (action === 'ignore' || action === 'unignore') {
    const n = await IncomingService.setIgnored(me(req), ids, action === 'ignore');
    return respond(req, res, { message: `${plural(n, 'ordre', 'ordres')} ${action === 'ignore' ? (n > 1 ? 'ignorés' : 'ignoré') : (n > 1 ? 'de nouveau affichés' : 'de nouveau affiché')}.`, ids, to });
  }
  throw new GameError('Action inconnue.');
}));

// Compteurs de l'en-tête, relus toutes les 20 s par game.js : attaques en approche (compteur, titre de l'onglet, son
// d'une nouvelle attaque), rapports non lus (par type, pour le menu Rapports) et messages non lus.
router.get('/alerts', ah(async (req, res) => {
  const [attacks, reports, messages] = await Promise.all([
    IncomingService.alertState(me(req)),
    require('../../../services/ReportService').unreadByFilter(me(req)),
    require('../../../services/MessageService').unreadCount(me(req)),
  ]);
  res.set('Cache-Control', 'no-store').json({ ...attacks, reports, messages });
}));

// Demande de soutien : texte proposé (modifiable) pour les attaques choisies, puis message à toute la tribu.
const supportIds = (raw) => String(raw || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
router.get('/incomings/support', ah(async (req, res) => {
  const ids = supportIds(req.query.ids);
  const draft = await IncomingService.supportDraft(me(req), ids, { now: req.ctx.now, when: require('../../helpers').when });
  res.render('incoming-support', { page: 'incomings', ids, ...draft, inTribe: Boolean(res.locals.player && res.locals.player.tribeId) });
}));

router.post('/incomings/support', ah(async (req, res) => {
  const conv = await IncomingService.requestSupport(me(req), { subject: req.body.subject, body: req.body.body });
  flash(req, 'success', 'Demande de soutien envoyée à la tribu.');
  res.redirect(`${base(req)}/messages/${conv.id}`);
}));

router.post('/incomings/format', ah(async (req, res) => {
  await IncomingService.setFormat(me(req), req.body.format);
  flash(req, 'success', 'Format des étiquettes enregistré.');
  res.redirect(back(req, `${base(req)}/incomings`));
}));

router.get('/incomings/:commandId', ah(async (req, res) => {
  let detail;
  try {
    detail = await IncomingService.detail(me(req), req.params.commandId, req.ctx.cfg, req.ctx.now);
  } catch (err) {
    if (err.status !== 404) throw err;
    // Ordre arrivé entre-temps (compte à rebours à zéro) : retour à l'aperçu.
    flash(req, 'info', 'Cet ordre est arrivé ou n’existe plus.');
    return res.redirect(`${base(req)}/incomings`);
  }
  res.render('incoming', { page: 'incomings', ...detail });
}));

router.post('/incomings/:commandId/rename', ah(async (req, res) => {
  // « Étiqueter » sur la page de l'ordre : le nom actuel est remplacé par l'étiquette.
  if (req.body.action === 'label') {
    await IncomingService.label(me(req), [req.params.commandId], req.ctx.cfg, req.ctx.now);
  } else {
    await IncomingService.rename(me(req), [req.params.commandId], req.body.name);
  }
  // Crayon de l'aperçu Arrivant : la ligne est remplacée sur place (AJAX), ou retour à la liste avec ses filtres.
  const detail = `${base(req)}/incomings/${req.params.commandId}`;
  return respond(req, res, { message: 'Ordre renommé.', ids: [req.params.commandId], to: req.body.back === '1' ? back(req, detail) : detail });
}));

router.post('/incomings/:commandId/note', ah(async (req, res) => {
  await IncomingService.setNote(me(req), req.params.commandId, req.body.note);
  flash(req, 'success', req.body.note && req.body.note.trim() ? 'Note enregistrée.' : 'Note supprimée.');
  res.redirect(`${base(req)}/incomings/${req.params.commandId}`);
}));

router.post('/incomings/:commandId/ignore', ah(async (req, res) => {
  const ignore = req.body.ignored === '1';
  await IncomingService.setIgnored(me(req), [req.params.commandId], ignore);
  flash(req, 'success', ignore ? 'Ordre ignoré.' : 'Ordre de nouveau affiché.');
  res.redirect(`${base(req)}/incomings/${req.params.commandId}`);
}));

module.exports = router;
