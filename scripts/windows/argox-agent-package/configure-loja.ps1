#Requires -Version 5.1
param(
    [string]$InstallPath = "",
    [string]$PrinterName = "",
    [switch]$PrinterAuto,
    [string]$Loja = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallPath) {
    $InstallPath = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$AgentDir = Join-Path $InstallPath "agente-impressao-argox"
$EnvFile = Join-Path $AgentDir ".env"
$ListPrintersScript = Join-Path $AgentDir "scripts\list-printers.ps1"

function Write-Step([string]$message) {
    Write-Host ">> $message"
}

function Get-ArgoxPrinterCandidates() {
    if (-not (Test-Path -LiteralPath $ListPrintersScript)) {
        throw "Script de impressoras nao encontrado: $ListPrintersScript"
    }
    $names = & powershell -NoProfile -ExecutionPolicy Bypass -File $ListPrintersScript
    return @($names | Where-Object { $_ -and ($_ -match "Argox|OS-214") })
}

function Resolve-PrinterName() {
    if ($PrinterName) {
        return $PrinterName.Trim()
    }

    $candidates = Get-ArgoxPrinterCandidates
    if ($PrinterAuto -and $candidates.Count -ge 1) {
        return [string]$candidates[0]
    }

    if ($candidates.Count -eq 1) {
        return [string]$candidates[0]
    }

    Write-Host ""
    Write-Host "Impressoras Argox encontradas:"
    if (-not $candidates.Count) {
        Write-Host "  (nenhuma com 'Argox' ou 'OS-214' no nome)"
        $all = & powershell -NoProfile -ExecutionPolicy Bypass -File $ListPrintersScript
        $index = 1
        foreach ($name in $all) {
            if ($name) {
                Write-Host "  [$index] $name"
                $index++
            }
        }
    } else {
        for ($i = 0; $i -lt $candidates.Count; $i++) {
            Write-Host "  [$($i + 1)] $($candidates[$i])"
        }
    }

    $choice = Read-Host "Digite o numero da impressora ou o nome exato"
    if ($choice -match '^\d+$' -and $candidates.Count) {
        $picked = $candidates[[int]$choice - 1]
        if ($picked) { return [string]$picked }
    }
    if ($choice) { return $choice.Trim() }
    throw "Nenhuma impressora selecionada."
}

$resolvedPrinter = Resolve-PrinterName
if (-not $resolvedPrinter) {
    throw "ARGOX_PRINTER_NAME nao definido."
}

$origins = "localhost,127.0.0.1,aerostore"
if ($Loja) {
    $origins = "$origins,$Loja"
}

$envLines = @(
    "# Gerado por configure-loja.ps1 em $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "ARGOX_AGENT_PORT=4000",
    "ARGOX_PRINTER_NAME=$resolvedPrinter",
    "ARGOX_LANGUAGE=PPLB",
    "ARGOX_PHYSICAL_LANGUAGE=PPLB",
    "ARGOX_SAFE_TEST_MODE=true",
    "ARGOX_AGENT_DRY_RUN=false",
    "ARGOX_PRINT_TRANSPORT=WINDOWS_DRIVER",
    "ARGOX_DRIVER_COLUMNS=2",
    "ARGOX_DRIVER_SCALE_X=1",
    "ARGOX_DRIVER_SCALE_Y=1",
    "ARGOX_DRIVER_OFFSET_X_MM=0",
    "ARGOX_DRIVER_OFFSET_Y_MM=0",
    "ARGOX_DRIVER_DEBUG_BORDER=false",
    "ARGOX_AGENT_ORIGINS=$origins"
)

Set-Content -LiteralPath $EnvFile -Value ($envLines -join [Environment]::NewLine) -Encoding UTF8
Write-Step ".env gravado em $EnvFile"
Write-Step "Impressora: $resolvedPrinter"

return @{
    InstallPath = $InstallPath
    PrinterName = $resolvedPrinter
    EnvFile = $EnvFile
}
