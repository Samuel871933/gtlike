# Planche « Ville de luxe »

Mode : imagegen intégré, fond transparent. La planche romaine sert de gabarit pour la perspective, les six positions et la progression des tailles. Une seconde passe a simplifié la première génération.

Prompt de génération :

> Create six transparent upgrade-level map sprites for a wealthy modern desert metropolis inspired by Dubai. Use the Roman village sheet as a strict composition template: 3 columns by 2 rows, shallow compact footprints, elevated isometric 3/4 camera, centered approach, broad transparent gutters and simple readable game icons. Replace ancient buildings with warm ivory stone, white concrete, turquoise glass and a few palms. Grow from two low villas at level 1 to a compact cluster of three staggered skyscrapers at level 6. Keep the height and footprint within the Roman reference. No people, cars, text, logos, flags, background skyline or watermark.

Prompt de simplification :

> Edit the first generated sheet, using the Roman sheet as strict layout and simplicity reference. Keep the six levels, turquoise glass, cream-white palette, centered entrance and true transparency. Remove golden domes, finials, palace decoration, most palms and tiny rooftop details. Use flat-roof white villas and clean rectangular blue-glass towers with a few large windows. Levels 1–3 stay low; level 4 has a few short towers; level 5 has one moderate skyscraper; level 6 has three towers of staggered height. Preserve the Roman reference's perspective, relative footprint, alignment and gutters.

La génération finale brute est `ville-luxe-generation.png`. La planche normalisée mesure 1200 × 680. Découpe reproductible : `php scripts/process-ville-luxe-sheet.php` depuis la racine du projet.
