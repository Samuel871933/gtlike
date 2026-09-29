<?php

declare(strict_types=1);

/**
 * Cut the generated five-column resource plaque into 96px transparent icons.
 *
 * Usage: php scripts/process-resource-sheet.php plaque.png output-directory
 */

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php scripts/process-resource-sheet.php plaque.png output-directory\n");
    exit(1);
}

$ids = ['wood', 'stone', 'iron', 'storage', 'pop'];
$source = new Imagick($argv[1]);
$source->setImageFormat('png');
$sourceWidth = $source->getImageWidth();
$sourceHeight = $source->getImageHeight();

$outputDirectory = rtrim($argv[2], DIRECTORY_SEPARATOR);
if (!is_dir($outputDirectory) && !mkdir($outputDirectory, 0775, true) && !is_dir($outputDirectory)) {
    throw new RuntimeException("Unable to create output directory: {$outputDirectory}");
}

foreach ($ids as $index => $id) {
    $left = (int) round($sourceWidth * $index / 5);
    $right = (int) round($sourceWidth * ($index + 1) / 5);
    $sprite = clone $source;
    $sprite->cropImage($right - $left, $sourceHeight, $left, 0);
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
