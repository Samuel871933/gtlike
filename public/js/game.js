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
  const PILL = 'self-start rounded-[3px] border px-2 py-0.5 font-display text-[10px] font-bold tracking-[0.12em] uppercase';
  let mapWasDragged = false;
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-map-tile]');
    const panel = document.querySelector('[data-map-target]');
    if (!tile || !panel || e.ctrlKey || e.metaKey) return;
    if (mapWasDragged) { e.preventDefault(); mapWasDragged = false; return; }
    e.preventDefault();
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
  });

  // Carte draggable : le cadre reste fixe ; au relâchement, on charge la zone correspondant au geste.
  document.querySelectorAll('[data-map-drag]').forEach((viewport) => {
    const grid = viewport.querySelector('[data-map-grid]');
    if (!grid) return;
    let drag = null;
    const finish = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      viewport.classList.remove('is-dragging');
      drag = null;
      if (Math.hypot(dx, dy) < 10) return;
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
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
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

  tick();
  setInterval(tick, 1000);
})();
