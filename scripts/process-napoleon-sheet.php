<?php

declare(strict_types=1);

/** Découpe la planche napoléonienne transparente en six sprites aux tailles de la carte. */
$directory = dirname(__DIR__) . '/public/img/map/villages/napoleon';
$sourcePath = $directory . '/source/napoleon-levels-plaque-transparent.png';
$targets = [[224, 146], [265, 214], [304, 234], [307, 235], [332, 257], [325, 258]];
$sheet = new Imagick($sourcePath);
if ($sheet->getImageWidth() !== 1665 || $sheet->getImageHeight() !== 944 || !$sheet->getImageAlphaChannel()) {
    throw new RuntimeException('La planche doit mesurer 1665 × 944 pixels avec transparence.');
}

foreach ($targets as $index => [$targetWidth, $targetHeight]) {
    $column = $index % 3;
    $row = intdiv($index, 3);
    $cell = clone $sheet;
    $cell->cropImage(555, 472, $column * 555, $row * 472);
    $cell->setImagePage(0, 0, 0, 0);

    $alpha = $cell->exportImagePixels(0, 0, 555, 472, 'A', Imagick::PIXEL_CHAR);
    $left = 555;
    $top = 472;
    $right = 0;
    $bottom = 0;
    foreach ($alpha as $pixel => $value) {
        if ($value < 24) continue;
        $x = $pixel % 555;
        $y = intdiv($pixel, 555);
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
