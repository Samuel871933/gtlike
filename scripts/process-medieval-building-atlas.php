<?php

declare(strict_types=1);

/**
 * Découpe un atlas 4 × 4 généré pour la vue du village médiéval.
 *
 * Usage : php scripts/process-medieval-building-atlas.php atlas.png dossier-sortie
 */

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php scripts/process-medieval-building-atlas.php atlas.png dossier-sortie\n");
    exit(1);
}

$buildingIds = [
    'statue', 'main', 'barracks', 'snob',
    'market', 'place', 'smith', 'storage',
    'garage', 'wood', 'stable', 'stone',
    'farm', 'hide', 'iron', 'wall',
];

$source = new Imagick($argv[1]);
$source->setImageFormat('png');

if ($source->getImageWidth() !== $source->getImageHeight()) {
    throw new RuntimeException(sprintf(
        'Atlas carré attendu, reçu : %dx%d',
        $source->getImageWidth(),
        $source->getImageHeight()
    ));
}

$outputDirectory = rtrim($argv[2], DIRECTORY_SEPARATOR);
if (!is_dir($outputDirectory) && !mkdir($outputDirectory, 0775, true) && !is_dir($outputDirectory)) {
    throw new RuntimeException("Impossible de créer le dossier : {$outputDirectory}");
}

$size = $source->getImageWidth();
$canvasWidth = 320;
$canvasHeight = 280;

foreach ($buildingIds as $index => $buildingId) {
    $column = $index % 4;
    $row = intdiv($index, 4);
    $x1 = (int) round($column * $size / 4);
    $x2 = (int) round(($column + 1) * $size / 4);
    $y1 = (int) round($row * $size / 4);
    $y2 = (int) round(($row + 1) * $size / 4);

    $sprite = clone $source;
    $sprite->cropImage($x2 - $x1, $y2 - $y1, $x1, $y1);
    $sprite->setImagePage(0, 0, 0, 0);
    $sprite->trimImage(0);
    $sprite->setImagePage(0, 0, 0, 0);

    $scale = min(
        ($canvasWidth - 8) / $sprite->getImageWidth(),
        ($canvasHeight - 8) / $sprite->getImageHeight()
    );
    $width = max(1, (int) round($sprite->getImageWidth() * $scale));
    $height = max(1, (int) round($sprite->getImageHeight() * $scale));
    $sprite->resizeImage($width, $height, Imagick::FILTER_LANCZOS, 1.0);

    $canvas = new Imagick();
    $canvas->newImage($canvasWidth, $canvasHeight, new ImagickPixel('transparent'), 'png');
    $canvas->compositeImage(
        $sprite,
        Imagick::COMPOSITE_OVER,
        intdiv($canvasWidth - $width, 2),
        $canvasHeight - $height - 4
    );
    $canvas->setImageFormat('png');
    $canvas->stripImage();
    $canvas->writeImage("{$outputDirectory}/{$buildingId}.png");

    $sprite->clear();
    $canvas->clear();
}

$source->clear();
