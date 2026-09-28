'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

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

  // Thème de jeu : médiéval par défaut en jeu, choix enregistré sur le compte, page d'accueil jamais stylée.
  assert.match(after.html, /data-game-style="medieval"/);
  const styled = await http(`${joined.location}/account/game-style`, { method: 'POST', form: { style: 'viking', _csrf: tokenOf(after.html) } });
  assert.equal(styled.status, 302);
  assert.match((await http(joined.location)).html, /class="h-full scheme-dark medieval:scheme-light game_style" data-game-style="viking"/);
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
  assert.match(medieval, /data-game-layout="minimal"/);
  await http(`${joined.location}/account/game-layout`, { method: 'POST', form: { layout: 'normal', _csrf: tokenOf(after.html) } });
  await http(`${joined.location}/account/game-layout`, { method: 'POST', form: { layout: 'inconnu', _csrf: tokenOf(after.html) } });
  const normal = (await http(joined.location)).html;
  assert.match(normal, /data-game-style="viking" data-game-layout="normal"/);
  assert.doesNotMatch((await http('/worlds')).html, /data-game-layout/);
  await http(`${joined.location}/account/game-layout`, { method: 'POST', form: { layout: 'minimal', _csrf: tokenOf(after.html) } });

  // Design des villages : skin de ses villages, envoyé avec chaque case (vu par tous) ; beige par défaut, design inconnu refusé.
  assert.match((await http(`${joined.location}/map`)).html, /"design":"beige"/);
  await http(`${joined.location}/account/village-design`, { method: 'POST', form: { design: 'blanc-bleu', _csrf: tokenOf(after.html) } });
  assert.match((await http(`${joined.location}/map`)).html, /"design":"blanc-bleu"/);
  await http(`${joined.location}/account/village-design`, { method: 'POST', form: { design: 'inconnu', _csrf: tokenOf(after.html) } });
  assert.match((await http(`${joined.location}/map`)).html, /"design":"blanc-bleu"/);

  for (const page of ['', '/place', '/map', '/reports', '/messages', '/tribe', '/market', '/ranking', '/ranking?type=continent', '/victory']) {
    const r = await http(joined.location + page);
    assert.ok([200, 302].includes(r.status), `${page} → ${r.status}`);
  }
});

test('pages de la maquette GTLike : outils de la carte, contenus publics, mot de passe oublié', async () => {
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
  for (const q of ['?type=tribes', '?type=continent&of=tribes', '?type=kills&kind=def', '?type=awards']) {
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
