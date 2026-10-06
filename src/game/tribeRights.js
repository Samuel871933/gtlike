'use strict';

/**
 * Titres et pouvoirs d'une tribu, comme sur Guerre Tribale (help.guerretribale.fr/wiki/Tribus) :
 * - Duc (`tribeRole: 'duke'`) : tous les droits ; seul à pouvoir nommer d'autres ducs. Il peut y en avoir plusieurs.
 * - Baron (`'baron'`) : administration de la tribu (droits des membres, renvois) et tous les autres droits.
 * - Membre (`'member'`) : les droits cochés un à un dans `tribeRights` (inviter, diplomatie, courrier circulaire,
 *   modérateur du forum, forum caché, opérations).
 * Le droit des membres de confiance n'est pas repris.
 */
const TITLES = {
  duke: 'Duc',
  baron: 'Baron',
  member: 'Membre',
};

const RIGHTS = [
  { id: 'invite', name: 'Inviter', text: 'Inviter de nouveaux joueurs dans la tribu.' },
  { id: 'diplomacy', name: 'Diplomatie', text: 'Modifier le profil de la tribu, créer des alliances, des PNA et marquer les ennemis.' },
  { id: 'massMail', name: 'Courrier circulaire', text: "Envoyer des messages à l'ensemble de la tribu." },
  { id: 'forumMod', name: 'Modérateur du forum', text: 'Gérer les sous-forums, supprimer ou modifier les messages, épingler et verrouiller les sujets.' },
  { id: 'operations', name: 'Opérations', text: "Créer et gérer les opérations de la tribu : cibles, attaques demandées, troupes et heures d'arrivée." },
  { id: 'hiddenForum', name: 'Forum caché', text: 'Lire et écrire dans les forums cachés de la tribu.' },
];
const RIGHT_IDS = RIGHTS.map((r) => r.id);

/** Le joueur a-t-il ce pouvoir ? `right` : 'duke', 'baron' ou l'un des RIGHTS. */
function has(player, right) {
  if (!player || !player.tribeId) return false;
  if (player.tribeRole === 'duke') return true;
  if (right === 'duke') return false;
  if (player.tribeRole === 'baron') return true;
  if (right === 'baron') return false;
  return Array.isArray(player.tribeRights) && player.tribeRights.includes(right);
}

/** Droits explicites d'un membre, filtrés (ordre de RIGHTS). */
function clean(rights) {
  const list = Array.isArray(rights) ? rights : [rights].filter(Boolean);
  return RIGHT_IDS.filter((id) => list.includes(id));
}

/** Libellé court des pouvoirs d'un membre : « Duc », « Baron », « Diplomatie, Inviter » ou « Membre ». */
function label(player) {
  if (player.tribeRole === 'duke' || player.tribeRole === 'baron') return TITLES[player.tribeRole];
  const names = RIGHTS.filter((r) => has(player, r.id)).map((r) => r.name);
  return names.length ? names.join(', ') : TITLES.member;
}

module.exports = { TITLES, RIGHTS, RIGHT_IDS, has, clean, label };
