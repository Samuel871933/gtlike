'use strict';

// Index des tâches de fond, pour tenir des milliers de joueurs :
// - ManagerVillages(checkAt) : villages du gestionnaire de compte à vérifier, lus toutes les minutes ;
// - Villages(worldId, playerId, points) : barbares à faire grandir, villages de joueurs d'un monde (succès, victoire) ;
// - Reports(folderId, happenedAt) : nettoyage des rapports archivés ;
// - Commands / Transports (worldId, arrivesAt) : arrivées échues d'un monde (traitées monde par monde).

const INDEXES = [
  { table: 'ManagerVillages', name: 'manager_villages_check_at', fields: ['checkAt'] },
  { table: 'Villages', name: 'villages_world_id_player_id_points', fields: ['worldId', 'playerId', 'points'] },
  { table: 'Reports', name: 'reports_folder_id_happened_at', fields: ['folderId', 'happenedAt'] },
  { table: 'Commands', name: 'commands_world_id_arrives_at', fields: ['worldId', 'arrivesAt'] },
  { table: 'Transports', name: 'transports_world_id_arrives_at', fields: ['worldId', 'arrivesAt'] },
];

async function up({ context: qi }) {
  for (const { table, name, fields } of INDEXES) {
    const existing = new Set((await qi.showIndex(table)).map((i) => i.name));
    if (!existing.has(name)) await qi.addIndex(table, fields, { name });
  }
}

async function down({ context: qi }) {
  for (const { table, name } of INDEXES) await qi.removeIndex(table, name);
}

module.exports = { up, down };
