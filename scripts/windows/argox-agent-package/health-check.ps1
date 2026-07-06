#Requires -Version 5.1
param(
    [string]$InstallPath = ""
)

$ErrorActionPreference = "Continue"

if (-not $InstallPath) {
    $InstallPath = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$TaskName = "AEROSTORE Argox Agent"
$LogFile = "C:\AEROSTORE\logs\argox-agent.log"
$issues = @()

function Write-Line([string]$label, [string]$value, [string]$color = "White") {
    Write-Host ("{0,-24} {1}" -f $label, $value) -ForegroundColor $color
}

Write-Host "========================================"
Write-Host " AEROSTORE Argox — Health Check"
Write-Host "========================================"
Write-Host ""

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $version = & node -v
    Write-Line "Node.js" "OK ($version)" "Green"
} else {
    Write-Line "Node.js" "AUSENTE" "Red"
    $issues += "Instale Node.js LTS"
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    $state = $task.State
    Write-Line "Tarefa agendada" "OK ($state)" "Green"
} else {
    Write-Line "Tarefa agendada" "NAO ENCONTRADA" "Red"
    $issues += "Rode register-startup.ps1 ou install-loja.ps1"
}

$portOpen = $false
try {
    $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 4000 -WarningAction SilentlyContinue
    $portOpen = [bool]$tcp.TcpTestSucceeded
} catch {}

if ($portOpen) {
    Write-Line "Porta 4000" "ABERTA" "Green"
} else {
    Write-Line "Porta 4000" "FECHADA" "Red"
    $issues += "Agente nao esta escutando na porta 4000"
}

$status = $null
try {
    $status = Invoke-RestMethod -Uri "http://localhost:4000/status" -TimeoutSec 5
    Write-Line "Agente /status" "ONLINE" "Green"
} catch {
    Write-Line "Agente /status" "OFFLINE" "Red"
    $issues += "Agente offline — rode restart-agent.cmd"
}

if ($status) {
    if ($status.agent_version) { $av = $status.agent_version } elseif ($status.versao) { $av = $status.versao } else { $av = "-" }
    Write-Line "agent_version" $av
    $pv = if ($status.package_version) { $status.package_version } else { "-" }
    Write-Line "package_version" $pv
    Write-Line "print_transport" ($(if ($status.print_transport) { $status.print_transport } else { "-" }))
    Write-Line "driver_columns" ($(if ($null -ne $status.driver_columns) { $status.driver_columns } else { "-" }))
    Write-Line "safe_test_mode" ($(if ($null -ne $status.safe_test_mode) { $status.safe_test_mode } else { "-" }))
    if ($status.printer_name) { $pn = $status.printer_name } elseif ($status.impressora) { $pn = $status.impressora } else { $pn = "-" }
    Write-Line "printer_name" $pn
    if ($status.last_error) {
        Write-Line "last_error" $status.last_error "Yellow"
        $issues += "Ultimo erro: $($status.last_error)"
    }
}

$ListPrintersScript = Join-Path $InstallPath "agente-impressao-argox\scripts\list-printers.ps1"
if (Test-Path -LiteralPath $ListPrintersScript) {
    $printers = & powershell -NoProfile -ExecutionPolicy Bypass -File $ListPrintersScript
    $argox = @($printers | Where-Object { $_ -and ($_ -match "Argox|OS-214") })
    if ($argox.Count) {
        Write-Line "Impressoras Argox" ($argox -join " | ") "Green"
    } else {
        Write-Line "Impressoras Argox" "NENHUMA ENCONTRADA" "Yellow"
        $issues += "Instale driver Argox ou ajuste ARGOX_PRINTER_NAME"
    }
}

Write-Host ""
Write-Host "Ultimas linhas do log ($LogFile):"
Write-Host "----------------------------------------"
if (Test-Path -LiteralPath $LogFile) {
    Get-Content -LiteralPath $LogFile -Tail 80 -ErrorAction SilentlyContinue
} else {
    Write-Host "(log ainda nao criado)"
}

Write-Host ""
Write-Host "========================================"
if ($issues.Count -eq 0 -and $status) {
    Write-Host " OK para imprimir" -ForegroundColor Green
} else {
    Write-Host " Corrigir antes de imprimir:" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
}
Write-Host "========================================"
