# Génération des images de l’aperçu

Outil intégré `image_gen` (compétence imagegen), 29 septembre 2026.

## Fond — `../background-v2.png`

Use case: precise-object-edit. Asset type: medieval browser strategy village background, landscape 1536x1024. Edit the referenced existing background. Keep its painterly detailed medieval game art, elevated isometric camera, oval wooden palisade, front gate centered at x50% y74%, forest upper left, rocky iron area upper right, clay terrain lower left and wheat fields lower right. Main change: remove ALL the excessive empty fenced rectangular building plots and their little fences and stone borders. Inside the enclosure use continuous natural green grass and a broad irregular compacted-earth central village square with a small simple stone well at x50% y43%. Just a few organically branching narrow dirt paths, no grid or repeating vacant plots. Keep broad flat clear grassy spaces for separately overlaid buildings, especially church on the right at x75% y57%, headquarters rear center x58% y25%, workshops left and lower central interior. Reduce decorative trees inside so buildings remain readable. No buildings inside, no church baked into background, no text, no interface, no characters. The result should feel like an organic compact village terrain inspired by classic Tribal Wars rather than a subdivision full of vacant lots. Preserve overall outer resource regions and wall silhouette to match existing sprite positions.

## Église — `church.png` (source), `../church.png` (sprite 320 × 280)

Use case: stylized-concept. Asset type: separate transparent PNG building sprite for medieval browser strategy village. Reference image is STYLE ONLY, replace its subject with ONE small medieval European stone church: rectangular nave, warm orange terracotta gabled roof, modest tall square bell tower with pointed orange tiled spire and small cross, arched doorway and narrow gothic windows. Match reference's crisp hand-painted game sprite, warm pale gray stone, 3/4 elevated isometric view, sunlight upper left, readable silhouette at small size. Entire building fully visible, centered, front and right wall visible. Tiny stone doorstep only. Genuine transparent alpha background, no scenery, no grass tile, no rectangular base, no checkerboard, no text, no UI, no people, no extra buildings. Church should be taller than it is wide, with 5% transparent padding. Original artwork inspired by classic Tribal Wars village readability.

Le sprite est normalisé avec `scripts/normalize-village-sprite.php` en conservant le canal alpha. L’église reste un décor sans lien ni action dans les mondes actuels.

