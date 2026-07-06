#Requires -Version 5.1
param(
    [string]$InstallPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallPath) {
    $InstallPath = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$TaskName = "AEROSTORE Argox Agent"

Write-Host ">> Reiniciando agente Argox ..."

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -match "agente-impressao-argox\\server\.js") {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
} catch {}

Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 2
& (Join-Path $InstallPath "health-check.ps1") -InstallPath $InstallPath
