# Script para generar iconos y logotipos institucionales para Android y Expo
param (
    [string]$SourceImage = (Join-Path $PSScriptRoot "..\assets\images\rysa-logo.png"),
    [string]$ProjectDir = (Join-Path $PSScriptRoot ".."),
    [string]$BuildDir = ""
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $SourceImage)) {
    Write-Error "No se encontro la imagen fuente en $SourceImage"
    exit 1
}

$srcImg = [System.Drawing.Image]::FromFile($SourceImage)
Write-Host "Cargada imagen fuente: $($srcImg.Width)x$($srcImg.Height)"

# Funcion para redimensionar y centrar en un lienzo cuadrado
function Generate-SquareImage {
    param (
        [System.Drawing.Image]$Image,
        [int]$Size,
        [string]$OutputPath,
        [System.Drawing.Color]$BgColor,
        [float]$PaddingRatio = 0.15,
        [bool]$IsRound = $false
    )

    $dir = Split-Path $OutputPath -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    if ($BgColor -ne [System.Drawing.Color]::Transparent) {
        $brush = New-Object System.Drawing.SolidBrush($BgColor)
        if ($IsRound) {
            $path = New-Object System.Drawing.Drawing2D.GraphicsPath
            $path.AddEllipse(0, 0, $Size, $Size)
            $g.FillPath($brush, $path)
            $g.SetClip($path)
        } else {
            $g.FillRectangle($brush, 0, 0, $Size, $Size)
        }
    }

    $availW = $Size * (1 - ($PaddingRatio * 2))
    $availH = $Size * (1 - ($PaddingRatio * 2))

    $scaleW = $availW / $Image.Width
    $scaleH = $availH / $Image.Height
    $scale = [Math]::Min($scaleW, $scaleH)

    $targetW = [int]($Image.Width * $scale)
    $targetH = [int]($Image.Height * $scale)
    $posX = [int](($Size - $targetW) / 2)
    $posY = [int](($Size - $targetH) / 2)

    $g.DrawImage($Image, $posX, $posY, $targetW, $targetH)
    $g.Dispose()

    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generado: $OutputPath ($Size x $Size)"
}

# 1. Copiar y optimizar rysa-logo.png directo (transparente) para vistas UI
$logoUiPath = Join-Path $ProjectDir "assets\images\rysa-logo.png"
Generate-SquareImage -Image $srcImg -Size 600 -OutputPath $logoUiPath -BgColor ([System.Drawing.Color]::Transparent) -PaddingRatio 0.05

# 2. Generar iconos de Expo (assets/images)
$carbonBg = [System.Drawing.ColorTranslator]::FromHtml('#121820')
$whiteBg = [System.Drawing.Color]::White

# Icono principal de la app con FONDO BLANCO puro
Generate-SquareImage -Image $srcImg -Size 1024 -OutputPath (Join-Path $ProjectDir "assets\images\icon.png") -BgColor $whiteBg -PaddingRatio 0.16
Generate-SquareImage -Image $srcImg -Size 1024 -OutputPath (Join-Path $ProjectDir "assets\images\android-icon-foreground.png") -BgColor ([System.Drawing.Color]::Transparent) -PaddingRatio 0.22

# Fondo adaptativo blanco
$whiteBmp = New-Object System.Drawing.Bitmap(1024, 1024)
$whiteG = [System.Drawing.Graphics]::FromImage($whiteBmp)
$whiteG.Clear($whiteBg)
$whiteG.Dispose()
$whiteBmp.Save((Join-Path $ProjectDir "assets\images\android-icon-background.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$whiteBmp.Dispose()

# Splash icon con zona segura circular de Android 12+ (padding 0.28) y fondo transparente
Generate-SquareImage -Image $srcImg -Size 512 -OutputPath (Join-Path $ProjectDir "assets\images\splash-icon.png") -BgColor ([System.Drawing.Color]::Transparent) -PaddingRatio 0.28

# 3. Limpiar iconos webp obsoletos para evitar conflictos de duplicidad en AAPT2
Get-ChildItem -Path (Join-Path $ProjectDir "android\app\src\main\res\mipmap-*") -Filter "*.webp" | Remove-Item -Force
if (Test-Path $BuildDir) {
    Get-ChildItem -Path (Join-Path $BuildDir "android\app\src\main\res\mipmap-*") -Filter "*.webp" -ErrorAction SilentlyContinue | Remove-Item -Force
}

# 4. Generar iconos nativos de Android (mipmap-*) con FONDO BLANCO
$densities = @{
    'mipmap-mdpi' = @{ legacy = 48; adaptive = 108 }
    'mipmap-hdpi' = @{ legacy = 72; adaptive = 162 }
    'mipmap-xhdpi' = @{ legacy = 96; adaptive = 216 }
    'mipmap-xxhdpi' = @{ legacy = 144; adaptive = 324 }
    'mipmap-xxxhdpi' = @{ legacy = 192; adaptive = 432 }
}

foreach ($entry in $densities.GetEnumerator()) {
    $folder = $entry.Key
    $legacySize = $entry.Value.legacy
    $adaptiveSize = $entry.Value.adaptive
    
    # Cuadrado institucional con FONDO BLANCO
    $launcherPath = Join-Path $ProjectDir "android\app\src\main\res\$folder\ic_launcher.png"
    Generate-SquareImage -Image $srcImg -Size $legacySize -OutputPath $launcherPath -BgColor $whiteBg -PaddingRatio 0.14 -IsRound $false
    
    # Redondo institucional con FONDO BLANCO
    $launcherRoundPath = Join-Path $ProjectDir "android\app\src\main\res\$folder\ic_launcher_round.png"
    Generate-SquareImage -Image $srcImg -Size $legacySize -OutputPath $launcherRoundPath -BgColor $whiteBg -PaddingRatio 0.18 -IsRound $true

    # Primer plano adaptativo (foreground)
    $foregroundPath = Join-Path $ProjectDir "android\app\src\main\res\$folder\ic_launcher_foreground.png"
    Generate-SquareImage -Image $srcImg -Size $adaptiveSize -OutputPath $foregroundPath -BgColor ([System.Drawing.Color]::Transparent) -PaddingRatio 0.22 -IsRound $false

    # Replicar en BuildDir si existe
    if (Test-Path $BuildDir) {
        $buildFolder = Join-Path $BuildDir "android\app\src\main\res\$folder"
        if (Test-Path $buildFolder) {
            Copy-Item -Path $launcherPath -Destination (Join-Path $buildFolder "ic_launcher.png") -Force
            Copy-Item -Path $launcherRoundPath -Destination (Join-Path $buildFolder "ic_launcher_round.png") -Force
            Copy-Item -Path $foregroundPath -Destination (Join-Path $buildFolder "ic_launcher_foreground.png") -Force
        }
    }
}

# 5. Splashscreen nativo con zona segura de 160dp circular (PaddingRatio 0.28)
$splashDensities = @{
    'drawable-mdpi' = 150
    'drawable-hdpi' = 225
    'drawable-xhdpi' = 300
    'drawable-xxhdpi' = 450
    'drawable-xxxhdpi' = 600
}
foreach ($entry in $splashDensities.GetEnumerator()) {
    $folder = $entry.Key
    $size = $entry.Value
    $splashPath = Join-Path $ProjectDir "android\app\src\main\res\$folder\splashscreen_logo.png"
    Generate-SquareImage -Image $srcImg -Size $size -OutputPath $splashPath -BgColor ([System.Drawing.Color]::Transparent) -PaddingRatio 0.28

    if (Test-Path $BuildDir) {
        $buildDrawable = Join-Path $BuildDir "android\app\src\main\res\$folder"
        if (Test-Path $buildDrawable) {
            Copy-Item -Path $splashPath -Destination (Join-Path $buildDrawable "splashscreen_logo.png") -Force
        }
    }
}

$srcImg.Dispose()
Write-Host "Generacion de iconos institucionales finalizada con exito."
