#Requires -Version 5.1
param(
    [string]$InstallPath = "",
    [string]$PrinterName = "",
    [switch]$PrinterAuto,
    [string]$Loja = "",
    [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"

$SourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $InstallPath) {
    $InstallPath = $SourceRoot
}

function Write-Step([string]$message) {
    Write-Host ""
    Write-Host ">> $message" -ForegroundColor Cyan
}

function Test-NodeVersion() {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        $version = & node -v
        Write-Step "Node.js encontrado: $version"
        return $true
    }
    return $false
}

function Install-NodeIfMissing() {
    if (Test-NodeVersion) { return }

    Write-Step "Node.js nao encontrado. Tentando instalar via winget..."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Node.js nao encontrado e winget indisponivel. Instale Node.js LTS manualmente: https://nodejs.org/"
    }

    & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (-not (Test-NodeVersion)) {
        throw "Node.js ainda nao disponivel apos winget. Reinicie o PowerShell e rode install-loja.ps1 novamente."
    }
}

function Sync-InstallTree([string]$source, [string]$target) {
    if ($source.TrimEnd('\').ToLower() -eq $target.TrimEnd('\').ToLower()) {
        Write-Step "Usando pasta de instalacao atual: $target"
        return
    }

    Write-Step "Copiando pacote para $target"
    if (-not (Test-Path -LiteralPath $target)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
    }

    robocopy $source $target /MIR /XD node_modules output .git /XF .env *.png *.prn /NFL /NDL /NJH /NJS /NC /NS | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "Falha ao copiar arquivos para $target (robocopy exit $LASTEXITCODE)"
    }
}

Write-Host "========================================"
Write-Host " AEROSTORE — Instalacao Agente Argox"
Write-Host "========================================"

Install-NodeIfMissing
Sync-InstallTree -source $SourceRoot -target $InstallPath

$LogDir = "C:\AEROSTORE\logs"
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

Write-Step "Instalando dependencias npm no pacote..."
Push-Location $InstallPath
try {
    if (-not (Test-Path -LiteralPath (Join-Path $InstallPath "package.json"))) {
        throw "package.json nao encontrado em $InstallPath"
    }
    & npm install --omit=dev
    if ($LASTEXITCODE -ne 0) {
        throw "npm install falhou com codigo $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

Write-Step "Configurando impressora e .env..."
$configureArgs = @{
    InstallPath = $InstallPath
}
if ($PrinterName) { $configureArgs.PrinterName = $PrinterName }
if ($PrinterAuto) { $configureArgs.PrinterAuto = $true }
if ($Loja) { $configureArgs.Loja = $Loja }
& (Join-Path $InstallPath "configure-loja.ps1") @configureArgs | Out-Null

Write-Step "Registrando inicializacao automatica..."
& (Join-Path $InstallPath "register-startup.ps1") -InstallPath $InstallPath

$taskName = "AEROSTORE Argox Agent"
Write-Step "Iniciando tarefa $taskName..."
try {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
} catch {}
Start-ScheduledTask -TaskName $taskName

Write-Step "Aguardando agente responder em http://localhost:4000/status ..."
$status = $null
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        $status = Invoke-RestMethod -Uri "http://localhost:4000/status" -TimeoutSec 3
        if ($status.status -eq "online") { break }
    } catch {
        $status = $null
    }
}

if (-not $status) {
    Write-Host "AVISO: agente ainda nao respondeu. Rode .\health-check.ps1 apos alguns segundos." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "Status do agente:"
    $status | ConvertTo-Json -Depth 6
}

if (-not $SkipSmoke) {
    Write-Step "Executando smoke test (dry-run)..."
    & (Join-Path $InstallPath "smoke-test.ps1") -InstallPath $InstallPath -SkipRealPrint
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Instalacao concluida"
Write-Host " Pasta: $InstallPath"
Write-Host " Logs:  C:\AEROSTORE\logs\argox-agent.log"
Write-Host " Health: .\health-check.ps1"
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Proximo passo: imprima 1 etiqueta de teste com safe mode ativo."
Write-Host "Depois libere impressao normal com:"
Write-Host "  .\smoke-test.ps1 -InstallPath `"$InstallPath`" -AllowDisableSafeMode"

try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktop "Reiniciar agente Argox.lnk"
    $target = Join-Path $InstallPath "restart-agent.cmd"
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $InstallPath
    $shortcut.Description = "Reinicia o agente local de etiquetas Argox"
    $shortcut.Save() | Out-Null
    Write-Host "Atalho criado na area de trabalho: Reiniciar agente Argox"
} catch {
    Write-Host "AVISO: nao foi possivel criar atalho na area de trabalho." -ForegroundColor Yellow
}
