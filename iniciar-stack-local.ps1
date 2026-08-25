# =====================================================================
# Grupo RYSA ERP - Arranque del stack LOCAL (post-reinicio)
# Uso: clic derecho > "Ejecutar con PowerShell", o:
#      powershell -ExecutionPolicy Bypass -File .\iniciar-stack-local.ps1
# Hace todo en orden: kernel WSL2 -> Docker Desktop -> engine ->
# docker compose (postgres + backend + frontend) -> verificacion.
# =====================================================================

$ErrorActionPreference = 'Continue'
$dockerBin = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'

# --- Auto-elevacion (una sola vez) ---
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Solicitando permisos de administrador (acepta el UAC)..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"")
    exit
}

Set-Location -LiteralPath $PSScriptRoot

# --- 1) Kernel WSL2: reintentar si el MSI quedo pendiente ---
$msi = Join-Path $env:TEMP 'wsl_update_x64.msi'
if (-not (Test-Path $msi)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        Invoke-WebRequest -Uri 'https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi' -OutFile $msi -UseBasicParsing
    } catch { Write-Host "No se pudo descargar el kernel WSL2: $($_.Exception.Message)" -ForegroundColor Red }
}
if (Test-Path $msi) {
    Write-Host "[1/5] Instalando kernel WSL2..." -ForegroundColor Cyan
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
    Write-Host ("      msiexec exit={0} (0 o 1638 = OK)" -f $p.ExitCode)
}

# --- 2) Aceptar EULA de Docker Desktop en primer arranque ---
$appData = [Environment]::GetFolderPath('ApplicationData')
$dockerDir = Join-Path $appData 'Docker'
New-Item -ItemType Directory -Force -Path $dockerDir | Out-Null
$settingsStore = Join-Path $dockerDir 'settings-store.json'
try {
    if (Test-Path $settingsStore) {
        $json = Get-Content $settingsStore -Raw | ConvertFrom-Json
        $json | Add-Member -NotePropertyName AcceptedEula -NotePropertyValue $true -Force
        $json | ConvertTo-Json -Depth 20 | Set-Content $settingsStore -Encoding UTF8
    } else {
        @{ AcceptedEula = $true } | ConvertTo-Json | Set-Content $settingsStore -Encoding UTF8
    }
    Write-Host "[2/5] EULA de Docker Desktop pre-aceptada." -ForegroundColor Cyan
} catch {
    Write-Host "      (No se pudo pre-aceptar la EULA automaticamente: $($_.Exception.Message))" -ForegroundColor Yellow
    Write-Host "      Si Docker abre una ventana de licencia, acéptala manualmente." -ForegroundColor Yellow
}

# --- 3) Arrancar Docker Desktop y esperar el engine ---
Write-Host "[3/5] Iniciando Docker Desktop (espera 1-2 min el engine)..." -ForegroundColor Cyan
Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$deadline = (Get-Date).AddMinutes(8)
$ready = $false
while ((Get-Date) -lt $deadline) {
    & $dockerBin info *>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 10
}
if (-not $ready) {
    Write-Host "ERROR: el engine de Docker no respondio. Abre Docker Desktop manualmente, acepta cualquier dialogo y vuelve a ejecutar este script." -ForegroundColor Red
    Read-Host "Enter para salir"
    exit 1
}
& $dockerBin version --format 'Engine {{.Server.Version}} - listo' 

# --- 4) Verificar puertos libres y levantar el stack ---
foreach ($port in 5174, 8002, 5433) {
    $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($busy) {
        Write-Host "AVISO: el puerto $port ya esta ocupado por PID $($busy.OwningProcess)." -ForegroundColor Yellow
    }
}

Write-Host "[4/5] Levantando stack local (build puede tardar 5-15 min la primera vez)..." -ForegroundColor Cyan
& $dockerBin compose -f docker-compose.local.yml --env-file .env.docker.local up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker compose fallo." -ForegroundColor Red
    Read-Host "Enter para salir"
    exit 1
}

# --- 5) Verificacion de servicios ---
Write-Host "[5/5] Verificando servicios (esto tarda mientras alembic migra el esquema)..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(6)
$backendOk = $false; $frontendOk = $false
while ((Get-Date) -lt $deadline -and -not ($backendOk -and $frontendOk)) {
    if (-not $backendOk) {
        try {
            $r = Invoke-WebRequest -Uri 'http://localhost:8002/docs' -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -eq 200) { $backendOk = $true }
        } catch {}
    }
    if (-not $frontendOk) {
        try {
            $r = Invoke-WebRequest -Uri 'http://localhost:5174' -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -eq 200) { $frontendOk = $true }
        } catch {}
    }
    if (-not ($backendOk -and $frontendOk)) { Start-Sleep -Seconds 5 }
}
& $dockerBin exec rysa_local_postgres pg_isready -U rysa -d rysa_local

Write-Host ""
Write-Host "================= ESTADO =================" -ForegroundColor Green
Write-Host ("Backend : http://localhost:8002/docs  -> {0}" -f $(if ($backendOk) {'OK'} else {'AUN NO RESPONDE'}))
Write-Host ("Frontend: http://localhost:5174       -> {0}" -f $(if ($frontendOk) {'OK'} else {'AUN NO RESPONDE'}))
Write-Host "Admin dev: admin@rysa-dev.local"
Write-Host "Password: (ver ADMIN_PASSWORD en .env.docker.local)"
Write-Host "=========================================="
Write-Host "Comandos utiles:"
Write-Host "  docker compose -f docker-compose.local.yml logs -f backend"
Write-Host "  docker compose -f docker-compose.local.yml down   (detiene)"
Write-Host "  docker compose -f docker-compose.local.yml down -v (borra datos)"
Read-Host "Enter para cerrar esta ventana"
