# Thèmes de jeu

Dans le code, un thème s'appelle « game style » (`gameStyles.js`, `data-game-style`). Dans l'interface, « Style de jeu »
désigne un autre réglage, la densité (normal / minimaliste) : voir `src/web/gameLayouts.js`.

Un style de jeu habille toute l'interface **en partie** (barres, panneaux, boutons, plan du village, carte…).
La page d'accueil, la connexion et les pages publiques des mondes gardent le style par défaut.

En jeu, `<html>` porte la classe `game_style` et l'attribut `data-game-style="<id>"` (voir
`src/views/partials/header.ejs`). Tout le style passe par les jetons de `@theme` (`src/styles/app.css`) :
les vues n'utilisent que des classes Tailwind qui lisent ces jetons (`bg-panel-top`, `text-gold-400`,
`fill-rel-own`…), donc redéfinir les jetons suffit à changer l'apparence.

Styles disponibles : `medieval` (par défaut : clair, couleurs de Guerre Tribale), `roman` (les valeurs de `@theme`), `viking`
et `egypt` (clair : pierre ocre, or et sépia, accordé à son fond de fresques).

Les styles clairs (`medieval`, `egypt`) partagent la variante `light:` (déclarée dans `app.css`) pour les ajustements propres
aux fonds clairs : `scheme-light`, onglet actif du menu en couleur d'action… Un nouveau style clair s'ajoute à la liste des
sélecteurs de cette variante, sans toucher aux vues.
`roman.css` répète les valeurs de `@theme` pour chaque jeton qu'un autre style redéfinit : ajouter un jeton à un style
demande de l'ajouter aussi à `roman.css` avec sa valeur de `@theme` (sinon `test/game-styles.test.js` échoue). Le joueur choisit le sien dans **Compte → Thème de
jeu** (gratuit) ; le choix est enregistré sur le compte (`User.gameStyle`).

## Ajouter un style

Les étapes ci-dessous reprennent le style `viking`, déjà présent : `viking.css` sert de modèle complet.

1. **Déclarer le style** dans `src/web/gameStyles.js` :
   ```js
   viking: { id: 'viking', name: 'Viking', fonts: 'https://fonts.googleapis.com/css2?family=…&display=swap' },
   ```
2. **Créer `src/styles/game-styles/viking.css`** en partant de `roman.css`, et l'importer dans `app.css` :
   ```css
   @custom-variant viking (&:where([data-game-style="viking"], [data-game-style="viking"] *));

   @layer theme {
     [data-game-style="viking"] {
       --font-display: "Pirata One", serif;
       --color-gold-400: #9fc4d8;   /* accents */
       --color-bronze-700: #3c4a52; /* bordures */
       --color-panel-top: #161c20;  /* panneaux */
       /* … tout jeton --color-* / --font-* de app.css … */
       --game-image-village: url("/img/game-styles/viking/village.svg");
     }
   }
   ```
3. **Ajouter les images** dans `public/img/game-styles/viking/` (au minimum `village.svg`, 966 × 580, même
   disposition que la version romaine : les bâtiments sont placés en % par `partials/village-plan.ejs`).
4. **Ajustements de mise en page** si besoin, directement dans les vues avec la variante :
   `class="rounded-md viking:rounded-none"`.
5. **C'est tout** : le style apparaît automatiquement dans le sélecteur de la page Compte (aperçu rendu avec
   ses propres jetons grâce à `data-game-style` sur la carte d'aperçu).

## Règles

- Ne jamais redéfinir les couleurs de la carte et de la mini-carte (`--color-mini-*`, `--color-map-*`, terrain : `grass`,
  `forest`, `hill`, `water`…) : elles restent identiques dans tous les styles (vérifié par `test/game-styles.test.js`).
- Ne jamais écrire de couleur en dur (`#…`, `rgba(…)` teintée) dans une vue du jeu : ajouter un jeton dans
  `@theme` et l'utiliser. Seules les ombres noires neutres (`rgba(0,0,0,…)`) restent littérales.
- Les SVG en ligne prennent leurs couleurs par classes (`fill-rel-own`, `stroke-gold-400`), jamais par
  attribut `fill="#…"`.
