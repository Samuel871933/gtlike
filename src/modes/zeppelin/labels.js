'use strict';

// Noms du mode Zeppelin. Seul l'habillage change : identifiants, valeurs et règles restent ceux du moteur de base.

const BUILDINGS = {
  main: ['Poste de pilotage', 'Le cœur du vaisseau : plus son niveau est élevé, plus les travaux du pont sont rapides.'],
  barracks: ['Salle d’armes', 'Formation des fusiliers, gardes et voltigeurs d’abordage.'],
  stable: ['Hangar d’escadrille', 'Éclaireurs aériens, chasseurs et intercepteurs blindés.'],
  garage: ['Arsenal', 'Construction des brise-coques et des bombardiers.'],
  snob: ['Bureau des navigateurs', 'Formation des navigateurs de prise, qui s’emparent des vaisseaux ennemis.'],
  smith: ['Atelier mécanique', 'Recherche des nouveaux équipements de l’équipage et des escadrilles.'],
  place: ['Pont d’envol', 'Départ des expéditions : attaques, soutiens et retours.'],
  statue: ['Figure de proue', 'Engagement du commandant de bord.'],
  church: ['Chapelle de bord', 'Lieu de foi des vaisseaux alentour : hors de sa zone d’influence, vos troupes ne se battent qu’à moitié de leur force.'],
  church_f: ['Première chapelle', 'Chapelle de votre premier vaisseau : une zone d’influence plus grande, qui ne s’agrandit pas. Une seule par joueur.'],
  market: ['Comptoir de cale', 'Échange de cargaisons avec les autres capitaines.'],
  wood: ['Salle des machines', 'Les turbines récupèrent et refondent les métaux : production d’alliage.'],
  stone: ['Condenseur', 'Capte l’humidité des nuages : production de condensat.'],
  iron: ['Raffinerie d’éther', 'Distille les cristaux d’éther : production d’éther.'],
  farm: ['Quartier d’équipage', 'Couchettes de l’équipage : modules et troupes en occupent une partie.'],
  storage: ['Cale', 'Capacité de stockage de l’alliage, du condensat et de l’éther.'],
  hide: ['Compartiments secrets', 'Met une partie de la cargaison à l’abri des pillards.'],
  wall: ['Blindage de coque', 'Renforce la défense du vaisseau.'],
};

const UNITS = {
  spear: 'Fusilier de pont',
  sword: 'Garde de coque',
  axe: 'Voltigeur d’abordage',
  archer: 'Tireur d’éther',
  spy: 'Éclaireur aérien',
  light: 'Chasseur',
  marcher: 'Chasseur à éther',
  heavy: 'Intercepteur blindé',
  ram: 'Brise-coque',
  catapult: 'Bombardier',
  knight: 'Commandant de bord',
  snob: 'Navigateur de prise',
  militia: 'Équipage de réserve',
};

const RESOURCES = { wood: 'Alliage', stone: 'Condensat', iron: 'Éther' };
// Glyphes des ressources (ceux de la maquette), à la place des icônes bois / argile / fer.
const RESOURCE_GLYPHS = { wood: '⬡', stone: '◈', iron: '◇' };

module.exports = { BUILDINGS, UNITS, RESOURCES, RESOURCE_GLYPHS };
