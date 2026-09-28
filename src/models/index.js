'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const WorldConfig = require('../game/WorldConfig');

/** Compte global : un compte peut jouer sur plusieurs mondes. */
const User = sequelize.define('User', {
  username: { type: DataTypes.STRING(24), allowNull: false, unique: true },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  // Style de jeu choisi (src/web/gameStyles.js) ; nul = style par défaut.
  gameStyle: { type: DataTypes.STRING(16), allowNull: true },
  // Design des villages sur la carte (src/web/villageDesigns.js) ; nul = design par défaut.
  villageDesign: { type: DataTypes.STRING(16), allowNull: true },
  // Style de jeu (densité de l'interface) (src/web/gameLayouts.js) : normal ou minimaliste ; nul = minimaliste (par défaut).
  gameLayout: { type: DataTypes.STRING(16), allowNull: true },
});

/** Un monde (serveur) avec sa configuration propre. */
const World = sequelize.define('World', {
  slug: { type: DataTypes.STRING(16), allowNull: false, unique: true },
  name: { type: DataTypes.STRING, allowNull: false },
  isOpen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  config: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  // Fin de partie : suivi de la condition de victoire, puis vainqueur (le monde passe en paix).
  victoryState: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  endedAt: { type: DataTypes.DATE, allowNull: true },
  winnerTribeId: { type: DataTypes.INTEGER, allowNull: true },
  winnerPlayerId: { type: DataTypes.INTEGER, allowNull: true },
});

World.prototype.getConfig = function getConfig() {
  if (!this._worldConfig) this._worldConfig = new WorldConfig(this.config);
  return this._worldConfig;
};

/** Tribu d'un monde. Les points sont calculés à la volée à partir de ceux des membres. */
const Tribe = sequelize.define(
  'Tribe',
  {
    name: { type: DataTypes.STRING(32), allowNull: false },
    tag: { type: DataTypes.STRING(6), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  },
  { indexes: [{ unique: true, fields: ['worldId', 'tag'] }, { unique: true, fields: ['worldId', 'name'] }] },
);

/** Invitation d'un joueur dans une tribu. */
const TribeInvite = sequelize.define('TribeInvite', {}, { indexes: [{ unique: true, fields: ['tribeId', 'playerId'] }] });

/** Diplomatie, à sens unique comme sur Guerre Tribale : ally | nap | enemy. */
const TribeRelation = sequelize.define(
  'TribeRelation',
  { type: { type: DataTypes.STRING(8), allowNull: false } },
  { indexes: [{ unique: true, fields: ['tribeId', 'otherTribeId'] }] },
);

/** Mur de messages interne à la tribu. */
const TribeMessage = sequelize.define(
  'TribeMessage',
  { body: { type: DataTypes.TEXT, allowNull: false } },
  { indexes: [{ fields: ['tribeId', 'createdAt'] }] },
);

/** Conversation privée entre joueurs d'un même monde. */
const Conversation = sequelize.define(
  'Conversation',
  {
    subject: { type: DataTypes.STRING(100), allowNull: false },
    lastMessageAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ fields: ['worldId'] }] },
);

/** Participant d'une conversation ; `lastReadAt` sert à compter les non-lus. */
const ConversationParticipant = sequelize.define(
  'ConversationParticipant',
  { lastReadAt: { type: DataTypes.DATE, allowNull: true } },
  { indexes: [{ unique: true, fields: ['conversationId', 'playerId'] }, { fields: ['playerId'] }] },
);

const ConversationMessage = sequelize.define(
  'ConversationMessage',
  { body: { type: DataTypes.TEXT, allowNull: false } },
  { indexes: [{ fields: ['conversationId', 'createdAt'] }] },
);

/**
 * Paladin à compétences : rattaché à un village (un seul par village). Une armée partie de ce
 * village qui contient un paladin l'emmène, ce qui permet de l'identifier dans les combats.
 */
const Knight = sequelize.define(
  'Knight',
  {
    name: { type: DataTypes.STRING(32), allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    xp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    skills: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    alive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // Formation en cours : le paladin quitte le village jusqu'à trainingEndsAt, puis gagne trainingXp.
    trainingEndsAt: { type: DataTypes.DATE, allowNull: true },
    trainingXp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { indexes: [{ fields: ['playerId'] }, { unique: true, fields: ['homeVillageId'] }, { fields: ['trainingEndsAt'] }] },
);

/** Compteurs d'une journée (heure du serveur) pour les succès quotidiens. */
const DailyStat = sequelize.define(
  'DailyStat',
  {
    day: { type: DataTypes.STRING(10), allowNull: false }, // AAAA-MM-JJ
    plunders: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    unitsKilledAttacker: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    unitsKilledDefender: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    unitsKilledSupporter: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    conquests: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    loot: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { indexes: [{ unique: true, fields: ['playerId', 'day'] }, { fields: ['worldId', 'day'] }] },
);

/** Succès quotidien attribué (un par catégorie et par jour, au gagnant unique). */
const DailyAward = sequelize.define(
  'DailyAward',
  {
    day: { type: DataTypes.STRING(10), allowNull: false },
    key: { type: DataTypes.STRING(24), allowNull: false },
    value: { type: DataTypes.INTEGER, allowNull: false },
  },
  { indexes: [{ unique: true, fields: ['worldId', 'day', 'key'] }, { fields: ['playerId'] }] },
);

/** Palier atteint d'un succès (1 bois, 2 bronze, 3 argent, 4 or). */
const PlayerAchievement = sequelize.define(
  'PlayerAchievement',
  {
    key: { type: DataTypes.STRING(24), allowNull: false },
    tier: { type: DataTypes.INTEGER, allowNull: false },
    unlockedAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ unique: true, fields: ['playerId', 'key'] }] },
);

/** Présence d'un compte sur un monde. */
const Player = sequelize.define(
  'Player',
  {
    name: { type: DataTypes.STRING(24), allowNull: false },
    points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    villageCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Pièces d'or frappées à l'académie : elles déterminent le nombre de nobles possibles.
    coins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Rôle dans la tribu : founder | leader | member (nul si sans tribu).
    tribeRole: { type: DataTypes.STRING(8), allowNull: true },
    // Mode sommeil : les attaques qui arrivent dans cet intervalle deviennent des visites.
    sleepStartsAt: { type: DataTypes.DATE, allowNull: true },
    sleepEndsAt: { type: DataTypes.DATE, allowNull: true },
    // Mode vacances : remplaçant désigné (sitterId) ; actif une fois accepté (sitterAcceptedAt).
    sitterAcceptedAt: { type: DataTypes.DATE, allowNull: true },
    // Adversaires vaincus (points) : en attaque (ODA), en défense (ODD), en soutien (ODS).
    killsAttacker: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    killsDefender: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    killsSupporter: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Paladin : armes trouvées, arme équipée, jauge de découverte (%), déjà recruté au moins une fois.
    knightItems: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    knightItem: { type: DataTypes.STRING(16), allowNull: true },
    knightProgress: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    knightProgressAt: { type: DataTypes.DATE, allowNull: true },
    knightRecruited: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Compteurs des succès (pillages, conquêtes, unités tuées…) et date d'entrée dans la tribu.
    stats: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    tribeJoinedAt: { type: DataTypes.DATE, allowNull: true },
    // Texte personnel affiché sur le profil public (texte brut, retours à la ligne conservés).
    profileText: { type: DataTypes.TEXT, allowNull: true },
    // Bâtiments favoris de la barre d'accès rapide (ids) ; nul = barre par défaut (bâtiments construits).
    favoriteBuildings: { type: DataTypes.JSON, allowNull: true },
    // Réglages de la carte : { size, mini, layers: { influence: true, … } } ; nul = réglages par défaut.
    mapSettings: { type: DataTypes.JSON, allowNull: true },
  },
  { indexes: [{ unique: true, fields: ['userId', 'worldId'] }] },
);

/** Le joueur dort-il à cet instant ? */
Player.prototype.isAsleep = function isAsleep(at = new Date()) {
  return Boolean(this.sleepStartsAt && this.sleepEndsAt && new Date(this.sleepStartsAt) <= at && at < new Date(this.sleepEndsAt));
};

const Village = sequelize.define(
  'Village',
  {
    name: { type: DataTypes.STRING(32), allowNull: false },
    x: { type: DataTypes.INTEGER, allowNull: false },
    y: { type: DataTypes.INTEGER, allowNull: false },
    isFirst: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    buildings: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    units: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    wood: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    stone: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    iron: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    resourcesAt: { type: DataTypes.DATE, allowNull: false },
    points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Loyauté (100 max) : baisse à chaque noble, remonte avec le temps (à partir de resourcesAt).
    loyalty: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 100 },
    // Villages barbares : date de référence de la croissance (voir game/barbarian.js).
    grownAt: { type: DataTypes.DATE, allowNull: true },
    // Unités recherchées à la forge : { axe: true, … }
    research: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    // Collecte : options débloquées et déblocage en cours { unlocked: [1, 2], unlocking: { option, endsAt } }
    scavenging: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    // Village spécial de fin de partie : 'rune' ou 'siege' (quartier du Grand Siège).
    special: { type: DataTypes.STRING(8), allowNull: true },
  },
  { indexes: [{ unique: true, fields: ['worldId', 'x', 'y'] }, { fields: ['playerId'] }] },
);

/** Un niveau de bâtiment en file d'attente. Le coût payé est gardé pour le remboursement. */
const BuildOrder = sequelize.define(
  'BuildOrder',
  {
    building: { type: DataTypes.STRING(16), allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
    wood: { type: DataTypes.INTEGER, allowNull: false },
    stone: { type: DataTypes.INTEGER, allowNull: false },
    iron: { type: DataTypes.INTEGER, allowNull: false },
    // Démolition : le bâtiment descend au niveau `level` (au lieu de monter), sans coût.
    demolish: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  { indexes: [{ fields: ['villageId'] }, { fields: ['endsAt'] }] },
);

/** Expédition de collecte : les unités reviennent à endsAt avec le butin. */
const ScavengeRun = sequelize.define(
  'ScavengeRun',
  {
    option: { type: DataTypes.INTEGER, allowNull: false },
    units: { type: DataTypes.JSON, allowNull: false },
    resources: { type: DataTypes.JSON, allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ fields: ['villageId'] }, { fields: ['endsAt'] }] },
);

/** Recherche d'une unité en cours à la forge (une à la fois par village). */
const ResearchOrder = sequelize.define(
  'ResearchOrder',
  {
    unit: { type: DataTypes.STRING(16), allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ fields: ['villageId'] }, { fields: ['endsAt'] }] },
);

/** Un lot d'unités en recrutement ; les unités sortent une par une. */
const RecruitOrder = sequelize.define(
  'RecruitOrder',
  {
    building: { type: DataTypes.STRING(16), allowNull: false },
    unit: { type: DataTypes.STRING(16), allowNull: false },
    count: { type: DataTypes.INTEGER, allowNull: false },
    done: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    unitDurationMs: { type: DataTypes.INTEGER, allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
    // Sortie de la prochaine unité : permet à la boucle de jeu de trouver les files à traiter.
    nextAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ fields: ['villageId'] }, { fields: ['nextAt'] }] },
);

/**
 * Troupes en mouvement. Les unités appartiennent toujours à `originVillageId` :
 * pour un retour, l'origine est le village où rentrent les troupes.
 */
const Command = sequelize.define(
  'Command',
  {
    type: { type: DataTypes.STRING(8), allowNull: false }, // attack | support | return | relocate
    units: { type: DataTypes.JSON, allowNull: false },
    loot: { type: DataTypes.JSON, allowNull: true },
    catapultTarget: { type: DataTypes.STRING(16), allowNull: true },
    cancelled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    arrivesAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ fields: ['arrivesAt'] }, { fields: ['originVillageId'] }, { fields: ['targetVillageId'] }] },
);

/** Troupes en soutien stationnées dans un autre village. */
const SupportStack = sequelize.define(
  'SupportStack',
  { units: { type: DataTypes.JSON, allowNull: false } },
  { indexes: [{ unique: true, fields: ['villageId', 'originVillageId'] }, { fields: ['originVillageId'] }] },
);

/**
 * Marchands en route. Comme pour les troupes, ils appartiennent à `originVillageId` :
 * pour un retour, l'origine est le village où ils rentrent.
 */
const Transport = sequelize.define(
  'Transport',
  {
    type: { type: DataTypes.STRING(8), allowNull: false }, // delivery | return
    resources: { type: DataTypes.JSON, allowNull: false },
    merchants: { type: DataTypes.INTEGER, allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    arrivesAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ fields: ['arrivesAt'] }, { fields: ['originVillageId'] }, { fields: ['targetVillageId'] }] },
);

/**
 * Offre du marché : `count` lots identiques de `sellAmount` contre `buyAmount`.
 * Les ressources vendues et les marchands sont réservés à la création.
 */
const MarketOffer = sequelize.define(
  'MarketOffer',
  {
    sellResource: { type: DataTypes.STRING(8), allowNull: false },
    sellAmount: { type: DataTypes.INTEGER, allowNull: false },
    buyResource: { type: DataTypes.STRING(8), allowNull: false },
    buyAmount: { type: DataTypes.INTEGER, allowNull: false },
    count: { type: DataTypes.INTEGER, allowNull: false },
    merchantsPerOffer: { type: DataTypes.INTEGER, allowNull: false },
  },
  { indexes: [{ fields: ['worldId'] }, { fields: ['villageId'] }] },
);

/** Rapport de combat, de soutien ou de retour, adressé à un joueur. */
const Report = sequelize.define(
  'Report',
  {
    type: { type: DataTypes.STRING(16), allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    data: { type: DataTypes.JSON, allowNull: false },
    isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    happenedAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ fields: ['playerId', 'happenedAt'] }] },
);

User.hasMany(Player, { foreignKey: { name: 'userId', allowNull: false } });
Player.belongsTo(User, { foreignKey: 'userId' });
World.hasMany(Player, { foreignKey: { name: 'worldId', allowNull: false } });
Player.belongsTo(World, { foreignKey: 'worldId' });
World.hasMany(Village, { foreignKey: { name: 'worldId', allowNull: false } });
Village.belongsTo(World, { foreignKey: 'worldId' });
// playerId nul = village barbare.
Player.hasMany(Village, { foreignKey: { name: 'playerId', allowNull: true } });
Village.belongsTo(Player, { foreignKey: 'playerId' });
Village.hasMany(BuildOrder, { foreignKey: { name: 'villageId', allowNull: false }, onDelete: 'CASCADE' });
BuildOrder.belongsTo(Village, { foreignKey: 'villageId' });
Village.hasMany(ScavengeRun, { foreignKey: { name: 'villageId', allowNull: false }, onDelete: 'CASCADE' });
ScavengeRun.belongsTo(Village, { foreignKey: 'villageId' });
Village.hasMany(ResearchOrder, { foreignKey: { name: 'villageId', allowNull: false }, onDelete: 'CASCADE' });
ResearchOrder.belongsTo(Village, { foreignKey: 'villageId' });
Village.hasMany(RecruitOrder, { foreignKey: { name: 'villageId', allowNull: false }, onDelete: 'CASCADE' });
RecruitOrder.belongsTo(Village, { foreignKey: 'villageId' });

World.hasMany(Tribe, { foreignKey: { name: 'worldId', allowNull: false } });
Tribe.belongsTo(World, { foreignKey: 'worldId' });
Tribe.hasMany(Player, { as: 'members', foreignKey: { name: 'tribeId', allowNull: true } });
Player.belongsTo(Tribe, { foreignKey: 'tribeId' });
Player.belongsTo(Player, { as: 'sitter', foreignKey: { name: 'sitterId', allowNull: true }, onDelete: 'SET NULL' });
Player.hasMany(Player, { as: 'sitting', foreignKey: 'sitterId' });
Tribe.hasMany(TribeInvite, { foreignKey: { name: 'tribeId', allowNull: false }, onDelete: 'CASCADE' });
TribeInvite.belongsTo(Tribe, { foreignKey: 'tribeId' });
Player.hasMany(TribeInvite, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
TribeInvite.belongsTo(Player, { foreignKey: 'playerId' });
Tribe.hasMany(TribeRelation, { as: 'relations', foreignKey: { name: 'tribeId', allowNull: false }, onDelete: 'CASCADE' });
TribeRelation.belongsTo(Tribe, { as: 'other', foreignKey: { name: 'otherTribeId', allowNull: false }, onDelete: 'CASCADE' });
Tribe.hasMany(TribeMessage, { foreignKey: { name: 'tribeId', allowNull: false }, onDelete: 'CASCADE' });
// Auteur nul = joueur supprimé : ses messages restent visibles pour les autres.
TribeMessage.belongsTo(Player, { foreignKey: { name: 'playerId', allowNull: true }, onDelete: 'SET NULL' });

World.hasMany(Conversation, { foreignKey: { name: 'worldId', allowNull: false } });
Conversation.hasMany(ConversationParticipant, { as: 'participants', foreignKey: { name: 'conversationId', allowNull: false }, onDelete: 'CASCADE' });
ConversationParticipant.belongsTo(Conversation, { foreignKey: 'conversationId' });
ConversationParticipant.belongsTo(Player, { foreignKey: { name: 'playerId', allowNull: false } });
Conversation.hasMany(ConversationMessage, { as: 'messages', foreignKey: { name: 'conversationId', allowNull: false }, onDelete: 'CASCADE' });
ConversationMessage.belongsTo(Player, { as: 'author', foreignKey: { name: 'playerId', allowNull: true }, onDelete: 'SET NULL' });

World.hasMany(Command, { foreignKey: { name: 'worldId', allowNull: false } });
Command.belongsTo(Village, { as: 'origin', foreignKey: { name: 'originVillageId', allowNull: false } });
Command.belongsTo(Village, { as: 'target', foreignKey: { name: 'targetVillageId', allowNull: false } });
SupportStack.belongsTo(Village, { as: 'village', foreignKey: { name: 'villageId', allowNull: false } });
SupportStack.belongsTo(Village, { as: 'origin', foreignKey: { name: 'originVillageId', allowNull: false } });
World.hasMany(Transport, { foreignKey: { name: 'worldId', allowNull: false } });
Transport.belongsTo(Village, { as: 'origin', foreignKey: { name: 'originVillageId', allowNull: false } });
Transport.belongsTo(Village, { as: 'target', foreignKey: { name: 'targetVillageId', allowNull: false } });
World.hasMany(MarketOffer, { foreignKey: { name: 'worldId', allowNull: false } });
MarketOffer.belongsTo(Village, { as: 'village', foreignKey: { name: 'villageId', allowNull: false } });
Player.hasMany(Knight, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
Knight.belongsTo(Player, { foreignKey: 'playerId' });
Knight.belongsTo(Village, { as: 'home', foreignKey: { name: 'homeVillageId', allowNull: false }, onDelete: 'CASCADE' });
World.hasMany(DailyStat, { foreignKey: { name: 'worldId', allowNull: false } });
Player.hasMany(DailyStat, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
DailyStat.belongsTo(Player, { foreignKey: 'playerId' });
World.hasMany(DailyAward, { foreignKey: { name: 'worldId', allowNull: false } });
Player.hasMany(DailyAward, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
DailyAward.belongsTo(Player, { foreignKey: 'playerId' });
Player.hasMany(PlayerAchievement, { as: 'achievements', foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
PlayerAchievement.belongsTo(Player, { foreignKey: 'playerId' });
Player.hasMany(Report, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
Report.belongsTo(Player, { foreignKey: 'playerId' });

/** Modèle d'armée d'un joueur (« Ordres rapides ») : un nom et des unités, pour pré-remplir le point de ralliement. */
const ArmyTemplate = sequelize.define(
  'ArmyTemplate',
  {
    name: { type: DataTypes.STRING(32), allowNull: false },
    units: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  },
  { indexes: [{ fields: ['playerId'] }] },
);
Player.hasMany(ArmyTemplate, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
ArmyTemplate.belongsTo(Player, { foreignKey: 'playerId' });

/** Village mis en favori par un joueur (menu de la carte, panneau « Favoris »). */
const MapFavorite = sequelize.define('MapFavorite', {}, { indexes: [{ unique: true, fields: ['playerId', 'villageId'] }] });
Player.hasMany(MapFavorite, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
MapFavorite.belongsTo(Player, { foreignKey: 'playerId' });
Village.hasMany(MapFavorite, { foreignKey: { name: 'villageId', allowNull: false }, onDelete: 'CASCADE' });
MapFavorite.belongsTo(Village, { foreignKey: 'villageId' });

/** Marquage de carte d'un joueur : une couleur pour un joueur, une tribu ou un village (targetType + targetId). */
const MapMarker = sequelize.define(
  'MapMarker',
  {
    targetType: { type: DataTypes.STRING(8), allowNull: false },
    targetId: { type: DataTypes.INTEGER, allowNull: false },
    color: { type: DataTypes.STRING(7), allowNull: false },
  },
  { indexes: [{ unique: true, fields: ['playerId', 'targetType', 'targetId'] }] },
);
Player.hasMany(MapMarker, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
MapMarker.belongsTo(Player, { foreignKey: 'playerId' });

/** Demande de réinitialisation du mot de passe : seul le haché SHA-256 du jeton envoyé par e-mail est stocké. */
const PasswordReset = sequelize.define(
  'PasswordReset',
  {
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { indexes: [{ fields: ['userId'] }] },
);
User.hasMany(PasswordReset, { foreignKey: { name: 'userId', allowNull: false }, onDelete: 'CASCADE' });
PasswordReset.belongsTo(User, { foreignKey: 'userId' });

/** Forum communautaire (commun à tous les mondes) : sujets rangés par section, messages des comptes. */
const ForumThread = sequelize.define(
  'ForumThread',
  {
    section: { type: DataTypes.STRING(24), allowNull: false },
    title: { type: DataTypes.STRING(80), allowNull: false },
    postCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastPostAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ fields: ['section', 'lastPostAt'] }] },
);
const ForumPost = sequelize.define(
  'ForumPost',
  {
    body: { type: DataTypes.TEXT, allowNull: false },
    editedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { indexes: [{ fields: ['threadId', 'createdAt'] }, { fields: ['userId', 'createdAt'] }] },
);
ForumThread.hasMany(ForumPost, { foreignKey: { name: 'threadId', allowNull: false }, onDelete: 'CASCADE' });
ForumPost.belongsTo(ForumThread, { foreignKey: 'threadId' });
// Un compte supprimé laisse ses messages, signés « Compte supprimé ».
User.hasMany(ForumThread, { foreignKey: { name: 'userId', allowNull: true }, onDelete: 'SET NULL' });
ForumThread.belongsTo(User, { as: 'author', foreignKey: 'userId' });
User.hasMany(ForumPost, { foreignKey: { name: 'userId', allowNull: true }, onDelete: 'SET NULL' });
ForumPost.belongsTo(User, { as: 'author', foreignKey: 'userId' });
ForumThread.belongsTo(ForumPost, { as: 'lastPost', foreignKey: { name: 'lastPostId', allowNull: true }, constraints: false });

/**
 * Forum interne d'une tribu (comme sur Guerre Tribale) : sous-forums créés par les chefs, sujets et messages des
 * membres, date de lecture de chaque sujet par joueur (marqueur « Nouveau »).
 */
const TribeForumSection = sequelize.define(
  'TribeForumSection',
  {
    name: { type: DataTypes.STRING(40), allowNull: false },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { indexes: [{ fields: ['tribeId', 'position'] }] },
);
const TribeForumThread = sequelize.define(
  'TribeForumThread',
  {
    title: { type: DataTypes.STRING(80), allowNull: false },
    pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    postCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastPostAt: { type: DataTypes.DATE, allowNull: false },
  },
  { indexes: [{ fields: ['sectionId', 'lastPostAt'] }] },
);
const TribeForumPost = sequelize.define(
  'TribeForumPost',
  {
    body: { type: DataTypes.TEXT, allowNull: false },
    editedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { indexes: [{ fields: ['threadId', 'createdAt'] }, { fields: ['playerId', 'createdAt'] }] },
);
const TribeForumRead = sequelize.define(
  'TribeForumRead',
  { readAt: { type: DataTypes.DATE, allowNull: false } },
  { indexes: [{ unique: true, fields: ['playerId', 'threadId'] }] },
);
Tribe.hasMany(TribeForumSection, { foreignKey: { name: 'tribeId', allowNull: false }, onDelete: 'CASCADE' });
TribeForumSection.belongsTo(Tribe, { foreignKey: 'tribeId' });
TribeForumSection.hasMany(TribeForumThread, { foreignKey: { name: 'sectionId', allowNull: false }, onDelete: 'CASCADE' });
TribeForumThread.belongsTo(TribeForumSection, { as: 'section', foreignKey: 'sectionId' });
TribeForumThread.hasMany(TribeForumPost, { foreignKey: { name: 'threadId', allowNull: false }, onDelete: 'CASCADE' });
TribeForumPost.belongsTo(TribeForumThread, { foreignKey: 'threadId' });
TribeForumThread.hasMany(TribeForumRead, { foreignKey: { name: 'threadId', allowNull: false }, onDelete: 'CASCADE' });
TribeForumRead.belongsTo(TribeForumThread, { foreignKey: 'threadId' });
Player.hasMany(TribeForumRead, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
// Un joueur qui quitte le monde laisse ses messages, sans auteur.
Player.hasMany(TribeForumThread, { foreignKey: { name: 'playerId', allowNull: true }, onDelete: 'SET NULL' });
TribeForumThread.belongsTo(Player, { as: 'author', foreignKey: 'playerId' });
Player.hasMany(TribeForumPost, { foreignKey: { name: 'playerId', allowNull: true }, onDelete: 'SET NULL' });
TribeForumPost.belongsTo(Player, { as: 'author', foreignKey: 'playerId' });
TribeForumThread.belongsTo(TribeForumPost, { as: 'lastPost', foreignKey: { name: 'lastPostId', allowNull: true }, constraints: false });
// Sous-forums mis en sourdine par un joueur (exclus des « Nouveaux messages » et de la pastille).
const TribeForumMute = sequelize.define('TribeForumMute', {}, { indexes: [{ unique: true, fields: ['playerId', 'sectionId'] }] });
Player.hasMany(TribeForumMute, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });
TribeForumSection.hasMany(TribeForumMute, { foreignKey: { name: 'sectionId', allowNull: false }, onDelete: 'CASCADE' });
// Sondage d'un sujet : une question (le titre du sujet), 2 à 10 réponses, un vote par membre (modifiable).
const TribeForumPoll = sequelize.define('TribeForumPoll', {
  options: { type: DataTypes.JSON, allowNull: false },
});
TribeForumThread.hasOne(TribeForumPoll, { as: 'poll', foreignKey: { name: 'threadId', allowNull: false, unique: true }, onDelete: 'CASCADE' });
TribeForumPoll.belongsTo(TribeForumThread, { foreignKey: 'threadId' });
const TribeForumVote = sequelize.define(
  'TribeForumVote',
  { option: { type: DataTypes.INTEGER, allowNull: false } },
  { indexes: [{ unique: true, fields: ['pollId', 'playerId'] }] },
);
TribeForumPoll.hasMany(TribeForumVote, { as: 'votes', foreignKey: { name: 'pollId', allowNull: false }, onDelete: 'CASCADE' });
Player.hasMany(TribeForumVote, { foreignKey: { name: 'playerId', allowNull: false }, onDelete: 'CASCADE' });

module.exports = {
  sequelize, User, World, Player, Village, BuildOrder, RecruitOrder, ResearchOrder, Command, SupportStack, Report, Transport, MarketOffer,
  Tribe, TribeInvite, TribeRelation, TribeMessage, Conversation, ConversationParticipant, ConversationMessage,
  PlayerAchievement, Knight, DailyStat, DailyAward, ScavengeRun, ArmyTemplate, MapFavorite, MapMarker, PasswordReset, ForumThread, ForumPost,
  TribeForumSection, TribeForumThread, TribeForumPost, TribeForumRead, TribeForumMute, TribeForumPoll, TribeForumVote,
};
