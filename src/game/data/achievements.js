'use strict';

// Succès (wiki DS « Erfolge »). `tiers` : seuils des paliers bois, bronze, argent, or ;
// un seul seuil = succès sans palier (cadre bois). `rank: true` : plus petit = meilleur.
// `metric` : clé calculée par AchievementService.metrics().
// Les succès liés au premium, aux parrainages ou à la liste d'amis ne sont pas repris.

module.exports = [
  // Progression
  { key: 'points', name: 'Roi des points', description: 'Atteindre un total de points.', metric: 'points', tiers: [100, 5000, 100000, 10000000] },
  { key: 'topscorer', name: 'Meilleur joueur', description: 'Atteindre une place au classement.', metric: 'rank', rank: true, tiers: [1000, 100, 20, 1] },
  { key: 'continent', name: 'Seigneur du continent', description: "Atteindre une place au classement d'un continent.", metric: 'continentRank', rank: true, tiers: [100, 30, 5, 1] },
  // Combat
  { key: 'robber', name: 'Brigand', description: 'Piller des ressources.', metric: 'lootTotal', tiers: [500, 10000, 1000000, 100000000] },
  { key: 'plunderer', name: 'Pillard', description: 'Piller des villages.', metric: 'plunders', tiers: [10, 100, 1000, 10000] },
  { key: 'conqueror', name: 'Conquérant', description: 'Conquérir des villages.', metric: 'conquests', tiers: [5, 50, 500, 1000] },
  { key: 'leader', name: 'Chef de guerre', description: 'Tuer des unités ennemies.', metric: 'unitsKilled', tiers: [10000, 100000, 1000000, 20000000] },
  { key: 'hero', name: 'Mort en héros', description: 'Perdre des unités en soutien.', metric: 'supportLosses', tiers: [1000, 7500, 20000, 100000] },
  { key: 'vandal', name: 'Vandale', description: 'Détruire des niveaux de bâtiments à la catapulte.', metric: 'levelsDestroyed', tiers: [25, 250, 2500, 10000] },
  { key: 'wallbreaker', name: 'Briseur de murailles', description: 'Détruire des niveaux de muraille.', metric: 'wallLevelsDestroyed', tiers: [25, 250, 2500, 10000] },
  { key: 'butcher', name: 'Boucher', description: 'Gagner des batailles (armées de 20 places de ferme ou plus).', metric: 'battlesWon', tiers: [25, 250, 1500, 2500] },
  { key: 'kingslayer', name: 'Régicide', description: 'Tuer des nobles.', metric: 'noblesKilled', tiers: [1, 25, 100, 500] },
  { key: 'reinforcement', name: 'Renfort', description: 'Participer à des batailles en soutien.', metric: 'supportBattles', tiers: [50, 100, 500, 3000] },
  { key: 'counterspy', name: 'Contre-espionnage', description: "Repousser des attaques d'éclaireurs.", metric: 'spyDefenses', tiers: [25, 50, 250, 500] },
  { key: 'warlord', name: 'Seigneur de guerre', description: 'Attaquer des joueurs différents.', metric: 'attackedPlayers', tiers: [10, 25, 100, 250] },
  { key: 'lucky', name: 'Chanceux', description: "La loyauté d'un village conquis est tombée pile à 0.", metric: 'luckyNoble', tiers: [1] },
  { key: 'unlucky', name: 'Malchanceux', description: "La loyauté d'un village est tombée à 1 après votre attaque.", metric: 'unluckyNoble', tiers: [1] },
  // Divers
  { key: 'merchant', name: 'Marchand', description: 'Conclure des échanges au marché.', metric: 'tradesCompleted', tiers: [10, 100, 500, 1000] },
  { key: 'croesus', name: 'Crésus', description: "Frapper des pièces d'or.", metric: 'coins', tiers: [50, 500, 5000, 50000] },
  { key: 'brothers', name: "Frère d'armes", description: 'Jours passés dans la même tribu.', metric: 'tribeDays', tiers: [30, 60, 180, 360] },
  { key: 'paladin', name: 'Puissance du paladin', description: 'Trouver toutes les armes du paladin.', metric: 'allItems', tiers: [1], feature: 'knight' },
  { key: 'worldWinner', name: 'Vainqueur du monde', description: 'Faire partie de la tribu (ou être le joueur) qui gagne le monde.', metric: 'worldWinner', tiers: [1] },
  { key: 'phoenix', name: 'Phénix', description: 'Recommencer 5 fois sur un monde.', metric: 'restarts', tiers: [5] },
];
