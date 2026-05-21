$ErrorActionPreference = "Stop"

subst P: C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado | Out-Null
Set-Location P:\

$proc = Start-Process -FilePath node -ArgumentList "server.js" -WorkingDirectory "P:\" -WindowStyle Hidden -PassThru

try {
  Start-Sleep -Seconds 15

  Write-Output "---SMOKE---"
  node scripts\stage825_store_settings_smoke.js
  $smokeExit = $LASTEXITCODE

  Write-Output "---VISUAL---"
  node scripts\stage825_store_settings_visual_smoke.js
  $visualExit = $LASTEXITCODE

  Write-Output "---REGRESSION---"
  node scripts\stage825_regression_smoke.js
  $regressionExit = $LASTEXITCODE

  Write-Output "SMOKE_EXIT=$smokeExit VISUAL_EXIT=$visualExit REGRESSION_EXIT=$regressionExit"

  if ($smokeExit -ne 0 -or $visualExit -ne 0 -or $regressionExit -ne 0) {
    exit 1
  }
}
finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
}
