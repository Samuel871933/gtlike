'use strict';

// Carte du mode Zeppelin (src/modes/zeppelin) : vaisseaux en vol animés en temps réel, et vol du vaisseau vers une
// case libre (clic sur une case sans village). Passe uniquement par l'API d'extension de public/js/map.js
// (window.AdarmaMap) ; le dessin de base de la carte n'est pas modifié.
(function () {
  const M = window.AdarmaMap;
  if (!M) return;
  const { esc } = window.Adarma;
  const fmt = window.Adarma.duration;
  const villageId = Number(M.base.split('/').pop());
  const POLL_MS = 15000;

  let flights = [];
  let offset = 0;
  const now = () => Date.now() + offset;

  // Calque des vols, dans le plan de la carte : il suit le glisser et le zoom sans calcul.
  const layer = document.createElement('div');
  layer.className = 'pointer-events-none absolute inset-0';
  M.layer.append(layer);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'zeppelin-route');
  svg.setAttribute('width', '1');
  svg.setAttribute('height', '1');
  layer.append(svg);
  const nodes = new Map();

  const angleOf = (dx, dy) => (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  function position(f, t) {
    const p = Math.max(0, Math.min(1, (t - f.startsAt) / (f.arrivesAt - f.startsAt)));
    return [f.from[0] + (f.to[0] - f.from[0]) * p, f.from[1] + (f.to[1] - f.from[1]) * p];
  }

  function sync(list) {
    flights = list;
    for (const [id, n] of nodes) if (!list.some((f) => f.villageId === id)) { n.ship.remove(); n.path.remove(); nodes.delete(id); }
    for (const f of list) {
      if (nodes.has(f.villageId)) continue;
      const ship = document.createElement('div');
      ship.className = `zeppelin-flight${f.villageId === villageId ? ' zeppelin-flight--mine' : ''}`;
      ship.innerHTML = `<i style="background-image:url('/img/modes/zeppelin/ships/angle-${angleOf(f.to[0] - f.from[0], f.to[1] - f.from[1])}.webp')"></i><b>${esc(f.name)}</b>`;
      ship.title = `${f.name}${f.owner ? ` (${f.owner})` : ''} · vers ${f.to[0]}|${f.to[1]}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      if (f.villageId === villageId) path.setAttribute('class', 'zeppelin-route--mine');
      svg.append(path);
      layer.append(ship);
      nodes.set(f.villageId, { ship, path });
    }
  }

  async function load() {
    try {
      const res = await fetch(`${M.base}/zeppelin/flights`, { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      offset = data.now - Date.now();
      sync(data.flights);
    } catch { /* nouvel essai au prochain tour */ }
  }

  // Positions à chaque image ; à l'arrivée, les secteurs de départ et d'arrivée sont rechargés (le village a bougé).
  function frame() {
    const { tw, th } = M.tile();
    const t = now();
    for (const f of flights.slice()) {
      const n = nodes.get(f.villageId);
      if (!n) continue;
      if (t >= f.arrivesAt) {
        flights = flights.filter((x) => x !== f);
        sync(flights);
        setTimeout(() => { M.reloadAt(...f.from); M.reloadAt(...f.to); load(); }, 1500);
        continue;
      }
      const [x, y] = position(f, t);
      n.ship.style.left = `${(x + 0.5) * tw}px`;
      n.ship.style.top = `${(y + 0.5) * th}px`;
      n.ship.style.width = `${tw * 1.25}px`;
      n.ship.style.height = `${tw * 1.25}px`;
      n.path.setAttribute('d', `M${((x + 0.5) * tw).toFixed(1)} ${((y + 0.5) * th).toFixed(1)}L${((f.to[0] + 0.5) * tw).toFixed(1)} ${((f.to[1] + 0.5) * th).toFixed(1)}`);
    }
    requestAnimationFrame(frame);
  }

  // Case sans village : vol du vaisseau, avec la durée calculée par le serveur (mêmes règles qu'au départ).
  const panel = document.createElement('div');
  panel.className = 'map-controls absolute z-[16] hidden w-[230px] border-2 border-black bg-panel-top p-2.5 text-[13px] shadow-[inset_0_0_0_1px_var(--color-bronze-500),5px_5px_0_#000]';
  M.frame.append(panel);
  const close = () => panel.classList.add('hidden');
  document.addEventListener('click', (e) => { if (!e.target.closest('.map-controls') && !e.target.closest('[data-map-viewport]')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  M.on('tile', ({ x, y, el }) => {
    panel.innerHTML = `<div class="font-display text-base text-gold-200">Case ${x}|${y}</div><div class="mt-1 text-parchment-500" data-z-plan>Calcul du vol…</div>`;
    panel.classList.remove('hidden');
    M.placeBeside(panel, el);
    fetch(`${M.base}/zeppelin/plan?x=${x}&y=${y}`, { headers: { accept: 'application/json' } }).then((r) => r.json()).then((p) => {
      const info = panel.querySelector('[data-z-plan]');
      if (!info) return;
      if (p.error) { info.textContent = p.error; return; }
      const at = new Date(p.arrivesAt - offset);
      info.innerHTML = `Vol de ${fmt(p.seconds)} · arrivée à ${at.toLocaleTimeString('fr-FR')}`
        + '<button type="button" class="mt-2 flex w-full cursor-pointer items-center justify-center border-2 border-black bg-action px-2 py-1.5 text-on-accent" data-z-move>Déplacer le vaisseau ici</button>'
        + '<p class="mt-1.5 text-xs text-parchment-600">Pendant le vol, le vaisseau reste visé à sa case de départ et ne peut envoyer ni troupes ni marchands.</p>';
      info.querySelector('[data-z-move]').addEventListener('click', async () => {
        const body = new URLSearchParams({ _csrf: M.csrf, x, y });
        const res = await fetch(`${M.base}/zeppelin/move`, { method: 'POST', body, headers: { accept: 'application/json' } });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) { info.textContent = out.error || 'Vol impossible.'; return; }
        close();
        window.adarmaToast?.(`Le vaisseau décolle vers ${x}|${y} (${fmt(out.seconds)}).`);
        load();
      });
    }).catch(() => { panel.querySelector('[data-z-plan]').textContent = 'Serveur injoignable.'; });
    return true;
  });

  load();
  setInterval(load, POLL_MS);
  requestAnimationFrame(frame);
}());
