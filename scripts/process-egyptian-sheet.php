<?php

declare(strict_types=1);

/**
 * Cut the generated 3x2 Egyptian village plaque into map-ready sprites.
 *
 * Usage: php scripts/process-egyptian-sheet.php plaque.png output-directory
 */

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php scripts/process-egyptian-sheet.php plaque.png output-directory\n");
    exit(1);
}

$source = new Imagick($argv[1]);
$source->setImageFormat('png');

if ($source->getImageWidth() !== 1536 || $source->getImageHeight() !== 1024) {
    throw new RuntimeException(sprintf(
        'Unexpected plaque size: %dx%d',
        $source->getImageWidth(),
        $source->getImageHeight()
    ));
}

$targets = [
    [224, 146],
    [265, 214],
    [304, 234],
    [307, 235],
    [332, 257],
    [325, 258],
];

$outputDirectory = rtrim($argv[2], DIRECTORY_SEPARATOR);
if (!is_dir($outputDirectory) && !mkdir($outputDirectory, 0775, true) && !is_dir($outputDirectory)) {
    throw new RuntimeException("Unable to create output directory: {$outputDirectory}");
}

foreach ($targets as $index => [$targetWidth, $targetHeight]) {
    $column = $index % 3;
    $row = intdiv($index, 3);
    $sprite = clone $source;
    $sprite->cropImage(512, 512, $column * 512, $row * 512);
    $sprite->setImagePage(0, 0, 0, 0);
    $sprite->trimImage(0);
    $sprite->setImagePage(0, 0, 0, 0);

    $availableWidth = $targetWidth - 4;
    $availableHeight = $targetHeight - 4;
    $scale = min($availableWidth / $sprite->getImageWidth(), $availableHeight / $sprite->getImageHeight());
    $width = max(1, (int) round($sprite->getImageWidth() * $scale));
    $height = max(1, (int) round($sprite->getImageHeight() * $scale));
    $sprite->resizeImage($width, $height, Imagick::FILTER_LANCZOS, 1.0);

    $canvas = new Imagick();
    $canvas->newImage($targetWidth, $targetHeight, new ImagickPixel('transparent'), 'png');
    $x = intdiv($targetWidth - $width, 2);
    $y = $targetHeight - $height - 2;
    $canvas->compositeImage($sprite, Imagick::COMPOSITE_OVER, $x, $y);
    $canvas->setImageFormat('png');
    $canvas->stripImage();
    $canvas->writeImage(sprintf('%s/level-%d.png', $outputDirectory, $index + 1));

    $sprite->clear();
    $canvas->clear();
}

$source->clear();
