#Requires -Version 5.1
$ErrorActionPreference = "SilentlyContinue"
Get-Printer | Select-Object -ExpandProperty Name
