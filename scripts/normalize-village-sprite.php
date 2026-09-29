<?php

declare(strict_types=1);

/** Normalize one transparent village cutout to an exact bottom-anchored canvas. */
if ($argc !== 5) {
    fwrite(STDERR, "Usage: php scripts/normalize-village-sprite.php input.png output.png width height\n");
    exit(1);
}

$targetWidth = (int) $argv[3];
$targetHeight = (int) $argv[4];
$sprite = new Imagick($argv[1]);
$sprite->setImageFormat('png');
$sprite->trimImage(0);
$sprite->setImagePage(0, 0, 0, 0);

$scale = min(
    ($targetWidth - 4) / $sprite->getImageWidth(),
    ($targetHeight - 4) / $sprite->getImageHeight()
);
$width = max(1, (int) round($sprite->getImageWidth() * $scale));
$height = max(1, (int) round($sprite->getImageHeight() * $scale));
$sprite->resizeImage($width, $height, Imagick::FILTER_LANCZOS, 1.0);

$canvas = new Imagick();
$canvas->newImage($targetWidth, $targetHeight, new ImagickPixel('transparent'), 'png');
$canvas->compositeImage(
    $sprite,
    Imagick::COMPOSITE_OVER,
    intdiv($targetWidth - $width, 2),
    $targetHeight - $height - 2
);
$canvas->stripImage();
$canvas->writeImage($argv[2]);
