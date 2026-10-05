'use strict';

/*
  Emplacement de la barre des favoris (Compte → Barre des favoris), réglage du compte (User.quickbarPosition) :
    - top (par défaut) : dans l'en-tête, à côté du village ;
    - bottom : barre fixée en bas de l'écran ;
    - left / right : colonne fixée hors du contenu, à gauche ou à droite.
  Une colonne n'a de place que sur un grand écran : en dessous, elle devient la barre du bas (src/styles/app.css,
  .quickbar-dock). Gratuit.
*/

const QUICKBAR_POSITIONS = {
  top: { id: 'top', name: 'Dans l’en-tête', description: 'Sous le menu principal, à côté du nom du village.' },
  bottom: { id: 'bottom', name: 'Barre en bas', description: 'Fixée en bas de l’écran : toujours à portée, même en faisant défiler.' },
  left: { id: 'left', name: 'Colonne à gauche', description: 'Le long de la page, à gauche du contenu, sur les grands écrans.' },
  right: { id: 'right', name: 'Colonne à droite', description: 'Le long de la page, à droite du contenu, sur les grands écrans.' },
};

const isQuickbarPosition = (id) => Object.prototype.hasOwnProperty.call(QUICKBAR_POSITIONS, id);

/** Emplacement choisi par le compte, sinon dans l'en-tête. */
function quickbarPositionFor(user) {
  const id = user && user.quickbarPosition;
  return isQuickbarPosition(id) ? id : 'top';
}

module.exports = { QUICKBAR_POSITIONS, isQuickbarPosition, quickbarPositionFor };
