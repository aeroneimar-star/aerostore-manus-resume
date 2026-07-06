#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$BundleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentDir = Join-Path $BundleRoot "agente-impressao-argox"
$EnvFile = Join-Path $AgentDir ".env"
$LogDir = "C:\AEROSTORE\logs"
$LogFile = Join-Path $LogDir "argox-agent.log"

if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Import-DotEnvFile([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Arquivo .env nao encontrado: $path"
    }
    Get-Content -LiteralPath $path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $parts = $line -split "=", 2
        if ($parts.Count -lt 2) { return }
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        Set-Item -Path "Env:$name" -Value $value
    }
}

Import-DotEnvFile $EnvFile

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js nao encontrado no PATH."
}

Push-Location $AgentDir
try {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $LogFile -Value "[$stamp] Iniciando agente Argox..."
    & node server.js 2>&1 | ForEach-Object {
        $entry = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $_"
        Add-Content -LiteralPath $LogFile -Value $entry
        Write-Output $_
    }
} finally {
    Pop-Location
}
