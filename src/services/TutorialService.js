'use strict';

// Quêtes du tutoriel (réglage `tutorial.active` du monde, quêtes dans game/tutorial.js) : une quête à la fois, dans
// l'ordre. Une quête terminée laisse sa récompense dans les récompenses à récupérer (BuildReward, building 'quest',
// level = numéro de la quête), ce qui la marque aussi comme faite : rien d'autre n'est enregistré.

const { Op } = require('sequelize');
const { BuildReward, BuildOrder, Village, Command, Report, DailyStat, ScavengeRun } = require('../models');
const VillageService = require('./VillageService');
const GameError = require('./GameError');
const registry = require('../game/registry');
const tutorial = require('../game/tutorial');

class TutorialService {
  static enabled(cfg) {
    return Boolean(cfg.tutorial && cfg.tutorial.active);
  }

  /**
   * État du joueur que lisent les objectifs, limité à `needs` (toutes les données si absent) : chaque page lit celles
   * de la quête en cours, une ou deux requêtes en général.
   * - levels / queued : niveau le plus haut de chaque bâtiment dans ses villages, construit / en file de construction ;
   * - armyPop : population de son armée (troupes au village, en route, en soutien ou en collecte) ;
   * - renamed, attacks, reportsRead, plunders, scavenged, tribe.
   */
  static async facts(player, needs = null) {
    const want = (key) => !needs || needs.includes(key);
    const out = {};
    const villages = want('levels') || want('queued') || want('armyPop') || want('renamed') || want('attacks') || want('scavenged')
      ? await Village.findAll({ where: { playerId: player.id }, attributes: ['id', 'name', 'buildings', 'units'] })
      : [];
    const ids = villages.map((v) => v.id);
    const jobs = {
      levels: async () => {
        const levels = {};
        for (const v of villages) for (const [id, lvl] of Object.entries(v.buildings || {})) levels[id] = Math.max(levels[id] || 0, lvl);
        return levels;
      },
      queued: async () => {
        const queued = {};
        const orders = ids.length ? await BuildOrder.findAll({ where: { villageId: { [Op.in]: ids }, demolish: false }, attributes: ['building', 'level'] }) : [];
        for (const o of orders) queued[o.building] = Math.max(queued[o.building] || 0, o.level);
        return queued;
      },
      armyPop: async () => {
        const units = {};
        for (const v of villages) for (const [id, n] of Object.entries(v.units || {})) units[id] = (units[id] || 0) + n;
        const away = await Promise.all(ids.map((id) => VillageService.awayUnits(id)));
        for (const a of away) for (const [id, n] of Object.entries(a)) units[id] = (units[id] || 0) + n;
        let pop = 0;
        for (const [id, n] of Object.entries(units)) {
          const type = registry.UNITS.get(id);
          if (type && !type.stationary) pop += type.pop * n;
        }
        return pop;
      },
      renamed: async () => villages.some((v) => v.name !== `Village de ${player.name}`),
      attacks: async () => (ids.length ? await Command.count({ where: { originVillageId: { [Op.in]: ids }, type: 'attack' } }) : 0)
        + await Report.count({ where: { playerId: player.id, type: 'attack' } }),
      reportsRead: () => Report.count({ where: { playerId: player.id, isRead: true } }),
      plunders: async () => (await DailyStat.sum('plunders', { where: { playerId: player.id } })) || 0,
      scavenged: async () => (ids.length ? await ScavengeRun.count({ where: { villageId: { [Op.in]: ids } } }) : 0)
        + await Report.count({ where: { playerId: player.id, type: 'scavenge' } }) > 0,
      tribe: async () => Boolean(player.tribeId),
    };
    await Promise.all(Object.entries(jobs).filter(([key]) => want(key)).map(async ([key, job]) => { out[key] = await job(); }));
    return out;
  }

  /**
   * Quêtes du monde avec celles déjà faites, la quête en cours et l'état de son objectif.
   * @returns {{ list, done: Set<number>, current, progress, finished: boolean }}
   */
  static async state(player, cfg) {
    const list = tutorial.quests(cfg);
    const rows = await BuildReward.findAll({ where: { playerId: player.id, building: 'quest' }, attributes: ['level'] });
    const done = new Set(rows.map((r) => r.level));
    const current = list.find((q) => !done.has(q.id)) || null;
    const progress = current ? tutorial.progress(current, await TutorialService.facts(player, tutorial.needs(current))) : null;
    return { list, done, current, progress, finished: !current };
  }

  /**
   * Indications de l'en-tête pour la quête en cours (lues à chaque page, toujours à jour) : ce qui doit clignoter tant
   * qu'une condition n'est ni remplie ni en bonne voie (`targets`), ou `ready` quand la quête peut être terminée.
   * `intro` : premier passage sur le monde (quêtes jamais ouvertes, aucune terminée) : une bulle montre le bouton des
   * quêtes, et rien d'autre ne clignote.
   * Pour l'encart de quête des pages concernées : `goals` (conditions et progression), `reward`, rang de la quête
   * (`index` sur `total`) et `pages`, chemins du village où l'encart s'affiche (pages de ses liens et de « Y aller »).
   * @returns {Promise<{ id, title, targets: string[], ready: boolean, intro: boolean, goals, reward, index, total,
   *   pages: string[] }|null>}
   */
  static async hints(player, cfg) {
    if (!TutorialService.enabled(cfg) || player.isBot) return null;
    const { list, current, progress, done } = await TutorialService.state(player, cfg);
    if (!current) return null;
    const intro = !player.tutorialSeenAt && !done.size;
    const targets = intro ? [] : [...new Set(progress.goals.filter((g) => !g.started).flatMap((g) => g.hints))];
    const pages = [...new Set([current.link, ...progress.goals.flatMap((g) => g.hints).filter((h) => h.startsWith('link:')).map((h) => h.slice(5))])];
    return {
      id: current.id, title: current.title, targets, ready: progress.done, intro,
      goals: progress.goals, reward: current.reward, index: list.indexOf(current) + 1, total: list.length, pages,
    };
  }

  /** Quêtes ouvertes ou bulle d'accueil fermée : la bulle ne revient plus. */
  static async markSeen(player, now = new Date()) {
    if (!player.tutorialSeenAt) await player.update({ tutorialSeenAt: now });
  }

  /** Termine la quête en cours (objectif atteint) : sa récompense rejoint les récompenses à récupérer. */
  static async complete(player, cfg, questId, now = new Date()) {
    if (!TutorialService.enabled(cfg)) throw new GameError('Pas de quêtes sur ce monde.', 404);
    const { current, progress } = await TutorialService.state(player, cfg);
    if (!current || current.id !== Number(questId)) throw new GameError('Cette quête est déjà terminée.', 404);
    if (!progress.done) throw new GameError(`Objectif pas encore atteint : ${progress.goals.find((g) => !g.done).label}.`);
    const { wood = 0, stone = 0, iron = 0, units = null } = current.reward;
    // Index unique (joueur, 'quest', numéro) : deux clics simultanés ne donnent qu'une récompense.
    await BuildReward.bulkCreate([{
      playerId: player.id, building: 'quest', level: current.id, wood, stone, iron, units, earnedAt: now,
    }], { ignoreDuplicates: true });
    return current;
  }
}

module.exports = TutorialService;
