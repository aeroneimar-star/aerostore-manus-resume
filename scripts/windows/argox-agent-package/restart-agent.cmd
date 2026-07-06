@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-agent.ps1" -InstallPath "%~dp0"
endlocal
