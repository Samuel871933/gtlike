# Shoreline kit v1

`shoreline-kit-v1.png` is the generated source atlas for the large water biomes.

The sheet contains a 4 x 4 family of matching assets:

- open water and an open-water variation;
- straight banks facing north, east, south and west;
- convex and concave shoreline corners;
- a narrow channel;
- a muddy bank/detail tile.

Rendering direction: painted fantasy RTS terrain, olive grass, slate-blue water, muddy natural banks, sparse reeds and stones. The source atlas is intentionally kept at generation resolution so tiles can be selected and normalized during the map autotile integration without losing detail.

This first combined atlas is retained as a visual source only. It is no longer used by the map renderer because the water contained inside each vignette produced visible tile seams.

The production renderer now uses three purpose-built assets:

- `water-seamless-v1.png`: full-bleed open water shared across a 6 x 6-cell area;
- `shore-edge-v1.png`: transparent 3:1 straight-bank strip, split into three variations;
- `shore-corner-v1.png`: transparent corner bank, rotated for every orientation.
- `shore-straight-v2.png`: square seamless straight bank whose two connection points share the exact same height.

`public/js/map.js` selects the overlays from the N/E/S/W land-neighbor mask. Every overlay is clipped by its `.map-water` cell, so shoreline artwork cannot spill onto surrounding terrain.

Generation method: built-in image generation, using `terrain-atlas-v3.png`, `terrain-grass.webp`, and `terrain-water-v3.png` as visual references.
