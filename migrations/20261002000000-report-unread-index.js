'use strict';

// Rapports non lus par type : compteur de l'en-tête, lu à chaque page du jeu (ReportService.unreadByFilter).
// Sans cet index, la requête parcourt tous les rapports du joueur (des dizaines de milliers pour un joueur actif).

const NAME = 'reports_player_id_is_read_type';

async function up({ context: qi }) {
  const existing = new Set((await qi.showIndex('Reports')).map((i) => i.name));
  if (!existing.has(NAME)) await qi.addIndex('Reports', ['playerId', 'isRead', 'type'], { name: NAME });
}

async function down({ context: qi }) {
  await qi.removeIndex('Reports', NAME);
}

module.exports = { up, down };
