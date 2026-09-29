'use strict';

// Affichage en direct : ressources qui montent, comptes à rebours, horloge serveur.
(function () {
  const offset = (() => {
    const clock = document.querySelector('[data-clock]');
    return clock ? Number(clock.dataset.clock) - Date.now() : 0;
  })();
  const serverNow = () => Date.now() + offset;
  const isOverview = Boolean(document.querySelector('[data-overview-page]'));
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (s) => `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
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

      // Repartir des ressources calculées par le serveur après la fin d'une activité.
      const updatedResources = fresh.querySelectorAll('[data-res]');
      document.querySelectorAll('[data-res]').forEach((el, i) => {
        const next = updatedResources[i];
        if (!next) return;
        for (const key of ['res', 'cap', 'rate', 'at']) el.dataset[key] = next.dataset[key];
      });
    } catch { /* Le minuteur reste visible ; une prochaine échéance réessaiera. */ }
    finally { refreshingOverview = false; }
  }

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
      if (left <= 0) {
        if (isOverview) refreshOverview();
        else if (!reloading) {
          reloading = true;
          setTimeout(() => window.location.reload(), 500);
        }
      }
    });
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
    for (const [id, amount] of Object.entries(resources)) preview.querySelector(`[data-scavenge-resource="${id}"]`).textContent = amount.toLocaleString('fr-FR');
    const seconds = Math.round((Math.pow(cap * cap * 100 * loot * loot, 0.45) + 1800) * Math.pow(Number(preview.dataset.speed), -0.55));
    preview.querySelector('[data-scavenge-duration]').textContent = cap ? fmt(seconds) : '—';
  }
  document.addEventListener('input', (e) => {
    if (e.target.closest('[data-scavenge-selection]')) document.querySelectorAll('[data-scavenge-preview]').forEach(scavengePreview);
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
      button.textContent = `max ${max.toLocaleString('fr-FR')}`;
      const input = form.querySelector(`input[name="${id}"]`);
      if (input) input.max = String(max);
    }
    form.querySelectorAll('[data-total]').forEach((el) => {
      const k = el.dataset.total;
      el.lastElementChild.textContent = k === 'time' ? fmt(Math.round(total.time)) : Math.floor(total[k]).toLocaleString('fr-FR');
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

  // Point de ralliement : durée du trajet (unité la plus lente, comme le serveur) et heure d'arrivée.
  function arrivalText(date, now) {
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${String(date.getMilliseconds()).padStart(3, '0')}`;
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(date) - day(now)) / 86400000);
    if (diff === 0) return `aujourd'hui à ${time}`;
    if (diff === 1) return `demain à ${time}`;
    return `le ${pad(date.getDate())}/${pad(date.getMonth() + 1)} à ${time}`;
  }
  function travelPreview(form) {
    const pace = JSON.parse(form.dataset.travel);
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
    form.querySelector('[data-travel-arrival]').textContent = ok ? arrivalText(new Date(now.getTime() + seconds * 1000), now) : '—';
    form.querySelector('[data-travel-duration]').textContent = ok ? `(${fmt(seconds)})` : '';
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
      el.textContent = arrivalText(new Date(now.getTime() + Number(el.dataset.arriveIn)), now);
    });
    requestAnimationFrame(arrivalFrame);
  }
  if (document.querySelector('form[data-travel], [data-arrive-in]')) requestAnimationFrame(arrivalFrame);

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

  // Renommer le village sur place : le titre devient un champ ; Annuler ou Échap le rétablit.
  function renameMode(on) {
    const form = document.querySelector('[data-rename-form]');
    if (!form) return;
    const title = document.querySelector('[data-rename-title]');
    const open = document.querySelector('[data-rename-open]');
    const input = form.querySelector('input[name="name"]');
    title.hidden = on;
    open.hidden = on;
    form.hidden = !on;
    if (on) { input.focus(); input.select(); } else { input.value = title.textContent.trim(); }
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-rename-open]')) renameMode(true);
    else if (e.target.closest('[data-rename-cancel]')) renameMode(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.closest('[data-rename-form]')) renameMode(false);
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
    if (bar) body.set('page', bar.dataset.page || '');
    try {
      const res = await fetch(form.action, { method: 'POST', body, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const { on, html } = await res.json();
      const id = form.querySelector('[data-fav]').dataset.fav;
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

  // « Sélectionner tout » : coche les cases liées au formulaire indiqué (boîte de réception).
  document.addEventListener('change', (e) => {
    const all = e.target.closest('[data-select-all]');
    if (all) document.querySelectorAll(`[form="${all.dataset.selectAll}"][data-select-item]`).forEach((box) => { box.checked = all.checked; });
  });

  // Encarts qu'on peut masquer (« Masquer ce message ») : mémorisé dans le navigateur.
  document.querySelectorAll('[data-dismissable]').forEach((el) => {
    const key = `gtlike:dismiss:${el.dataset.dismissable}`;
    try { if (localStorage.getItem(key)) el.hidden = true; } catch (err) { /* stockage indisponible */ }
    el.querySelector('[data-dismiss]')?.addEventListener('click', () => {
      el.hidden = true;
      try { localStorage.setItem(key, '1'); } catch (err) { /* stockage indisponible */ }
    });
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
