'use strict';

// Chargement progressif des longues listes (aperçu Arrivant, rapports, messages, marché, aperçus des villages…) : la
// page n'affiche que le premier paquet de lignes ; une marque [data-lazy-more] en fin de liste donne l'adresse du paquet
// suivant (la même page avec ?lazy_<liste>=<rang>). game.js la demande à l'approche du bas, y lit les lignes du
// conteneur [data-lazy-list="<liste>"] et les met à la place de la marque.
//
// Dans une vue :
//   <% const l = lazy('reports', reports) %>
//   <ul data-lazy-list="reports"><% for (const r of l.items) { %>…<% } %><%- lazyMore(l, { tag: 'li' }) %></ul>
// Le conteneur ne doit contenir que les lignes (l'en-tête d'un tableau va dans <thead>).

const { esc } = require('./ui');

const DEFAULT_CHUNK = 100;

/** Pose lazy() et lazyMore() dans les vues de la requête. */
function lazyLists(req, res, next) {
  const url = new URL(req.originalUrl, 'http://local');
  res.locals.lazy = (key, items, { chunk = DEFAULT_CHUNK } = {}) => {
    const from = Math.max(0, Math.min(items.length, Number.parseInt(req.query[`lazy_${key}`], 10) || 0));
    const to = Math.min(items.length, from + chunk);
    let more = null;
    if (to < items.length) {
      const u = new URL(url);
      for (const k of [...u.searchParams.keys()]) if (k.startsWith('lazy_')) u.searchParams.delete(k);
      u.searchParams.set(`lazy_${key}`, String(to));
      more = { href: u.pathname + u.search, left: items.length - to };
    }
    return { key, items: items.slice(from, to), from, more };
  };
  /**
   * Marque du paquet suivant (rien s'il n'en reste pas) : `tag` tr (avec `colspan`), li ou div, selon le conteneur.
   */
  res.locals.lazyMore = (l, { tag = 'tr', colspan = 1, label = 'éléments' } = {}) => {
    if (!l.more) return '';
    const text = `Chargement des ${esc(label)} suivants… (${l.more.left} restants)`;
    const cls = 'px-3 py-3 text-center text-[13px] text-parchment-500';
    const attrs = `data-lazy-more="${esc(l.more.href)}"`;
    if (tag === 'tr') return `<tr ${attrs}><td colspan="${colspan}" class="${cls}">${text}</td></tr>`;
    return `<${tag} ${attrs} class="${cls}">${text}</${tag}>`;
  };
  next();
}

module.exports = { lazyLists, DEFAULT_CHUNK };
