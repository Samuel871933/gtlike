'use strict';

// Achat d'un article de la boutique (views/shop-item.ejs) : n'affiche que l'étape de la portée choisie (monde, compte,
// serveur), coche sa première durée et tient à jour le récapitulatif (prix, solde après l'achat, Adartons manquants).
(() => {
  const form = document.querySelector('[data-shop-form]');
  if (!form) return;
  const balance = Number(form.dataset.balance) || 0;
  const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');
  const scopes = [...form.querySelectorAll('[data-scope]')];
  const panels = [...form.querySelectorAll('[data-scope-panel]')];
  const $ = (sel) => form.querySelector(sel);

  function current() {
    const scope = scopes.find((r) => r.checked);
    return scope ? scope.value : null;
  }

  function update() {
    const scope = current();
    for (const p of panels) {
      const on = p.dataset.scopePanel === scope;
      p.hidden = !on;
      // Champs des autres portées : désactivés, pour qu'ils ne partent pas avec le formulaire.
      p.querySelectorAll('select, input').forEach((el) => { el.disabled = !on; });
    }
    let offer = form.querySelector(`[data-offer][data-scope-of="${scope}"]:checked`);
    if (!offer) {
      offer = form.querySelector(`[data-offer][data-scope-of="${scope}"]`);
      if (offer) offer.checked = true;
    }
    const pay = $('[data-pay]');
    if (!offer) {
      $('[data-total]').textContent = '—';
      $('[data-after]').textContent = '—';
      pay.disabled = true;
      return;
    }
    const price = Number(offer.dataset.price);
    const scopeName = scopes.find((r) => r.checked).closest('label').querySelector('.font-display').textContent;
    const target = form.querySelector(`[data-scope-panel="${scope}"] [data-target]`);
    const where = target ? ` · ${target.options[target.selectedIndex].text}` : '';
    $('[data-summary]').textContent = `${form.dataset.item} · ${scopeName}${where} · ${offer.dataset.duration}`;
    $('[data-total]').textContent = fmt(price);
    const after = balance - price;
    $('[data-after]').textContent = after >= 0 ? `${fmt(after)} Adartons` : '—';
    $('[data-missing]').classList.toggle('hidden', after >= 0);
    $('[data-missing-amount]').textContent = fmt(-after);
    pay.disabled = after < 0;
    $('[data-pay-label]').textContent = `Payer ${fmt(price)} Adartons`;
  }

  form.addEventListener('change', update);
  update();
})();
