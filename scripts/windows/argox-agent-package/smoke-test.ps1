#Requires -Version 5.1
param(
    [string]$InstallPath = "",
    [switch]$SkipRealPrint,
    [switch]$AllowDisableSafeMode
)

$ErrorActionPreference = "Stop"

if (-not $InstallPath) {
    $InstallPath = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$AgentDir = Join-Path $InstallPath "agente-impressao-argox"
$EnvFile = Join-Path $AgentDir ".env"
$LogFile = "C:\AEROSTORE\logs\argox-agent.log"

function Import-DotEnvFile([string]$path) {
    Get-Content -LiteralPath $path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $parts = $line -split "=", 2
        if ($parts.Count -lt 2) { return }
        Set-Item -Path ("Env:" + $parts[0].Trim()) -Value $parts[1].Trim()
    }
}

function Set-DotEnvValue([string]$path, [string]$name, [string]$value) {
    $lines = Get-Content -LiteralPath $path -Encoding UTF8
    $updated = $false
    $output = foreach ($line in $lines) {
        if ($line -match "^\s*$([regex]::Escape($name))\s*=") {
            $updated = $true
            "$name=$value"
        } else {
            $line
        }
    }
    if (-not $updated) {
        $output += "$name=$value"
    }
    Set-Content -LiteralPath $path -Value $output -Encoding UTF8
}

Write-Host ">> Consultando /status ..."
try {
    $status = Invoke-RestMethod -Uri "http://localhost:4000/status" -TimeoutSec 5
    $status | ConvertTo-Json -Depth 6
} catch {
    throw "Agente offline em http://localhost:4000/status. Rode health-check.ps1."
}

Write-Host ">> Dry-run minimo ..."
Push-Location $InstallPath
try {
    & node (Join-Path $InstallPath "smoke-minimal-dry-run.js")
    if ($LASTEXITCODE -ne 0) {
        throw "smoke-minimal-dry-run.js falhou."
    }
} finally {
    Pop-Location
}

if ($SkipRealPrint) {
    Write-Host "Smoke dry-run OK."
    return
}

$answer = Read-Host "Deseja imprimir 1 etiqueta real de teste? (S/N)"
if ($answer -notmatch '^(s|sim|y|yes)$') {
    Write-Host "Teste real ignorado."
    return
}

Import-DotEnvFile $EnvFile
$env:ARGOX_SAFE_TEST_MODE = "true"
$env:ARGOX_CONFIRM_REAL_PRINT = "true"

Write-Host ">> Imprimindo 1 etiqueta real (safe mode ativo) ..."
Push-Location $InstallPath
try {
    & node (Join-Path $InstallPath "smoke-minimal-real.js")
    if ($LASTEXITCODE -ne 0) {
        throw "smoke-minimal-real.js falhou."
    }
} finally {
    Pop-Location
}

Write-Host "Etiqueta de teste enviada. Confira o papel: TESTE AEROSTORE / COD 123456"

if ($AllowDisableSafeMode) {
    $release = Read-Host "Deseja liberar impressao normal agora? (safe mode OFF) (S/N)"
    if ($release -match '^(s|sim|y|yes)$') {
        Set-DotEnvValue -path $EnvFile -name "ARGOX_SAFE_TEST_MODE" -value "false"
        Write-Host "ARGOX_SAFE_TEST_MODE=false gravado em .env"
        Write-Host "Reinicie o agente: .\restart-agent.cmd"
    }
}
