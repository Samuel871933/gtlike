<?php

declare(strict_types=1);

/** Découpe les huit sigles et colore un même cachet de cire pour les neuf niveaux. */
$root = dirname(__DIR__) . '/public/img/seals';
$source = $root . '/source';
$types = ['production', 'recruit', 'attack', 'defense', 'luck', 'population', 'coin', 'haul'];
// Identiques à game/seals.js LEVEL_COLORS.
$colors = ['#8b9097', '#9b6b3c', '#a3322b', '#c9a33a', '#3f8a3c', '#2f5fa6', '#2a8c8c', '#7a4bb0', '#2b2b33'];

function contentBox(Imagick $image): array
{
    $width = $image->getImageWidth();
    $height = $image->getImageHeight();
    $alpha = $image->exportImagePixels(0, 0, $width, $height, 'A', Imagick::PIXEL_CHAR);
    $left = $width;
    $top = $height;
    $right = 0;
    $bottom = 0;
    foreach ($alpha as $index => $value) {
        if ($value < 24) continue;
        $x = $index % $width;
        $y = intdiv($index, $width);
        $left = min($left, $x);
        $top = min($top, $y);
        $right = max($right, $x + 1);
        $bottom = max($bottom, $y + 1);
    }
    if ($right <= $left || $bottom <= $top) throw new RuntimeException('Illustration vide.');
    return [$left, $top, $right - $left, $bottom - $top];
}

function isolated(Imagick $image, int $canvasSize, int $margin): Imagick
{
    [$x, $y, $width, $height] = contentBox($image);
    $image->cropImage($width, $height, $x, $y);
    $image->setImagePage(0, 0, 0, 0);
    $image->thumbnailImage($canvasSize - 2 * $margin, $canvasSize - 2 * $margin, true);
    $canvas = new Imagick();
    $canvas->newImage($canvasSize, $canvasSize, new ImagickPixel('transparent'), 'png');
    $canvas->compositeImage($image, Imagick::COMPOSITE_OVER,
        intdiv($canvasSize - $image->getImageWidth(), 2), intdiv($canvasSize - $image->getImageHeight(), 2));
    $image->clear();
    return $canvas;
}

function webp(Imagick $image, string $path): void
{
    $output = clone $image;
    $output->setImageFormat('webp');
    $output->setImageCompressionQuality(88);
    $output->stripImage();
    $output->writeImage($path);
    $output->clear();
}

$waxRaw = new Imagick($source . '/wax-neutral-generation.png');
if (!$waxRaw->getImageAlphaChannel()) throw new RuntimeException('Le cachet doit être transparent.');
$wax = isolated($waxRaw, 256, 9);
$wax->stripImage();
$wax->writeImage($source . '/wax-neutral.png');
$neutral = $wax->exportImagePixels(0, 0, 256, 256, 'RGBA', Imagick::PIXEL_CHAR);
$wax->clear();

foreach ($colors as $index => $hex) {
    $rgb = [hexdec(substr($hex, 1, 2)), hexdec(substr($hex, 3, 2)), hexdec(substr($hex, 5, 2))];
    $pixels = $neutral;
    for ($pixel = 0, $count = count($pixels); $pixel < $count; $pixel += 4) {
        if ($pixels[$pixel + 3] < 8) {
            $pixels[$pixel] = $pixels[$pixel + 1] = $pixels[$pixel + 2] = 0;
            $pixels[$pixel + 3] = 0;
            continue;
        }
        $luminance = ($pixels[$pixel] + $pixels[$pixel + 1] + $pixels[$pixel + 2]) / 3;
        $shade = 0.25 + $luminance / 205;
        for ($channel = 0; $channel < 3; $channel++) {
            $pixels[$pixel + $channel] = min(255, (int) round($rgb[$channel] * $shade));
        }
    }
    $image = new Imagick();
    $image->newImage(256, 256, new ImagickPixel('transparent'), 'png');
    $image->importImagePixels(0, 0, 256, 256, 'RGBA', Imagick::PIXEL_CHAR, $pixels);
    webp($image, $root . '/wax-' . ($index + 1) . '.webp');
    $image->clear();
}

$sheet = new Imagick($source . '/sigils-generation.png');
if ($sheet->getImageWidth() !== 1774 || $sheet->getImageHeight() !== 887 || !$sheet->getImageAlphaChannel()) {
    throw new RuntimeException('La planche doit être un PNG transparent de 1774 × 887 pixels.');
}
$xEdges = [0, 443, 887, 1330, 1774];
$yEdges = [0, 443, 887];
foreach ($types as $index => $type) {
    $column = $index % 4;
    $row = intdiv($index, 4);
    $icon = clone $sheet;
    $icon->cropImage($xEdges[$column + 1] - $xEdges[$column], $yEdges[$row + 1] - $yEdges[$row],
        $xEdges[$column], $yEdges[$row]);
    $icon->setImagePage(0, 0, 0, 0);
    $icon = isolated($icon, 160, 8);
    // Nettoie les franges rouge/jaune propres à la génération tout en gardant le relief et son alpha.
    $pixels = $icon->exportImagePixels(0, 0, 160, 160, 'RGBA', Imagick::PIXEL_CHAR);
    for ($pixel = 0, $count = count($pixels); $pixel < $count; $pixel += 4) {
        if ($pixels[$pixel + 3] < 12) {
            $pixels[$pixel] = $pixels[$pixel + 1] = $pixels[$pixel + 2] = $pixels[$pixel + 3] = 0;
            continue;
        }
        $luminance = 0.25 * $pixels[$pixel] + 0.65 * $pixels[$pixel + 1] + 0.1 * $pixels[$pixel + 2];
        $pixels[$pixel] = min(255, (int) round($luminance * 1.04));
        $pixels[$pixel + 1] = min(255, (int) round($luminance * 0.99));
        $pixels[$pixel + 2] = min(255, (int) round($luminance * 0.87));
    }
    $icon->importImagePixels(0, 0, 160, 160, 'RGBA', Imagick::PIXEL_CHAR, $pixels);
    $icon->stripImage();
    $icon->writeImage($root . '/sigil-' . $type . '.png');
    $icon->clear();
}
$sheet->clear();

// Planche de contrôle : types en lignes, niveaux en colonnes, comme la grille du jeu.
$palette = new Imagick();
$palette->newImage(9 * 112, 8 * 112, new ImagickPixel('#171914'), 'png');
foreach ($types as $row => $type) {
    $sigil = new Imagick($root . '/sigil-' . $type . '.png');
    $sigil->resizeImage(62, 62, Imagick::FILTER_LANCZOS, 1);
    foreach ($colors as $column => $_) {
        $wax = new Imagick($root . '/wax-' . ($column + 1) . '.webp');
        $wax->resizeImage(102, 102, Imagick::FILTER_LANCZOS, 1);
        $x = $column * 112 + 5;
        $y = $row * 112 + 5;
        $palette->compositeImage($wax, Imagick::COMPOSITE_OVER, $x, $y);
        $palette->compositeImage($sigil, Imagick::COMPOSITE_OVER, $x + 20, $y + 20);
        $wax->clear();
    }
    $sigil->clear();
}
$palette->stripImage();
$palette->writeImage($source . '/palette-preview.png');
$palette->clear();
printf("9 couleurs de cire, 8 sigles et planche de contrôle créés dans %s\n", $root);
