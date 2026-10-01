<?php

declare(strict_types=1);

/** Découpe la planche Noël transparente (3 colonnes × 2 lignes) aux tailles des villages de la carte. */
$directory = dirname(__DIR__) . '/public/img/map/villages/noel';
$sourcePath = $directory . '/source/noel-levels-plaque-transparent.png';
$targets = [[224, 146], [265, 214], [304, 234], [307, 235], [332, 257], [325, 258]];
$alphaCutoff = 24;

$sheet = new Imagick($sourcePath);
if ($sheet->getImageWidth() !== 1665 || $sheet->getImageHeight() !== 944 || !$sheet->getImageAlphaChannel()) {
    throw new RuntimeException('Expected a transparent 1665 × 944 source sheet.');
}
$xEdges = [0, 555, 1110, 1665];
$yEdges = [0, 472, 944];
// Les flèches des niveaux 5 et 6 montent légèrement dans les cases 2 et 3 de la rangée du haut.
$topRowHeights = [472, 436, 448];

foreach ($targets as $index => [$targetWidth, $targetHeight]) {
    $column = $index % 3;
    $row = intdiv($index, 3);
    $cellWidth = $xEdges[$column + 1] - $xEdges[$column];
    $cellHeight = $row === 0 ? $topRowHeights[$column] : $yEdges[$row + 1] - $yEdges[$row];
    $cell = clone $sheet;
    $cell->cropImage($cellWidth, $cellHeight, $xEdges[$column], $yEdges[$row]);
    $cell->setImagePage(0, 0, 0, 0);

    $alpha = $cell->exportImagePixels(0, 0, $cellWidth, $cellHeight, 'A', Imagick::PIXEL_CHAR);
    $left = $cellWidth;
    $top = $cellHeight;
    $right = 0;
    $bottom = 0;
    foreach ($alpha as $pixel => $value) {
        if ($value < $alphaCutoff) continue;
        $x = $pixel % $cellWidth;
        $y = intdiv($pixel, $cellWidth);
        $left = min($left, $x);
        $top = min($top, $y);
        $right = max($right, $x + 1);
        $bottom = max($bottom, $y + 1);
    }
    if ($right <= $left || $bottom <= $top) {
        throw new RuntimeException('Level ' . ($index + 1) . ' has no visible artwork.');
    }

    $cell->cropImage($right - $left, $bottom - $top, $left, $top);
    $cell->setImagePage(0, 0, 0, 0);
    $iterator = $cell->getPixelIterator();
    foreach ($iterator as $pixels) {
        foreach ($pixels as $pixel) {
            if ($pixel->getColorValue(Imagick::COLOR_ALPHA) < $alphaCutoff / 255) {
                $pixel->setColorValue(Imagick::COLOR_ALPHA, 0);
            }
        }
        $iterator->syncIterator();
    }

    $scale = min(($targetWidth - 4) / $cell->getImageWidth(), ($targetHeight - 4) / $cell->getImageHeight());
    $width = max(1, (int) round($cell->getImageWidth() * $scale));
    $height = max(1, (int) round($cell->getImageHeight() * $scale));
    $cell->resizeImage($width, $height, Imagick::FILTER_LANCZOS, 1);

    $canvas = new Imagick();
    $canvas->newImage($targetWidth, $targetHeight, new ImagickPixel('transparent'), 'png');
    $canvas->compositeImage($cell, Imagick::COMPOSITE_OVER,
        intdiv($targetWidth - $width, 2), $targetHeight - $height - 2);
    $canvas->stripImage();
    $canvas->writeImage($directory . '/level-' . ($index + 1) . '.png');
    printf("level-%d.png: %d × %d, visible %d × %d\n",
        $index + 1, $targetWidth, $targetHeight, $width, $height);
    $cell->clear();
    $canvas->clear();
}
$sheet->clear();
