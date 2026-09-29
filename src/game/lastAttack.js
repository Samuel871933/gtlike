'use strict';

/**
 * Résultat d'une attaque pour la gommette de la carte (comme sur GT), à partir des données du rapport :
 * `result` win (aucune perte) | partial (pertes partielles) | loss (toute l'armée perdue) | spy (espionnage sans perte),
 * `haul` full (butin plein) | partial (butin partiel) | null (rien rapporté).
 */
function outcome(data) {
  const units = (data.attacker && data.attacker.units) || {};
  const losses = (data.attacker && data.attacker.losses) || {};
  const sent = Object.values(units).reduce((s, n) => s + (n || 0), 0);
  const lost = Object.values(losses).reduce((s, n) => s + (n || 0), 0);
  const spyOnly = sent > 0 && Object.entries(units).every(([id, n]) => !n || id === 'spy');
  const result = lost === 0 ? (spyOnly ? 'spy' : 'win') : lost >= sent ? 'loss' : 'partial';
  const loot = data.loot || {};
  const looted = (loot.wood || 0) + (loot.stone || 0) + (loot.iron || 0);
  const haul = looted > 0 ? (data.carry > 0 && looted >= data.carry ? 'full' : 'partial') : null;
  return { result, haul };
}

module.exports = { outcome };
