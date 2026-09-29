'use strict';

/** Prochaine échéance par activité et bâtiment ; plusieurs activités peuvent coexister. */
module.exports = function villageActivities(ctx, { knights = [], scavenges = [], transports = [] } = {}) {
  const result = {};
  const now = Number(new Date(ctx.now));
  const add = (building, kind, label, date) => {
    const end = Number(new Date(date));
    if (!Number.isFinite(end) || end <= now) return;
    const list = result[building] ||= [];
    const previous = list.find((a) => a.kind === kind);
    if (!previous) list.push({ kind, label, end });
    else if (end < previous.end) Object.assign(previous, { label, end });
  };
  for (const o of ctx.buildOrders || []) {
    const queued = new Date(o.startsAt) > now;
    add(o.building, 'build', queued ? 'Début chantier' : o.demolish ? 'Démolition' : 'Construction', queued ? o.startsAt : o.endsAt);
  }
  for (const o of ctx.recruitOrders || []) {
    if (o.done < o.count) add(o.building, 'recruit', 'Prochaine unité', o.nextAt);
  }
  for (const o of ctx.researchOrders || []) add('smith', 'research', 'Recherche', o.endsAt);
  for (const k of knights) add('statue', 'training', 'Formation paladin', k.trainingEndsAt);
  for (const s of scavenges) add('place', 'scavenge', 'Retour collecte', s.endsAt);
  add('place', 'unlock', 'Déblocage collecte', ctx.village.scavenging?.unlocking?.endsAt);
  add('farm', 'militia', 'Fin de la milice', ctx.state.militiaUntil);
  for (const t of transports) add('market', 'transport', t.type === 'return' ? 'Retour marchands' : 'Livraison', t.arrivesAt);
  return result;
};
