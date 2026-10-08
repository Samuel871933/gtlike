'use strict';

// Quêtes et récompenses (comme le livre des quêtes de Guerre Tribale), deux onglets d'une même page :
// - Quêtes : le tutoriel (services/TutorialService), une quête à la fois, terminée d'un clic une fois l'objectif atteint ;
// - Récompenses : celles des quêtes et des constructions (services/BuildRewardService), récupérées dans le village
//   courant une à une ou toutes ensemble.
// Pages d'un village, montées par ./index.js.

const express = require('express');
const BuildRewardService = require('../../../services/BuildRewardService');
const TutorialService = require('../../../services/TutorialService');
const GameError = require('../../../services/GameError');
const { ah, back, flash } = require('../../middleware');
const { base, me, currentPlayer } = require('./shared');

const router = express.Router({ mergeParams: true });

router.get('/rewards', ah(async (req, res) => {
  const { world, cfg, now } = req.ctx;
  const player = currentPlayer(res);
  const quests = TutorialService.enabled(cfg);
  const [rewards, collected, tutorial] = await Promise.all([
    BuildRewardService.pending(me(req)), BuildRewardService.collectedCount(me(req)),
    quests ? TutorialService.state(player, cfg) : null,
  ]);
  if (!quests && !cfg.buildRewards.active && !rewards.length) throw new GameError('Pas de quêtes ni de récompenses sur ce monde.', 404);
  // Onglet par défaut : les quêtes tant que le tutoriel n'est pas fini et qu'aucune récompense n'attend.
  const tab = ['quests', 'rewards'].includes(req.query.tab) ? req.query.tab
    : tutorial && !tutorial.finished && !rewards.length ? 'quests' : 'rewards';
  const shown = tab === 'quests' && !tutorial ? 'rewards' : tab;
  // Quêtes ouvertes par le titulaire : la bulle d'accueil de l'en-tête disparaît (déjà calculée pour cette page).
  if (shown === 'quests' && !req.asSitter) {
    await TutorialService.markSeen(player, now);
    if (res.locals.questHints) res.locals.questHints = { ...res.locals.questHints, intro: false };
  }
  res.render('rewards', {
    page: 'rewards', tab: shown, rewards, collected, tutorial,
    rewardsOpen: BuildRewardService.active(cfg, world, now), rewardsEnd: BuildRewardService.endsAt(cfg, world),
  });
}));

// Bulle d'accueil fermée sans ouvrir les quêtes.
router.post('/quests/intro/dismiss', ah(async (req, res) => {
  if (!req.asSitter) await TutorialService.markSeen(currentPlayer(res));
  res.redirect(back(req, base(req)));
}));

router.post('/quests/:questId/complete', ah(async (req, res) => {
  const quest = await TutorialService.complete(currentPlayer(res), req.ctx.cfg, req.params.questId);
  flash(req, 'success', `Quête « ${quest.title} » terminée : sa récompense t’attend dans les récompenses.`);
  res.redirect(`${base(req)}/rewards?tab=quests`);
}));

router.post('/rewards/collect', ah(async (req, res) => {
  const ids = req.body.id ? [Number(req.body.id)] : null;
  const { collected, left } = await BuildRewardService.collect(me(req), req.ctx.village.id, ids);
  const what = collected > 1 ? `${collected} récompenses récupérées` : 'Récompense récupérée';
  flash(req, left ? 'error' : 'success', left ? `${what} ; ${left} attendent de la place (entrepôt ou ferme).` : `${what}.`);
  res.redirect(`${base(req)}/rewards?tab=rewards`);
}));

module.exports = router;
