'use strict';

// Page du matchup : relit l'état toutes les 3 s (ce qui garde la place dans la file), entre dans la partie dès qu'elle
// est trouvée, recharge la page quand l'état change (recherche lancée par le chef du groupe, membre arrivé ou parti),
// et affiche le temps d'attente.
(() => {
  const card = document.querySelector('[data-matchup-poll]');
  if (!card) return;
  const state = card.dataset.matchupPoll;

  async function poll() {
    if (document.hidden) return;
    try {
      const res = await fetch('/matchup/status', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (!res.ok) return;
      const s = await res.json();
      if (s.match) {
        window.location.href = s.match.url;
        return;
      }
      const now = `${s.queue ? s.queue.format : ''}|${s.group ? s.group.members.map((m) => m.id).join(',') : ''}`;
      if (now !== state) window.location.reload();
    } catch {
      // Réseau coupé : on réessaie au tour suivant.
    }
  }
  setInterval(poll, 3000);
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
})();
