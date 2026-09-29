<?php

declare(strict_types=1);

/**
 * Cut the generated 4x3 unit plaque into consistently framed 96px icons.
 *
 * Usage: php scripts/process-unit-sheet.php plaque.png output-directory
 */

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php scripts/process-unit-sheet.php plaque.png output-directory\n");
    exit(1);
}

$ids = [
    'spear', 'sword', 'axe', 'archer',
    'spy', 'light', 'marcher', 'heavy',
    'ram', 'catapult', 'knight', 'snob',
];
$source = new Imagick($argv[1]);
$source->setImageFormat('png');

if ($source->getImageWidth() % 4 !== 0 || $source->getImageHeight() % 3 !== 0) {
    throw new RuntimeException(sprintf(
        'Unexpected plaque size: %dx%d',
        $source->getImageWidth(),
        $source->getImageHeight()
    ));
}

$outputDirectory = rtrim($argv[2], DIRECTORY_SEPARATOR);
if (!is_dir($outputDirectory) && !mkdir($outputDirectory, 0775, true) && !is_dir($outputDirectory)) {
    throw new RuntimeException("Unable to create output directory: {$outputDirectory}");
}

$cellWidth = intdiv($source->getImageWidth(), 4);
$cellHeight = intdiv($source->getImageHeight(), 3);
foreach ($ids as $index => $id) {
    $column = $index % 4;
    $row = intdiv($index, 4);
    $sprite = clone $source;
    $sprite->cropImage($cellWidth, $cellHeight, $column * $cellWidth, $row * $cellHeight);
    $sprite->setImagePage(0, 0, 0, 0);
    $sprite->trimImage(0);
    $sprite->setImagePage(0, 0, 0, 0);

    $scale = min(90 / $sprite->getImageWidth(), 90 / $sprite->getImageHeight());
    $width = max(1, (int) round($sprite->getImageWidth() * $scale));
    $height = max(1, (int) round($sprite->getImageHeight() * $scale));
    $sprite->resizeImage($width, $height, Imagick::FILTER_LANCZOS, 1.0);

    $canvas = new Imagick();
    $canvas->newImage(96, 96, new ImagickPixel('transparent'), 'png');
    $canvas->compositeImage($sprite, Imagick::COMPOSITE_OVER, intdiv(96 - $width, 2), intdiv(96 - $height, 2));
    $canvas->stripImage();
    $canvas->writeImage("{$outputDirectory}/{$id}.png");

    $sprite->clear();
    $canvas->clear();
}

$source->clear();
