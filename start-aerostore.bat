@echo off
title AEROSTORE - %COMPUTERNAME%
cd /d "%~dp0"
echo ========================================
echo   AEROSTORE CRM + PDV
echo   Iniciando servidor...
echo ========================================
node server.js
pause
