'use strict';

// Matchup, deux usages :
// - page du matchup : relit l'état toutes les 3 s (ce qui garde la place dans la file), entre dans la partie dès qu'elle
//   est créée, recharge la page quand l'état change (recherche lancée par le chef du groupe, membre arrivé ou parti,
//   partie trouvée à accepter), affiche le temps d'attente et le compte à rebours de la partie trouvée ;
// - en jeu (barre de partie) : relit l'état toutes les 4 s et ouvre l'écran de fin dès que la partie est terminée.
(() => {
  async function status() {
    const res = await fetch('/matchup/status', { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
    return res.ok ? res.json() : null;
  }

  const live = document.querySelector('[data-match-live]');
  if (live) {
    const id = Number(live.dataset.matchLive);
    setInterval(async () => {
      try {
        const s = await status();
        if (s && (!s.match || s.match.id !== id)) window.location.href = `/matchup/partie/${id}`;
      } catch { /* Réseau coupé : on réessaie au tour suivant. */ }
    }, 4000);
    return;
  }

  const card = document.querySelector('[data-matchup-poll]');
  if (!card) return;
  const state = card.dataset.matchupPoll;

  async function poll() {
    try {
      const s = await status();
      if (!s) return;
      if (s.match) {
        window.location.href = s.match.url;
        return;
      }
      const p = s.proposal;
      const now = `${s.queue ? s.queue.format : ''}|${s.group ? s.group.members.map((m) => m.id).join(',') : ''}|${p ? `${p.id}:${p.accepted ? 1 : 0}:${p.acceptedCount}` : ''}`;
      if (now !== state) window.location.reload();
    } catch {
      // Réseau coupé : on réessaie au tour suivant.
    }
  }
  // Partie trouvée : relecture plus serrée (les autres joueurs acceptent), même onglet caché.
  const deadline = document.querySelector('[data-accept-deadline]');
  setInterval(poll, deadline ? 1000 : 3000);
  document.addEventListener('visibilitychange', poll);

  const elapsed = document.querySelector('[data-elapsed-since]');
  if (elapsed) {
    const since = Number(elapsed.dataset.elapsedSince);
    const show = () => {
      const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
      elapsed.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    show();
    setInterval(show, 1000);
  }

  if (deadline) {
    // Compte à rebours de l'acceptation ; l'onglet signale la partie trouvée s'il est en arrière-plan.
    const end = Number(deadline.dataset.acceptDeadline);
    const title = document.title;
    let flip = false;
    const show = () => {
      deadline.textContent = String(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
      flip = !flip;
      document.title = document.hidden && flip ? 'Partie trouvée !' : title;
    };
    show();
    setInterval(show, 500);
  }
})();
