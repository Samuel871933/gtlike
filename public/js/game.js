'use strict';

// Outils communs aux scripts du jeu (ce fichier, map.js) : nombres, durées, heures, texte réécrit, échappement HTML.
window.Adarma = (() => {
  // Un formateur pour tous les nombres : toLocaleString en recrée un à chaque appel, et la page en affiche chaque seconde.
  const NUMBER = new Intl.NumberFormat('fr-FR');
  const DATE_TIME = new Intl.DateTimeFormat('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');
  return {
    num: (n) => NUMBER.format(n),
    dateTime: (d) => DATE_TIME.format(d),
    pad,
    // Durée en secondes : « 1:05:09 ».
    duration: (s) => `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`,
    // Heure à la milliseconde, comme sur Guerre Tribale : « 11:25:21:926 ».
    clockMs: (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}:${String(d.getMilliseconds()).padStart(3, '0')}`,
    // Texte réécrit en continu : le nœud texte existant est modifié au lieu d'être remplacé. Remplacer un nœud est une
    // insertion, qui fait recalculer les styles de toute la page (règles :has(:checked)… des utilitaires has-*).
    setText: (el, text) => {
      const node = el.firstChild;
      if (node && node === el.lastChild && node.nodeType === 3) { if (node.data !== text) node.data = text; } else if (el.textContent !== text) el.textContent = text;
    },
    esc: (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  };
})();

// Affichage en direct : ressources qui montent, comptes à rebours, horloge serveur.
(function () {
  const offset = (() => {
    const clock = document.querySelector('[data-clock]');
    return clock ? Number(clock.dataset.clock) - Date.now() : 0;
  })();
  const serverNow = () => Date.now() + offset;
  const isOverview = Boolean(document.querySelector('[data-overview-page]'));
  const { pad, num, setText, clockMs } = window.Adarma;
  const fmt = window.Adarma.duration;
  // Barre des ressources sur écran étroit : nombres abrégés (8,4k, 400k), même règle que numShort (src/web/helpers.js).
  const narrow = window.matchMedia('(max-width: 767px)');
  const short = (n) => {
    const cut = (x, unit) => `${num(x < 10 ? Math.floor(x * 10) / 10 : Math.floor(x))}${unit}`;
    return n < 1000 ? String(n) : n < 1e6 ? cut(n / 1000, 'k') : cut(n / 1e6, 'M');
  };
  let reloading = false;
  let refreshingOverview = false;
  let nextOverviewRefresh = 0;

  // Une échéance met à jour les panneaux concernés sans recréer le décor et ses images.
  async function refreshOverview() {
    if (refreshingOverview || Date.now() < nextOverviewRefresh) return;
    refreshingOverview = true;
    nextOverviewRefresh = Date.now() + 5000;
    try {
      const response = await fetch(window.location.href, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      // Un template garde les images du plan inertes tant qu'on ne les insère pas dans la page.
      const template = document.createElement('template');
      template.innerHTML = await response.text();
      const fresh = template.content;
      if (!fresh.querySelector('[data-overview-page]')) return;

      for (const key of ['movements', 'buildings', 'recruitment', 'troops']) {
        const current = document.querySelector(`[data-overview-live="${key}"]`);
        const updated = fresh.querySelector(`[data-overview-live="${key}"]`);
        if (current && updated) current.replaceWith(updated);
      }
      const currentMeta = document.querySelector('[data-overview-meta]');
      const updatedMeta = fresh.querySelector('[data-overview-meta]');
      if (currentMeta && updatedMeta) currentMeta.replaceWith(updatedMeta);

      // Conserver les bâtiments en place : seules leurs valeurs et activités changent.
      const freshPlots = new Map([...fresh.querySelectorAll('.village-scene-medieval [data-plot]')].map((plot) => [plot.dataset.plot, plot]));
      document.querySelectorAll('.village-scene-medieval [data-plot]').forEach((plot) => {
        const updated = freshPlots.get(plot.dataset.plot);
        if (!updated) return;
        plot.title = updated.title;
        for (const selector of ['.village-building-level', '.village-building-activities']) {
          const current = plot.querySelector(selector);
          const next = updated.querySelector(selector);
          if (current && next && current.innerHTML !== next.innerHTML) current.innerHTML = next.innerHTML;
        }
        const currentImage = plot.querySelector('.village-building-sprite');
        const nextImage = updated.querySelector('.village-building-sprite');
        if (currentImage && nextImage && currentImage.outerHTML !== nextImage.outerHTML) currentImage.replaceWith(nextImage);
      });
      const freshInfo = new Map([...fresh.querySelectorAll('[data-plot-info]')].map((info) => [info.dataset.plotInfo, info]));
      document.querySelectorAll('[data-plot-info]').forEach((info) => {
        const updated = freshInfo.get(info.dataset.plotInfo);
        if (updated && info.innerHTML !== updated.innerHTML) info.innerHTML = updated.innerHTML;
      });

      syncResources(fresh);
    } catch { /* Le minuteur reste visible ; une prochaine échéance réessaiera. */ }
    finally { refreshingOverview = false; }
  }

  // Repartir des ressources calculées par le serveur après la fin d'une activité ; prochaine heure où des ressources
  // suffiront : celle de la page à jour (ou plus aucune).
  function syncResources(fresh) {
    const currentReload = document.querySelector('[data-reload-at]');
    const updatedReload = fresh.querySelector('[data-reload-at]');
    if (currentReload) currentReload.replaceWith(updatedReload || '');
    else if (updatedReload) document.querySelector('[data-clock]')?.parentElement.before(updatedReload);

    const updatedResources = fresh.querySelectorAll('[data-res]');
    document.querySelectorAll('[data-res]').forEach((el, i) => {
      const next = updatedResources[i];
      if (!next) return;
      for (const key of ['res', 'cap', 'rate', 'at']) el.dataset[key] = next.dataset[key];
    });
  }

  // Pages à blocs vivants (data-live="clé" : file de recrutement, effectifs…) : une échéance remplace ces blocs par ceux
  // de la page à jour, sans recharger ; les formulaires gardent leur saisie (le recrutement reprend ressources et
  // maximums du serveur). Les autres pages se rechargent (en gardant aussi la saisie, voir reloadKeepingInputs).
  const livePage = Boolean(document.querySelector('[data-live]'));
  let refreshingLive = false;
  let nextLiveRefresh = 0;
  let pendingLive = null;
  async function refreshLive() {
    // Au plus une mise à jour toutes les 1,5 s : une échéance qui tombe entre-temps est reportée, jamais perdue.
    const wait = refreshingLive ? 300 : nextLiveRefresh - Date.now();
    if (wait > 0) {
      if (!pendingLive) pendingLive = setTimeout(() => { pendingLive = null; refreshLive(); }, wait);
      return;
    }
    refreshingLive = true;
    nextLiveRefresh = Date.now() + 1500;
    try {
      const response = await fetch(window.location.href, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const template = document.createElement('template');
      template.innerHTML = await response.text();
      const fresh = template.content;
      const keys = (root) => [...root.querySelectorAll('[data-live]')].map((el) => el.dataset.live).join('|');
      // Page qui a changé de forme (file apparue ou vide, bâtiment terminé…) : rechargement complet.
      if (keys(fresh) !== keys(document)) {
        reloadKeepingInputs();
        return;
      }
      document.querySelectorAll('[data-live]').forEach((el) => {
        const updated = fresh.querySelector(`[data-live="${CSS.escape(el.dataset.live)}"]`);
        if (updated && updated.innerHTML !== el.innerHTML) el.replaceWith(updated);
      });
      // Formulaires gardés (saisie en cours) : seulement leurs maximums, effectifs et champs actifs à jour.
      document.querySelectorAll('form[action]').forEach((form) => {
        const updated = fresh.querySelector(`form[action="${CSS.escape(form.getAttribute('action'))}"]`);
        if (!updated) return;
        for (const key of ['have', 'recruit']) if (updated.dataset[key] !== undefined) form.dataset[key] = updated.dataset[key];
        updated.querySelectorAll('[data-fill]').forEach((b) => {
          const mine = form.querySelector(`[data-fill="${CSS.escape(b.dataset.fill)}"]`);
          if (!mine) return;
          // Recrutement : maximum du serveur (data-cap), le maximum affiché suit la saisie (recruitTotal).
          if (mine.dataset.cap !== undefined) mine.dataset.cap = b.dataset.cap;
          else { mine.dataset.max = b.dataset.max; mine.className = b.className; setText(mine, b.textContent); }
        });
        updated.querySelectorAll('input[name]:not([type=hidden])').forEach((input) => {
          const mine = form.querySelector(`input[name="${CSS.escape(input.name)}"]`);
          if (!mine) return;
          mine.disabled = input.disabled;
          if (input.max) mine.max = input.max;
        });
        if (form.matches('[data-recruit]')) recruitTotal(form);
      });
      syncResources(fresh);
    } catch { /* Une prochaine échéance réessaiera. */ }
    finally { refreshingLive = false; }
  }

  // Une échéance est passée : mise à jour des panneaux (aperçu, pages à blocs vivants) ou rechargement de la page.
  function refreshPage() {
    if (isOverview) refreshOverview();
    else if (livePage) refreshLive();
    else if (!reloading) {
      reloading = true;
      setTimeout(reloadKeepingInputs, 500);
    }
  }
  // Comptes à rebours déjà échus et traités : une seule mise à jour chacun (sinon toutes les secondes).
  const expired = new WeakSet();

  // Saisies gardées d'un rechargement automatique à l'autre (unité terminée, ressources arrivées…) : les nombres tapés
  // dans les formulaires (recrutement, marché…) et le champ en cours de saisie sont rendus au chargement suivant de la
  // même page. Sur un monde rapide, une unité sort chaque seconde : sans cela, chaque saisie serait effacée.
  const KEEP_KEY = 'adarma:keep-inputs';
  const KEEP_MS = 60000;
  const keepable = 'form input[name]:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=password]):not([type=file])';
  const keyOf = (input) => `${input.form.getAttribute('action') || ''}|${input.name}`;
  function reloadKeepingInputs() {
    try {
      const values = {};
      document.querySelectorAll(keepable).forEach((input) => {
        if (input.value !== input.defaultValue) values[keyOf(input)] = input.value;
      });
      const active = document.activeElement && document.activeElement.matches && document.activeElement.matches(keepable) ? keyOf(document.activeElement) : null;
      sessionStorage.setItem(KEEP_KEY, JSON.stringify({ page: location.pathname + location.search, at: Date.now(), values, active }));
    } catch { /* Stockage indisponible (navigation privée) : rechargement simple. */ }
    window.location.reload();
  }
  // Rendu après le chargement du reste du script : les écouteurs (total du recrutement…) recalculent avec ces valeurs.
  setTimeout(() => {
    let kept = null;
    try {
      kept = JSON.parse(sessionStorage.getItem(KEEP_KEY) || 'null');
      sessionStorage.removeItem(KEEP_KEY);
    } catch { return; }
    if (!kept || kept.page !== location.pathname + location.search || Date.now() - kept.at > KEEP_MS) return;
    document.querySelectorAll(keepable).forEach((input) => {
      const key = keyOf(input);
      if (Object.hasOwn(kept.values, key)) {
        input.value = kept.values[key];
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (key === kept.active) {
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* champ numérique */ }
      }
    });
  }, 0);

  // Au-delà de 50 comptes à rebours (aperçu Arrivant), un observateur retient ceux qui sont à l'écran : les autres
  // ne sont pas réécrits chaque seconde. Les comptes ajoutés en cours de route (aperçu du village) sont observés aussi.
  const onScreen = new Set();
  const observed = new WeakSet();
  const watch = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) onScreen.add(e.target); else onScreen.delete(e.target); });
  }, { rootMargin: '200px 0px' }) : null;

  // Échu dès le chargement (le serveur n'a pas encore traité l'échéance) : rechargement 5 s plus tard au plus tôt, pas
  // en boucle toutes les demi-secondes.
  const loadedAt = serverNow();
  // Formulaire en cours de saisie (nombre d'unités, offre…) : l'arrivée des ressources n'actualise pas la page.
  let editing = false;
  document.addEventListener('input', (e) => { if (e.target.closest('form')) editing = true; });

  function tick() {
    // Onglet caché : rien à afficher ni à recharger ; le tour suivant au retour rattrape tout.
    if (document.hidden) return;
    const now = serverNow();
    const countdowns = document.querySelectorAll('[data-countdown]');
    const many = watch && countdowns.length > 50;
    if (many) countdowns.forEach((el) => { if (!observed.has(el)) { observed.add(el); watch.observe(el); } });

    document.querySelectorAll('[data-res]').forEach((el) => {
      const start = Number(el.dataset.res);
      const cap = Number(el.dataset.cap);
      const value = start >= cap ? start : Math.min(cap, start + (Number(el.dataset.rate) * (now - Number(el.dataset.at))) / 3600000);
      setText(el, 'resShort' in el.dataset && narrow.matches ? short(Math.floor(value)) : num(Math.floor(value)));
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

    countdowns.forEach((el) => {
      const left = Math.ceil((Number(el.dataset.countdown) - now) / 1000);
      // Longues listes (aperçu Arrivant, 1 000 lignes) : seuls les comptes à rebours visibles sont réécrits.
      if (!many || onScreen.has(el) || left <= 0) {
        setText(el, fmt(Math.max(0, left)));
      }
      // Comptes à rebours sans rechargement à la fin (popup de l'happy hour ; aperçu Arrivant : la ligne de l'ordre
      // arrivé est retirée de la liste).
      if (left <= 0 && el.hasAttribute('data-countdown-noreload')) {
        const row = el.closest('[data-arrived-row]');
        if (row) {
          document.dispatchEvent(new CustomEvent('incoming:arrived', { detail: row }));
          row.remove();
        }
        return;
      }
      if (left <= 0) {
        if (Number(el.dataset.countdown) <= loadedAt && now - loadedAt < 5000) return;
        // Aperçu : il se resynchronise lui-même (au plus toutes les 5 s) ; ailleurs, une fois par compte à rebours.
        if (!isOverview && expired.has(el)) return;
        expired.add(el);
        refreshPage();
      }
    });
    // Ressources qui suffisent enfin pour une construction, une unité… (« Ressources disponibles à … ») : la page
    // se met à jour pour proposer le bouton.
    const reloadAt = Number(document.querySelector('[data-reload-at]')?.dataset.reloadAt);
    // Une page à blocs vivants se met à jour même pendant une saisie (elle la garde).
    if (reloadAt && reloadAt <= now && (livePage || !editing) && !(reloadAt <= loadedAt && now - loadedAt < 5000)) refreshPage();
    // Le serveur peut traiter la prochaine unité quelques secondes après son échéance.
    // Continuer à synchroniser le recrutement même si son minuteur a disparu du plan.
    if (isOverview) {
      const nextUnit = Number(document.querySelector('[data-overview-live="recruitment"]')?.dataset.recruitNext);
      if (nextUnit > 0 && nextUnit <= now) refreshOverview();
    }

    // Bouton « Terminer » (construction gratuite) : affiché dès qu'il reste au plus 3 minutes.
    document.querySelectorAll('[data-free-at]').forEach((el) => {
      el.classList.toggle('hidden', now < Number(el.dataset.freeAt));
    });

    document.querySelectorAll('[data-clock]').forEach((el) => {
      setText(el, window.Adarma.dateTime(new Date(now)));
    });
  }

  document.addEventListener('change', (e) => {
    const select = e.target.closest('[data-village-switch]');
    if (!select) return;
    // Même page, autre village : /village/12/main → /village/34/main
    window.location.href = window.location.pathname.replace(/^\/village\/\d+/, `/village/${select.value}`);
  });

  // Collecte : aperçu du butin et de la durée (même formule que le serveur).
  const scavengeSelection = document.querySelector('[data-scavenge-selection]');
  function scavengeCount(id) {
    const input = scavengeSelection?.querySelector(`input[name="${id}"]`);
    if (!input) return 0;
    return Math.min(Number(input.max) || 0, Math.max(0, Math.floor(Number(input.value) || 0)));
  }
  function scavengePreview(preview) {
    const carry = JSON.parse(preview.dataset.carry);
    const loot = Number(preview.dataset.loot);
    let cap = 0;
    for (const [id, c] of Object.entries(carry)) {
      cap += scavengeCount(id) * c;
    }
    const total = Math.floor(cap * loot);
    const third = Math.floor(total / 3);
    const resources = { wood: total - 2 * third, stone: third, iron: third };
    for (const [id, amount] of Object.entries(resources)) preview.querySelector(`[data-scavenge-resource="${id}"]`).textContent = num(amount);
    const seconds = Math.round((Math.pow(cap * cap * 100 * loot * loot, 0.45) + 1800) * Math.pow(Number(preview.dataset.speed), -0.55));
    preview.querySelector('[data-scavenge-duration]').textContent = cap ? fmt(seconds) : '—';
  }
  document.addEventListener('input', (e) => {
    if (e.target.closest('[data-scavenge-selection]')) document.querySelectorAll('[data-scavenge-preview]').forEach(scavengePreview);
  });
  // Sceaux : le grand sceau de gauche montre le sceau survolé dans la grille, puis revient à celui du village.
  const sealBig = document.querySelector('[data-seal-big]');
  if (sealBig) {
    const wax = sealBig.querySelector('[data-seal-big-wax]');
    const sigil = sealBig.querySelector('[data-seal-big-sigil]');
    const caption = document.querySelector('[data-seal-caption]');
    const initial = { wax: wax.src, sigil: sigil.src, caption: caption.textContent, empty: !sealBig.dataset.type };
    const show = (w, s, text, empty) => {
      wax.src = w; sigil.src = s; caption.textContent = text;
      sigil.hidden = empty; wax.style.cssText = empty ? 'opacity:.45;filter:grayscale(1)' : '';
    };
    show(initial.wax, initial.sigil, initial.caption, initial.empty);
    document.querySelectorAll('[data-seal-hover]').forEach((cell) => {
      cell.addEventListener('mouseenter', () => show(`/img/seals/wax-${cell.dataset.level}.webp`, `/img/seals/sigil-${cell.dataset.type}.png`, cell.dataset.name, !cell.dataset.has));
    });
    document.querySelector('[data-seal-grid]')?.addEventListener('mouseleave', () => show(initial.wax, initial.sigil, initial.caption, initial.empty));
  }
  // Offre d'échange : « Contre » suit le niveau du sceau donné (cires), le type donné y est grisé, résumé à jour.
  const offerForm = document.querySelector('[data-seal-offer]');
  if (offerForm) {
    const gives = [...offerForm.querySelectorAll('[data-offer-give]')];
    const wants = [...offerForm.querySelectorAll('[data-offer-want]')];
    const summary = offerForm.querySelector('[data-offer-summary]');
    const nameOf = (input) => input.closest('label').title.replace(/ \d+ \(.*$/, '');
    const update = () => {
      const give = gives.find((g) => g.checked);
      if (!give) return;
      const level = give.dataset.level;
      for (const w of wants) {
        w.disabled = w.dataset.type === give.dataset.type;
        const wax = w.closest('label').querySelector('.seal-art__wax');
        if (wax) wax.src = `/img/seals/wax-${level}.webp`;
      }
      let want = wants.find((w) => w.checked && !w.disabled);
      if (!want) { want = wants.find((w) => !w.disabled); if (want) want.checked = true; }
      if (summary && want) summary.textContent = `${nameOf(give)} ${level} contre ${want.closest('label').title} ${level}`;
    };
    offerForm.addEventListener('change', update);
    update();
  }
  // Modèle d'armée choisi : remplit la sélection (au plus les troupes présentes), les autres unités à 0.
  const scavengeTemplates = JSON.parse(document.querySelector('[data-scavenge-templates]')?.textContent || '{}');
  document.querySelector('[data-scavenge-template]')?.addEventListener('change', (e) => {
    const tpl = scavengeTemplates[e.target.value];
    if (!tpl) return;
    scavengeSelection.querySelectorAll('input[type="number"]').forEach((input) => {
      const max = Number(input.max) || 0;
      input.value = Math.min(max, tpl[input.name] || 0) || '';
    });
    document.querySelectorAll('[data-scavenge-preview]').forEach(scavengePreview);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-scavenge]');
    if (!form) return;
    for (const id of Object.keys(JSON.parse(form.dataset.carry))) form.querySelector(`input[name="${id}"]`).value = scavengeCount(id);
  });

  // Recrutement : coût total (ressources, population, durée) de la saisie, en rouge ce qui manque ; le maximum de
  // chaque ligne suit ce que les autres lignes consomment déjà (sans dépasser le maximum du serveur, data-cap).
  function recruitTotal(form) {
    const units = JSON.parse(form.dataset.recruit);
    const have = JSON.parse(form.dataset.have);
    const total = { wood: 0, stone: 0, iron: 0, pop: 0, time: 0 };
    const counts = {};
    for (const [id, c] of Object.entries(units)) {
      const input = form.querySelector(`input[name="${id}"]`);
      const n = Math.max(0, Math.floor(Number(input && input.value) || 0));
      counts[id] = n;
      for (const k of Object.keys(total)) total[k] += n * c[k];
    }
    for (const [id, c] of Object.entries(units)) {
      const button = form.querySelector(`[data-recruit-max][data-fill="${id}"]`);
      if (!button) continue;
      let max = Number(button.dataset.cap);
      for (const k of ['wood', 'stone', 'iron', 'pop']) {
        if (c[k] > 0) max = Math.min(max, Math.floor((have[k] - (total[k] - counts[id] * c[k])) / c[k]));
      }
      max = Math.max(0, max);
      button.dataset.max = String(max);
      button.textContent = `(${max})`; // même forme que le rendu du serveur : (1708)
      const input = form.querySelector(`input[name="${id}"]`);
      if (input) input.max = String(max);
    }
    form.querySelectorAll('[data-total]').forEach((el) => {
      const k = el.dataset.total;
      el.lastElementChild.textContent = k === 'time' ? fmt(Math.round(total.time)) : num(Math.floor(total[k]));
      if (k === 'time') return;
      const short = total[k] > have[k];
      el.classList.toggle('text-blood-450', short);
      el.classList.toggle(k === 'pop' ? 'text-parchment-400' : 'text-parchment-200', !short);
    });
  }
  document.addEventListener('input', (e) => {
    const form = e.target.closest('form[data-recruit]');
    if (form) recruitTotal(form);
  });

  // Point de ralliement : durée du trajet (unité la plus lente, comme le serveur) et heure d'arrivée, arrondie comme
  // sur le serveur à la précision des arrivées du monde (data-arrival-step, en ms ; voir game/movement.arrivalAt).
  const roundArrival = (ms, step) => new Date(Math.ceil(ms / Math.max(1, Number(step) || 1)) * Math.max(1, Number(step) || 1));
  function arrivalText(date, now) {
    const time = clockMs(date);
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(date) - day(now)) / 86400000);
    if (diff === 0) return `aujourd'hui à ${time}`;
    if (diff === 1) return `demain à ${time}`;
    return `le ${pad(date.getDate())}/${pad(date.getMonth() + 1)} à ${time}`;
  }
  // Rythme des unités de chaque formulaire, lu une fois : l'aperçu est recalculé à chaque image.
  const paces = new WeakMap();
  function travelPreview(form) {
    if (!paces.has(form)) paces.set(form, JSON.parse(form.dataset.travel));
    const pace = paces.get(form);
    let minutes = 0;
    for (const [id, m] of Object.entries(pace)) {
      const input = form.querySelector(`input[name="${id}"]`);
      if (input && Number(input.value) > 0) minutes = Math.max(minutes, m);
    }
    const x = form.querySelector('input[name="x"]').value;
    const y = form.querySelector('input[name="y"]').value;
    const dist = Math.hypot(Number(x) - Number(form.dataset.fromX), Number(y) - Number(form.dataset.fromY));
    const seconds = Math.round(dist * minutes * 60);
    const ok = minutes && x !== '' && y !== '' && seconds > 0;
    const now = new Date(serverNow());
    // setText : le texte n'est réécrit que s'il change (une réécriture fait recalculer les styles de la page).
    setText(form.querySelector('[data-travel-arrival]'), ok ? arrivalText(roundArrival(now.getTime() + seconds * 1000, form.dataset.arrivalStep), now) : '—');
    setText(form.querySelector('[data-travel-duration]'), ok ? `(${fmt(seconds)})` : '');
  }
  document.addEventListener('input', (e) => {
    const form = e.target.closest('form[data-travel]');
    if (form) travelPreview(form);
  });
  // Heure d'arrivée si l'ordre part maintenant (confirmation et formulaire d'envoi), rafraîchie à chaque image pour les ms.
  function arrivalFrame() {
    document.querySelectorAll('form[data-travel]').forEach(travelPreview);
    document.querySelectorAll('[data-arrive-in]').forEach((el) => {
      const now = new Date(serverNow());
      setText(el, arrivalText(roundArrival(now.getTime() + Number(el.dataset.arriveIn), el.dataset.arrivalStep), now));
    });
    requestAnimationFrame(arrivalFrame);
  }
  if (document.querySelector('form[data-travel], [data-arrive-in]')) requestAnimationFrame(arrivalFrame);

  // Confirmation des actions irréversibles (form[data-confirm] : suppressions, renvoi d'unités, départ…), ou du seul
  // bouton qui envoie le formulaire (button[data-confirm]).
  document.addEventListener('submit', (e) => {
    const message = (e.submitter && e.submitter.dataset.confirm) || e.target.dataset.confirm;
    if (message && !window.confirm(message)) e.preventDefault();
  });

  // Bouton « déplier » (data-unfold="id") : montre ou cache le bloc lié (détail d'un ordre en route…). Une ligne
  // data-unfold-row se déplie aussi d'un clic n'importe où, sauf sur ses liens, boutons et champs.
  document.addEventListener('click', (e) => {
    let toggle = e.target.closest('[data-unfold]');
    if (!toggle) {
      const row = e.target.closest('[data-unfold-row]');
      if (!row || e.target.closest('a, button, input, select, textarea, label, form')) return;
      toggle = row.querySelector('[data-unfold]');
    }
    const panel = toggle && document.getElementById(toggle.dataset.unfold);
    if (!panel) return;
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });

  // Bulle au survol (data-tip="id") : copie du détail lié ([data-order-detail] du bloc, même caché), en position fixe
  // pour ne pas être coupée par un tableau qui défile. Pas au toucher : le clic sur la ligne déplie le détail.
  const tipBox = document.createElement('div');
  tipBox.className = 'pointer-events-none fixed z-50 max-w-[calc(100vw-16px)] border-2 border-black bg-panel-top p-2 shadow-[inset_0_0_0_1px_var(--color-bronze-500),4px_4px_0_#000]';
  tipBox.hidden = true;
  document.body.append(tipBox);
  // Bulle de `el` remplie par `fill`, placée sous l'élément (au-dessus s'il manque de place). Rien n'est refait tant que
  // la bulle affichée est déjà la sienne : `pointerover` se répète à chaque élément enfant traversé, et mesurer la
  // bulle force le calcul de la mise en page.
  let tipFor = null;
  function openTip(el, fill) {
    if (tipFor === el && !tipBox.hidden) return;
    tipFor = el;
    fill();
    tipBox.hidden = false;
    const r = el.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - tipBox.offsetWidth - 8);
    const below = r.bottom + 6 + tipBox.offsetHeight <= window.innerHeight;
    tipBox.style.left = `${Math.max(8, left)}px`;
    tipBox.style.top = `${below ? r.bottom + 6 : r.top - tipBox.offsetHeight - 6}px`;
  }
  // Bulle fermée quand le pointeur quitte l'élément `selector` qui l'a ouverte (pas en passant sur ses enfants).
  const closeTipOn = (selector) => document.addEventListener('pointerout', (e) => {
    const el = e.target.closest(selector);
    if (el && !el.contains(e.relatedTarget)) tipBox.hidden = true;
  });
  // Bulle courte et immédiate (data-hint="texte", une ligne par \n) : places des opérations… L'infobulle native du
  // navigateur arrive trop tard et ne s'affiche pas toujours sur les petits éléments.
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-hint]');
    if (!el || e.pointerType === 'touch') return;
    openTip(el, () => tipBox.replaceChildren(...el.dataset.hint.split('\n').map((line, i) => {
      const row = document.createElement('div');
      row.className = i ? 'text-[12px] text-parchment-300 tabular-nums' : 'text-[13px] font-semibold text-parchment-100';
      row.textContent = line;
      return row;
    })));
  });
  closeTipOn('[data-hint]');
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    const src = el && e.pointerType !== 'touch' && document.getElementById(el.dataset.tip);
    if (!src) return;
    openTip(el, () => {
      // L'infobulle du navigateur ferait doublon avec la bulle.
      el.querySelectorAll('[title]').forEach((t) => t.removeAttribute('title'));
      tipBox.innerHTML = (src.querySelector('[data-order-detail]') || src).outerHTML;
    });
  });
  closeTipOn('[data-tip]');

  // Opérations de tribu : l'écart entre les attaques d'un village n'a de sens qu'à partir de 2 attaques (en
  // modification groupée, nombre vide = inchangé : l'écart reste proposé) ; en mode « troupes différentes par
  // attaque », une grille de troupes par attaque (10 au plus) ; un modèle d'armée remplit la grille où il est choisi.
  const opForm = (form) => {
    const count = form && form.querySelector('[data-op-count]');
    if (!count) return;
    const box = form.querySelector('[data-op-spacing]');
    if (box) box.hidden = count.value === '' ? !box.hasAttribute('data-op-bulk') : Number(count.value) <= 1;
    const each = form.querySelector('[data-op-each]');
    if (!each) return;
    const perAttack = form.querySelector('input[name="mode"][value="each"]').checked;
    const rows = each.querySelectorAll('[data-op-row]');
    count.max = perAttack ? String(rows.length) : '50';
    form.querySelector('[data-op-same]').hidden = perAttack;
    each.hidden = !perAttack;
    const n = Math.min(rows.length, Math.max(1, Number(count.value) || 1));
    rows.forEach((row) => { row.hidden = Number(row.dataset.opRow) >= n; });
  };
  document.querySelectorAll('[data-op-count]').forEach((input) => opForm(input.form));
  document.addEventListener('input', (e) => { if (e.target.matches('[data-op-count]')) opForm(e.target.form); });
  document.addEventListener('change', (e) => {
    if (e.target.matches('input[name="mode"]') && e.target.form && e.target.form.querySelector('[data-op-each]')) opForm(e.target.form);
    if (!e.target.matches('select[data-fill-units]')) return;
    const option = e.target.selectedOptions[0];
    if (!option || !option.value) return;
    let units = {};
    try { units = JSON.parse(option.dataset.units || '{}'); } catch { units = {}; }
    const scope = e.target.closest('[data-units-scope]') || e.target.form;
    scope.querySelectorAll('[data-unit-input]').forEach((input) => { input.value = units[input.dataset.unit] > 0 ? units[input.dataset.unit] : ''; });
  });

  // Lien vers un panneau repliable (data-open-details="id") : l'ouvre et y descend, sans recharger la page.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-open-details]');
    const panel = link && document.getElementById(link.dataset.openDetails);
    if (!panel) return;
    e.preventDefault();
    panel.open = true;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Gestionnaire de compte : total des troupes saisies (population, ressources) sous les champs d'unités, et aperçu d'un
  // lot par bâtiment (même découpe que managerTemplates.splitBatch : coût au plus la taille des lots, à proportion de
  // ce qui manque, dizaine supérieure, une dizaine de l'unité qui manque le plus si tout s'arrondit à zéro).
  const fr = window.Adarma.num;
  function troopForm(form) {
    const box = form.querySelector('[data-troop-total]');
    if (!box) return;
    const inputs = [...box.querySelectorAll('input[data-pop]')];
    const sum = { pop: 0, wood: 0, stone: 0, iron: 0 };
    for (const input of inputs) {
      const n = Math.max(0, Math.floor(Number(input.value) || 0));
      for (const k of Object.keys(sum)) sum[k] += n * Number(input.dataset[k]);
    }
    box.querySelectorAll('[data-troop-sum]').forEach((el) => { el.textContent = fr(sum[el.dataset.troopSum]); });
    const preview = box.querySelector('[data-batch-preview]');
    const budgetInput = form.querySelector('[data-batch-cost]');
    if (!preview || !budgetInput) return;
    const budget = Math.max(1, Number(budgetInput.value) || 0);
    const groups = new Map();
    for (const input of inputs) {
      const need = Math.max(0, Math.floor(Number(input.value) || 0));
      if (!need) continue;
      const price = Number(input.dataset.wood) + Number(input.dataset.stone) + Number(input.dataset.iron);
      const b = input.dataset.building;
      if (!groups.has(b)) groups.set(b, { name: input.dataset.buildingName, items: [] });
      groups.get(b).items.push({ need, price, icon: input.dataset.icon });
    }
    const parts = [];
    for (const { name, items } of groups.values()) {
      const total = items.reduce((n, i) => n + i.need * i.price, 0);
      let counts = items.map((i) => i.need);
      if (total > budget) {
        const k = budget / total;
        counts = items.map((i) => Math.min(i.need, Math.ceil(Math.floor(i.need * k) / 10) * 10));
        if (!counts.some((n) => n > 0)) {
          const most = items.reduce((x, y, j) => (y.need > items[x].need ? j : x), 0);
          counts[most] = Math.min(items[most].need, 10);
        }
      }
      const cost = items.reduce((n, i, j) => n + counts[j] * i.price, 0);
      const units = items.map((i, j) => (counts[j] ? `<span class="inline-flex items-center gap-1"><img src="${i.icon}" class="size-5 min-h-5 min-w-5 shrink-0 object-contain" alt="" aria-hidden="true">${fr(counts[j])}</span>` : '')).join('');
      const label = document.createElement('span');
      label.textContent = `${name} :`;
      parts.push(`<span class="inline-flex flex-wrap items-center gap-x-2"><span class="text-parchment-400">${label.innerHTML}</span>${units}<span class="text-parchment-500">(${fr(cost)} ressources)</span></span>`);
    }
    preview.innerHTML = parts.length ? parts.join('<span class="text-parchment-600">·</span>') : '<span class="text-parchment-500">aucune unité</span>';
  }
  document.addEventListener('input', (e) => {
    if (!e.target.matches('[data-troop-total] input[data-pop], input[data-batch-cost]')) return;
    const form = e.target.closest('form');
    if (form) troopForm(form);
  });

  // Case « Tout » des listes à sélection multiple : data-check-all coche les cases « ids » de son formulaire,
  // data-select-all="id" celles reliées au formulaire id par l'attribut form (tableaux hors du formulaire).
  document.addEventListener('change', (e) => {
    const box = e.target;
    if (box.matches('[data-check-all]')) {
      box.closest('form').querySelectorAll('input[type="checkbox"][name="ids"]').forEach((b) => { b.checked = box.checked; });
    } else if (box.matches('[data-select-all]')) {
      document.querySelectorAll(`[form="${box.dataset.selectAll}"][data-select-item]`).forEach((b) => { b.checked = box.checked; });
    }
  });

  // Groupes de villages (aperçus, onglet Groupes) : les cases modifiées sont signalées et comptées jusqu'à Appliquer
  // (envoi du formulaire). La case d'en-tête coche sa colonne ; le pied du tableau suit le nombre de villages.
  const groupMatrix = document.querySelector('[data-group-matrix]');
  if (groupMatrix) {
    const status = groupMatrix.querySelector('[data-group-status]');
    const apply = groupMatrix.querySelector('[data-group-apply]');
    const reset = groupMatrix.querySelector('[data-group-reset]');
    const cells = (gid) => [...groupMatrix.querySelectorAll(gid ? `[data-group-cell="${gid}"]` : '[data-group-cell]')];
    const sync = () => {
      let dirty = 0;
      for (const c of cells()) {
        const changed = c.checked !== c.defaultChecked;
        c.closest('td').toggleAttribute('data-dirty', changed);
        if (changed) dirty += 1;
      }
      groupMatrix.querySelectorAll('[data-group-col]').forEach((col) => {
        const list = cells(col.dataset.groupCol);
        col.checked = list.length > 0 && list.every((c) => c.checked);
        col.indeterminate = !col.checked && list.some((c) => c.checked);
        const total = groupMatrix.querySelector(`[data-group-count="${col.dataset.groupCol}"]`);
        if (total) total.textContent = Number(total.dataset.count) + list.filter((c) => c.checked).length - list.filter((c) => c.defaultChecked).length;
      });
      status.textContent = dirty ? `${dirty} modification${dirty > 1 ? 's' : ''} à appliquer` : 'Aucune modification.';
      status.classList.toggle('text-gold-400', dirty > 0);
      apply.disabled = !dirty;
      reset.disabled = !dirty;
    };
    groupMatrix.addEventListener('change', (e) => {
      const col = e.target.closest('[data-group-col]');
      if (col) cells(col.dataset.groupCol).forEach((c) => { c.checked = col.checked; });
      sync();
    });
    groupMatrix.addEventListener('reset', () => setTimeout(sync));
    // Lignes chargées plus tard (liste progressive) : comptées aussi.
    new MutationObserver(sync).observe(groupMatrix.querySelector('tbody'), { childList: true });
    // Quitter la page avec des cases non appliquées : confirmation du navigateur.
    window.addEventListener('beforeunload', (e) => { if (!apply.disabled && !groupMatrix.dataset.sending) e.preventDefault(); });
    groupMatrix.addEventListener('submit', () => { groupMatrix.dataset.sending = '1'; });
    sync();
  }

  // Renommer sur place (village, ordres de l'aperçu Arrivant) : le titre devient un champ ; Annuler ou Échap le
  // rétablit. Plusieurs sur une page : chacun dans son conteneur [data-rename-scope].
  function renameMode(from, on) {
    const scope = from.closest('[data-rename-scope]') || document;
    const form = scope.querySelector('[data-rename-form]');
    if (!form) return;
    const title = scope.querySelector('[data-rename-title]');
    const open = scope.querySelector('[data-rename-open]');
    const input = form.querySelector('input[name="name"]');
    title.hidden = on;
    open.hidden = on;
    form.hidden = !on;
    if (on) { input.focus(); input.select(); } else { input.value = input.defaultValue; }
  }
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-rename-open]');
    const cancel = e.target.closest('[data-rename-cancel]');
    if (open) renameMode(open, true);
    else if (cancel) renameMode(cancel, false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.closest('[data-rename-form]')) renameMode(e.target, false);
  });

  // Renommer une ligne d'une longue liste (aperçu Arrivant) : un seul <template id="incoming-rename">, cloné sur la
  // ligne du crayon ; le nom et le crayon sont masqués le temps de la saisie, Annuler ou Échap les rétablit.
  let inlineOpen = null;
  function closeInline() {
    if (!inlineOpen) return;
    inlineOpen.form.remove();
    inlineOpen.hidden.forEach((el) => { el.hidden = false; });
    inlineOpen = null;
  }
  document.addEventListener('click', (e) => {
    const pen = e.target.closest('[data-inline-rename]');
    if (e.target.closest('[data-inline-cancel]')) { closeInline(); return; }
    if (!pen) return;
    const tpl = document.getElementById('incoming-rename');
    if (!tpl) return;
    closeInline();
    const form = tpl.content.firstElementChild.cloneNode(true);
    form.action = form.dataset.action.replace(':id', pen.dataset.inlineRename);
    const input = form.querySelector('input[name="name"]');
    input.value = pen.dataset.name;
    input.placeholder = pen.dataset.default;
    const title = pen.previousElementSibling;
    const hidden = [pen, title].filter(Boolean);
    hidden.forEach((el) => { el.hidden = true; });
    pen.after(form);
    inlineOpen = { form, hidden };
    input.focus();
    input.select();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inlineOpen && inlineOpen.form.contains(e.target)) closeInline();
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
    const scope = link.closest('[data-scavenge-selection]') || link.closest('form') || document;
    const input = scope.querySelector(`input[name="${link.dataset.fill}"]`);
    if (input) input.value = link.dataset.max;
    if (link.closest('[data-scavenge-selection]')) document.querySelectorAll('[data-scavenge-preview]').forEach(scavengePreview);
    const recruit = link.closest('form[data-recruit]');
    if (recruit) recruitTotal(recruit);
  });

  // Point de ralliement et recrutement : Entrée choisit « Attaquer » / « Recruter », même après un clic sur un bouton
  // de remplissage max (qui garde le focus) ou avec une saisie au-delà du maximum affiché (le serveur tranche).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !(e.target instanceof Element)) return;
    const form = e.target.closest('form[data-attack-on-enter], form[data-recruit]');
    const submit = form && form.querySelector('[data-attack-submit], [data-recruit-submit]');
    if (!submit || e.target.closest('button[type="submit"]')) return;
    e.preventDefault();
    if (!e.repeat) form.requestSubmit(submit);
  });

  // Plan du village : le survol d'un bâtiment affiche son encart (coût, Améliorer) sous le plan ; le clic ouvre sa page.
  document.addEventListener('pointerover', (e) => {
    const plot = e.target.closest('[data-plot]');
    if (!plot || plot.hasAttribute('data-selected')) return;
    document.querySelectorAll('[data-plot][data-selected]').forEach((p) => p.removeAttribute('data-selected'));
    plot.setAttribute('data-selected', '');
    document.querySelectorAll('[data-plot-info]').forEach((info) => {
      const on = info.dataset.plotInfo === plot.dataset.plot;
      info.classList.toggle('hidden', !on);
      info.classList.toggle('flex', on);
    });
  });

  // Étoiles « favori » des bâtiments : bascule sans recharger la page, puis mise à jour des étoiles du même
  // bâtiment et de la barre d'accès rapide de l'en-tête.
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-fav-form]');
    if (!form) return;
    e.preventDefault();
    const bar = document.querySelector('[data-quickbar]');
    const body = new URLSearchParams(new FormData(form));
    if (bar) { body.set('page', bar.dataset.page || ''); body.set('pageTab', bar.dataset.tab || ''); }
    try {
      const res = await fetch(form.action, { method: 'POST', body, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const { on, html } = await res.json();
      const id = CSS.escape(form.querySelector('[data-fav]').dataset.fav);
      document.querySelectorAll(`[data-fav="${id}"]`).forEach((b) => {
        b.setAttribute('aria-pressed', String(on));
        b.title = on ? 'Retirer des favoris' : 'Ajouter aux favoris';
        b.setAttribute('aria-label', b.title);
      });
      if (bar) bar.outerHTML = html;
    } catch {
      form.submit();
    }
  });

  // Menus déroulants de l'en-tête (Rapports, Tribu) : ouverts au survol de la souris, le clic suit le lien (Tous les
  // rapports, Aperçu de la tribu). Au toucher (pas de survol), le premier appui ouvre le menu, le second suit le lien.
  let closeTimer = null;
  let lastPointer = 'mouse';
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);
  function closeMenus(except) {
    document.querySelectorAll('[data-menu]').forEach((m) => {
      if (m === except) return;
      m.classList.add('hidden');
      const t = document.querySelector(`[data-menu-toggle="${m.dataset.menu}"]`);
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  }
  function openMenu(toggle) {
    const menu = document.querySelector(`[data-menu="${toggle.dataset.menuToggle}"]`);
    if (!menu) return null;
    clearTimeout(closeTimer);
    closeMenus(menu);
    menu.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
    const box = menu.parentElement.getBoundingClientRect();
    const left = toggle.getBoundingClientRect().left - box.left;
    menu.style.left = `${Math.max(0, Math.min(left, box.width - menu.offsetWidth))}px`;
    return menu;
  }
  // Petit délai à la sortie : le pointeur a le temps de passer du bouton au menu.
  const closeSoon = () => { clearTimeout(closeTimer); closeTimer = setTimeout(() => closeMenus(), 180); };
  document.querySelectorAll('[data-menu-toggle]').forEach((toggle) => {
    toggle.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') openMenu(toggle); });
    toggle.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') closeSoon(); });
    // Clavier seulement (au toucher, le focus précède le clic et ouvrirait le menu avant de suivre le lien).
    toggle.addEventListener('focus', () => { if (toggle.matches(':focus-visible')) openMenu(toggle); });
  });
  document.querySelectorAll('[data-menu]').forEach((menu) => {
    menu.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    menu.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') closeSoon(); });
    menu.addEventListener('focusout', (e) => { if (!menu.contains(e.relatedTarget)) closeSoon(); });
  });
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-menu-toggle]');
    if (toggle) {
      const menu = document.querySelector(`[data-menu="${toggle.dataset.menuToggle}"]`);
      if (lastPointer !== 'mouse' && menu && menu.classList.contains('hidden')) {
        e.preventDefault();
        openMenu(toggle);
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
  // Notification après une action sans rechargement (AJAX) : même encart que les messages du serveur.
  window.adarmaToast = (message, bad = false) => {
    const tpl = document.getElementById('toast-template');
    if (!tpl) return;
    document.querySelectorAll('[data-toast]').forEach((t) => t.remove());
    const toast = tpl.content.firstElementChild.cloneNode(true);
    toast.querySelector('[data-toast-text]').textContent = message;
    if (bad) {
      toast.setAttribute('role', 'alert');
      toast.querySelector('[data-toast-dot]').classList.replace('bg-olive-500', 'bg-blood-600');
    }
    document.body.append(toast);
    setTimeout(() => closeToast(toast), bad ? 8000 : 4500);
  };
  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-toast-close]');
    if (close) closeToast(close.closest('[data-toast]'));
  });

  // Liste des villages de l'en-tête (au-delà de 100 villages) : construite à la première ouverture du menu, d'après la
  // ligne modèle du serveur (partials/header.ejs), depuis le JSON [id, nom, x, y] de la liste.
  document.addEventListener('toggle', (e) => {
    const list = e.target.open && e.target.querySelector && e.target.querySelector('ul[data-nav-villages]');
    if (!list) return;
    const villages = JSON.parse(list.dataset.navVillages);
    const model = list.querySelector('template[data-nav-line]').content.firstElementChild;
    const [on, off, current] = [list.dataset.navOn, list.dataset.navOff, Number(list.dataset.navCurrent)];
    list.removeAttribute('data-nav-villages');
    list.append(...villages.map(([id, name, x, y]) => {
      const li = model.cloneNode(true);
      const a = li.firstElementChild;
      a.href = `/village/${id}`;
      a.className = a.className.replace(off, id === current ? on : off);
      li.querySelector('[data-nav-name]').textContent = name;
      li.querySelector('[data-nav-coords]').textContent = `${x}|${y}`;
      return li;
    }));
  }, true);

  // Champs qui envoient leur formulaire dès qu'on les change (forum : exclure les forums en sourdine ; listes de filtres).
  // data-autosubmit="request" : envoi comme par le bouton, en passant par les écouteurs « submit » de la page.
  // Listes de navigation (select[data-nav-select]) : chaque option porte l'adresse où aller.
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-autosubmit="request"]')) el.form.requestSubmit();
    else if (el.matches('[data-autosubmit]')) el.form.submit();
    else if (el.matches('select[data-nav-select]')) window.location.href = el.value;
  });

  // Réglages tribu : chaque en-tête commande seulement les cases de sa colonne.
  const tribeSharing = document.querySelector('[data-tribe-sharing]');
  if (tribeSharing) {
    const updateColumn = (column) => {
      const all = tribeSharing.querySelector(`[data-tribe-select-all="${column}"]`);
      const boxes = [...tribeSharing.querySelectorAll(`[data-tribe-column="${column}"]`)];
      all.checked = boxes.length > 0 && boxes.every((box) => box.checked);
      all.indeterminate = !all.checked && boxes.some((box) => box.checked);
    };
    for (const column of ['share', 'show']) updateColumn(column);
    tribeSharing.addEventListener('change', (e) => {
      const all = e.target.closest('[data-tribe-select-all]');
      if (all) {
        const column = all.dataset.tribeSelectAll;
        tribeSharing.querySelectorAll(`[data-tribe-column="${column}"]`).forEach((box) => { box.checked = all.checked; });
        updateColumn(column);
      } else {
        const box = e.target.closest('[data-tribe-column]');
        if (box) updateColumn(box.dataset.tribeColumn);
      }
    });
  }

  // Popup de l'happy hour (une fois par créneau) : ouverte au chargement, signalée « vue » au serveur tout de suite.
  const happy = document.querySelector('[data-happy-popup]');
  if (happy && typeof happy.showModal === 'function') {
    happy.showModal();
    const seen = happy.querySelector('[data-happy-seen]');
    fetch(seen.action, { method: 'POST', body: new URLSearchParams(new FormData(seen)), headers: { accept: 'application/json' } }).catch(() => {});
    happy.addEventListener('click', (e) => { if (e.target === happy) happy.close(); });
  }

  // Encarts qu'on peut masquer (« Masquer ce message ») : mémorisé dans le navigateur.
  document.querySelectorAll('[data-dismissable]').forEach((el) => {
    const key = `adarma:dismiss:${el.dataset.dismissable}`;
    // Ancienne clé (le jeu s'appelait GTLike) encore lue, pour ne pas réafficher un encart déjà masqué.
    try { if (localStorage.getItem(key) || localStorage.getItem(`gtlike:dismiss:${el.dataset.dismissable}`)) el.hidden = true; } catch (err) { /* stockage indisponible */ }
    el.querySelector('[data-dismiss]')?.addEventListener('click', () => {
      el.hidden = true;
      try { localStorage.setItem(key, '1'); } catch (err) { /* stockage indisponible */ }
    });
  });

  // Zones de dépôt de fichier (image de profil) : nom du fichier choisi, zone éclairée pendant le glisser-déposer.
  document.querySelectorAll('[data-dropzone]').forEach((zone) => {
    const input = zone.querySelector('input[type="file"]');
    const name = zone.querySelector('[data-dropzone-name]');
    const empty = name.textContent;
    input.addEventListener('change', () => { name.textContent = input.files[0]?.name || empty; });
    input.addEventListener('dragenter', () => { zone.dataset.dragover = ''; });
    ['dragleave', 'drop'].forEach((type) => input.addEventListener(type, () => { delete zone.dataset.dragover; }));
  });

  // Écrire un message : menu « Tribu » du champ À (groupe de destinataires à la place des pseudos).
  document.querySelectorAll('form[data-recipients]').forEach((form) => {
    const input = form.querySelector('[data-group-input]');
    const to = form.querySelector('[data-to-input]');
    const chip = form.querySelector('[data-group-chip]');
    const menu = form.querySelector('[data-group-menu]');
    const set = (id, label) => {
      input.value = id;
      to.hidden = Boolean(id);
      to.required = !id;
      chip.hidden = !id;
      chip.querySelector('[data-group-name]').textContent = label || '';
      if (menu) menu.open = false;
      if (!id) to.focus();
    };
    form.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-group]');
      if (pick) set(pick.dataset.group, pick.dataset.groupLabel);
      else if (e.target.closest('[data-group-clear]')) set('', '');
      else if (e.target.closest('[data-group-close]') && menu) menu.open = false;
    });
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

// Confirmation d'attaque : « Ajouter une attaque supplémentaire ». Chaque ajout répartit à parts égales, entre toutes les
// lignes ajoutées, les troupes qui restent après l'attaque #1 ; les lignes sont envoyées sous extra_<n>_<unité>.
(() => {
  const box = document.querySelector('[data-multi-attack]');
  if (!box) return;
  const form = box.closest('form');
  const units = JSON.parse(box.dataset.units);
  const available = JSON.parse(box.dataset.available);
  const first = JSON.parse(box.dataset.first);
  const max = Number(box.dataset.max) || 50;
  const panel = box.querySelector('[data-multi-panel]');
  const rows = box.querySelector('[data-multi-rows]');
  const template = box.querySelector('[data-multi-row]');
  const error = box.querySelector('[data-multi-error]');
  const addButton = box.querySelector('[data-multi-add]');
  const submit = form.querySelector('[data-multi-submit]');
  const fmt = (n) => window.Adarma.num(Math.floor(n));
  const extras = () => [...rows.querySelectorAll('tr[data-extra]')];

  function renumber() {
    extras().forEach((tr, i) => {
      tr.querySelector('[data-multi-label]').textContent = `Attaque #${i + 2}`;
      tr.querySelectorAll('input[data-unit]').forEach((input) => { input.name = `extra_${i + 2}_${input.dataset.unit}`; });
    });
    addButton.hidden = extras().length + 1 >= max;
  }

  function update() {
    let over = false;
    for (const id of units) {
      const total = (first[id] || 0) + extras().reduce((n, tr) => n + Math.max(0, Math.floor(Number(tr.querySelector(`[data-unit="${id}"]`).value)) || 0), 0);
      const cell = box.querySelector(`[data-multi-total="${id}"]`);
      cell.textContent = fmt(total);
      const bad = total > (available[id] || 0);
      over ||= bad;
      cell.classList.toggle('text-blood-450', bad);
      cell.classList.toggle('text-parchment-600', !bad && !total);
    }
    error.hidden = !over;
    if (submit) submit.disabled = over;
  }

  // Troupes restantes (disponibles moins l'attaque #1) réparties entre les lignes ; le reste va aux premières.
  function split() {
    const list = extras();
    for (const id of units) {
      const rest = Math.max(0, (available[id] || 0) - (first[id] || 0));
      const share = Math.floor(rest / list.length);
      list.forEach((tr, i) => {
        const n = share + (i < rest % list.length ? 1 : 0);
        tr.querySelector(`[data-unit="${id}"]`).value = n || '';
      });
    }
  }

  addButton.addEventListener('click', () => {
    panel.hidden = false;
    box.closest('form').querySelector('[data-multi-single]')?.setAttribute('hidden', '');
    const tr = template.content.firstElementChild.cloneNode(true);
    tr.dataset.extra = '';
    rows.append(tr);
    renumber();
    split();
    update();
  });
  rows.addEventListener('input', update);
  rows.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-multi-remove]');
    if (!remove) return;
    remove.closest('tr').remove();
    renumber();
    update();
  });
  update();
})();

// Alertes d'attaques (en-tête de chaque page du jeu) : le nombre d'attaques en approche est relu toutes les 20 s (avec les rapports et messages non lus), dans
// le compteur rouge et en tête du titre de l'onglet ; une nouvelle attaque (identifiant plus grand que le dernier vu,
// partagé entre les onglets) joue un son si le joueur l'a activé sur cet appareil (aperçu Arrivant).
(() => {
  const badge = document.querySelector('[data-incoming-alerts]');
  const toggle = document.querySelector('[data-attack-sound-toggle]');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  };
  const SOUND = 'adarma.attackSound';
  let audio = null;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      [[880, 0], [660, 0.18], [880, 0.36]].forEach(([freq, at]) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, audio.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.15);
        osc.connect(gain).connect(audio.destination);
        osc.start(audio.currentTime + at);
        osc.stop(audio.currentTime + at + 0.16);
      });
    } catch { /* pas de son disponible */ }
  }
  // Les navigateurs n'autorisent le son qu'après un geste du joueur : le premier clic prépare le contexte audio.
  document.addEventListener('click', () => {
    if (store.get(SOUND) !== '1' || audio) return;
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* pas de son */ }
  }, { once: true });

  if (toggle) {
    toggle.checked = store.get(SOUND) === '1';
    toggle.addEventListener('change', () => { store.set(SOUND, toggle.checked ? '1' : '0'); if (toggle.checked) beep(); });
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-attack-sound-test]')) beep(); });

  if (!badge) return;
  const LAST = `adarma.attacks.lastId.${badge.dataset.world}`;
  const count = badge.querySelector('[data-incoming-count]');
  function show(n) {
    count.textContent = n;
    badge.hidden = !n;
    document.title = (n ? `(${n}) ` : '') + document.title.replace(/^\(\d+\) /, '');
  }
  // Dernière lecture, partagée entre les onglets du monde : un seul onglet interroge le serveur toutes les 20 s, les
  // autres reçoivent ses compteurs (événement storage) ; un onglet caché n'interroge pas, il relit en revenant.
  const SHARED = `adarma.alerts.${badge.dataset.world}`;
  const PERIOD = 20000;
  const shared = () => { try { return JSON.parse(store.get(SHARED) || 'null'); } catch { return null; } };
  function apply({ attacks, lastId, reports, messages }) {
    show(attacks);
    // Rapports et messages non lus : pastilles du menu, et nombres du menu déroulant Rapports.
    const setCount = (key, n, hideZero) => document.querySelectorAll(`[data-live-count="${key}"]`).forEach((el) => {
      el.textContent = n ? String(n) : '';
      if (hideZero) el.hidden = !n;
    });
    if (reports) {
      setCount('reports', reports.all, true);
      for (const [f, n] of Object.entries(reports)) setCount(`reports:${f}`, n, false);
    }
    if (messages != null) setCount('messages', messages, true);
    // Première lecture sur cet appareil : rien à signaler, on retient seulement le dernier identifiant.
    const stored = store.get(LAST);
    if (stored === null || lastId > Number(stored)) {
      store.set(LAST, String(lastId));
      if (stored !== null && store.get(SOUND) === '1') beep();
    }
  }
  async function poll() {
    if (document.hidden) return;
    const last = shared();
    if (last && Date.now() - last.at < PERIOD - 2000) return;
    try {
      const res = await fetch(badge.dataset.incomingAlerts, { cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      store.set(SHARED, JSON.stringify({ at: Date.now(), data }));
      apply(data);
    } catch { /* hors ligne : on réessaie au prochain tour */ }
  }
  window.addEventListener('storage', (e) => {
    if (e.key !== SHARED || !e.newValue || document.hidden) return;
    try { apply(JSON.parse(e.newValue).data); } catch { /* valeur illisible */ }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  // Au chargement, l'en-tête vient d'être rendu avec ces compteurs : lecture seulement si aucune n'est récente (ou
  // pour retenir le dernier identifiant sur un nouvel appareil).
  if (store.get(LAST) === null) store.set(SHARED, '');
  poll();
  setInterval(poll, PERIOD);
})();

// Longues listes (voir web/lazyLists.js) : le paquet suivant d'une liste [data-lazy-list] est demandé à l'approche de sa
// marque [data-lazy-more], et ses lignes remplacent la marque (elles apportent la marque du paquet d'après).
// Les cases à cocher suivent « Tout sélectionner » : les lignes chargées ensuite arrivent cochées ; un formulaire
// [data-page-ids] (ordres de toute la page) envoie aussi les lignes pas encore chargées quand tout est sélectionné.
(() => {
  const loading = new WeakSet();
  const watch = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) load(e.target); });
  }, { rootMargin: '1200px 0px' }) : null;
  const observe = (root) => root.querySelectorAll('[data-lazy-more]').forEach((m) => (watch ? watch.observe(m) : load(m)));

  // Formulaire d'une case de liste, et sa case « Tout sélectionner » (data-select-all="id" ou data-check-all dedans).
  const formOf = (box) => (box.form || (box.getAttribute('form') && document.getElementById(box.getAttribute('form'))));
  const selectAllChecked = (form) => Boolean(form) && [...document.querySelectorAll(`[data-select-all="${form.id}"]`), ...form.querySelectorAll('[data-check-all]')]
    .some((b) => b.checked);

  async function load(marker) {
    if (loading.has(marker) || !marker.isConnected) return;
    loading.add(marker);
    watch?.unobserve(marker);
    const list = marker.closest('[data-lazy-list]');
    try {
      const res = await fetch(marker.dataset.lazyMore, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const fresh = doc.querySelector(`[data-lazy-list="${list.dataset.lazyList}"]`);
      if (!fresh) throw new Error('liste absente');
      const nodes = [...fresh.children].map((n) => document.importNode(n, true));
      for (const n of nodes) {
        n.querySelectorAll('input[type="checkbox"]').forEach((box) => { if (selectAllChecked(formOf(box) || box.closest('form'))) box.checked = true; });
      }
      marker.replaceWith(...nodes);
      nodes.forEach((n) => { if (n.matches('[data-lazy-more]')) observe(n.parentElement); });
      list.dispatchEvent(new CustomEvent('lazy:loaded', { bubbles: true, detail: { nodes } }));
    } catch {
      // Échec (hors ligne…) : un clic sur la marque relance le chargement.
      loading.delete(marker);
      marker.textContent = 'Chargement impossible : cliquer pour réessayer.';
      marker.addEventListener('click', () => load(marker), { once: true });
    }
  }
  observe(document);
  // Listes remplacées en direct (aperçu du village rafraîchi) : leurs marques sont observées aussi.
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => { if (n.nodeType === 1 && !n.matches('[data-lazy-more]') && n.querySelector('[data-lazy-more]')) observe(n); });
    }
  }).observe(document.body, { childList: true, subtree: true });

  // « Tout sélectionner » en double (haut et bas d'une liste) : les cases restent d'accord.
  document.addEventListener('change', (e) => {
    const box = e.target.closest('[data-select-all]');
    if (box) document.querySelectorAll(`[data-select-all="${box.dataset.selectAll}"]`).forEach((b) => { b.checked = box.checked; });
  });
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.matches('[data-page-ids]')) return;
    form.querySelectorAll('input[data-unloaded]').forEach((i) => i.remove());
    if (!selectAllChecked(form)) return;
    const name = form.dataset.pageIdsName || 'ids';
    const present = new Set([...document.querySelectorAll(`input[type="checkbox"][name="${name}"]`)].filter((b) => formOf(b) === form).map((b) => b.value));
    for (const id of form.dataset.pageIds.split(',').filter(Boolean)) {
      if (present.has(id)) continue;
      const input = document.createElement('input');
      Object.assign(input, { type: 'hidden', name, value: id });
      input.dataset.unloaded = '';
      form.append(input);
    }
  }, true);
})();

// Aperçu Arrivant : actions sans rechargement (on garde sa place dans la liste). Étiqueter, ignorer et renommer envoient
// le formulaire en AJAX avec les filtres de la page (`view`) et les ordres affichés (`shown`) ; le serveur renvoie les
// lignes à jour, qui remplacent les anciennes, et les ordres sortis de la liste (ignorés…), retirés. Une erreur
// s'affiche en notification. Sans JavaScript, le formulaire part normalement.
(() => {
  const list = document.querySelector('[data-lazy-list="incomings"]');
  if (!list) return;
  const shownIds = () => [...list.querySelectorAll('tr[data-row-id]')].map((tr) => tr.dataset.rowId).join(',');

  // Compteurs : onglets, liste, ignorés ([data-count]), colonnes des totaux ([data-total="player:12"]) et compteur rouge
  // de l'en-tête. Une arrivée les fait baisser aussitôt ; la page relit les vrais nombres toutes les 15 s et après
  // chaque action (attaques arrivées sur des lignes pas encore chargées, nouvelles attaques…).
  const bump = (el, by) => { if (el) el.textContent = String(Math.max(0, Number(el.textContent) + by)); };
  document.addEventListener('incoming:arrived', ({ detail: tr }) => {
    const ignored = tr.dataset.ignored === '1';
    if (ignored) bump(document.querySelector('[data-count="ignored"]'), -1);
    else {
      bump(document.querySelector('[data-count="all"]'), -1);
      bump(document.querySelector(`[data-count="${tr.dataset.type === 'attack' ? 'attacks' : 'supports'}"]`), -1);
    }
    bump(document.querySelector('[data-count="total"]'), -1);
    for (const key of ['player', 'origin', 'target']) bump(document.querySelector(`[data-total="${key}:${tr.dataset[key]}"]`), -1);
    if (tr.dataset.type === 'attack') {
      const header = document.querySelector('[data-incoming-count]');
      bump(header, -1);
      if (header) {
        const n = Number(header.textContent);
        header.closest('[data-incoming-alerts]').hidden = !n;
        document.title = (n ? `(${n}) ` : '') + document.title.replace(/^\(\d+\) /, '');
      }
    }
  });
  async function resync() {
    if (document.hidden) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('format', 'counts');
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const { counts, total, totals } = await res.json();
      for (const [key, n] of Object.entries({ ...counts, total })) {
        const el = document.querySelector(`[data-count="${key}"]`);
        if (el) el.textContent = String(n);
      }
      document.querySelectorAll('[data-total]').forEach((el) => {
        const [key, id] = el.dataset.total.split(':');
        el.textContent = String((totals[key] && totals[key][id]) || 0);
      });
    } catch { /* hors ligne : prochain essai dans 15 s */ }
  }
  setInterval(resync, 15000);
  function apply({ rows = {}, removed = [] }) {
    for (const [id, html] of Object.entries(rows)) {
      const tpl = document.createElement('template');
      tpl.innerHTML = `<table><tbody>${html}</tbody></table>`;
      const fresh = tpl.content.querySelector('tr');
      list.querySelector(`tr[data-row-id="${id}"]`)?.replaceWith(fresh);
    }
    removed.forEach((id) => list.querySelector(`tr[data-row-id="${id}"]`)?.remove());
    document.querySelectorAll('[data-select-all="incomings-bulk"]').forEach((b) => { b.checked = false; });
  }
  async function send(form, body) {
    body.set('view', window.location.search.slice(1));
    body.set('shown', shownIds());
    // getAttribute : form.action est masqué par les boutons nommés « action » (Étiqueter, Ignorer…).
    const res = await fetch(form.getAttribute('action'), { method: 'POST', body, credentials: 'same-origin', headers: { accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Action impossible.');
    apply(data);
    window.adarmaToast?.(data.message);
    resync();
  }
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    const bulk = form.id === 'incomings-bulk' && ['label', 'ignore', 'unignore'].includes(e.submitter?.value);
    const rename = form.closest('tr[data-row-id]') && /\/rename$/.test(form.getAttribute('action') || '');
    if (!bulk && !rename) return;
    e.preventDefault();
    // Le formulaire est lu avant de désactiver les boutons : un bouton désactivé (celui cliqué) n'est pas envoyé.
    const body = new URLSearchParams(new FormData(form, e.submitter));
    const buttons = [...document.querySelectorAll('button')].filter((b) => b.form === form);
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await send(form, body);
    } catch (err) {
      window.adarmaToast?.(err.message, true);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  });

})();

(() => {
  // Assistant de pillage : envoi d'un modèle favori, retrait d'une ligne et filtres sans recharger la page. Après un
  // envoi, les troupes du village baissent, la ligne s'estompe et les boutons des modèles devenus trop gros se
  // désactivent ; un filtre changé est enregistré puis la liste est relue.
  const farmUnits = document.querySelectorAll('[data-farm-unit]');
  if (farmUnits.length) {
    const left = Object.fromEntries([...farmUnits].map((el) => [el.dataset.farmUnit, Number(el.textContent.replace(/\D/g, '')) || 0]));
    const refresh = () => {
      farmUnits.forEach((el) => {
        const n = left[el.dataset.farmUnit];
        el.textContent = window.Adarma.num(n);
        el.classList.toggle('is-amount', n > 0);
        el.classList.toggle('is-zero', !n);
      });
      document.querySelectorAll('[data-farm-units]').forEach((b) => {
        const units = JSON.parse(b.dataset.farmUnits);
        b.disabled = Object.entries(units).some(([id, n]) => (left[id] || 0) < n);
      });
    };
    const filters = document.querySelector('[data-farm-filters]');
    let reload = 0;
    filters?.addEventListener('change', async () => {
      const ticket = ++reload;
      const list = document.querySelector('[data-farm-list]');
      list?.classList.add('opacity-60');
      try {
        const res = await fetch(filters.action, { method: 'POST', body: new URLSearchParams(new FormData(filters)), headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Filtres non enregistrés.');
        const page = await fetch(window.location.pathname, { headers: { accept: 'text/html' } });
        const doc = new DOMParser().parseFromString(await page.text(), 'text/html');
        if (ticket !== reload) return;
        const next = doc.querySelector('[data-farm-list]');
        if (list && next) list.replaceWith(next);
        const total = doc.querySelector('[data-farm-total]');
        if (total) document.querySelector('[data-farm-total]').textContent = total.textContent;
        refresh();
        if (window.location.search) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      } catch (err) {
        window.adarmaToast?.(err.message, true);
      } finally {
        document.querySelector('[data-farm-list]')?.classList.remove('opacity-60');
      }
    });
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      const sending = form.matches('[data-farm-send]');
      if (!sending && !form.matches('[data-farm-forget]')) return;
      e.preventDefault();
      const button = form.querySelector('button');
      const row = form.closest('[data-farm-row]');
      button.disabled = true;
      try {
        const res = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { accept: 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Envoi impossible.');
        if (sending) {
          for (const [id, n] of Object.entries(data.units || {})) left[id] = Math.max(0, (left[id] || 0) - n);
          window.adarmaToast?.(`Attaque envoyée sur ${data.target.x}|${data.target.y}.`);
        }
        // Village désormais attaqué : il sort de la liste, sauf si le filtre garde les villages vers lesquels une
        // attaque est en route (la ligne s'estompe alors). Un village retiré (×) sort toujours.
        const keep = sending && filters?.querySelector('[name="attacked"]')?.checked;
        if (keep) row?.classList.add('opacity-45');
        else if (row) {
          row.remove();
          const total = document.querySelector('[data-farm-total]');
          if (total) total.textContent = String(Math.max(0, (Number(total.textContent) || 0) - 1));
        }
      } catch (err) {
        window.adarmaToast?.(err.message, true);
      } finally {
        button.disabled = false;
        if (sending) refresh();
      }
    });
  }
})();

// Barre des favoris en colonne (Compte → Barre des favoris) : elle se place sous l'en-tête collant, dont la hauteur
// varie (style de jeu, passage à la ligne) ; mesurée ici dans --header-h (src/styles/app.css, .quickbar-dock).
(() => {
  const header = document.querySelector('body > header.sticky');
  if (!header || !document.querySelector('.quickbar-dock')) return;
  const measure = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  measure();
  if (window.ResizeObserver) new ResizeObserver(measure).observe(header);
  else window.addEventListener('resize', measure);
})();

// Ouvrir chaque page de discussion au dernier message de sa zone défilante.
(() => {
  const messages = document.querySelector('[data-conversation-messages]');
  if (!messages) return;
  const scrollToLast = () => { messages.scrollTop = messages.scrollHeight; };
  scrollToLast();
  if (document.readyState !== 'complete') window.addEventListener('load', scrollToLast, { once: true });
})();

// Quête du tutoriel en cours (en-tête, data-quest-hints ; game/tutorial.js) : les liens vers la page à ouvrir
// ('link:<chemin>', sauf celle où l'on est déjà) et les boutons ou lignes à utiliser (sélecteurs) pulsent en doré.
(() => {
  const source = document.querySelector('[data-quest-hints]');
  if (!source) return;
  let targets;
  try { targets = JSON.parse(source.dataset.questHints); } catch { return; }
  const base = `/village/${source.dataset.questVillage}`;
  const label = `Quête « ${source.dataset.questTitle} »`;
  const mark = (el) => {
    el.classList.add('quest-hint');
    if (!el.title.includes(label)) el.title = el.title ? `${el.title} · ${label}` : label;
  };
  // Les liens d'une quête forment un chemin (point de ralliement → collecte) : sur une de ses pages, seules les pages
  // suivantes clignotent. Un lien doit viser la page exacte, sans paramètre (?tab=troops n'est pas la page visée).
  const paths = targets.filter((t) => t.startsWith('link:')).map((t) => base + (t.slice(5) ? `/${t.slice(5)}` : ''));
  const here = window.location.pathname.replace(/\/$/, '');
  const next = paths.slice(paths.indexOf(here) + 1);
  document.querySelectorAll('a[href]').forEach((a) => {
    const url = new URL(a.href, window.location.href);
    if (a.closest('[data-quest-skip]') || url.origin !== window.location.origin || url.search) return;
    if (next.includes(url.pathname.replace(/\/$/, ''))) mark(a);
  });
  for (const selector of targets.filter((t) => !t.startsWith('link:'))) {
    try { document.querySelectorAll(selector).forEach(mark); } catch { /* sélecteur invalide : ignoré */ }
  }
})();
