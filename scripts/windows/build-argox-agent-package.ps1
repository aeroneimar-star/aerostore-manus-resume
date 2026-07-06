#Requires -Version 5.1
param(
    [string]$RepoRoot = "",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

if (-not $OutputDir) {
    $OutputDir = Join-Path $RepoRoot "dist"
}

$PackageTemplateDir = Join-Path $PSScriptRoot "argox-agent-package"
$TraceScript = Join-Path $PSScriptRoot "trace-argox-agent-package-files.js"
$DateStamp = Get-Date -Format "yyyyMMdd"
$PackageVersion = "$(Get-Date -Format 'yyyy.MM.dd')-argox"
$StagingDir = Join-Path $env:TEMP "aerostore-argox-agent-$DateStamp"
$ZipPath = Join-Path $OutputDir "aerostore-argox-agent-$DateStamp.zip"

function Write-Step([string]$message) {
    Write-Host ">> $message" -ForegroundColor Cyan
}

if (-not (Test-Path -LiteralPath $TraceScript)) {
    throw "Trace script nao encontrado: $TraceScript"
}

Write-Step "Limpando staging: $StagingDir"
if (Test-Path -LiteralPath $StagingDir) {
    Remove-Item -LiteralPath $StagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

Write-Step "Rastreando dependencias do agente..."
$traceLines = & node $TraceScript
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao rastrear dependencias do pacote Argox."
}

foreach ($relativePath in $traceLines) {
    if (-not $relativePath) { continue }
    $source = Join-Path $RepoRoot $relativePath
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Arquivo rastreado ausente: $relativePath"
    }
    $target = Join-Path $StagingDir $relativePath
    $targetDir = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
}

Write-Step "Copiando scripts de instalacao..."
$installFiles = @(
    "install-loja.ps1",
    "configure-loja.ps1",
    "register-startup.ps1",
    "uninstall-loja.ps1",
    "health-check.ps1",
    "smoke-test.ps1",
    "restart-agent.ps1",
    "restart-agent.cmd",
    "start-argox-agent.ps1",
    "start-argox-agent.cmd",
    "smoke-minimal-dry-run.js",
    "smoke-minimal-real.js",
    "package.json.template"
)

foreach ($file in $installFiles) {
    $source = Join-Path $PackageTemplateDir $file
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Arquivo de instalacao ausente: $file"
    }
    if ($file -eq "package.json.template") {
        Copy-Item -LiteralPath $source -Destination (Join-Path $StagingDir "package.json") -Force
    } else {
        Copy-Item -LiteralPath $source -Destination (Join-Path $StagingDir $file) -Force
    }
}

Write-Step "Copiando documentacao..."
Copy-Item -LiteralPath (Join-Path $RepoRoot "ARGOX_INSTALL_LOJA.md") -Destination (Join-Path $StagingDir "ARGOX_INSTALL_LOJA.md") -Force
Set-Content -LiteralPath (Join-Path $StagingDir "package-version.txt") -Value $PackageVersion -Encoding UTF8

Write-Step "Gerando manifest do pacote..."
$manifest = [ordered]@{
    package_version = $PackageVersion
    built_at = (Get-Date).ToUniversalTime().ToString("o")
    files = $traceLines
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $StagingDir "package-manifest.json") -Encoding UTF8

if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
}

Write-Step "Criando ZIP: $ZipPath"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($StagingDir, $ZipPath)

Write-Host ""
Write-Host "Pacote gerado com sucesso." -ForegroundColor Green
Write-Host "ZIP: $ZipPath"
Write-Host "package_version: $PackageVersion"
Write-Host "Arquivos rastreados: $($traceLines.Count)"
Write-Host ""
Write-Host "Conteudo principal:"
Get-ChildItem -LiteralPath $StagingDir | Select-Object Name, Length | Format-Table -AutoSize
