'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createMigrator } = require('./migrator');
const createApp = require('./app');
const GameLoop = require('./services/GameLoop');
const { seedWorlds } = require('../scripts/seed');

async function main() {
  if (!config.databaseUrl) fs.mkdirSync(path.dirname(config.sqliteStorage), { recursive: true });

  const app = createApp();
  // En dev, les migrations en attente sont appliquées au démarrage ; en prod, il faut lancer `npm run migrate`.
  const migrator = createMigrator();
  if (config.isProduction) {
    const pending = await migrator.pending();
    if (pending.length) throw new Error(`Migrations en attente : ${pending.map((m) => m.name).join(', ')}. Lancez \`npm run migrate\`.`);
  } else {
    const done = await migrator.up();
    if (done.length) console.log(`Migrations appliquées : ${done.map((m) => m.name).join(', ')}`);
  }
  await app.sessionStore.sync();
  await seedWorlds();

  new GameLoop(config.gameLoopIntervalMs).start();
  app.listen(config.port, () => console.log(`Serveur démarré sur http://localhost:${config.port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
