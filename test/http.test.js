'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.SITE_URL = 'https://adarma.example';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize } = require('../src/models');
const createApp = require('../src/app');
const WorldService = require('../src/services/WorldService');

let server;
let base;

/** Petit client HTTP qui garde le cookie de session. */
function client() {
  let cookie = '';
  return async (path, { method = 'GET', form } = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  };
}

const tokenOf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  const app = createApp();
  await app.sessionStore.sync();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await sequelize.close();
});

test('SEO : accueil indexable, pages privées exclues et favicon accessible', async () => {
  const http = client();
  const home = await http('/');
  assert.equal(home.status, 200);
  assert.match(home.html, /<title>Jeu de stratégie et de gestion en ligne \| Adarma<\/title>/);
  assert.match(home.html, /<h1[^>]*>Jeu de stratégie et de gestion en ligne<\/h1>/);
  assert.match(home.html, /<link rel="canonical" href="https:\/\/adarma\.example\/">/);
  assert.match(home.html, /<meta name="description"/);
  assert.match(home.html, /application\/ld\+json/);
  assert.doesNotMatch(home.html, /name="robots" content="noindex/);
  assert.match((await http('/register')).html, /href="https:\/\/adarma\.example\/register"/);
  assert.match((await http('/password/forgot')).html, /name="robots" content="noindex, follow"/);
  assert.equal((await http('/favicon.ico')).status, 200);
  assert.equal((await http('/favicon-48x48.png')).status, 200);
  assert.equal((await http('/apple-touch-icon.png')).status, 200);
  assert.match((await http('/robots.txt')).html, /Sitemap: https:\/\/adarma\.example\/sitemap\.xml/);
  const sitemap = await http('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.html, /https:\/\/adarma\.example\/help/);
  assert.doesNotMatch(sitemap.html, /\/worlds/);
});

test('CSRF : un formulaire sans jeton est refusé, avec le jeton il passe', async () => {
  const http = client();
  const page = await http('/register');
  const form = { username: 'Alice', email: 'a@example.com', password: 'motdepasse' };

  const refused = await http('/register', { method: 'POST', form });
  assert.equal(refused.status, 403);
  const wrong = await http('/register', { method: 'POST', form: { ...form, _csrf: 'faux' } });
  assert.equal(wrong.status, 403);

  const ok = await http('/register', { method: 'POST', form: { ...form, _csrf: tokenOf(page.html) } });
  assert.equal(ok.status, 302);
  assert.equal(ok.location, '/worlds');
});

test('parcours complet : inscription, entrée dans un monde, construction', async () => {
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Bob', email: 'b@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });

  // Le jeton change à la connexion (nouvelle session) : on le relit sur la page suivante.
  const worlds = await http('/worlds');
  assert.equal(worlds.status, 200);
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  assert.match(joined.location, /^\/village\/\d+$/);

  const main = await http(`${joined.location}/main`);
  const built = await http(`${joined.location}/build`, { method: 'POST', form: { building: 'wood', _csrf: tokenOf(main.html) } });
  assert.equal(built.status, 302);
  const after = await http(`${joined.location}/main`);
  // File du QG : le camp de bois niveau 1 en cours, avec son bouton d'annulation.
  assert.match(after.html, /<span class="font-semibold">Camp de bois<\/span>\s*<span class="text-\[13px\] text-parchment-500">Niveau 1<\/span>/);
  assert.match(after.html, /\/build\/\d+\/cancel/);
  // Onglet Démolition.
  assert.match((await http(`${joined.location}/main?tab=demolition`)).html, /Quartier général niveau 15/);

  // Page Compte : menu latéral, un panneau par onglet (thème par défaut), onglet inconnu ramené au thème.
  const account = (await http(`${joined.location}/account`)).html;
  assert.match(account, /aria-current="page"><span[^>]*>Thème de jeu</);
  assert.match(account, /\/account\?tab=sleep/);
  assert.doesNotMatch(account, /id="design-villages"/);
  assert.match((await http(`${joined.location}/account?tab=design`)).html, /id="design-villages"/);
  // Filtre des thèmes : possédés (Adarma, gratuit) ou à débloquer.
  const ownedThemes = (await http(`${joined.location}/account?tab=theme&own=owned`)).html;
  assert.match(ownedThemes, /name="style" value="adarma"/);
  assert.doesNotMatch(ownedThemes, /name="style" value="viking"/);
  const lockedThemes = (await http(`${joined.location}/account?tab=theme&own=locked`)).html;
  assert.match(lockedThemes, /name="style" value="viking"/);
  assert.doesNotMatch(lockedThemes, /name="style" value="adarma"/);
  assert.match((await http(`${joined.location}/account?tab=inconnu`)).html, /aria-current="page"><span[^>]*>Thème de jeu</);

  // Thème de jeu : Adarma par défaut en jeu, choix enregistré sur le compte, page d'accueil jamais stylée.
  assert.match(after.html, /data-game-style="adarma"/);
  // Thème payant pas encore possédé : refusé ; puis pack « Tous les cosmétiques » acheté pour le compte.
  await http(`${joined.location}/account/game-style`, { method: 'POST', form: { style: 'viking', _csrf: tokenOf(after.html) } });
  assert.match((await http(joined.location)).html, /data-game-style="adarma"/);
  const ShopService = require('../src/services/ShopService');
  const bobUser = await require('../src/models').User.findOne({ where: { username: 'Bob' } });
  await ShopService.credit(bobUser.id, require('../src/game/shopCatalog').item('cosmetics:all').offers.find((o) => o.id === 'account').price, 'Test');
  await ShopService.purchase(bobUser.id, { itemKey: 'cosmetics:all', offerId: 'account', waiver: true });
  const styled = await http(`${joined.location}/account/game-style`, { method: 'POST', form: { style: 'viking', _csrf: tokenOf(after.html) } });
  assert.equal(styled.status, 302);
  assert.match((await http(joined.location)).html, /class="h-full scheme-dark light:scheme-light game_style" data-game-style="viking"/);
  assert.doesNotMatch((await http('/worlds')).html, /data-game-style/);
  const unknown = await http(`${joined.location}/account/game-style`, { method: 'POST', form: { style: 'inconnu', _csrf: tokenOf(after.html) } });
  assert.equal(unknown.status, 302);
  assert.match((await http(joined.location)).html, /data-game-style="viking"/);
  // Style Médiéval (clair, couleurs de Guerre Tribale), puis retour au viking pour la suite.
  await http(`${joined.location}/account/game-style`, { method: 'POST', form: { style: 'medieval', _csrf: tokenOf(after.html) } });
  const medieval = (await http(joined.location)).html;
  assert.match(medieval, /data-game-style="medieval"/);
  assert.match(medieval, /family=Alegreya/);
  await http(`${joined.location}/account/game-style`, { method: 'POST', form: { style: 'viking', _csrf: tokenOf(after.html) } });

  // Style de jeu (densité) : minimaliste par défaut, normal enregistré sur le compte (indépendant du thème), inconnu refusé.
  assert.match(medieval, /data-game-layout="minimal" data-shadows="off"/);
  await http(`${joined.location}/account/game-layout`, { method: 'POST', form: { layout: 'normal', _csrf: tokenOf(after.html) } });
  await http(`${joined.location}/account/game-layout`, { method: 'POST', form: { layout: 'inconnu', _csrf: tokenOf(after.html) } });
  const normal = (await http(joined.location)).html;
  assert.match(normal, /data-game-style="viking" data-game-layout="normal">/);
  assert.doesNotMatch((await http('/worlds')).html, /data-game-layout/);

  // Ombres portées : retirées en normal, puis rendues ; changer de style revient au réglage par défaut (sans en minimaliste).
  const shadows = (v) => http(`${joined.location}/account/game-shadows`, { method: 'POST', form: { shadows: v, _csrf: tokenOf(after.html) } });
  await shadows('off');
  assert.match((await http(joined.location)).html, /data-game-layout="normal" data-shadows="off"/);
  assert.equal((await shadows('peut-etre')).status, 302);
  assert.match((await http(joined.location)).html, /data-shadows="off"/);
  await http(`${joined.location}/account/game-layout`, { method: 'POST', form: { layout: 'minimal', _csrf: tokenOf(after.html) } });
  assert.match((await http(joined.location)).html, /data-game-layout="minimal" data-shadows="off"/);
  await shadows('on');
  const minimalShadows = (await http(`${joined.location}/account?tab=layout`)).html;
  assert.match(minimalShadows, /data-game-layout="minimal">/);
  assert.match(minimalShadows, /id="ombres-portees"/);
  await shadows('off');

  // Design des villages : skin de ses villages, envoyé avec chaque case (vu par tous) ; beige par défaut, design inconnu refusé.
  assert.match((await http(`${joined.location}/map`)).html, /"design":"beige"/);
  await http(`${joined.location}/account/village-design`, { method: 'POST', form: { design: 'blanc-bleu', _csrf: tokenOf(after.html) } });
  assert.match((await http(`${joined.location}/map`)).html, /"design":"blanc-bleu"/);
  await http(`${joined.location}/account/village-design`, { method: 'POST', form: { design: 'inconnu', _csrf: tokenOf(after.html) } });
  assert.match((await http(`${joined.location}/map`)).html, /"design":"blanc-bleu"/);

  for (const page of ['', '/villages', '/villages?mode=prod', '/villages?mode=units', '/villages?mode=buildings', '/place', '/place?tab=troops', '/place?tab=troops&view=units', '/scavenge', '/map', '/reports', '/reports/folders', '/messages', '/tribe', '/market', '/ranking', '/ranking?type=continent', '/ranking?type=daily', '/ranking?type=daily&rec=loot', '/ranking?type=victory']) {
    const r = await http(joined.location + page);
    assert.ok([200, 302].includes(r.status), `${page} → ${r.status}`);
  }
  const simulation = await http(`${joined.location}/place?tab=sim&att_spear=10&def_spear=5&wall=2&luck=10`);
  assert.equal(simulation.status, 200);
  assert.match(simulation.html, /id="simulation-result"/);
  assert.match(simulation.html, /report-army-table/);
});

test('pages de la maquette Adarma : outils de la carte, contenus publics, mot de passe oublié', async () => {
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Carole', email: 'c@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const vid = joined.location.split('/').pop();

  // Aperçu : encart du bâtiment sélectionnable avec son bouton d'amélioration, menu des rapports dans l'en-tête.
  const overview = await http(joined.location);
  assert.match(overview.html, /data-plot-info="main"/);
  assert.match(overview.html, /data-menu="reports"/);

  const map = await http(`${joined.location}/map?find=player&q=car`);
  assert.equal(map.status, 200);
  assert.match(map.html, /data-map-menu/);
  assert.match(map.html, />Carole</, 'la recherche trouve le joueur');
  const jump = await http(`${joined.location}/map?find=coords&q=500|500`);
  assert.equal(jump.status, 302);
  assert.match(jump.location, /x=500&y=500/);

  const tpl = await http(`${joined.location}/templates`, { method: 'POST', form: { name: 'Lanciers', spear: '5', _csrf: tokenOf(overview.html) } });
  assert.equal(tpl.status, 302);
  assert.match((await http(`${joined.location}/place`)).html, /Lanciers/);
  const fav = await http(`${joined.location}/favorites/${vid}`, { method: 'POST', form: { _csrf: tokenOf(overview.html) } });
  assert.equal(fav.status, 302);

  const newThread = await http('/forum/general', { method: 'POST', form: { title: 'Bonjour', body: 'Premier message', _csrf: tokenOf(overview.html) } });
  assert.match(newThread.location, /^\/forum\/t\/\d+$/);
  assert.match((await http(newThread.location)).html, /Premier message/);
  assert.equal((await client()('/forum/general', { method: 'POST', form: { title: 'x' } })).status, 403, 'CSRF exigé');

  for (const page of [`${joined.location}/villages/${vid}`, `${joined.location}/invite`, '/rules', '/help', '/worlds/w1/info', '/forum', '/forum/general']) {
    const r = await http(page);
    assert.equal(r.status, 200, `${page} → ${r.status}`);
  }

  // Forum de la tribu : onglet de la page Tribu, sujet créé puis affiché.
  await http(`${joined.location}/tribe/create`, { method: 'POST', form: { name: 'Les Carolingiens', tag: 'CARO', _csrf: tokenOf(overview.html) } });
  const tab = await http(`${joined.location}/tribe?tab=forum`);
  assert.equal(tab.status, 302, "l'onglet Forum ouvre le premier sous-forum");
  const tforum = await http(tab.location);
  assert.equal(tforum.status, 200);
  for (const name of ['Annonces', 'Attaque', 'Défense', 'Taverne', 'Vacances', 'Suggestions']) assert.match(tforum.html, new RegExp(`>\\s*${name}\\s*<`));
  assert.match(tforum.html, /Nouveaux messages du forum/);
  const sectionId = tab.location.match(/\/tribe\/forum\/(\d+)$/)[1];
  assert.equal((await http(`${tab.location}?nouveau=sondage`)).status, 200);
  const tthread = await http(`${joined.location}/tribe/forum/${sectionId}`, { method: 'POST', form: { title: 'Plan', body: 'Attaque à 20 h', _csrf: tokenOf(overview.html) } });
  assert.match(tthread.location, /\/tribe\/forum\/t\/\d+$/);
  assert.match((await http(tthread.location)).html, /Attaque à 20 h/);
  // Réglages du forum : forum caché et forums partagés.
  const fsettings = await http(`${joined.location}/tribe/forum/settings`);
  assert.equal(fsettings.status, 200);
  assert.match(fsettings.html, /Forums partagés/);
  const hidden = await http(`${joined.location}/tribe/forum/sections/${sectionId}/hidden`, { method: 'POST', form: { on: '1', _csrf: tokenOf(overview.html) } });
  assert.match(hidden.location, /\/tribe\/forum\/settings$/);
  assert.match((await http(tab.location)).html, /Caché/);

  // Opérations de la tribu : onglet, création, page de l'opération et ajout d'une cible par coordonnées.
  assert.match((await http(`${joined.location}/tribe?tab=operations`)).html, /Nouvelle opération/);
  const created = await http(`${joined.location}/tribe/operations`, { method: 'POST', form: { name: 'Aube rouge', color: '#ff0000', tags: '', _csrf: tokenOf(overview.html) } });
  assert.match(created.location, /\/tribe\/operations\/\d+$/);
  const [, vx, vy] = (await http(created.location)).html.match(/(\d+)\|(\d+)/) || [];
  const added = await http(`${created.location}/targets`, { method: 'POST', form: { coords: `${vx}|${vy}`, count: '2', axe: '4000', arrival: '2026-10-07T20:00:00', stagger: '0', _csrf: tokenOf(overview.html) } });
  assert.equal(added.status, 302);
  const opPage = await http(created.location);
  assert.equal(opPage.status, 200);
  assert.match(opPage.html, />Prendre</);
  assert.match(opPage.html, /0 \/ 2/);
  const targetId = opPage.html.match(/\/targets\/(\d+)\/claim/)[1];
  await http(`${joined.location}/tribe/operations/targets/${targetId}/claim`, { method: 'POST', form: { _csrf: tokenOf(overview.html) } });
  const mine = await http(`${created.location}?vue=mine`);
  assert.equal(mine.status, 200);
  assert.match(mine.html, /Ta feuille de route/);
  // Aperçu du village ciblé : résumé de l'opération, avec la place revendiquée.
  const ownVillage = await http(`${joined.location}/villages/${vid}`);
  assert.match(ownVillage.html, /Opérations de la tribu/);
  assert.match(ownVillage.html, /Libérer les attaques cochées/);
  assert.match((await http(`${created.location}?vue=player&j=0`)).html, /Toutes les cibles/);

  const anon = client();
  const forgot = await anon('/password/forgot');
  assert.equal(forgot.status, 200);
  const sent = await anon('/password/forgot', { method: 'POST', form: { email: 'c@example.com', _csrf: tokenOf(forgot.html) } });
  assert.match(sent.html, /Si un compte utilise cette adresse/);
  assert.equal((await anon(`/password/reset/${'0'.repeat(64)}`)).status, 400);
});

test('bâtiments favoris : l’étoile ajoute ou retire un bâtiment de la barre d’accès rapide', async () => {
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Fanny', email: 'f@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const quickbar = (html) => html.match(/<nav[^>]*data-quickbar[^>]*>([\s\S]*?)<\/nav>/)[1];

  // Par défaut : les bâtiments construits de la barre (QG, point de ralliement…).
  const page = await http(joined.location);
  assert.match(quickbar(page.html), /Quartier général/);
  assert.doesNotMatch(quickbar(page.html), /Camp de bois/);

  const add = await http(`${joined.location}/buildings/wood/favorite`, { method: 'POST', form: { _csrf: tokenOf(page.html) } });
  assert.equal(add.status, 302);
  const after = await http(joined.location);
  assert.match(quickbar(after.html), /Camp de bois/);
  assert.match(after.html, /data-fav="wood" aria-pressed="true"/);

  await http(`${joined.location}/buildings/main/favorite`, { method: 'POST', form: { _csrf: tokenOf(after.html) } });
  assert.doesNotMatch(quickbar((await http(joined.location)).html), /Quartier général/);
  const unknown = await http(`${joined.location}/buildings/church/favorite`, { method: 'POST', form: { _csrf: tokenOf(after.html) } });
  assert.equal(unknown.status, 404);
});

test('classement : menu des types, page du joueur, aller à un rang, recherche', async () => {
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Gaston', email: 'g@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const page = await http(`${joined.location}/ranking`);
  assert.match(page.html, /aria-label="Classements"/);
  assert.match(page.html, /Page 1 \/ 1/);
  assert.match(page.html, /Points par village/);
  assert.match((await http(`${joined.location}/ranking?rank=1`)).html, /Page 1 \/ 1/);
  assert.match((await http(`${joined.location}/ranking?q=gast`)).html, /Gaston/);
  assert.match((await http(`${joined.location}/ranking?q=personne`)).html, /Aucun résultat pour « personne »/);
  for (const q of ['?type=tribes', '?type=continent&of=tribes', '?type=kills&kind=def', '?type=kills&of=tribes&kind=att', '?type=awards']) {
    assert.equal((await http(`${joined.location}/ranking${q}`)).status, 200, q);
  }
});

test('carte : tailles et calques mémorisés sur le joueur, marquages', async () => {
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Hugo', email: 'h@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const map = `${joined.location}/map`;

  // Tailles de Guerre Tribale, mémorisées : la page suivante les garde sans paramètre.
  await http(`${map}?size=30&mini=120`);
  const again = await http(map);
  assert.match(again.html, /data-map data-size="30"/);
  assert.match(again.html, /data-mini-map data-size="120"/);
  assert.equal((await http(`${map}?size=12`)).status, 200);
  assert.match((await http(map)).html, /data-map data-size="30"/, 'une taille inconnue ne remplace pas la taille mémorisée');

  // Calque désactivé : plus rendu sur la grille.
  const token = tokenOf(again.html);
  const frameOf = (html) => html.match(/<div class="map-frame[^>]*>/)[0];
  // Quadrillage désactivé par défaut : on l'active puis on le désactive.
  assert.doesNotMatch(frameOf(again.html), /data-layer-grid/);
  await http(`${map}/layers`, { method: 'POST', form: { _csrf: token, layer: 'grid', on: '1' } });
  assert.match(frameOf((await http(map)).html), /data-layer-grid/);
  await http(`${map}/layers`, { method: 'POST', form: { _csrf: token, layer: 'grid', on: '0' } });
  assert.doesNotMatch(frameOf((await http(map)).html), /data-layer-grid/);

  // Données chargées pendant les déplacements : secteur de 20 × 20 et mini-carte.
  const [, x, y] = again.html.match(/data-me="(\d+)\|(\d+)"/);
  const sector = JSON.parse((await http(`${map}/sector?sx=${Math.floor(x / 20)}&sy=${Math.floor(y / 20)}`)).html);
  assert.ok(sector.cells.some((c) => c.kind === 'current' && c.x === Number(x) && c.y === Number(y)));
  assert.equal((await http(`${map}/sector?sx=-1&sy=0`)).status, 404);
  const mini = JSON.parse((await http(`${map}/mini?x0=${x - 10}&y0=${y - 10}&size=20`)).html);
  assert.ok(mini.some(([mx, my, kind]) => mx === Number(x) && my === Number(y) && kind === 'current'));

  // Taille changée en direct (map.js) puis mémorisée ; carte du monde chargée à l'ouverture de sa fenêtre.
  const saved = await http(`${map}/settings`, { method: 'POST', form: { _csrf: token, size: '9' } });
  assert.equal(saved.status, 302);
  assert.match((await http(map)).html, /data-map data-size="9"/);
  const world = JSON.parse((await http(`${map}/world`)).html);
  assert.ok(world.size > 0 && world.villages.some(([wx, wy, kind]) => wx === Number(x) && wy === Number(y) && kind === 'current'));

  // Marquage d'un village par ses coordonnées, puis suppression.
  const set = await http(`${map}/markers`, { method: 'POST', form: { _csrf: token, type: 'village', target: `${x}|${y}`, color: '#22c55e' } });
  assert.equal(set.status, 302);
  const marked = await http(map);
  assert.match(marked.html, /"mark":"#22c55e"/);
  const id = marked.html.match(/map\/markers\/(\d+)\/delete/)[1];
  await http(`${map}/markers/${id}/delete`, { method: 'POST', form: { _csrf: token } });
  assert.doesNotMatch((await http(map)).html, /"mark":"#22c55e"/);
  const bad = await http(`${map}/markers`, { method: 'POST', form: { _csrf: token, type: 'player', target: 'Personne', color: '#22c55e' } });
  assert.equal(bad.status, 302, 'cible inconnue : message d’erreur et retour à la carte');

  // Couleur libre (sélecteur de couleur) : tout #rrggbb, rangé en minuscules ; le reste est refusé.
  await http(`${map}/markers`, { method: 'POST', form: { _csrf: token, type: 'village', target: `${x}|${y}`, color: '#1A2B3C' } });
  const free = await http(map);
  assert.match(free.html, /"mark":"#1a2b3c"/);
  assert.match(free.html, /type="color" name="color"/);
  await http(`${map}/markers`, { method: 'POST', form: { _csrf: token, type: 'village', target: `${x}|${y}`, color: 'red;background:url(x)' } });
  const after = await http(map);
  assert.match(after.html, /"mark":"#1a2b3c"/, 'couleur invalide : le marquage garde sa couleur');
  assert.doesNotMatch(after.html, /url\(x\)/);
});

test('bâtiments : la date de disponibilité des ressources s\'affiche quand elles manquent', async () => {
  const { Village } = require('../src/models');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Dora', email: 'd@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const id = Number(joined.location.split('/').pop());
  const village = await Village.findByPk(id);
  await village.update({
    wood: 0, stone: 0, iron: 0, resourcesAt: new Date(),
    buildings: { ...village.buildings, main: 20, farm: 30, storage: 30, smith: 20, barracks: 10, stable: 10, market: 10, snob: 1, wood: 5, stone: 5, iron: 5 },
  });
  for (const path of ['main', 'building/wood', 'recruit/snob', 'recruit/barracks', 'smith', '']) {
    const page = await http(`${joined.location}/${path}`.replace(/\/$/, ''));
    assert.equal(page.status, 200, path);
    assert.match(page.html, /Ressources disponibles (aujourd&#39;hui|demain|le )/, path);
  }
});

test('messagerie : boîte, écriture avec groupe de tribu, mail circulaire, effacement groupé ; droits de tribu', async () => {
  const { Player } = require('../src/models');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Ines', email: 'i@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const m = `${joined.location}/messages`;

  const tribe = await http(`${joined.location}/tribe`);
  await http(`${joined.location}/tribe/create`, { method: 'POST', form: { name: 'Les Cerfs', tag: 'CERF', _csrf: tokenOf(tribe.html) } });
  const bob = await Player.findOne({ where: { name: 'Bob' } });
  await Player.update({ tribeId: (await Player.findOne({ where: { name: 'Ines' } })).tribeId, tribeRole: 'member' }, { where: { id: bob.id } });

  const overview = await http(`${joined.location}/tribe`);
  assert.match(overview.html, /a fondé la tribu/);
  assert.match(overview.html, /Annonces internes/);
  await http(`${joined.location}/tribe/announcement`, { method: 'POST', form: { announcement: 'Pour toute question : Ines', _csrf: tokenOf(overview.html) } });
  const feed = await http(`${joined.location}/tribe?tab=overview&cat=misc`);
  assert.match(feed.html, /Pour toute question : Ines/);
  assert.match(feed.html, /a modifié les annonces internes/);
  assert.equal((await http(`${joined.location}/tribe?tab=properties`)).status, 200);
  const members = await http(`${joined.location}/tribe?tab=rights`);
  assert.match(members.html, /Courrier circulaire/);
  assert.equal((members.html.match(/>Enregistrer</g) || []).length, 1, 'un seul bouton Enregistrer pour tous les membres');
  await http(`${joined.location}/tribe/rights`, { method: 'POST', form: { members: String(bob.id), [`title-${bob.id}`]: 'member', [`rights-${bob.id}`]: 'forumMod', _csrf: tokenOf(members.html) } });
  assert.deepEqual((await Player.findByPk(bob.id)).tribeRights, ['forumMod']);

  const form = await http(`${m}/new`);
  assert.match(form.html, /data-group="tribe"/);
  const refused = await http(m, { method: 'POST', form: { to: '', group: '', subject: 'Garder', body: 'Texte conservé', _csrf: tokenOf(form.html) } });
  assert.equal(refused.status, 422);
  assert.match(refused.html, /Texte conservé/);
  const sent = await http(m, { method: 'POST', form: { to: '', group: 'tribe', subject: 'Rassemblement', body: 'Ce soir', _csrf: tokenOf(form.html) } });
  assert.match(sent.location, /\/messages\/\d+$/);

  const circ = await http(`${m}/circular`);
  assert.match(circ.html, /Rassemblement/);
  const inbox = await http(m);
  assert.match(inbox.html, /Tribu entière/);
  const id = sent.location.split('/').pop();
  await http(`${m}/delete`, { method: 'POST', form: { ids: id, _csrf: tokenOf(inbox.html) } });
  assert.doesNotMatch((await http(m)).html, /Rassemblement/);
  const v = joined.location;
  await http(`${v}/per-page`, { method: 'POST', form: { list: 'messages', perPage: '30', _csrf: tokenOf(inbox.html) } });
  assert.match((await http(m)).html, /name="perPage"[^>]*value="30"/);
  // Même réglage commun pour les rapports ; valeur hors bornes refusée.
  await http(`${v}/per-page`, { method: 'POST', form: { list: 'reports', perPage: '40', _csrf: tokenOf(inbox.html) } });
  assert.match((await http(`${v}/reports`)).html, /name="perPage"[^>]*value="40"/);
  await http(`${v}/per-page`, { method: 'POST', form: { list: 'reports', perPage: '9999', _csrf: tokenOf(inbox.html) } });
  assert.match((await http(`${v}/reports`)).html, /name="perPage"[^>]*value="40"/);

  // Archives de rapports : réservées au premium ; dossier créé, rapport archivé puis lu dans son dossier.
  const { Entitlement, Village: VillageModel, Player: PlayerModel, Report } = require('../src/models');
  const owner = await PlayerModel.findByPk((await VillageModel.findByPk(Number(v.split('/').pop()))).playerId);
  assert.match((await http(`${v}/reports/folders`)).html, /réservées au premium/);
  await http(`${v}/reports/folders`, { method: 'POST', form: { name: 'Refusé', _csrf: tokenOf(inbox.html) } });
  assert.match((await http(`${v}/reports/folders`)).html, /Aucun dossier/);
  await Entitlement.create({ scope: 'account', userId: owner.userId, itemKey: 'premium', startsAt: new Date(Date.now() - 60000), source: 'gift' });
  await http(`${v}/reports/folders`, { method: 'POST', form: { name: 'Espionnages', _csrf: tokenOf(inbox.html) } });
  const folders = await http(`${v}/reports/folders`);
  const folderId = folders.html.match(/reports\?folder=(\d+)/)[1];
  const report = await Report.create({ playerId: owner.id, type: 'attack', title: 'Espionnage de test', data: { perspective: 'attacker', attackerWins: null }, happenedAt: new Date() });
  await http(`${v}/reports/bulk`, { method: 'POST', form: { action: 'move', ids: String(report.id), folder: folderId, _csrf: tokenOf(inbox.html) } });
  assert.doesNotMatch((await http(`${v}/reports`)).html, /Espionnage de test/);
  const archived = await http(`${v}/reports?folder=${folderId}`);
  assert.match(archived.html, /Espionnage de test/);
  assert.match(archived.html, /Rapports archivés/);
  await http(`${v}/reports/archive-months`, { method: 'POST', form: { months: '12', _csrf: tokenOf(inbox.html) } });
  assert.match((await http(`${v}/reports/folders`)).html, /value="12" selected/);
});

test('fin du monde : dans le menu des classements, une page par type de victoire, ancienne adresse redirigée', async () => {
  const { World } = require('../src/models');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Jules', email: 'j@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const village = await http(joined.location);
  assert.doesNotMatch(village.html, /\/victory"/, "plus de lien direct dans l'en-tête ni le pied de page");

  const old = await http(`${joined.location}/victory`);
  assert.equal(old.location, `${joined.location}/ranking?type=victory`);
  const world = await World.findOne({ where: { slug: 'w1' } });
  const expected = {
    dominance: ['Dominance du monde', 'Top des tribus par dominance', 'Compte à rebours de dominance', 'Votre contribution'],
    pointsVillages: ['Points et villages', 'Top des tribus par points', 'Top villages'],
    runes: ['Guerres runiques', 'Top des tribus par continents remplis', 'Apparition des runes', 'de chaque continent'],
    siege: ['Grand Siège', 'Top des tribus par influence', "Baisse de l&#39;objectif"],
  };
  for (const [type, texts] of Object.entries(expected)) {
    await world.update({ config: { ...world.config, victory: { type } } });
    const page = await http(`${joined.location}/ranking?type=victory`);
    assert.equal(page.status, 200, type);
    for (const text of texts) assert.ok(page.html.includes(text), `${type} : ${text}`);
  }
  const lobby = await http('/worlds/w1/ranking?type=victory');
  assert.equal(lobby.status, 200);
  await world.update({ config: { ...world.config, victory: { type: 'dominance' } } });
});

test('aperçu d’un village : fiche, carnet de notes, propres ordres, rapports ; modèle d’armée au point de ralliement', async () => {
  const { Village, Player, Report } = require('../src/models');
  const CommandService = require('../src/services/CommandService');
  const ArmyTemplateService = require('../src/services/ArmyTemplateService');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Kiki', email: 'k@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const mine = await Village.findByPk(Number(joined.location.split('/').pop()));
  await mine.update({ units: { axe: 50, spy: 5 }, buildings: { ...mine.buildings, place: 1 } });
  const target = await Village.findOne({ where: { playerId: { [require('sequelize').Op.ne]: mine.playerId } } });
  await CommandService.send(mine.id, { x: target.x, y: target.y, type: 'support', units: { axe: 10 } });
  await Report.create({ playerId: mine.playerId, type: 'attack', title: 'Kiki attaque la cible', happenedAt: new Date(), data: { attacker: { units: { axe: 1 }, losses: {} }, defender: { villageId: target.id } } });

  const page = await http(`${joined.location}/villages/${target.id}`);
  assert.equal(page.status, 200);
  for (const text of ['Carnet de notes', 'Propres ordres (1)', 'Soutien depuis', 'Kiki attaque la cible', 'data-minimap', 'Envoyer des troupes']) assert.ok(page.html.includes(text), text);

  await http(`${joined.location}/villages/${target.id}/note`, { method: 'POST', form: { text: 'Cible à nobler dimanche', _csrf: tokenOf(page.html) } });
  assert.match((await http(`${joined.location}/villages/${target.id}`)).html, /Cible à nobler dimanche/);

  const player = await Player.findByPk(mine.playerId);
  const tpl = await ArmyTemplateService.create(player.id, { name: 'Nettoyage', axe: 7 }, (await require('../src/models').World.findOne({ where: { slug: 'w1' } })).getConfig());
  const place = await http(`${joined.location}/place?x=${target.x}&y=${target.y}&tpl=${tpl.id}`);
  assert.match(place.html, /name="axe"[^>]*value="7"/);
  // Colonne des modèles : « Toutes les troupes » d'abord (toutes les unités du village), puis ceux du joueur.
  assert.match(place.html, /aria-label="Modèles de troupes"[\s\S]*Toutes les troupes[\s\S]*Nettoyage/);
  const troops = await http(`${joined.location}/place?tab=troops`);
  assert.equal(troops.status, 200);
  assert.ok(troops.html.includes(`href="${joined.location}/villages/${target.id}"`), 'le village en campagne ouvre son aperçu');
  assert.ok(!troops.html.includes(`href="${joined.location}/map?x=${target.x}&amp;y=${target.y}"`), 'son nom ne centre plus la carte');
});

test('réglages tribu du compte : colonnes Partager avec la tribu / Afficher la tribu', async () => {
  const { Player } = require('../src/models');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Lola', email: 'l@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const account = await http(`${joined.location}/account?tab=tribe-settings`);
  assert.match(account.html, /Partager avec la tribu/);
  assert.match(account.html, /Notes de village/);
  assert.match(account.html, /Ordres de troupes/);
  await http(`${joined.location}/account/tribe-settings`, { method: 'POST', form: { shareVillageNotes: '1', shareTribeOrders: '1', showTribeOrders: '1', _csrf: tokenOf(account.html) } });
  const lola = await Player.findOne({ where: { name: 'Lola' } });
  assert.equal(lola.shareVillageNotes, true);
  assert.equal(lola.showTribeNotes, false);
  assert.equal(lola.shareTribeOrders, true);
  assert.equal(lola.showTribeOrders, true);
});

test('marché comme sur GT : pages du menu, préremplissage, offres en masse, demande', async () => {
  const { Village, MarketOffer, Transport } = require('../src/models');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Momo', email: 'mo@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const home = await Village.findByPk(Number(joined.location.split('/').pop()));
  const buildings = { ...home.buildings, market: 5, storage: 20 };
  await home.update({ buildings, wood: 9000, stone: 2000, iron: 5000, resourcesAt: new Date() });
  // Un deuxième village pour les offres en masse et la demande.
  const second = await Village.findOne({ where: { playerId: null } });
  await second.update({ playerId: home.playerId, name: 'Second', buildings, wood: 4000, stone: 4000, iron: 4000, resourcesAt: new Date() });
  const m = `${joined.location}/market`;

  for (const tab of ['offers', 'create', 'mass', 'send', 'transports', 'merchants', 'own', 'request']) {
    const page = await http(`${m}?tab=${tab}`);
    assert.equal(page.status, 200, tab);
    assert.match(page.html, /Quantité de transport maximale/, tab);
  }
  const create = await http(`${m}?tab=create`);
  assert.match(create.html, /name="sellResource" value="wood" checked/, 'j’offre ce que j’ai le plus');
  assert.match(create.html, /name="buyResource" value="stone" checked/, 'je veux ce que j’ai le moins');
  assert.equal((await http(`${m}?tab=mine`)).status, 200, 'ancienne adresse');

  const token = tokenOf(create.html);
  await http(`${m}/mass`, { method: 'POST', form: { sellResource: 'wood', sellAmount: '1000', buyResource: 'iron', buyAmount: '1000', [`count_${home.id}`]: '2', [`count_${second.id}`]: '1', _csrf: token } });
  assert.equal(await MarketOffer.sum('count', { where: { villageId: [home.id, second.id] } }), 3);
  assert.match((await http(`${m}?tab=own`)).html, /Second/);

  await http(`${m}/request`, { method: 'POST', form: { [`iron_${second.id}`]: '1000', _csrf: token } });
  const tr = await Transport.findOne({ where: { originVillageId: second.id, targetVillageId: home.id, type: 'delivery' } });
  assert.equal(tr.resources.iron, 1000);
});

test('ferme : population maximale et population actuelle détaillée, total égal à la population occupée', async () => {
  const { Village } = require('../src/models');
  const VillageService = require('../src/services/VillageService');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Nina', email: 'n@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const id = Number(joined.location.split('/').pop());
  await Village.update({ units: { spear: 40, axe: 10 } }, { where: { id } });
  const page = await http(`${joined.location}/building/farm`);
  assert.match(page.html, /Population maximum/);
  assert.match(page.html, /Troupes en cours de production/);
  const used = await VillageService.withVillage(id, (ctx) => ctx.popUsed());
  const total = page.html.match(/font-semibold">Tout<\/td><td[^>]*>([\d\s  ]+)/)[1].replace(/\D/g, '');
  assert.equal(Number(total), used);
});

test('profil public de tribu : description visible, diplomatie et annonces internes privées', async () => {
  const { Village } = require('../src/models');
  const TribeService = require('../src/services/TribeService');
  const join = async (username, email) => {
    const http = client();
    const reg = await http('/register');
    await http('/register', { method: 'POST', form: { username, email, password: 'motdepasse', _csrf: tokenOf(reg.html) } });
    const worlds = await http('/worlds');
    const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
    const village = await Village.findByPk(Number(joined.location.split('/').pop()));
    return { http, village };
  };
  const owner = await join('PriveAlice', 'prive-alice@example.com');
  const outsider = await join('PriveBob', 'prive-bob@example.com');
  const visitor = await join('PriveVisiteur', 'prive-visiteur@example.com');
  const tribe = await TribeService.create(owner.village.playerId, { name: 'Tribu privée', tag: 'PRIV' });
  await TribeService.create(outsider.village.playerId, { name: 'Tribu extérieure', tag: 'AUTRE' });
  await TribeService.updateDescription(owner.village.playerId, 'Présentation publique de la tribu');
  await TribeService.updateAnnouncement(owner.village.playerId, 'Plan interne secret');
  await TribeService.setRelation(owner.village.playerId, 'AUTRE', 'enemy');

  const publicUrl = `/village/${visitor.village.id}/tribes/${tribe.id}`;
  const publicPage = await visitor.http(publicUrl);
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.html, /<span class="min-w-0 truncate">Description<\/span>/);
  assert.match(publicPage.html, /Présentation publique de la tribu/);
  for (const secret of ['Diplomatie', 'Tribu extérieure', 'AUTRE', 'Plan interne secret']) {
    assert.doesNotMatch(publicPage.html, new RegExp(secret), `${secret} ne doit pas figurer sur le profil public`);
  }
  const ownPublicPage = await owner.http(`/village/${owner.village.id}/tribes/${tribe.id}`);
  assert.doesNotMatch(ownPublicPage.html, /<span class="min-w-0 truncate">Diplomatie<\/span>|AUTRE|Plan interne secret/, 'le profil public ne révèle rien, même à un membre');
  const internalPage = await owner.http(`/village/${owner.village.id}/tribe?tab=diplomacy`);
  assert.equal(internalPage.status, 200);
  assert.match(internalPage.html, /Diplomatie/);
  assert.match(internalPage.html, /AUTRE/);
});

test('profil d’un joueur : son contenu dans le thème de jeu de son propriétaire', async () => {
  const join = async (name) => {
    const http = client();
    const reg = await http('/register');
    await http('/register', { method: 'POST', form: { username: name, email: `${name}@example.com`, password: 'motdepasse', _csrf: tokenOf(reg.html) } });
    const worlds = await http('/worlds');
    const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
    return { http, at: joined.location };
  };
  const owner = await join('Ysolde');
  const page = await owner.http(owner.at);
  const ShopService = require('../src/services/ShopService');
  const ysoldeUser = await require('../src/models').User.findOne({ where: { username: 'Ysolde' } });
  await ShopService.credit(ysoldeUser.id, 1200, 'Test');
  await ShopService.purchase(ysoldeUser.id, { itemKey: 'theme:egypt', offerId: 'account', waiver: true });
  await owner.http(`${owner.at}/account/game-style`, { method: 'POST', form: { style: 'egypt', _csrf: tokenOf(page.html) } });
  const { Player } = require('../src/models');
  const ysolde = await Player.findOne({ where: { name: 'Ysolde' } });

  const visitor = await join('Tristan');
  assert.match((await visitor.http(visitor.at)).html, /data-game-style="adarma"/, 'son propre thème ailleurs');
  const profile = (await visitor.http(`${visitor.at}/players/${ysolde.id}`)).html;
  // En-tête et pied de page dans le thème du visiteur, contenu du profil dans celui du propriétaire.
  assert.match(profile, /<html[^>]*data-game-style="adarma"/);
  assert.match(profile, /<div class="contents[^"]*" data-game-style="egypt">/);
  assert.match(profile, /family=El\+Messiri/, 'polices du thème chargées');
});

test('carte : un secteur rechargé après une arrivée montre le retour sur le village attaqué, sans attendre la boucle de jeu', async () => {
  const { Village, Command } = require('../src/models');
  const CommandService = require('../src/services/CommandService');
  const mapView = require('../src/web/mapView');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Ragnhild', email: 'r@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const home = await Village.findByPk(Number(joined.location.match(/\/village\/(\d+)/)[1]));
  const barb = await Village.findOne({ where: { worldId: home.worldId, playerId: null } });
  await home.update({ units: { axe: 30 }, buildings: { ...home.buildings, place: 1 } });
  const cmd = await CommandService.send(home.id, { x: barb.x, y: barb.y, type: 'attack', units: { axe: 30 } });
  // L'attaque est arrivée, mais la boucle de jeu n'est pas passée.
  await cmd.update({ startsAt: new Date(Date.now() - 60000), arrivesAt: new Date(Date.now() - 1000) });
  const sectorOf = async (v) => JSON.parse((await http(`${joined.location}/map/sector?sx=${Math.floor(v.x / mapView.SECTOR)}&sy=${Math.floor(v.y / mapView.SECTOR)}`)).html);
  // Le retour s'affiche sur le village attaqué (d'où les troupes reviennent), avec le village où elles rentrent.
  const orders = (await sectorOf(barb)).cells.find((c) => c.id === barb.id).orders.own;
  assert.deepEqual(orders.map((o) => o.type), ['return']);
  assert.deepEqual([orders[0].x, orders[0].y], [home.x, home.y]);
  assert.ok(!((await sectorOf(home)).cells.find((c) => c.id === home.id).orders?.own || []).length, 'rien sur le village d’origine');
  assert.equal(await Command.count({ where: { id: cmd.id } }), 0, 'attaque résolue');
});

test('aperçu du village : 9 premiers mouvements, nombres d’ordres de chaque onglet et lien vers les autres', async () => {
  const { Village, Command } = require('../src/models');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Mouvant', email: 'mv@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const home = await Village.findByPk(Number(joined.location.match(/\/village\/(\d+)/)[1]));
  const barb = await Village.findOne({ where: { worldId: home.worldId, playerId: null } });
  const soon = (min) => new Date(Date.now() + min * 60000);
  for (let i = 0; i < 12; i++) {
    await Command.create({ worldId: home.worldId, type: 'attack', originVillageId: home.id, targetVillageId: barb.id, units: { axe: 1 }, startsAt: new Date(), arrivesAt: soon(10 + i) });
  }
  await Command.create({ worldId: home.worldId, type: 'attack', originVillageId: barb.id, targetVillageId: home.id, units: { axe: 1 }, startsAt: new Date(), arrivesAt: soon(60) });
  // Une attaque arrive : onglet Entrants par défaut ; les nombres comptent tous les ordres.
  const page = (await http(joined.location)).html;
  assert.match(page, /Tous \(13\)/);
  assert.match(page, /Entrants \(1\)/);
  assert.match(page, /Sortants \(12\)/);
  const all = (await http(`${joined.location}?mv=all`)).html;
  assert.match(all, /Afficher les 4 autres ordres/);
  assert.doesNotMatch((await http(`${joined.location}?mv=all&tous=1`)).html, /autres ordres/);
});

test('carte : plusieurs secteurs en une requête, hors carte ignorés', async () => {
  const { Village } = require('../src/models');
  const mapView = require('../src/web/mapView');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Secteurs', email: 'secteurs@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const home = await Village.findByPk(Number(joined.location.match(/\/village\/(\d+)/)[1]));
  const sx = Math.floor(home.x / mapView.SECTOR);
  const sy = Math.floor(home.y / mapView.SECTOR);
  const res = await http(`${joined.location}/map/sectors?s=${sx}.${sy},${sx + 1}.${sy},-1.0,9999.0`);
  const list = JSON.parse(res.html);
  assert.deepEqual(list.map((s) => [s.sx, s.sy]), [[sx, sy], [sx + 1, sy]]);
  assert.ok(list[0].cells.some((c) => c.id === home.id));
  assert.ok(list[1].cells.every((c) => Math.floor(c.x / mapView.SECTOR) === sx + 1));
  // Même contenu que le secteur seul.
  const single = JSON.parse((await http(`${joined.location}/map/sector?sx=${sx}&sy=${sy}`)).html);
  assert.deepEqual(single.cells.map((c) => c.id).sort(), list[0].cells.map((c) => c.id).sort());
});

test('confirmation d’attaque : attaques supplémentaires envoyées à la suite', async () => {
  const { Village, Command } = require('../src/models');
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Multi', email: 'multi@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const vid = Number(joined.location.split('/').pop());
  await Village.update({ buildings: { main: 5, farm: 10, storage: 10, place: 1, barracks: 5 }, units: { axe: 90 } }, { where: { id: vid } });
  const barb = await Village.findOne({ where: { playerId: null } });
  const csrf = tokenOf((await http(joined.location)).html);
  const order = { x: barb.x, y: barb.y, type: 'attack', axe: 30, _csrf: csrf };

  const confirm = await http(`${joined.location}/place/confirm`, { method: 'POST', form: order });
  assert.match(confirm.html, /data-multi-attack/);
  assert.match(confirm.html, /Ajouter une attaque supplémentaire/);
  const sent = await http(`${joined.location}/place/send`, { method: 'POST', form: { ...order, extra_2_axe: 30, extra_3_axe: 30, extra_4_axe: '' } });
  assert.equal(sent.status, 302);
  const cmds = await Command.findAll({ where: { originVillageId: vid }, order: [['arrivesAt', 'ASC']] });
  assert.equal(cmds.length, 3);
  assert.deepEqual(cmds.map((c) => c.units.axe), [30, 30, 30]);
  assert.equal(+cmds[2].arrivesAt - +cmds[1].arrivesAt, 100);
});

test('pages légales : publiques, liées depuis le pied de page et l’inscription', async () => {
  const anon = client();
  const pages = ['/mentions-legales', '/cgu', '/cgv', '/confidentialite', '/cookies'];
  for (const page of pages) {
    const r = await anon(page);
    assert.equal(r.status, 200, `${page} → ${r.status}`);
    assert.match(r.html, /Dernière mise à jour : 1er octobre 2026/);
    assert.match(r.html, /aria-label="Sommaire"/);
  }
  // Pied de page hors partie (visiteur) et en jeu.
  const home = await anon('/rules');
  for (const page of pages) assert.match(home.html, new RegExp(`<footer[\\s\\S]*href="${page}"`));
  const reg = await anon('/register');
  assert.match(reg.html, /En créant un compte, vous acceptez les <a href="\/cgu"/);
  assert.match(reg.html, /href="\/confidentialite"/);

  const http = client();
  const form = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Legiste', email: 'legiste@example.com', password: 'motdepasse', _csrf: tokenOf(form.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const village = await http(joined.location);
  assert.match(village.html, /Réglages du monde/);
  for (const page of pages) assert.match(village.html, new RegExp(`<footer[\\s\\S]*href="${page}"`));
});

test('boutique : catalogue, offres, achat en Adartons, packs en construction, mes achats', async () => {
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Marchande', email: 'marchande@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  assert.equal((await http('/shop')).status, 200);
  const item = await http('/shop/item/theme:roman');
  assert.match(item.html, /name="waiver"/);
  // Venue d'un monde (?world=slug) : portée « un monde » proposée, ce monde présélectionné, gardé jusqu'à « Mes achats ».
  const worlds = await http('/worlds');
  await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const fromWorld = await http('/shop/item/premium?world=w1');
  assert.match(fromWorld.html, /name="scope" value="world"[^>]*checked/);
  assert.match(fromWorld.html, /<option value="\d+" selected>Monde 1<\/option>/);
  assert.match(fromWorld.html, /action="\/shop\/buy\?world=w1"/);
  assert.match(fromWorld.html, /href="\/shop\?world=w1"/);
  assert.equal((await http('/shop/item/inconnu')).status, 404);
  assert.match((await http('/shop/adartons')).html, /\/shop\/coming-soon\?pack=pack-200/);
  assert.match((await http('/shop/coming-soon?pack=pack-200')).html, /En construction/);
  const { User } = require('../src/models');
  const user = await User.findOne({ where: { username: 'Marchande' } });
  await require('../src/services/ShopService').credit(user.id, 1500, 'Test');
  const refused = await http('/shop/buy', { method: 'POST', form: { _csrf: tokenOf(item.html), itemKey: 'theme:roman', offerId: 'account' } });
  assert.equal(refused.status, 302);
  assert.equal((await user.reload()).adartons, 1500, 'sans renonciation : rien n’est débité');
  const bought = await http('/shop/buy', { method: 'POST', form: { _csrf: tokenOf(item.html), itemKey: 'theme:roman', offerId: 'account', waiver: '1' } });
  assert.equal(bought.location, '/shop/purchases');
  assert.equal((await user.reload()).adartons, 300);
  assert.match((await http('/shop/purchases')).html, /Thème Romain/);
});

test('happy hour : popup en jeu une seule fois par créneau et par compte', async () => {
  const config = require('../src/config');
  const forced = config.happyHourForce;
  config.happyHourForce = true;
  try {
    const http = client();
    const reg = await http('/register');
    await http('/register', { method: 'POST', form: { username: 'Fetard', email: 'fetard@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
    const worlds = await http('/worlds');
    const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
    const page = await http(joined.location);
    assert.match(page.html, /data-happy-popup/);
    assert.match(page.html, /\+25 %/);
    const seen = await http(`${joined.location}/happy-hour/seen`, { method: 'POST', form: { _csrf: tokenOf(page.html) } });
    assert.equal(seen.status, 204);
    assert.doesNotMatch((await http(joined.location)).html, /data-happy-popup/);
  } finally {
    config.happyHourForce = forced;
  }
});

test('formulaire de plus de 5 000 champs : page d’erreur lisible, sans plantage', async () => {
  const body = new URLSearchParams();
  for (let i = 0; i < 6000; i++) body.append('ids', String(i));
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  assert.equal(res.status, 413);
  assert.match(await res.text(), /Formulaire trop volumineux/);
});
