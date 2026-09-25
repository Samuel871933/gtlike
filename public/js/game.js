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
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-map-tile]');
    const panel = document.querySelector('[data-map-target]');
    if (!tile || !panel || e.ctrlKey || e.metaKey) return;
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
    const svg = tile.querySelector('svg');
    box.innerHTML = isVillage && svg ? svg.outerHTML.replace(/\bw-(\d+|\[\d+px\])/, 'w-[30px]') : '';
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
