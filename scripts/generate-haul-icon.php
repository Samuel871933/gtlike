<?php
// Icône du butin des rapports : sac de stockage et ressources déjà utilisées dans le jeu.
$root = dirname(__DIR__);
$source = $root . '/public/img/resources';
$target = $root . '/public/img/reports/haul-full.png';

$canvas = imagecreatetruecolor(128, 128);
imagealphablending($canvas, false);
imagesavealpha($canvas, true);
imagefill($canvas, 0, 0, imagecolorallocatealpha($canvas, 0, 0, 0, 127));
imagealphablending($canvas, true);

foreach ([
    ['storage', 32, 5, 65, 72],
    ['wood', 7, 57, 60, 53],
    ['iron', 73, 55, 55, 49],
    ['stone', 41, 75, 52, 46],
] as [$name, $x, $y, $width, $height]) {
    $icon = imagecreatefrompng("$source/$name.png");
    $left = imagesx($icon);
    $top = imagesy($icon);
    $right = 0;
    $bottom = 0;
    for ($iy = 0; $iy < imagesy($icon); $iy++) {
        for ($ix = 0; $ix < imagesx($icon); $ix++) {
            if ((imagecolorat($icon, $ix, $iy) >> 24) >= 100) continue;
            $left = min($left, $ix);
            $top = min($top, $iy);
            $right = max($right, $ix);
            $bottom = max($bottom, $iy);
        }
    }
    imagecopyresampled($canvas, $icon, $x, $y, $left, $top, $width, $height, $right - $left + 1, $bottom - $top + 1);
    imagedestroy($icon);
}

imagepng($canvas, $target);
imagedestroy($canvas);
echo "$target\n";
