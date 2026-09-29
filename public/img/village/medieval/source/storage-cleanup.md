# Nettoyage de l’entrepôt

Outil intégré `image_gen`, une édition par palier, suivie de la normalisation transparente 320 × 280 avec `scripts/normalize-village-sprite.php`.

Sorties : `../tier-1/storage-clean.png`, `../tier-2/storage-clean.png`, `../tier-3/storage-clean.png`.

## Prompt commun

Use case: background-extraction. Edit target: supplied medieval warehouse sprite. Remove ALL disconnected fragments of neighboring sprites: the floating flowerbed/building fragment along the top edge and stray fragments at the left and right canvas edges. Keep ONLY the central warehouse, including its complete roof, walls, attached sacks/barrels/crane if present and its own ground base. Preserve this exact warehouse design, colors, materials, perspective, and proportions; do not redesign or add elements. Crisp original pixel/painted game art. Output a single clean cutout on genuine transparent alpha background, with transparent padding on every edge. No background, no checkerboard, no text.
