'use strict';

// Le jeu s'appelle désormais Adarma : les comptes fictifs passent de @bots.gtlike.local à @bots.adarma.local (les
// scripts de peuplement les reconnaissent à ce domaine), et le thème Basic (ex-Brume) devient Adarma.

async function up({ context: qi }) {
  await qi.sequelize.query(`UPDATE "Users" SET email = REPLACE(email, '@bots.gtlike.local', '@bots.adarma.local') WHERE email LIKE '%@bots.gtlike.local'`);
  await qi.sequelize.query(`UPDATE "Users" SET "gameStyle" = 'adarma' WHERE "gameStyle" IN ('basic', 'brume')`);
}

async function down({ context: qi }) {
  await qi.sequelize.query(`UPDATE "Users" SET email = REPLACE(email, '@bots.adarma.local', '@bots.gtlike.local') WHERE email LIKE '%@bots.adarma.local'`);
  await qi.sequelize.query(`UPDATE "Users" SET "gameStyle" = 'basic' WHERE "gameStyle" = 'adarma'`);
}

module.exports = { up, down };
