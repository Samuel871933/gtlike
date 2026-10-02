'use strict';

// Usage : npm run migrate [-- up|down|status|create <nom>]
const fs = require('fs');
const path = require('path');
const config = require('../src/config');

async function main() {
  const [command = 'up', name] = process.argv.slice(2);

  if (command === 'create') {
    if (!name) throw new Error('Usage : npm run migrate -- create nom-de-la-migration');
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const file = path.join(__dirname, '..', 'migrations', `${stamp}-${name}.js`);
    fs.writeFileSync(file, `'use strict';

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  // await qi.addColumn('Villages', 'nouvelleColonne', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
}

async function down({ context: qi }) {
  // await qi.removeColumn('Villages', 'nouvelleColonne');
}

module.exports = { up, down };
`);
    console.log(`Créé : ${path.relative(process.cwd(), file)}`);
    return;
  }

  if (config.db.dialect === 'sqlite') fs.mkdirSync(path.dirname(config.sqliteStorage), { recursive: true });
  const { sequelize } = require('../src/models');
  const { createMigrator } = require('../src/migrator');
  const migrator = createMigrator();
  if (command === 'up') {
    const done = await migrator.up();
    console.log(done.length ? `Appliquées : ${done.map((m) => m.name).join(', ')}` : 'Base à jour.');
  } else if (command === 'down') {
    const undone = await migrator.down();
    console.log(undone.length ? `Annulée : ${undone.map((m) => m.name).join(', ')}` : 'Rien à annuler.');
  } else if (command === 'status') {
    const [executed, pending] = await Promise.all([migrator.executed(), migrator.pending()]);
    console.log(`Appliquées : ${executed.map((m) => m.name).join(', ') || 'aucune'}`);
    console.log(`En attente : ${pending.map((m) => m.name).join(', ') || 'aucune'}`);
  } else {
    throw new Error(`Commande inconnue : ${command}`);
  }
  await sequelize.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
