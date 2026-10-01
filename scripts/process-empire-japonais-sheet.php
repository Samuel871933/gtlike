<?php

declare(strict_types=1);

/** Aligne la planche japonaise sur la composition romaine, puis découpe les six sprites. */
$directory = dirname(__DIR__) . '/public/img/map/villages/empire-japonais';
$rawPath = $directory . '/source/empire-japonais-generation.png';
$sourcePath = $directory . '/source/empire-japonais-levels-plaque-transparent.png';
$targets = [[224, 146], [265, 214], [304, 234], [307, 235], [332, 257], [325, 258]];
$referenceBoxes = [[92, 183, 216, 139], [71, 116, 256, 206], [55, 100, 290, 222],
    [52, 97, 295, 225], [38, 73, 323, 249], [40, 71, 318, 251]];
$raw = new Imagick($rawPath);
if ($raw->getImageWidth() !== 1666 || $raw->getImageHeight() !== 944 || !$raw->getImageAlphaChannel()) {
    throw new RuntimeException('La génération doit mesurer 1666 × 944 pixels avec transparence.');
}
$rawXEdges = [0, 555, 1111, 1666];
$normalized = new Imagick();
$normalized->newImage(1200, 680, new ImagickPixel('transparent'), 'png');
foreach ($referenceBoxes as $index => [$boxX, $boxY, $boxWidth, $boxHeight]) {
    $column = $index % 3;
    $row = intdiv($index, 3);
    $cellWidth = $rawXEdges[$column + 1] - $rawXEdges[$column];
    $cell = clone $raw;
    $cell->cropImage($cellWidth, 472, $rawXEdges[$column], $row * 472);
    $cell->setImagePage(0, 0, 0, 0);
    $alpha = $cell->exportImagePixels(0, 0, $cellWidth, 472, 'A', Imagick::PIXEL_CHAR);
    $left = $cellWidth;
    $top = 472;
    $right = 0;
    $bottom = 0;
    foreach ($alpha as $pixel => $value) {
        if ($value < 24) continue;
        $x = $pixel % $cellWidth;
        $y = intdiv($pixel, $cellWidth);
        $left = min($left, $x);
        $top = min($top, $y);
        $right = max($right, $x + 1);
        $bottom = max($bottom, $y + 1);
    }
    if ($right <= $left || $bottom <= $top) {
        throw new RuntimeException('Illustration absente au niveau ' . ($index + 1));
    }
    $cell->cropImage($right - $left, $bottom - $top, $left, $top);
    $cell->setImagePage(0, 0, 0, 0);
    $scale = min($boxWidth / $cell->getImageWidth(), $boxHeight / $cell->getImageHeight());
    $width = max(1, (int) round($cell->getImageWidth() * $scale));
    $height = max(1, (int) round($cell->getImageHeight() * $scale));
    $cell->resizeImage($width, $height, Imagick::FILTER_LANCZOS, 1);
    $normalized->compositeImage($cell, Imagick::COMPOSITE_OVER,
        $column * 400 + $boxX + intdiv($boxWidth - $width, 2),
        $row * 340 + $boxY + $boxHeight - $height);
    $cell->clear();
}
$normalized->stripImage();
$normalized->writeImage($sourcePath);
$normalized->clear();
$raw->clear();

$sheet = new Imagick($sourcePath);
if ($sheet->getImageWidth() !== 1200 || $sheet->getImageHeight() !== 680 || !$sheet->getImageAlphaChannel()) {
    throw new RuntimeException('La planche normalisée doit mesurer 1200 × 680 pixels avec transparence.');
}

foreach ($targets as $index => [$targetWidth, $targetHeight]) {
    $column = $index % 3;
    $row = intdiv($index, 3);
    $cellWidth = 400;
    $cell = clone $sheet;
    $cell->cropImage($cellWidth, 340, $column * 400, $row * 340);
    $cell->setImagePage(0, 0, 0, 0);

    $alpha = $cell->exportImagePixels(0, 0, $cellWidth, 340, 'A', Imagick::PIXEL_CHAR);
    $left = $cellWidth;
    $top = 340;
    $right = 0;
    $bottom = 0;
    foreach ($alpha as $pixel => $value) {
        if ($value < 24) continue;
        $x = $pixel % $cellWidth;
        $y = intdiv($pixel, $cellWidth);
        $left = min($left, $x);
        $top = min($top, $y);
        $right = max($right, $x + 1);
        $bottom = max($bottom, $y + 1);
    }
    if ($right <= $left || $bottom <= $top) {
        throw new RuntimeException('Illustration absente au niveau ' . ($index + 1));
    }

    $cell->cropImage($right - $left, $bottom - $top, $left, $top);
    $cell->setImagePage(0, 0, 0, 0);
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
    printf("level-%d.png : %d × %d, dessin %d × %d\n",
        $index + 1, $targetWidth, $targetHeight, $width, $height);
    $cell->clear();
    $canvas->clear();
}
$sheet->clear();
