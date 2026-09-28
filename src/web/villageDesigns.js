'use strict';

/*
  Designs des villages : un skin. Le compte choisit l'apparence de SES villages sur la carte (6 niveaux), et tous
  les joueurs les voient ainsi, quel que soit leur style de jeu ; les barbares gardent le design par défaut.
  Chaque design a :
    - une entrée ici ;
    - ses images dans public/img/map/villages/<id>/level-1.png … level-6.png ;
    - ses règles .village-design--<id>.village-marker--N dans src/styles/app.css (et public/css/map-v3.css).
  Chaque case de village reçoit le design de son propriétaire (src/web/mapView.js, champ `design`).
  Tous les designs sont gratuits ; le compte choisit le sien (User.villageDesign).
*/

const VILLAGE_DESIGNS = {
  beige: { id: 'beige', name: 'Beige', description: 'Pierre blonde et toits de tuiles orangées.' },
  'blanc-bleu': { id: 'blanc-bleu', name: 'Blanc et bleu', description: 'Pierre blanche et toits bleus.' },
  noir: { id: 'noir', name: 'Noir', description: 'Pierre sombre et toits rouge sang.' },
  viking: { id: 'viking', name: 'Camp viking', description: 'Longues maisons, palissades et forteresses des terres du Nord.' },
  'rome-antique': { id: 'rome-antique', name: 'Rome antique', description: 'Camps légionnaires, villas de pierre, temples et capitale impériale.' },
};

const DEFAULT_VILLAGE_DESIGN = 'beige';

/** Le design existe-t-il ? */
const isVillageDesign = (id) => Object.prototype.hasOwnProperty.call(VILLAGE_DESIGNS, id);

/** Design des villages d'un compte : son choix s'il existe encore, sinon le design par défaut. */
function villageDesignFor(user) {
  const id = user && user.villageDesign;
  return VILLAGE_DESIGNS[isVillageDesign(id) ? id : DEFAULT_VILLAGE_DESIGN];
}

module.exports = { VILLAGE_DESIGNS, DEFAULT_VILLAGE_DESIGN, isVillageDesign, villageDesignFor };
