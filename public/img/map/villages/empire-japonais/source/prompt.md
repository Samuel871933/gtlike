# Planche des villages de l’Empire japonais

Mode : imagegen intégré, fond transparent. La planche romaine du projet a servi de gabarit strict pour l’orientation, la perspective, le centrage, les marges et la simplicité. Le script aligne ensuite les six silhouettes sur les boîtes visibles de cette référence.

Prompt final :

> Create six transparent Japanese Empire map sprites using the Roman sprite sheet as a strict composition template. Keep the same six positions, settlement footprints, vertical placement, 3/4 isometric camera direction, symmetric centered front gate, broad transparent gutters, relative level sizes, lighting and simplicity. Replace Roman architecture with Japanese timber and white plaster buildings, dark charcoal tile roofs, stone foundations and sparse vermilion accents. Do not add visual complexity or apparent height. Level 1: exactly two low houses, short open fence and central well. Level 2: two houses, simple palisade and centered gate. Level 3: compact wall, two low houses and one modest watchtower. Level 4: four corner towers, two houses and centered gate. Level 5: slightly larger enclosure, medium two-tier keep and two houses. Level 6: slightly larger three-tier keep, four low houses, compact wall and centered gate. Same camera angle and roof directions throughout. No tall trees, dense roof clutter, people, text, flags, scenery or watermark. Genuine transparent background.

La génération brute est conservée dans `empire-japonais-generation.png`. La planche finale mesure 1200 × 680, comme la référence romaine. Découpe reproductible : `php scripts/process-empire-japonais-sheet.php` depuis la racine du projet.
