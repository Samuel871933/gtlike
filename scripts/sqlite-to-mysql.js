'use strict';

// Copie une base SQLite existante (data/game.sqlite par défaut) dans la base MySQL / MariaDB configurée dans .env.
//   node scripts/sqlite-to-mysql.js [chemin/vers/game.sqlite]
// La base MySQL doit être vide : le script y applique les migrations puis recopie toutes les lignes, ids compris.
// Les sessions ne sont pas reprises (les joueurs devront se reconnecter).

const { Sequelize } = require('sequelize');
const config = require('../src/config');

const SKIPPED = new Set(['SequelizeMeta', 'Sessions', 'sqlite_sequence']);
const BATCH = 500;

/** '2026-09-29 14:34:36.723 +00:00' (format SQLite de Sequelize) → Date. */
function toDate(value) {
  if (value === null || value instanceof Date) return value;
  const d = new Date(String(value).replace(' ', 'T').replace(' ', ''));
  if (Number.isNaN(d.getTime())) throw new Error(`Date illisible : ${value}`);
  return d;
}

async function main() {
  if (config.db.dialect !== 'mysql') throw new Error('Renseignez DB_DIALECT=mysql et les accès MySQL dans .env.');
  const source = new Sequelize({ dialect: 'sqlite', storage: process.argv[2] || config.sqliteStorage, logging: false });
  const { sequelize: target } = require('../src/models');
  const { createMigrator } = require('../src/migrator');

  // La source doit être à jour, sinon ses colonnes ne correspondent pas au schéma créé par les migrations.
  const migrator = createMigrator(target);
  const all = (await migrator.migrations()).map((m) => m.name);
  const [applied] = await source.query('SELECT name FROM SequelizeMeta');
  const missing = all.filter((name) => !applied.some((r) => r.name === name));
  if (missing.length) throw new Error(`Migrations absentes de la base SQLite : ${missing.join(', ')}. Lancez d'abord le serveur ou \`npm run migrate\` sur SQLite.`);

  await migrator.up();
  const qi = target.getQueryInterface();
  const [tables] = await source.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  const names = tables.map((t) => t.name).filter((n) => !SKIPPED.has(n));

  for (const table of names) {
    const [[{ n }]] = await target.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    if (Number(n) > 0) throw new Error(`La table MySQL ${table} n'est pas vide : la copie se fait dans une base neuve.`);
  }

  await target.transaction(async (transaction) => {
    await target.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });
    for (const table of names) {
      const columns = await qi.describeTable(table);
      const dates = Object.keys(columns).filter((c) => /^DATETIME/i.test(columns[c].type));
      let copied = 0;
      for (let offset = 0; ; offset += BATCH) {
        const [rows] = await source.query(`SELECT * FROM "${table}" ORDER BY rowid LIMIT ${BATCH} OFFSET ${offset}`);
        if (!rows.length) break;
        const values = rows.map((row) => {
          const out = {};
          for (const c of Object.keys(row)) if (columns[c]) out[c] = dates.includes(c) ? toDate(row[c]) : row[c];
          return out;
        });
        await qi.bulkInsert(table, values, { transaction });
        copied += rows.length;
      }
      console.log(`${table} : ${copied}`);
    }
    await target.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
  });

  await source.close();
  await target.close();
  console.log('Copie terminée.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
