'use strict';

// Réglages d'un serveur privé, décrits une seule fois : le formulaire de création (views/server-new.ejs) est généré
// à partir de cette liste et la saisie est validée par `parse`. Chaque réglage vise un chemin de la configuration du
// monde (WorldConfig) ; sa valeur par défaut est celle de WorldConfig.DEFAULTS.
//   type 'number' : min, max, step ; `scale` convertit la saisie en valeur stockée (minutes → secondes, % → fraction),
//                   `offset` s'y ajoute (surcoût de 25 % → facteur 1,25)
//   type 'bool'   : case à cocher
//   type 'select' : options [[valeur, libellé]]
// Fin du monde : domination ou Guerres runiques (points et villages, Grand Siège : pas proposés).
// Un monde créé est immuable : ces réglages ne servent qu'à la création (voir le hook beforeUpdate de World).

const WorldConfig = require('./WorldConfig');
const { MODES } = require('../modes/catalog');

// `intro` : texte sous le titre du groupe ; `hint` : effet de l'option, affiché sous son libellé.
const GROUPS = [
  { title: 'Mode de jeu', intro: 'Le mode habille le monde et peut ajouter quelques règles ; le moteur, les bâtiments, les unités et tous les réglages ci-dessous restent ceux du jeu.', settings: [
    { key: 'mode', label: 'Mode', type: 'select', options: Object.values(MODES).map((m) => [m.id, m.name]), hint: Object.values(MODES).map((m) => `${m.name} : ${m.description}`).join(' ') },
  ] },
  { title: 'Vitesse et carte', intro: 'Le rythme de la partie. Les mondes classiques de Guerre Tribale tournent à ×1 ; les mondes « speed » se jouent en quelques jours à ×100 et plus.', settings: [
    { key: 'speed', label: 'Vitesse du monde', type: 'number', min: 0.5, max: 1000, step: 0.5, hint: 'Multiplie la production, et divise la durée des constructions, du recrutement et des recherches.' },
    { key: 'unitSpeed', label: 'Vitesse des unités', type: 'number', min: 0.5, max: 10, step: 0.5, hint: 'Multiplie la vitesse de déplacement des troupes et des marchands, en plus de la vitesse du monde.' },
    { key: 'mapSize', label: 'Taille de la carte', type: 'select', options: [[200, '200 × 200'], [500, '500 × 500'], [1000, '1000 × 1000']], hint: 'Taille maximale : le monde se peuple depuis le centre au fil des inscriptions, la carte ne sert que de limite (toujours 1000 × 1000 sur Guerre Tribale). Ce qui rapproche les joueurs, c’est le nombre d’inscrits.' },
    { key: 'newbieDays', label: 'Protection des débutants (jours)', type: 'number', min: 0, max: 14, step: 1, hint: 'Pendant ce temps après son inscription, un joueur ne peut pas être attaqué par les autres joueurs.' },
    { key: 'buildQueueSlots', label: 'Emplacements de la file de construction', type: 'number', min: 1, max: 5, step: 1, hint: 'Nombre de constructions qu’on peut mettre en file au quartier général.' },
    { key: 'premium.buildQueueBonus', label: 'Emplacements en plus avec le premium', type: 'number', min: 0, max: 10, step: 1, hint: 'Constructions en plus dans la file, au prix normal, pour les joueurs premium (3 sur Guerre Tribale).' },
    { key: 'premium.maxQueue', label: 'File maximale avec le premium', type: 'number', min: 1, max: 50, step: 1, hint: 'Au-delà des emplacements au prix normal, un joueur premium peut encore ajouter des constructions jusqu’à ce total, de plus en plus chères.' },
    { key: 'premium.extraOrderFactor', label: 'Surcoût par construction en plus (%)', type: 'number', min: 0, max: 100, step: 5, scale: 0.01, offset: 1, hint: 'Chaque construction au-delà des emplacements au prix normal coûte ce pourcentage de plus que la précédente (25 % sur Guerre Tribale : +25 %, +56 %, +95 %…).' },
  ] },
  { title: 'Quêtes et récompenses', intro: 'Comme sur Guerre Tribale : un tutoriel de quêtes guide les nouveaux joueurs, et au début du monde chaque niveau de bâtiment construit pour la première fois rend une part de son coût. Tout se récupère dans les récompenses.', settings: [
    { key: 'tutorial.active', label: 'Quêtes du tutoriel', type: 'bool', hint: 'Une quinzaine de quêtes pour apprendre le jeu (économie, armée, pillage, tribu), récompensées en ressources et en troupes.' },
    { key: 'buildRewards.active', label: 'Récompenses de construction', type: 'bool', hint: 'Chaque niveau de bâtiment construit pour la première fois rend une part de son coût. Un même niveau ne rapporte qu’une fois par joueur, même construit dans un autre village.' },
    { key: 'buildRewards.percent', label: 'Part du coût rendue (%)', type: 'number', min: 1, max: 100, step: 1, scale: 0.01, hint: 'Pourcentage du coût de chaque ressource rendu à la fin de la construction.' },
    { key: 'buildRewards.min', label: 'Minimum par ressource', type: 'number', min: 0, max: 10000, step: 10, hint: 'Récompense minimale de chaque ressource, même pour un niveau bon marché.' },
    { key: 'buildRewards.max', label: 'Maximum par ressource', type: 'number', min: 0, max: 100000, step: 100, hint: 'Plafond de chaque ressource, même pour un niveau très cher.' },
    { key: 'buildRewards.days', label: 'Durée (jours)', type: 'number', min: 0, max: 365, step: 1, hint: 'Seules les constructions terminées pendant ces premiers jours du monde rapportent (jours réels). 0 : toute la partie.' },
  ] },
  { title: 'Unités et modules', intro: 'Les unités et les fonctionnalités disponibles. Tout ce qui est décoché disparaît du monde (bâtiments, unités, menus).', settings: [
    { key: 'features.archer', label: 'Archers et archers montés', type: 'bool', hint: 'Ajoute l’archer (caserne) et l’archer monté (écurie), et la défense contre les archers.' },
    { key: 'features.knight', label: 'Paladin', type: 'bool', hint: 'Ajoute la statue et le paladin, qui renforce les troupes qu’il accompagne.' },
    { key: 'knightSystem', label: 'Système du paladin', type: 'select', options: [['items', 'Armes (un paladin)'], ['skills', 'Compétences (10 max)']], hint: 'Armes : un seul paladin, qui trouve des armes au combat. Compétences : jusqu’à 10 paladins qui gagnent de l’expérience. Sans effet si le paladin est désactivé.' },
    { key: 'features.church', label: 'Église', type: 'bool', hint: 'Ajoute l’église et la première église. Hors de la zone d’influence de ses églises, un village se bat à 50 % : ses attaques et sa défense (soutiens compris) sont deux fois plus faibles.' },
    { key: 'features.seals', label: 'Sceaux', type: 'bool', hint: 'Chaque joueur pose les sceaux de son compte sur ses villages (un par village) : production, recrutement, attaque, défense, chance, ferme, pièces d’or ou butin. On ne gagne pas de sceaux sur un serveur privé : on y utilise ceux gagnés sur les mondes officiels.' },
    { key: 'features.militia', label: 'Milice de la ferme', type: 'bool', hint: 'Défense d’urgence : 20 miliciens par niveau de ferme pendant 6 h, production réduite de moitié ; limitée aux joueurs de 2 villages au plus.' },
    { key: 'tech', label: 'Recherche à la forge', type: 'select', options: [['simple', 'Une fois par unité'], ['none', 'Aucune']], hint: 'Une fois par unité : chaque unité doit être recherchée à la forge avant d’être recrutée. Aucune : toutes les unités sont disponibles.' },
    { key: 'scavenging.active', label: 'Collecte', type: 'bool', hint: 'Envoyer des troupes ramasser des ressources autour du village, sans combat (4 niveaux de collecteurs).' },
  ] },
  { title: 'Combat', intro: 'Les règles des batailles. Morale et chance s’appliquent à chaque attaque ; le bonus de nuit suit l’heure du serveur.', settings: [
    { key: 'moral', label: 'Morale', type: 'bool', hint: 'L’attaquant perd en force quand il attaque un joueur beaucoup plus petit que lui (jusqu’à 70 %). Protège les petits joueurs.' },
    { key: 'luck', label: 'Chance (± %)', type: 'number', min: 0, max: 25, step: 1, scale: 0.01, hint: 'Part d’aléatoire de chaque attaque, en plus ou en moins. 0 : des combats entièrement prévisibles.' },
    { key: 'night.active', label: 'Bonus de nuit', type: 'bool', hint: 'La nuit, la défense des villages de joueurs est multipliée : attaquer pendant la nuit coûte plus cher.' },
    { key: 'night.startHour', label: 'Début de la nuit (heure)', type: 'number', min: 0, max: 23, step: 1, hint: 'Heure du serveur. La nuit peut passer minuit (par exemple de 23 h à 7 h).' },
    { key: 'night.endHour', label: 'Fin de la nuit (heure)', type: 'number', min: 0, max: 23, step: 1 },
    { key: 'night.defFactor', label: 'Défense la nuit (×)', type: 'number', min: 1, max: 4, step: 0.5, hint: 'Multiplicateur de la défense pendant la nuit (×2 sur Guerre Tribale).' },
    { key: 'arrivalStepMs', label: 'Précision des arrivées', type: 'select', options: [[1, 'À la milliseconde (comme Guerre Tribale)'], [10, 'Au centième de seconde (10 ms)'], [100, 'Au dixième de seconde (100 ms)'], [1000, 'À la seconde']], hint: 'Les arrivées des troupes et des marchands sont arrondies à la tranche supérieure : à 100 ms, une attaque qui arriverait à 12:00:00:926 arrive à 12:00:01:000. Plus la précision est grossière, plus il est facile de faire arriver deux ordres ensemble (ils passent alors dans l’ordre d’envoi).' },
    { key: 'commandCancelSeconds', label: 'Annulation d’un ordre (minutes)', type: 'number', min: 0, max: 30, step: 1, scale: 60, hint: 'Délai pendant lequel une attaque ou un soutien envoyé peut encore être rappelé. 0 : aucun rappel possible.' },
  ] },
  { title: 'Villages barbares', intro: 'Les villages sans propriétaire : premières cibles de pillage, puis de conquête. Ils ne recrutent jamais de troupes.', settings: [
    { key: 'placement.emptyVillages', label: 'Barbares par inscription (%)', type: 'number', min: 0, max: 500, step: 10, hint: 'Villages barbares créés près de chaque nouveau joueur : 100 = un ; 170 = un, et 70 % de chances d’un second.' },
    { key: 'barbarian.growthPerDay', label: 'Croissance (points par jour)', type: 'number', min: 0, max: 1000, step: 10, hint: 'Points que chaque barbare gagne par jour en construisant (multipliés par la vitesse du monde).' },
    { key: 'barbarian.maxPoints', label: 'Points maximum', type: 'number', min: 100, max: 12000, step: 100, hint: 'Les barbares cessent de grandir à ce total.' },
    { key: 'barbarian.troops', label: 'Les villages abandonnés gardent leurs troupes', type: 'bool', hint: 'Quand un joueur quitte le monde, ses villages redeviennent barbares avec leur armée (comme sur Guerre Tribale), ou vides si décoché.' },
  ] },
  { title: 'Bots', intro: 'Des joueurs gérés par l’ordinateur, signalés « Bot » partout. Ils jouent avec les mêmes règles que vous (protection des débutants, mode sommeil, morale) et comptent dans les classements et la fin du monde.', settings: [
    { key: 'bots.count', label: 'Nombre de bots', type: 'number', min: 0, max: 100, step: 1, hint: 'Bots présents sur le monde. Un bot qui perd tous ses villages recommence avec un nouveau village. 0 : aucun bot.' },
    { key: 'bots.difficulty', label: 'Comportement des bots', type: 'select', options: [['peaceful', 'Paisibles'], ['normal', 'Normaux'], ['aggressive', 'Agressifs']], hint: 'Paisibles : se développent et pillent les barbares. Normaux : attaquent aussi les joueurs proches et conquièrent des villages barbares. Agressifs : attaquent souvent et conquièrent aussi les villages des joueurs.' },
  ] },
  { title: 'Joueurs et tribus', intro: 'La vie commune : tribus, absences, nobles et commerce.', settings: [
    { key: 'tribe.memberLimit', label: 'Membres par tribu', type: 'number', min: 1, max: 100, step: 1, hint: 'Une petite limite oblige à multiplier les tribus et les alliances.' },
    { key: 'tribe.noHarm', label: 'Attaque interdite entre membres d’une tribu', type: 'bool', hint: 'Empêche d’attaquer un membre de sa propre tribu.' },
    { key: 'sitter.allow', label: 'Remplaçant (mode vacances)', type: 'bool', hint: 'Un joueur absent peut confier son compte à un autre joueur (3 comptes remplacés au plus).' },
    { key: 'sleep.active', label: 'Mode sommeil', type: 'bool', hint: 'Un joueur peut se mettre à l’abri des attaques pendant 6 à 10 h pour dormir, une fois éveillé au moins 12 h. Surtout utile sur les mondes rapides.' },
    { key: 'snob.maxDistance', label: 'Distance maximale d’un noble (cases)', type: 'number', min: 10, max: 500, step: 5, hint: 'Un noble ne peut pas conquérir un village plus loin que cette distance de son village d’origine.' },
    { key: 'market.merchantCapacity', label: 'Capacité d’un marchand', type: 'number', min: 100, max: 5000, step: 100, hint: 'Ressources transportées par chaque marchand (1 000 sur Guerre Tribale).' },
  ] },
  { title: 'Factions', intro: 'Un monde à factions oppose quatre peuples : elfes, nains, orques et humains. Chaque joueur choisit le sien en entrant dans le monde, pour toute la partie. Les tribus restent, mais chacune appartient à la faction de son fondateur, et c’est une faction, non une tribu, qui gagne le monde.', settings: [
    { key: 'factions.active', label: 'Monde à factions', type: 'bool', hint: 'La fin du monde se joue entre factions : on additionne les villages de tous les joueurs de chaque faction, avec les mêmes conditions de victoire.' },
    { key: 'factions.noHarm', label: 'Attaque interdite entre membres d’une faction', type: 'bool', hint: 'Empêche d’attaquer un joueur de sa propre faction, même hors de sa tribu. Sans effet sur un monde sans factions.' },
  ] },
  { title: 'Fin du monde', intro: 'Comment le monde se termine. Sur un monde à factions, c’est une faction et non une tribu qui l’emporte. Les durées sont en jours réels : elles ne suivent pas la vitesse du monde.', settings: [
    { key: 'victory.type', label: 'Condition de victoire', type: 'select', options: [['dominance', 'Domination'], ['runes', 'Guerres runiques']], hint: 'Domination : détenir une part des villages de joueurs. Guerres runiques : conquérir et tenir des villages de rune dans chaque continent. Seuls les réglages de la condition choisie comptent.' },
  ] },
  { title: 'Domination', intro: 'Le monde se termine quand une tribu (ou une faction) détient une part des villages de joueurs assez longtemps.', settings: [
    { key: 'victory.dominance.endgamePercent', label: 'Villages de joueurs à détenir (%)', type: 'number', min: 10, max: 100, step: 5, hint: 'Part des villages de joueurs qu’une tribu (ou une faction) doit posséder (les barbares ne comptent pas).' },
    { key: 'victory.dominance.minWorldAgeDays', label: 'Durée minimale du monde (jours)', type: 'number', min: 1, max: 730, step: 1, hint: 'Aucune victoire possible avant cet âge du monde : c’est la durée minimale de la partie.' },
    { key: 'victory.dominance.holdDays', label: 'Domination à tenir (jours)', type: 'number', min: 1, max: 90, step: 1, hint: 'La tribu (ou la faction) doit garder la domination sans interruption pendant ce temps pour gagner.' },
  ] },
  { title: 'Guerres runiques', intro: 'Comme sur Guerre Tribale : à une date fixée, des villages de rune gardés par des troupes barbares apparaissent dans chaque continent peuplé. Il faut en conquérir et en tenir une part dans chaque continent, alors qu’ils se défendent mal une fois conquis.', settings: [
    { key: 'victory.runes.spawnAfterDays', label: 'Apparition des villages de rune (jours)', type: 'number', min: 0, max: 365, step: 1, hint: 'Âge du monde auquel les villages de rune apparaissent (90 sur Guerre Tribale).' },
    { key: 'victory.runes.villagesPerContinent', label: 'Villages de rune par continent', type: 'number', min: 1, max: 100, step: 1, hint: '25 sur Guerre Tribale. Baisse-le pour un serveur à peu de joueurs.' },
    { key: 'victory.runes.minPlayerVillages', label: 'Villages de joueurs pour qu’un continent compte', type: 'number', min: 1, max: 1000, step: 1, hint: 'Seuls les continents qui ont au moins ce nombre de villages de joueurs à l’apparition reçoivent des runes (au moins le plus peuplé). La carte grandit depuis le centre : ce sont les continents habités qui comptent, pas la taille de la carte.' },
    { key: 'victory.runes.winPercent', label: 'Part à tenir dans chaque continent (%)', type: 'number', min: 10, max: 100, step: 5, hint: 'La tribu (ou la faction) doit tenir cette part des villages de rune de chaque continent (60 % sur Guerre Tribale).' },
    { key: 'victory.runes.holdDays', label: 'Villages de rune à tenir (jours)', type: 'number', min: 1, max: 90, step: 1, hint: 'Durée du compte à rebours : il s’arrête dès qu’un continent n’est plus tenu.' },
    { key: 'victory.runes.defenseFactor', label: 'Pénalité de défense des villages de rune (%)', type: 'number', min: 0, max: 90, step: 5, scale: -0.01, offset: 1, hint: 'Un village de rune conquis se défend avec ce pourcentage de force en moins, soutiens compris (50 % sur Guerre Tribale FR, 60 % sur le serveur anglais). 0 : aucune pénalité.' },
    { key: 'victory.runes.disableMorale', label: 'Pas de morale contre les villages de rune', type: 'bool', hint: 'Les attaques contre un village de rune ne sont pas affaiblies par la morale, même contre un petit joueur.' },
  ] },
  // Réglages propres à un mode : enregistrés seulement si ce mode est choisi.
  ...Object.values(MODES).filter((m) => m.settings).map((m) => ({
    title: `Mode ${m.name}`, intro: `Seulement pour un monde en mode ${m.name}.`, settings: m.settings.map((x) => ({ ...x, mode: m.id })),
  })),
];

const SETTINGS = GROUPS.flatMap((g) => g.settings);
// Valeurs par défaut fusionnées (réglages des modes compris).
const DEFAULT_CONFIG = new WorldConfig({});

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function set(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] || {};
  o[keys[keys.length - 1]] = value;
}

/**
 * Valeur affichée dans le formulaire : la saisie de l'utilisateur quand le formulaire est réaffiché (une case
 * décochée n'est pas envoyée : elle reste décochée), sinon la valeur par défaut du monde, à l'échelle du champ.
 */
function formValue(setting, input = {}) {
  const submitted = Object.prototype.hasOwnProperty.call(input, 'name');
  if (submitted && setting.type === 'bool') return input[setting.key] === '1';
  if (Object.prototype.hasOwnProperty.call(input, setting.key)) return input[setting.key];
  const v = get(DEFAULT_CONFIG, setting.key);
  if (setting.type === 'number' && setting.scale) return Math.round(((v - (setting.offset || 0)) / setting.scale) * 1000) / 1000;
  return v;
}

/**
 * Configuration du monde à partir de la saisie (champs nommés par leur chemin, `features.knight`…). Les valeurs hors
 * bornes ou inconnues sont refusées : renvoie { config } ou { error }.
 */
function parse(body = {}) {
  const config = {};
  for (const s of SETTINGS) {
    const raw = body[s.key];
    let value;
    if (s.type === 'bool') value = raw === '1' || raw === 'on';
    else if (s.type === 'select') {
      const option = s.options.find(([v]) => String(v) === String(raw));
      if (!option) return { error: `${s.label} : choix invalide.` };
      value = option[0];
    } else {
      const n = Number(String(raw ?? '').replace(',', '.'));
      if (!Number.isFinite(n) || n < s.min || n > s.max) return { error: `${s.label} : entre ${s.min} et ${s.max}.` };
      value = s.scale ? Math.round(((s.offset || 0) + n * s.scale) * 1e6) / 1e6 : n;
    }
    set(config, s.key, value);
  }
  for (const s of SETTINGS) if (s.mode && s.mode !== config.mode) delete config[s.key.split('.')[0]];
  // Avertissement de domination (35 % et 80 jours sur GT) : ramené sous le seuil et la durée choisis.
  const d = config.victory.dominance;
  d.warningPercent = Math.min(WorldConfig.DEFAULTS.victory.dominance.warningPercent, Math.round(d.endgamePercent * 0.7));
  d.warningWorldAgeDays = Math.min(WorldConfig.DEFAULTS.victory.dominance.warningWorldAgeDays, Math.round(d.minWorldAgeDays * 0.45));
  if (!['dominance', 'runes'].includes(config.victory.type)) config.victory.type = 'dominance';
  return { config };
}

module.exports = { GROUPS, SETTINGS, parse, formValue };
