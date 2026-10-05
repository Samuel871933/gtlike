<?php

declare(strict_types=1);

/** Prépare la planche naine et ses six sprites de carte à partir de la génération transparente. */
$directory = dirname(__DIR__) . '/public/img/map/villages/nains';
$source = $directory . '/source/nains-generation.png';
$correctedFirstLevel = $directory . '/source/nains-level-1-corrected.png';
$sheetPath = $directory . '/source/nains-levels-plaque-transparent.png';
$targets = [[224, 146], [265, 214], [304, 234], [307, 235], [332, 257], [325, 258]];
$referenceBoxes = [[92, 183, 216, 139], [71, 116, 256, 206], [55, 100, 290, 222],
    [52, 97, 295, 225], [38, 73, 323, 249], [40, 71, 318, 251]];

function contentBox(Imagick $image): array
{
    $width = $image->getImageWidth();
    $height = $image->getImageHeight();
    $alpha = $image->exportImagePixels(0, 0, $width, $height, 'A', Imagick::PIXEL_CHAR);
    $left = $width;
    $top = $height;
    $right = 0;
    $bottom = 0;
    foreach ($alpha as $pixel => $value) {
        if ($value < 24) continue;
        $x = $pixel % $width;
        $y = intdiv($pixel, $width);
        $left = min($left, $x);
        $top = min($top, $y);
        $right = max($right, $x + 1);
        $bottom = max($bottom, $y + 1);
    }
    if ($right <= $left || $bottom <= $top) {
        throw new RuntimeException('Une case de la planche est vide.');
    }
    return [$left, $top, $right - $left, $bottom - $top];
}

function cropToContent(Imagick $image): Imagick
{
    [$x, $y, $width, $height] = contentBox($image);
    $image->cropImage($width, $height, $x, $y);
    $image->setImagePage(0, 0, 0, 0);
    return $image;
}

$raw = new Imagick($source);
if ($raw->getImageWidth() !== 1666 || $raw->getImageHeight() !== 944 || !$raw->getImageAlphaChannel()) {
    throw new RuntimeException('La génération doit être un PNG RGBA de 1666 × 944 pixels.');
}
$xEdges = [0, 555, 1111, 1666];
$sheet = new Imagick();
$sheet->newImage(1200, 680, new ImagickPixel('transparent'), 'png');

foreach ($referenceBoxes as $index => [$boxX, $boxY, $boxWidth, $boxHeight]) {
    $column = $index % 3;
    $row = intdiv($index, 3);
    if ($index === 0) {
        $cell = new Imagick($correctedFirstLevel);
    } else {
        $cell = clone $raw;
        $cell->cropImage($xEdges[$column + 1] - $xEdges[$column], 472, $xEdges[$column], $row * 472);
        $cell->setImagePage(0, 0, 0, 0);
    }
    cropToContent($cell);
    $scale = min($boxWidth / $cell->getImageWidth(), $boxHeight / $cell->getImageHeight());
    $width = (int) round($cell->getImageWidth() * $scale);
    $height = (int) round($cell->getImageHeight() * $scale);
    $cell->resizeImage($width, $height, Imagick::FILTER_LANCZOS, 1);
    $sheet->compositeImage($cell, Imagick::COMPOSITE_OVER,
        $column * 400 + $boxX + intdiv($boxWidth - $width, 2),
        $row * 340 + $boxY + $boxHeight - $height);
    $cell->clear();
}
$sheet->stripImage();
$sheet->writeImage($sheetPath);
$raw->clear();

foreach ($targets as $index => [$targetWidth, $targetHeight]) {
    $cell = clone $sheet;
    $cell->cropImage(400, 340, ($index % 3) * 400, intdiv($index, 3) * 340);
    $cell->setImagePage(0, 0, 0, 0);
    cropToContent($cell);
    $scale = min(($targetWidth - 4) / $cell->getImageWidth(), ($targetHeight - 4) / $cell->getImageHeight());
    $width = (int) round($cell->getImageWidth() * $scale);
    $height = (int) round($cell->getImageHeight() * $scale);
    $cell->resizeImage($width, $height, Imagick::FILTER_LANCZOS, 1);
    $sprite = new Imagick();
    $sprite->newImage($targetWidth, $targetHeight, new ImagickPixel('transparent'), 'png');
    $sprite->compositeImage($cell, Imagick::COMPOSITE_OVER,
        intdiv($targetWidth - $width, 2), $targetHeight - $height - 2);
    $sprite->stripImage();
    $path = $directory . '/level-' . ($index + 1);
    $sprite->writeImage($path . '.png');
    $sprite->setImageFormat('webp');
    $sprite->setImageCompressionQuality(86);
    $sprite->writeImage($path . '.webp');
    printf("level-%d : %d × %d, dessin %d × %d\n", $index + 1, $targetWidth, $targetHeight, $width, $height);
    $cell->clear();
    $sprite->clear();
}
$sheet->clear();
