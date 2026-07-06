#Requires -Version 5.1
param(
    [string]$LeftImagePath = "",

    [string]$RightImagePath = "",

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [int]$WidthPx = 640,

    [int]$HeightPx = 480,

    [int]$CellWidthPx = 320,

    [int]$Dpi = 203
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Write-JsonResult($payload) {
    $payload | ConvertTo-Json -Compress
}

function Test-ImagePath([string]$path) {
    return -not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path -PathType Leaf)
}

try {
    if ($WidthPx -le 0 -or $HeightPx -le 0 -or $CellWidthPx -le 0) {
        throw "Dimensoes invalidas para composicao de lote."
    }

    $dir = Split-Path -Parent $OutputPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $bitmap = New-Object System.Drawing.Bitmap($WidthPx, $HeightPx)
    $bitmap.SetResolution([single]$Dpi, [single]$Dpi)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $leftUsed = $false
    $rightUsed = $false

    if (Test-ImagePath $LeftImagePath) {
        $left = [System.Drawing.Image]::FromFile($LeftImagePath)
        try {
            $graphics.DrawImage($left, 0, 0, $CellWidthPx, $HeightPx)
            $leftUsed = $true
        }
        finally {
            $left.Dispose()
        }
    }

    if (Test-ImagePath $RightImagePath) {
        $right = [System.Drawing.Image]::FromFile($RightImagePath)
        try {
            $graphics.DrawImage($right, $CellWidthPx, 0, $CellWidthPx, $HeightPx)
            $rightUsed = $true
        }
        finally {
            $right.Dispose()
        }
    }

    $graphics.Dispose()
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()

    $bytes = (Get-Item -LiteralPath $OutputPath).Length
    Write-JsonResult @{
        ok = $true
        file_path = $OutputPath
        bytes = $bytes
        width_px = $WidthPx
        height_px = $HeightPx
        cell_width_px = $CellWidthPx
        left_used = $leftUsed
        right_used = $rightUsed
        metodo = "WINDOWS_DRIVER_BATCH_COMPOSE"
    }
    exit 0
}
catch {
    Write-JsonResult @{ ok = $false; erro = $_.Exception.Message }
    exit 1
}
