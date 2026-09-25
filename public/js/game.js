'use strict';

// Affichage en direct : ressources qui montent, comptes à rebours, horloge serveur.
(function () {
  const offset = (() => {
    const clock = document.querySelector('[data-clock]');
    return clock ? Number(clock.dataset.clock) - Date.now() : 0;
  })();
  const serverNow = () => Date.now() + offset;
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (s) => `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  let reloading = false;

  function tick() {
    const now = serverNow();

    document.querySelectorAll('[data-res]').forEach((el) => {
      const start = Number(el.dataset.res);
      const cap = Number(el.dataset.cap);
      const value = start >= cap ? start : Math.min(cap, start + (Number(el.dataset.rate) * (now - Number(el.dataset.at))) / 3600000);
      el.textContent = Math.floor(value).toLocaleString('fr-FR');
      el.classList.toggle('text-blood-450', value >= cap);
      const bar = el.parentElement.querySelector('[data-res-bar]');
      if (bar) bar.style.width = `${Math.min(100, Math.round((value / cap) * 100))}%`;
    });

    // Progression d'une construction ou d'un déblocage : barre (largeur) ou anneau (variable --p).
    document.querySelectorAll('[data-progress-end]').forEach((el) => {
      const start = Number(el.dataset.progressStart);
      const end = Number(el.dataset.progressEnd);
      const pct = `${Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100)).toFixed(1)}%`;
      if (el.dataset.progressRing !== undefined) el.style.setProperty('--p', pct);
      else el.style.width = pct;
    });

    document.querySelectorAll('[data-countdown]').forEach((el) => {
      const left = Math.ceil((Number(el.dataset.countdown) - now) / 1000);
      el.textContent = fmt(Math.max(0, left));
      if (left <= 0 && !reloading) {
        reloading = true;
        setTimeout(() => window.location.reload(), 500);
      }
    });

    document.querySelectorAll('[data-clock]').forEach((el) => {
      el.textContent = new Date(now).toLocaleString('fr-FR');
    });
  }

  document.addEventListener('change', (e) => {
    const select = e.target.closest('[data-village-switch]');
    if (!select) return;
    // Même page, autre village : /village/12/main → /village/34/main
    window.location.href = window.location.pathname.replace(/^\/village\/\d+/, `/village/${select.value}`);
  });

  // Collecte : aperçu du butin et de la durée (même formule que le serveur).
  function scavengePreview(form) {
    const carry = JSON.parse(form.dataset.carry);
    const loot = Number(form.dataset.loot);
    let cap = 0;
    for (const [id, c] of Object.entries(carry)) {
      const input = form.querySelector(`input[name="${id}"]`);
      cap += (Number(input && input.value) || 0) * c;
    }
    const seconds = Math.round((Math.pow(cap * cap * 100 * loot * loot, 0.45) + 1800) * Math.pow(Number(form.dataset.speed), -0.55));
    form.querySelector('[data-scavenge-haul]').textContent = Math.floor(cap * loot).toLocaleString('fr-FR');
    form.querySelector('[data-scavenge-duration]').textContent = cap ? fmt(seconds) : '—';
  }
  document.addEventListener('input', (e) => {
    const form = e.target.closest('form[data-scavenge]');
    if (form) scavengePreview(form);
  });

  // Carte : un clic sur une case la sélectionne et remplit le panneau « Cible » (sans recharger la page).
  const PILL = 'self-start border px-1.5 py-px text-[11px] font-bold tracking-[0.1em] uppercase';
  let mapWasDragged = false;
  let skipNextMapClick = false;
  function selectMapTile(tile) {
    const panel = document.querySelector('[data-map-target]');
    if (!tile || !panel) return;
    document.querySelectorAll('[data-map-tile][data-selected]').forEach((t) => t.removeAttribute('data-selected'));
    tile.setAttribute('data-selected', '');
    const d = JSON.parse(tile.dataset.mapTile);
    const $ = (k) => panel.querySelector(`[data-t="${k}"]`);
    const show = (k, on) => $(k).classList.toggle('hidden', !on);
    const isVillage = Boolean(d.kind);
    const mine = d.kind === 'current' || d.kind === 'own';
    const box = $('tile');
    box.className = box.className.replace(/\bbg-\S+/g, '').trim() + ' ' + d.bg;
    const visual = tile.querySelector('[data-map-visual]');
    box.innerHTML = visual ? visual.outerHTML.replace('village-marker ', 'village-marker village-marker--large ').replace('terrain-sprite ', 'terrain-sprite terrain-sprite--large ') : '';
    $('name').textContent = d.name;
    $('coords').textContent = `${d.x}|${d.y} · Continent ${d.k}`;
    $('rel').textContent = d.rel || '';
    $('rel').className = isVillage ? `${PILL} ${d.pill}` : 'hidden';
    for (const k of ['owner', 'tribe', 'points', 'dist']) $(k).textContent = d[k] || '';
    $('special').textContent = d.special || '';
    $('desc').textContent = d.desc || '';
    show('stats', isVillage);
    show('special', Boolean(d.special));
    show('desc', !isVillage);
    show('own', mine);
    show('other', isVillage && !mine);
    const base = window.location.pathname.replace(/\/map$/, '');
    if (mine) {
      $('open').href = `/village/${d.id}`;
      $('recruit').href = `/village/${d.id}/recruit/barracks`;
    } else if (isVillage) {
      $('attack').href = `${base}/place?x=${d.x}&y=${d.y}`;
      $('market').href = `${base}/market?tab=send&x=${d.x}&y=${d.y}`;
      $('profile').href = `${base}/players/${d.playerId}`;
      show('profileBox', Boolean(d.playerId));
    }
  }
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-map-tile]');
    if (!tile || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (skipNextMapClick) { skipNextMapClick = false; return; }
    if (mapWasDragged) { mapWasDragged = false; return; }
    selectMapTile(tile);
    openMapMenu(tile);
  });

  // Carte : position d'un encart à côté d'une case, retourné près des bords (comme la maquette).
  function placeBeside(el, tile) {
    const grid = tile.closest('[data-map-grid]');
    const flipX = tile.offsetLeft + tile.offsetWidth + el.offsetWidth + 8 > grid.clientWidth;
    const flipY = tile.offsetTop + el.offsetHeight > grid.clientHeight;
    el.style.left = `${flipX ? tile.offsetLeft - el.offsetWidth - 6 : tile.offsetLeft + tile.offsetWidth + 6}px`;
    el.style.top = `${flipY ? tile.offsetTop + tile.offsetHeight - el.offsetHeight : tile.offsetTop}px`;
  }

  // Infobulle au survol d'un village.
  document.addEventListener('pointerover', (e) => {
    const tip = document.querySelector('[data-map-tip]');
    if (!tip) return;
    const tile = e.target.closest('[data-map-tile]');
    const menuOpen = document.querySelector('[data-map-menu]:not(.hidden)');
    const d = tile ? JSON.parse(tile.dataset.mapTile) : null;
    if (!d || !d.kind || menuOpen || document.querySelector('.map-viewport.is-dragging')) { tip.classList.add('hidden'); return; }
    const set = (k, v) => { tip.querySelector(`[data-tip="${k}"]`).textContent = v; };
    set('name', d.name);
    set('coords', `(${d.x}|${d.y})`);
    set('owner', d.owner);
    set('tribe', `${d.tribe} · ${d.rel}`);
    set('points', d.points);
    set('dist', d.eta ? `${d.dist} · ${d.eta}` : d.dist);
    // Morale : affichée seulement contre un autre joueur ; en orange sous 100 %.
    const mor = tip.querySelector('[data-tip="morale"]');
    set('morale', d.morale || '');
    mor.classList.toggle('text-blood-450', Boolean(d.morale) && d.morale !== '100 %');
    [mor, tip.querySelector('[data-tip-row="morale"]')].forEach((el) => el.classList.toggle('hidden', !d.morale));
    tip.classList.remove('hidden');
    placeBeside(tip, tile);
  });
  document.addEventListener('pointerleave', (e) => {
    if (e.target.matches && e.target.matches('[data-map-grid]')) document.querySelector('[data-map-tip]').classList.add('hidden');
  }, true);

  // Menu d'actions au clic sur un village.
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MENU_ICONS = {
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    attack: '<path d="M5 19L17 7M14 4h6v6M4 16l4 4"/>',
    support: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 9v6M9 12h6"/>',
    market: '<path d="M12 4v16M7 20h10M5 8h14"/><path d="M5 8l-3 6h6zM19 8l-3 6h6z"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
    center: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    open: '<path d="M3 9l9-5 9 5z"/><path d="M5 20h14M6 17h12M7 17V10M11 17V10M13 17V10M17 17V10"/>',
    star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  };
  const MENU_COLORS = { attack: 'text-blood-500', support: 'text-steel-300', star: 'text-gold-200' };
  function closeMapMenu() {
    const menu = document.querySelector('[data-map-menu]');
    if (menu) menu.classList.add('hidden');
  }
  function openMapMenu(tile) {
    const menu = document.querySelector('[data-map-menu]');
    if (!menu) return;
    const d = JSON.parse(tile.dataset.mapTile);
    if (!d.kind) { closeMapMenu(); return; }
    const grid = tile.closest('[data-map-grid]');
    const base = window.location.pathname.replace(/\/map$/, '');
    const params = new URLSearchParams(window.location.search);
    params.set('x', d.x); params.set('y', d.y); params.delete('sx'); params.delete('sy'); params.delete('world');
    const mine = d.kind === 'current' || d.kind === 'own';
    const spy = Number(grid.dataset.spy) || 0;
    // Ordres rapides : modèle d'armée ajouté aux liens Attaquer / Soutenir, actions masquées si décochées.
    const quick = readQuick();
    const tplOption = document.querySelector(`[data-quick-template] option[value="${quick.tpl || ''}"]`);
    const tplUnits = tplOption && tplOption.dataset.units ? new URLSearchParams(JSON.parse(tplOption.dataset.units)).toString() : '';
    const target = `x=${d.x}&y=${d.y}${tplUnits ? `&${tplUnits}` : ''}`;
    const allowed = (k) => quick[k] !== false;
    const actions = mine
      ? [['open', 'Ouvrir le village', `/village/${d.id}`], ['attack', 'Recruter', `/village/${d.id}/recruit/barracks`], ['center', 'Centrer ici', `${base}/map?${params}`]]
      : [
        ['eye', 'Voir le village', `${base}/villages/${d.id}`],
        ...(allowed('attack') ? [['attack', tplOption && tplOption.value ? `Attaquer · ${tplOption.textContent}` : 'Attaquer', `${base}/place?${target}`]] : []),
        ...(allowed('support') ? [['support', tplOption && tplOption.value ? `Soutenir · ${tplOption.textContent}` : 'Envoyer du soutien', `${base}/place?${target}`]] : []),
        ...(spy && allowed('spy') ? [['eye', `Espionner (${spy} éclaireur${spy > 1 ? 's' : ''})`, `${base}/place?x=${d.x}&y=${d.y}&spy=${spy}`]] : []),
        ['market', 'Envoyer des ressources', `${base}/market?tab=send&x=${d.x}&y=${d.y}`],
        ...(d.playerId ? [['profile', 'Profil du joueur', `${base}/players/${d.playerId}`]] : []),
        ['center', 'Centrer ici', `${base}/map?${params}`],
        ['star', d.fav ? 'Retirer des favoris' : 'Ajouter aux favoris', `${base}/favorites/${d.id}`, 'post'],
      ];
    menu.querySelector('[data-menu-t="name"]').textContent = d.name;
    menu.querySelector('[data-menu-t="coords"]').textContent = `(${d.x}|${d.y})${d.morale ? ` · morale ${d.morale}` : ''}`;
    const item = 'flex w-full cursor-pointer items-center gap-2 border-b border-bronze-800 px-2 py-1.5 text-left font-semibold no-underline hover:bg-head-dark hover:text-parchment-100';
    const svg = (ic) => `<svg class="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MENU_ICONS[ic]}</svg>`;
    // Les actions qui modifient (favoris) passent par un formulaire POST avec le jeton CSRF.
    menu.querySelector('[data-menu-t="actions"]').innerHTML = actions.map(([ic, label, href, method]) => (method === 'post'
      ? `<form method="post" action="${esc(href)}"><input type="hidden" name="_csrf" value="${esc(grid.dataset.csrf)}"><button class="${item} ${MENU_COLORS[ic] || 'text-parchment-300'}">${svg(ic)}${esc(label)}</button></form>`
      : `<a href="${esc(href)}" class="${item} ${MENU_COLORS[ic] || 'text-parchment-300'}">${svg(ic)}${esc(label)}</a>`)).join('');
    document.querySelector('[data-map-tip]').classList.add('hidden');
    menu.classList.remove('hidden');
    placeBeside(menu, tile);
  }
  document.addEventListener('click', (e) => {
    // Pendant un glisser-déposer, le clic est capturé par le cadre de la carte : il ne ferme pas le menu.
    if (!e.target.closest('[data-map-menu]') && !e.target.closest('[data-map-tile]') && !e.target.closest('[data-map-drag]')) closeMapMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMapMenu(); });

  // Ordres rapides : choix mémorisés dans le navigateur.
  const QUICK_KEY = 'gtlike.quickOrders';
  function readQuick() {
    try { return JSON.parse(localStorage.getItem(QUICK_KEY) || '{}') || {}; } catch (err) { return {}; }
  }
  function saveQuick(q) {
    try { localStorage.setItem(QUICK_KEY, JSON.stringify(q)); } catch (err) { /* stockage indisponible */ }
  }
  const quickPanel = document.querySelector('[data-quick-orders]');
  if (quickPanel) {
    const q = readQuick();
    const select = quickPanel.querySelector('[data-quick-template]');
    if (q.tpl && select.querySelector(`option[value="${q.tpl}"]`)) select.value = q.tpl;
    select.addEventListener('change', () => { saveQuick({ ...readQuick(), tpl: select.value }); closeMapMenu(); });
    quickPanel.querySelectorAll('[data-quick-action]').forEach((box) => {
      const k = box.dataset.quickAction;
      if (q[k] === false) box.checked = false;
      box.addEventListener('change', () => { saveQuick({ ...readQuick(), [k]: box.checked }); closeMapMenu(); });
    });
  }

  // Calques de carte : interrupteurs, mémorisés dans le navigateur (préférence de ce joueur uniquement).
  const LAYER_KEY = 'gtlike.mapLayers';
  const mapGrid = document.querySelector('[data-map-grid]');
  if (mapGrid) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LAYER_KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const apply = (k, on) => {
      mapGrid.toggleAttribute(`data-layer-${k}`, on);
      const btn = document.querySelector(`[data-map-layer="${k}"]`);
      if (btn) btn.setAttribute('aria-pressed', String(on));
    };
    document.querySelectorAll('[data-map-layer]').forEach((b) => {
      const k = b.dataset.mapLayer;
      if (typeof saved[k] === 'boolean') apply(k, saved[k]);
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        apply(k, on);
        saved[k] = on;
        try { localStorage.setItem(LAYER_KEY, JSON.stringify(saved)); } catch (err) { /* stockage indisponible */ }
      });
    });
  }

  // Carte : la taille des cases (--tile) s'ajuste pour que le quadrillage prenne toute la largeur du cadre.
  const fitGrid = document.querySelector('[data-map-grid]');
  const fitViewport = document.querySelector('[data-map-drag]');
  function fitMap() {
    if (!fitGrid || !fitViewport) return;
    const size = Number(fitGrid.dataset.size) || 13;
    const style = getComputedStyle(fitViewport);
    const inner = fitViewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const labels = 36 + 6 + 6; // graduations y (w-9), bordures du cadre, ombre portée
    const tile = Math.max(16, Math.floor((inner - labels) / size));
    fitGrid.style.setProperty('--tile', `${tile}px`);
    fitViewport.dataset.tileSize = String(tile);
  }
  fitMap();
  let fitTimer = null;
  window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitMap, 100); });

  // Carte draggable : le cadre reste fixe ; au relâchement, on charge la zone correspondant au geste.
  document.querySelectorAll('[data-map-drag]').forEach((viewport) => {
    const grid = viewport.querySelector('[data-map-grid]');
    if (!grid) return;
    let drag = null;
    const finish = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const pressedTile = drag.tile;
      viewport.classList.remove('is-dragging');
      drag = null;
      if (Math.hypot(dx, dy) < 10) {
        if (pressedTile) {
          selectMapTile(pressedTile);
          openMapMenu(pressedTile);
          skipNextMapClick = true;
        }
        return;
      }
      mapWasDragged = true;
      const tile = Number(viewport.dataset.tileSize) || 56;
      const x = Math.round(Number(viewport.dataset.centerX) - dx / tile);
      const y = Math.round(Number(viewport.dataset.centerY) - dy / tile);
      const url = new URL(window.location.href);
      url.searchParams.set('x', x);
      url.searchParams.set('y', y);
      url.searchParams.delete('sx');
      url.searchParams.delete('sy');
      window.location.href = url.toString();
    };
    viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.map-controls')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tile: e.target.closest('[data-map-tile]') };
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add('is-dragging');
    });
    viewport.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) e.preventDefault();
    });
    viewport.addEventListener('pointerup', finish);
    viewport.addEventListener('pointercancel', finish);
  });

  // Carte globale : rendu léger en canvas, même avec plusieurs milliers de villages.
  document.querySelectorAll('[data-world-map]').forEach((canvas) => {
    const source = canvas.closest('.world-map-overlay').querySelector('[data-world-map-data]');
    const villages = JSON.parse(source.textContent);
    const ctx = canvas.getContext('2d');
    const worldSize = Number(canvas.dataset.worldSize);
    const colors = { current: '#f4c451', own: '#f4c451', tribe: '#5794e8', ally: '#55c8dc', nap: '#aa79d6', enemy: '#dc654b', other: '#bd855b', barb: '#8b8d86' };
    const w = canvas.width;
    ctx.fillStyle = '#34452b'; ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(8,16,8,.28)'; ctx.lineWidth = 1;
    for (let n = 100; n < worldSize; n += 100) { const p = n / worldSize * w; ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, w); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke(); }
    for (const v of villages) {
      const x = v.x / worldSize * w; const y = v.y / worldSize * w;
      const r = v.kind === 'current' ? 4 : v.kind === 'own' ? 3 : 2;
      ctx.fillStyle = colors[v.kind] || colors.other;
      ctx.fillRect(Math.round(x - r / 2), Math.round(y - r / 2), r, r);
    }
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(worldSize - 1, Math.round((e.clientX - rect.left) / rect.width * worldSize)));
      const y = Math.max(0, Math.min(worldSize - 1, Math.round((e.clientY - rect.top) / rect.height * worldSize)));
      const url = new URL(canvas.dataset.mapUrl, window.location.origin);
      url.searchParams.set('x', x); url.searchParams.set('y', y); url.searchParams.delete('world');
      window.location.href = url.toString();
    });
  });

  // Confirmation des actions irréversibles.
  document.addEventListener('submit', (e) => {
    const message = e.target.dataset.confirm;
    if (message && !window.confirm(message)) e.preventDefault();
  });

  // Case « Tout » des listes à sélection multiple.
  document.addEventListener('change', (e) => {
    if (!e.target.matches('[data-check-all]')) return;
    const form = e.target.closest('form');
    form.querySelectorAll('input[type="checkbox"][name="ids"]').forEach((box) => { box.checked = e.target.checked; });
  });

  // Flèches village précédent / suivant : même page, autre village.
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-village-link]');
    if (!nav) return;
    e.preventDefault();
    const id = nav.getAttribute('href').match(/\/village\/(\d+)/)[1];
    window.location.href = window.location.pathname.replace(/^\/village\/\d+/, `/village/${id}`) + window.location.search;
  });

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-fill]');
    if (!link) return;
    e.preventDefault();
    const scope = link.closest('form') || document;
    const input = scope.querySelector(`input[name="${link.dataset.fill}"]`);
    if (input) input.value = link.dataset.max;
    const form = link.closest('form[data-scavenge]');
    if (form) scavengePreview(form);
  });

  // Plan du village : un premier clic sélectionne le bâtiment et affiche son encart (coût, Améliorer), un second ouvre sa page.
  document.addEventListener('click', (e) => {
    const plot = e.target.closest('[data-plot]');
    if (!plot || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (plot.hasAttribute('data-selected')) return;
    e.preventDefault();
    document.querySelectorAll('[data-plot][data-selected]').forEach((p) => p.removeAttribute('data-selected'));
    plot.setAttribute('data-selected', '');
    document.querySelectorAll('[data-plot-info]').forEach((info) => {
      const on = info.dataset.plotInfo === plot.dataset.plot;
      info.classList.toggle('hidden', !on);
      info.classList.toggle('flex', on);
    });
  });

  // Menus déroulants de l'en-tête (Rapports) : le lien reste utilisable sans JS, le clic ouvre le menu sous le bouton.
  function closeMenus(except) {
    document.querySelectorAll('[data-menu]').forEach((m) => {
      if (m === except) return;
      m.classList.add('hidden');
      const t = document.querySelector(`[data-menu-toggle="${m.dataset.menu}"]`);
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  }
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-menu-toggle]');
    if (toggle) {
      e.preventDefault();
      const menu = document.querySelector(`[data-menu="${toggle.dataset.menuToggle}"]`);
      if (!menu) return;
      closeMenus(menu);
      const open = menu.classList.toggle('hidden') === false;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        const box = menu.parentElement.getBoundingClientRect();
        const left = toggle.getBoundingClientRect().left - box.left;
        menu.style.left = `${Math.max(0, Math.min(left, box.width - menu.offsetWidth))}px`;
      }
      return;
    }
    if (!e.target.closest('[data-menu]')) closeMenus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  // Notifications : fermeture au clic ou après quelques secondes (les erreurs restent un peu plus longtemps).
  function closeToast(toast) {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }
  document.querySelectorAll('[data-toast]').forEach((toast) => {
    setTimeout(() => closeToast(toast), toast.getAttribute('role') === 'alert' ? 8000 : 4500);
  });
  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-toast-close]');
    if (close) closeToast(close.closest('[data-toast]'));
  });

  // Cases qui envoient leur formulaire dès qu'on les coche (forum : exclure les forums en sourdine).
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-autosubmit]')) e.target.form.submit();
  });

  // Formulaires à confirmer (suppression d'un message du forum…).
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-confirm]');
    if (form && !window.confirm(form.dataset.confirm)) e.preventDefault();
  });

  // Bouton « Copier » (page Inviter des joueurs).
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-copy]');
    if (!button) return;
    const source = button.parentElement.querySelector('[data-copy-source]');
    source.select();
    const done = () => { button.textContent = 'Copié'; setTimeout(() => { button.textContent = 'Copier'; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(source.value).then(done, () => document.execCommand('copy') && done());
    else if (document.execCommand('copy')) done();
  });

  tick();
  setInterval(tick, 1000);
})();
