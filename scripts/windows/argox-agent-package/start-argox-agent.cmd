@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-argox-agent.ps1"
endlocal
