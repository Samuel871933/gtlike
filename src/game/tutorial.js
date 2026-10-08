'use strict';

// Quêtes du tutoriel (réglage `tutorial.active` du monde), inspirées des quêtes de Guerre Tribale : une suite guidée,
// une quête à la fois, dans l'ordre. Chaque objectif se lit sur l'état du joueur (`facts`, voir TutorialService.facts),
// pas sur ses actions : une quête dont l'objectif est déjà atteint se termine d'un clic. La récompense (ressources ou
// troupes) rejoint les récompenses à récupérer.
//
// `id` : numéro fixe d'une quête (gardé en base avec la récompense), jamais réutilisé ; l'ordre est celui de la liste.
// `available(cfg)` : quête absente des mondes sans la fonctionnalité (collecte…).
// `art` : source de l'illustration de la quête (public/img/quests/<id>.webp, générée par
// scripts/generate-quest-art.js) : { building, level } ou { buildings: [[id, niveau]…] } (sprites du village), ou
// { src } (scène). `goals` : conditions, toutes à remplir, chacune avec son image ({ building, level }, { unit } ou
// { icon }), sa valeur lue dans `facts`, le seuil visé (barre de progression) et ses `hints` : ce qui clignote dans
// le jeu tant qu'elle n'est pas remplie (game.js) : 'link:<chemin>' pour les liens vers cette page du village
// ('link:' : l'aperçu), sinon un sélecteur CSS d'un bouton ou d'une ligne des pages concernées.

const res = (n) => ({ wood: n, stone: n, iron: n });
// Objectif « bâtiment au niveau n », illustré par son sprite.
// Un niveau déjà en file de construction (`queued`) éteint les indications : il n'y a plus rien à cliquer, mais la
// quête n'est terminée qu'une fois le niveau construit.
const building = (id, need, label) => ({
  label, img: { building: id, level: need }, needs: ['levels', 'queued'], value: (f) => f.levels[id] || 0, need,
  started: (f) => (f.queued[id] || 0) >= need,
  hints: ['link:main', `[data-build-row="${id}"]`, `[data-build-row="${id}"] [data-build-submit]`],
});
const flag = (label, img, key, hints) => ({ label, img, needs: [key], value: (f) => (f[key] ? 1 : 0), need: 1, hints });
// Objectif chiffré lu dans `facts[key]`.
const counter = (label, img, key, need, hints) => ({ label, img, needs: [key], value: (f) => f[key], need, hints });

const QUESTS = [
  {
    id: 1, title: 'Les premières ressources', link: 'main', art: { buildings: [['wood', 1], ['stone', 1], ['iron', 1]] },
    text: 'Tout commence par le bois, l’argile et le fer. Construis un camp de bois, une carrière d’argile et une mine de fer au quartier général : ils produisent en continu, même quand tu n’es pas là.',
    goals: [building('wood', 1, 'Camp de bois niveau 1'), building('stone', 1, 'Carrière d’argile niveau 1'), building('iron', 1, 'Mine de fer niveau 1')],
    reward: res(200),
  },
  {
    id: 2, title: 'Le cœur du village', link: 'main', art: { building: 'main', level: 3 },
    text: 'Le quartier général dirige les ouvriers : plus il est haut, plus les constructions vont vite, et certains bâtiments l’exigent.',
    goals: [building('main', 3, 'Quartier général niveau 3')],
    reward: res(300),
  },
  {
    id: 3, title: 'Un nom pour ton village', link: '', art: { src: '/img/reports/world.png' },
    text: 'Donne un nom à ton village : sur son aperçu, clique le crayon à côté de son nom. Tes voisins le verront sur la carte.',
    goals: [flag('Renommer un village', { icon: 'edit' }, 'renamed', ['link:', '[data-rename-open]'])],
    reward: res(100),
  },
  {
    id: 4, title: 'Stocker et loger', link: 'main', art: { buildings: [['storage', 3], ['farm', 3]] },
    text: 'L’entrepôt limite ce que tu peux stocker de chaque ressource ; la ferme limite la population de tes bâtiments et de tes troupes. Fais-les grandir avec ta production.',
    goals: [building('storage', 3, 'Entrepôt niveau 3'), building('farm', 3, 'Ferme niveau 3')],
    reward: res(300),
  },
  {
    id: 5, title: 'Aux armes', link: 'main', art: { building: 'barracks', level: 2 },
    text: 'La caserne forme l’infanterie : les lanciers défendent bien contre la cavalerie, les porte-épées contre l’infanterie.',
    goals: [building('barracks', 2, 'Caserne niveau 2')],
    reward: { units: { spear: 10, sword: 10 } },
  },
  {
    id: 6, title: 'Une première armée', link: 'recruit/barracks', art: { src: '/img/reports/support.png' },
    text: 'Recrute des troupes à la caserne. Chaque unité occupe de la place à la ferme : c’est la population de ton armée.',
    goals: [counter('Une armée de 40 habitants', { unit: 'spear' }, 'armyPop', 40, ['link:recruit/barracks', '[data-recruit-submit]'])],
    reward: res(300),
  },
  {
    id: 7, title: 'Des revenus en plus', link: 'map', art: { src: '/img/reports/victory.png' },
    text: 'Les villages barbares n’ont pas de propriétaire et se défendent peu. Sur la carte, clique un village barbare et attaque-le depuis le point de ralliement : tes troupes rapportent ce qu’elles pillent.',
    goals: [counter('Attaquer un village', { unit: 'axe' }, 'attacks', 1, ['link:map', 'link:place', '[data-attack-submit]'])],
    reward: res(200),
  },
  {
    id: 8, title: 'Le rapport de combat', link: 'reports', art: { src: '/img/reports/espionage.png' },
    text: 'Chaque attaque laisse un rapport : pertes des deux côtés, butin rapporté, et ce que tes éclaireurs ont vu. Lis-en un.',
    goals: [counter('Lire un rapport', { unit: 'spy' }, 'reportsRead', 1, ['link:reports', '[data-report-unread]'])],
    reward: res(100),
  },
  {
    id: 9, title: 'Pillage', link: 'farm', art: { src: '/img/reports/visit.png' },
    text: 'Pille régulièrement les barbares autour de toi. L’assistant de pillage envoie la même petite armée sur plusieurs villages en quelques clics.',
    goals: [counter('Piller 5 villages', { src: '/img/reports/haul-full.png' }, 'plunders', 5, ['link:place', 'link:farm', '[data-farm-send] button'])],
    reward: res(500),
  },
  {
    id: 10, title: 'La collecte', link: 'scavenge', art: { src: '/img/reports/scavenge.png' }, available: (cfg) => cfg.scavenging.active,
    text: 'Les troupes qui ne se battent pas peuvent ramasser des ressources autour du village, sans aucun risque. Lance une collecte depuis le point de ralliement.',
    goals: [flag('Lancer une collecte', { icon: 'troops' }, 'scavenged', ['link:place', 'link:scavenge', '[data-scavenge-send]'])],
    reward: res(300),
  },
  {
    id: 11, title: 'La forge', link: 'main', art: { building: 'smith', level: 1 },
    text: 'La forge recherche les nouvelles unités, comme le guerrier à la hache, l’unité d’attaque de l’infanterie.',
    goals: [building('smith', 1, 'Forge niveau 1')],
    reward: res(400),
  },
  {
    id: 12, title: 'Le commerce', link: 'main', art: { src: '/img/reports/trade.png' },
    text: 'Au marché, échange les ressources que tu as en trop contre celles qui te manquent, ou envoie-les à tes autres villages et à ta tribu.',
    goals: [building('market', 1, 'Marché niveau 1')],
    reward: res(400),
  },
  {
    id: 13, title: 'Une armée qui compte', link: 'recruit/barracks', art: { building: 'barracks', level: 10 },
    text: 'Continue de recruter : une armée plus grande pille plus et décourage tes voisins.',
    goals: [counter('Une armée de 150 habitants', { unit: 'sword' }, 'armyPop', 150, ['link:recruit/barracks', '[data-recruit-submit]'])],
    reward: { units: { spear: 20, sword: 20 } },
  },
  {
    id: 14, title: 'L’union fait la force', link: 'tribe', art: { src: '/img/reports/award.png' },
    text: 'Seul, on ne tient pas longtemps. Rejoins une tribu qui t’invite, ou fonde la tienne depuis la page Tribu.',
    goals: [flag('Être membre d’une tribu', { icon: 'tribe' }, 'tribe', ['link:tribe', '[data-tribe-join]'])],
    reward: res(500),
  },
  {
    id: 15, title: 'Un village solide', link: 'main', art: { building: 'main', level: 10 },
    text: 'Dernière étape du tutoriel : un quartier général niveau 10 ouvre la voie à l’écurie, à l’atelier et, plus tard, à l’académie et à la conquête.',
    goals: [building('main', 10, 'Quartier général niveau 10')],
    reward: res(1000),
  },
];

/**
 * Objectifs d'une quête lus sur `facts` : { done, goals: [{ label, img, hints, have, need, done, started }] }
 * (`started` : rempli, ou en bonne voie, comme un niveau en construction).
 */
function progress(quest, facts) {
  const goals = quest.goals.map((g) => {
    const have = Math.min(g.value(facts), g.need);
    const done = have >= g.need;
    return { label: g.label, img: g.img, hints: g.hints || [], have, need: g.need, done, started: done || Boolean(g.started && g.started(facts)) };
  });
  return { done: goals.every((g) => g.done), goals };
}

/** Quêtes du monde, dans l'ordre (celles qu'il ne propose pas sont retirées). */
function quests(cfg) {
  return QUESTS.filter((q) => !q.available || q.available(cfg));
}

/** Données de `facts` que lisent les objectifs d'une quête (TutorialService.facts ne lit que celles-là). */
function needs(quest) {
  return [...new Set(quest.goals.flatMap((g) => g.needs || []))];
}

module.exports = { QUESTS, quests, progress, needs };
