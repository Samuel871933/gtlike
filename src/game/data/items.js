'use strict';

// Armes du paladin (ancien système, wiki DS « Waffen ») : bonus quand le paladin accompagne l'armée
// en attaque, ou se trouve parmi les défenseurs.
//  - unit / attack / defense : bonus de force d'une unité (+30 % en attaque, +20 % en défense)
//  - siege : multiplicateur supplémentaire des dégâts des béliers ou catapultes (+100 %)
//  - spy : le paladin compte comme éclaireur (rapport d'espionnage complet s'il survit)
//  - loyalty : baisse minimale de la loyauté lors d'une attaque de noble

module.exports = [
  { id: 'halberd', name: 'Hallebarde de Bonifacius', unit: 'spear', attack: 0.3, defense: 0.2 },
  { id: 'longsword', name: "Épée longue d'Ullrich", unit: 'sword', attack: 0.3, defense: 0.2 },
  { id: 'waraxe', name: 'Hache de guerre de Thorgard', unit: 'axe', attack: 0.3, defense: 0.2 },
  { id: 'longbow', name: "Arc long d'Edward", unit: 'archer', attack: 0.3, defense: 0.2, feature: 'archer' },
  { id: 'telescope', name: 'Longue-vue de Kalid', spy: true },
  { id: 'lance', name: 'Lance de Mieszko', unit: 'light', attack: 0.3, defense: 0.2 },
  { id: 'compositebow', name: 'Arc composite du Khan', unit: 'marcher', attack: 0.3, defense: 0.2, feature: 'archer' },
  { id: 'banner', name: 'Étendard de Baptiste', unit: 'heavy', attack: 0.3, defense: 0.2 },
  { id: 'morningstar', name: 'Étoile du matin de Carol', siege: { ram: 1 } },
  { id: 'beacon', name: "Phare d'Aletheia", siege: { catapult: 1 } },
  { id: 'scepter', name: 'Sceptre de Vasco', loyalty: 30 },
];
