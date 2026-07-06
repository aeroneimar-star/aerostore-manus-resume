#Requires -Version 5.1
param(
    [string]$InstallPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallPath) {
    $InstallPath = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$TaskName = "AEROSTORE Argox Agent"
$StartCmd = Join-Path $InstallPath "start-argox-agent.cmd"

if (-not (Test-Path -LiteralPath $StartCmd)) {
    throw "start-argox-agent.cmd nao encontrado em $InstallPath"
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$StartCmd`"" -WorkingDirectory $InstallPath
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Tarefa agendada registrada: $TaskName"
