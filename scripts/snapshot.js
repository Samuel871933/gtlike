'use strict';

// Rendu HTML figé d'une partie de test (horloge et hasard arrêtés) : un fichier par page, pour vérifier qu'une
// refactorisation ne change rien à l'affichage.
//   npm run snapshot -- data/snapshot          enregistre la référence
//   npm run snapshot -- --compare data/snapshot rend à nouveau et liste les pages différentes (espaces ignorés)
// Base SQLite en mémoire : la base du jeu n'est jamais touchée.

const ROOT = require('path').join(__dirname, '..');
process.chdir(ROOT);
process.env.DB_DIALECT = 'sqlite';
process.env.SQLITE_STORAGE = ':memory:';
process.env.SITE_URL = 'https://adarma.example';

// Horloge figée : toutes les dates « maintenant » valent T.
let T = Date.UTC(2026, 9, 2, 10, 0, 0);
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [T])); }
  static now() { return T; }
};

// Hasard reproductible (placement des villages…).
let seed = 42;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const compare = args.includes('--compare');
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('Usage : npm run snapshot -- [--compare] <dossier>');
  process.exit(1);
}
const out = compare ? fs.mkdtempSync(path.join(require('os').tmpdir(), 'adarma-snapshot-')) : dir;
fs.mkdirSync(out, { recursive: true });

const { sequelize, Village, Report, Entitlement, TribeForumSection } = require('../src/models');
const createApp = require('../src/app');
const WorldService = require('../src/services/WorldService');
const AuthService = require('../src/services/AuthService');
const TribeService = require('../src/services/TribeService');
const TradeService = require('../src/services/TradeService');
const MessageService = require('../src/services/MessageService');
const VillageService = require('../src/services/VillageService');
const ReportService = require('../src/services/ReportService');

const BUILDINGS = { main: 20, barracks: 10, stable: 10, garage: 5, smith: 15, market: 10, place: 1, statue: 1, snob: 1, farm: 25, storage: 25, hide: 5, wall: 10, wood: 20, stone: 20, iron: 20 };

(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0, placement: { emptyVillages: 0 } } });
  const users = {}; const p = {}; const v = {};
  for (const name of ['Alice', 'Bob', 'Carl']) {
    users[name] = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(users[name], 'w1'));
    await Village.update({ buildings: BUILDINGS, units: { spear: 500, sword: 300, axe: 200, spy: 50, light: 100, ram: 10, snob: 0 }, wood: 50000, stone: 50000, iron: 50000, resourcesAt: new RealDate(T), research: { axe: true, light: true, spy: true, ram: true } }, { where: { id: v[name].id } });
  }
  await Entitlement.create({ scope: 'account', userId: users.Alice.id, itemKey: 'premium', startsAt: new RealDate(T - 60000), source: 'gift' });
  const tribe = await TribeService.create(p.Alice.id, { name: 'Les Ours', tag: 'OURS' });
  await TribeService.invite(p.Alice.id, 'Bob');
  const inv = (await TribeService.invitesFor(p.Bob.id))[0];
  await TribeService.acceptInvite(p.Bob.id, inv.id);
  await TribeService.invite(p.Alice.id, 'Carl');
  await TribeService.create(p.Carl.id, { name: 'Les Loups', tag: 'LOUP' }).catch(() => {});
  await TribeService.setRelation(p.Alice.id, 'LOUP', 'enemy').catch(() => {});

  await TradeService.createOffer(v.Bob.id, { sellResource: 'wood', sellAmount: 1000, buyResource: 'iron', buyAmount: 1000, count: 3 });
  await TradeService.createOffer(v.Alice.id, { sellResource: 'stone', sellAmount: 500, buyResource: 'wood', buyAmount: 600, count: 2, maxHours: 5 });
  await TradeService.send(v.Alice.id, { x: v.Bob.x, y: v.Bob.y, resources: { wood: 1000, stone: 500, iron: 0 } });
  await TradeService.send(v.Bob.id, { x: v.Alice.x, y: v.Alice.y, resources: { wood: 0, stone: 0, iron: 800 } });
  await VillageService.recruit(v.Alice.id, 'barracks', { spear: 20, sword: 5 });
  await VillageService.recruit(v.Alice.id, 'stable', { light: 4 });
  await VillageService.build(v.Alice.id, 'wall');
  await MessageService.start(p.Bob.id, { to: 'Alice', subject: 'Salut', body: 'Coucou Alice' });
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ playerId: p.Alice.id, type: ['attack', 'defense', 'trade', 'support'][i % 4], title: `Rapport ${i}`, data: { perspective: 'attacker', attackerWins: i % 3 !== 0 }, isRead: i > 4, happenedAt: new RealDate(T - i * 3600000) });
  await Report.bulkCreate(rows);
  await ReportService.createFolder(p.Alice.id, 'Espionnages', { premium: true });

  // Vrais rapports : pillage d'un barbare, attaque d'un joueur, espionnage, échange accepté ; arrivées traitées à T.
  const CommandService = require('../src/services/CommandService');
  const EventService = require('../src/services/EventService');
  const barb = await Village.findOne({ where: { playerId: null }, order: [['id', 'ASC']] });
  if (barb) await CommandService.send(v.Alice.id, { x: barb.x, y: barb.y, type: 'attack', units: { axe: 50, light: 20 } });
  await CommandService.send(v.Alice.id, { x: v.Carl.x, y: v.Carl.y, type: 'attack', units: { axe: 100, ram: 5 } });
  await CommandService.send(v.Alice.id, { x: v.Carl.x, y: v.Carl.y, type: 'attack', units: { spy: 5 } });
  const offer = await require('../src/models').MarketOffer.findOne({ where: { villageId: v.Bob.id } });
  await TradeService.acceptOffer(v.Alice.id, offer.id, 1);
  T += 6 * 3600000;
  await EventService.processDue(new Date(T), { rng: Math.random });
  T += 30000;

  const app = createApp(); await app.sessionStore.sync();
  const server = app.listen(0); const port = server.address().port;
  let cookie = '';
  const http = async (url, opts = {}) => {
    const r = await fetch(`http://localhost:${port}${url}`, { redirect: 'manual', ...opts, headers: { cookie, ...(opts.headers || {}) } });
    const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
    return { status: r.status, text: await r.text() };
  };
  const login = await http('/login');
  const csrf = login.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await http('/login', { method: 'POST', body: new URLSearchParams({ _csrf: csrf, login: 'Alice@example.com', password: 'motdepasse' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  const b = `/village/${v.Alice.id}`;
  const pages = {
    overview: b, villages: `${b}/villages`, main: `${b}/main`, mainDemolition: `${b}/main?tab=demolition`,
    barracks: `${b}/recruit/barracks`, barracksDismiss: `${b}/recruit/barracks?tab=dismiss`, stable: `${b}/recruit/stable`, garage: `${b}/recruit/garage`,
    statue: `${b}/recruit/statue`, snob: `${b}/recruit/snob`, smith: `${b}/smith`, scavenge: `${b}/scavenge`,
    place: `${b}/place`, placeTroops: `${b}/place?tab=troops`, placeSim: `${b}/place?tab=sim&att_spear=10&def_spear=5`,
    reports: `${b}/reports`, reportFolders: `${b}/reports/folders`, messages: `${b}/messages`, messagesNew: `${b}/messages/new`,
    ranking: `${b}/ranking`, rankingTribes: `${b}/ranking?type=tribes`, account: `${b}/account`,
    player: `${b}/players/${p.Bob.id}`, me: `${b}/players/${p.Alice.id}`, tribeProfile: `${b}/tribes/${tribe.id}`,
    villageInfo: `${b}/villages/${v.Bob.id}`, map: `${b}/map`,
    worlds: '/worlds', worldInfo: '/worlds/w1/info', worldRanking: '/worlds/w1/ranking', shop: '/shop',
  };
  for (const t of ['offers', 'create', 'mass', 'send', 'transports', 'merchants', 'own', 'request']) pages[`market-${t}`] = `${b}/market?tab=${t}`;
  for (const t of ['overview', 'properties', 'members', 'rights', 'invites', 'diplomacy']) pages[`tribe-${t}`] = `${b}/tribe?tab=${t}`;
  const section = await TribeForumSection.findOne({ where: { tribeId: tribe.id }, order: [['position', 'ASC']] });
  if (section) pages['tribe-forum'] = `${b}/tribe/forum/${section.id}`;
  // Une page par rapport réel d'Alice (combats, espionnage, commerce).
  const real = await Report.findAll({ where: { playerId: p.Alice.id, title: { [require('sequelize').Op.notLike]: 'Rapport %' } }, order: [['id', 'ASC']] });
  real.forEach((r, i) => { pages[`report-${i}-${r.type}`] = `${b}/reports/${r.id}`; });
  for (const [name, url] of Object.entries(pages)) {
    const r = await http(url);
    const html = r.text.replace(/name="_csrf" value="[^"]+"/g, 'name="_csrf" value="X"').replace(/"csrfToken":"[^"]+"/g, '"csrfToken":"X"').replace(/data-csrf="[^"]+"/g, 'data-csrf="X"');
    fs.writeFileSync(path.join(out, `${name}.html`), `<!-- ${r.status} -->\n${html}`);
  }
  console.log(`${Object.keys(pages).length} pages rendues`);
  if (compare) {
    // Espaces ignorés, et versions des CSS / JS (asset() : date du fichier, change à chaque modification).
    const flat = (file) => fs.readFileSync(file, 'utf8').replace(/(\/(?:css|js)\/[\w.-]+)\?v=\w+/g, '$1')
      .replace(/\s+/g, ' ').replace(/> </g, '><');
    const changed = Object.keys(pages).filter((name) => {
      const ref = path.join(dir, `${name}.html`);
      return !fs.existsSync(ref) || flat(ref) !== flat(path.join(out, `${name}.html`));
    });
    console.log(changed.length ? `Pages différentes : ${changed.join(', ')} (nouveau rendu dans ${out})` : 'Aucune différence.');
    process.exitCode = changed.length ? 1 : 0;
  }
  server.close(); await sequelize.close(); process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
