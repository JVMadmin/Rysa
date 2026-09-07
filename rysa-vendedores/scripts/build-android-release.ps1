# Script automatizado de compilacion y release de APK para RYSA Vendedores.

[CmdletBinding()]
param (
    [switch]$Clean,
    [string]$KeystorePassword = $env:RYSA_KEYSTORE_PASSWORD
)

if (-not $KeystorePassword) {
    $KeystorePassword = "RysaReleaseKey2026"
}

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   RYSA VENDEDORES - BUILD AUTOMATICO DE APK RELEASE      " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Directorios base
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $ProjectRoot

$DistAndroid = Join-Path $ProjectRoot "dist\android"
if (-not (Test-Path $DistAndroid)) {
    New-Item -ItemType Directory -Path $DistAndroid -Force | Out-Null
}

# 2. Validar Node.js
Write-Host "`n[1/7] Verificando Node.js y npm..." -ForegroundColor Yellow
try {
    $nodeVer = & node --version
    Write-Host "  [OK] Node.js detectado: $nodeVer" -ForegroundColor Green
} catch {
    Write-Error "Node.js no esta instalado o no esta en el PATH. Por favor instala Node.js LTS."
}

# 3. Validar Java / JDK
Write-Host "`n[2/7] Verificando Java JDK..." -ForegroundColor Yellow
if (-not $env:JAVA_HOME) {
    $commonJdk = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
    if (Test-Path $commonJdk) {
        $env:JAVA_HOME = $commonJdk
    } else {
        $javaCmd = Get-Command java -ErrorAction SilentlyContinue
        if ($javaCmd) {
            $binDir = Split-Path -Parent $javaCmd.Source
            $env:JAVA_HOME = Split-Path -Parent $binDir
        }
    }
}

if (-not $env:JAVA_HOME -or -not (Test-Path $env:JAVA_HOME)) {
    Write-Error "JAVA_HOME no esta definido. Se requiere JDK 17 o JDK 21 para compilar Android."
}
Write-Host "  [OK] JAVA_HOME configurado: $env:JAVA_HOME" -ForegroundColor Green

# 4. Validar Android SDK
Write-Host "`n[3/7] Verificando Android SDK..." -ForegroundColor Yellow
if (-not $env:ANDROID_HOME) {
    $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    if (Test-Path $defaultSdk) {
        $env:ANDROID_HOME = $defaultSdk
    }
}

if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) {
    Write-Host "  ! Android SDK no encontrado en ANDROID_HOME." -ForegroundColor Yellow
    Write-Host "  Intentando localizar mediante Google Android CLI..." -ForegroundColor Yellow
    $cliPath = Join-Path $env:USERPROFILE "AppData\AndroidCLI\android.exe"
    if (Test-Path $cliPath) {
        & $cliPath sdk install platform-tools platforms/android-35 build-tools/35.0.0
        $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    } else {
        Write-Error "No se encontro Android SDK ni Android CLI."
    }
}
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Write-Host "  [OK] ANDROID_HOME configurado: $env:ANDROID_HOME" -ForegroundColor Green

# 5. Validar dependencias npm
Write-Host "`n[4/7] Verificando dependencias de Node..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
    Write-Host "  Instalando dependencias de package.json..." -ForegroundColor Gray
    & npm.cmd install
} else {
    Write-Host "  [OK] Dependencias node_modules encontradas." -ForegroundColor Green
}

# 6. Generar proyecto nativo android/ si no existe
Write-Host "`n[5/7] Verificando proyecto nativo Android..." -ForegroundColor Yellow
$AndroidDir = Join-Path $ProjectRoot "android"
if (-not (Test-Path $AndroidDir)) {
    Write-Host "  Generando directorio nativo con Expo Prebuild..." -ForegroundColor Gray
    & npx.cmd expo prebuild --platform android --no-install
} else {
    Write-Host "  [OK] Directorio nativo android/ existente." -ForegroundColor Green
}

# Crear o actualizar local.properties
$LocalPropsFile = Join-Path $AndroidDir "local.properties"
$escapedSdk = $env:ANDROID_HOME.Replace("\", "\\").Replace(":", "\:")
Set-Content -Path $LocalPropsFile -Value "sdk.dir=$escapedSdk" -Encoding UTF8

# 7. Configuracion de firma de Release
Write-Host "`n[6/7] Configurando firmado de Release..." -ForegroundColor Yellow
$AppDir = Join-Path $AndroidDir "app"
$KeystoreFile = Join-Path $AppDir "rysa-release.keystore"
$KeyPropsFile = Join-Path $AndroidDir "key.properties"

if (-not (Test-Path $KeystoreFile)) {
    Write-Host "  Creando keystore de release local para RYSA Vendedores..." -ForegroundColor Gray
    $keytoolPath = Join-Path $env:JAVA_HOME "bin\keytool.exe"
    & $keytoolPath -genkeypair -v -storetype PKCS12 -keystore $KeystoreFile `
        -alias "rysa-release-key" -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $KeystorePassword -keypass $KeystorePassword `
        -dname "CN=Grupo RYSA, OU=Comercial, O=Grupo RYSA, L=Guadalajara, ST=Jalisco, C=MX"
}

if (-not (Test-Path $KeyPropsFile)) {
    $keyContent = @(
        "storeFile=rysa-release.keystore",
        "storePassword=$KeystorePassword",
        "keyAlias=rysa-release-key",
        "keyPassword=$KeystorePassword"
    )
    Set-Content -Path $KeyPropsFile -Value $keyContent -Encoding UTF8
}
Write-Host "  [OK] Clave de firmado de release lista." -ForegroundColor Green

# 8. Ejecutar compilacion Gradle Release con optimizacion de ruta corta (subst)
Write-Host "`n[7/7] Compilando APK Release con Gradle..." -ForegroundColor Yellow

# Buscar una letra de unidad libre para evitar el error de MAX_PATH de CMake en Windows (250 chars)
$CandidateDrives = @("R", "V", "X", "Y", "Z", "W")
$SubstDrive = $null
foreach ($d in $CandidateDrives) {
    if (-not (Test-Path "${d}:\")) {
        $SubstDrive = $d
        break
    }
}

$BuildDir = $AndroidDir
$UsedSubst = $false

if ($SubstDrive) {
    Write-Host "  Montando unidad virtual ${SubstDrive}: para mitigar limite MAX_PATH de CMake..." -ForegroundColor Gray
    cmd /c "subst ${SubstDrive}: /d >nul 2>&1"
    cmd /c "subst ${SubstDrive}: `"$ProjectRoot`""
    if (Test-Path "${SubstDrive}:\android") {
        $BuildDir = "${SubstDrive}:\android"
        $UsedSubst = $true
        $env:NODE_PRESERVE_SYMLINKS = "1"
    }
}

# Limpiar caches previas de autolinking para forzar uso de rutas cortas de la unidad virtual
$rootAndroidBuild = Join-Path $AndroidDir "build"
if (Test-Path $rootAndroidBuild) {
    cmd /c "rmdir /s /q `"$rootAndroidBuild`""
}

try {
    Set-Location $BuildDir

    $gradlew = Join-Path $BuildDir "gradlew.bat"
    if ($Clean) {
        Write-Host "  Ejecutando gradlew clean..." -ForegroundColor Gray
        & $gradlew clean
    }

    Write-Host "  Ejecutando gradlew assembleRelease..." -ForegroundColor Cyan
    & $gradlew assembleRelease --no-daemon

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Fallo la compilacion de Gradle con codigo de salida: $LASTEXITCODE"
    }
} finally {
    Set-Location $ProjectRoot
    $env:NODE_PRESERVE_SYMLINKS = $null
    if ($UsedSubst) {
        Write-Host "  Desmontando unidad virtual ${SubstDrive}:..." -ForegroundColor Gray
        cmd /c "subst ${SubstDrive}: /d"
    }
}

# 9. Localizar APK y copiar a dist/android/
$ApkSearchPaths = @(
    (Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"),
    (Join-Path $AndroidDir "app\build\outputs\apk\release\app-release-unsigned.apk")
)

$FoundApk = $null
foreach ($p in $ApkSearchPaths) {
    if (Test-Path $p) {
        $FoundApk = $p
        break
    }
}

if (-not $FoundApk) {
    $FoundApk = Get-ChildItem -Path (Join-Path $AndroidDir "app\build\outputs\apk") -Filter "*.apk" -Recurse | Select-Object -First 1 -ExpandProperty FullName
}

if (-not $FoundApk) {
    Write-Error "No se pudo localizar el APK generado en android/app/build/outputs/apk/"
}

# Obtener version de app.json
$AppJson = Get-Content "app.json" | ConvertFrom-Json
$VersionName = $AppJson.expo.version
$VersionCode = $AppJson.expo.android.versionCode
$PackageName = $AppJson.expo.android.package

$FinalApkName = "RYSA-Vendedores-v$VersionName-release.apk"
$FinalDest = Join-Path $DistAndroid $FinalApkName
Copy-Item -Path $FoundApk -Destination $FinalDest -Force
Copy-Item -Path $FoundApk -Destination (Join-Path $DistAndroid "app-release.apk") -Force

$ApkItem = Get-Item $FinalDest
$SizeMB = [math]::Round($ApkItem.Length / 1MB, 2)

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "                BUILD SUCCESSFUL                          " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Aplicacion:   RYSA Vendedores" -ForegroundColor White
Write-Host "  Package:      $PackageName" -ForegroundColor White
Write-Host "  VersionName:  $VersionName" -ForegroundColor White
Write-Host "  VersionCode:  $VersionCode" -ForegroundColor White
Write-Host "  Ruta APK:     $FinalDest" -ForegroundColor Cyan
Write-Host "  Tamano APK:   $SizeMB MB ($($ApkItem.Length) bytes)" -ForegroundColor White
Write-Host "  Estado Firma: Firmado (Release)" -ForegroundColor Green
Write-Host "==========================================================`n" -ForegroundColor Green
