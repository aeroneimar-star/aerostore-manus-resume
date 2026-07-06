#Requires -Version 5.1
param(
    [string]$InstallPath = "C:\AEROSTORE\argox-agent",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$TaskName = "AEROSTORE Argox Agent"

Write-Host ">> Parando tarefa $TaskName ..."
try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
} catch {}

Write-Host ">> Removendo tarefa agendada ..."
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Host ">> Encerrando processos node do agente (se houver) ..."
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -match "agente-impressao-argox\\server\.js") {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

if ($Force) {
    $remove = "S"
} else {
    $remove = Read-Host "Deseja apagar a pasta $InstallPath ? (S/N)"
}

if ($remove -match '^(s|sim|y|yes)$') {
    if (Test-Path -LiteralPath $InstallPath) {
        Remove-Item -LiteralPath $InstallPath -Recurse -Force
        Write-Host "Pasta removida: $InstallPath"
    }
} else {
    Write-Host "Pasta mantida: $InstallPath"
}

$logRemove = Read-Host "Deseja apagar logs em C:\AEROSTORE\logs ? (S/N)"
if ($logRemove -match '^(s|sim|y|yes)$') {
    if (Test-Path -LiteralPath "C:\AEROSTORE\logs") {
        Remove-Item -LiteralPath "C:\AEROSTORE\logs" -Recurse -Force
        Write-Host "Logs removidos."
    }
} else {
    Write-Host "Logs mantidos em C:\AEROSTORE\logs"
}

Write-Host "Desinstalacao concluida."
