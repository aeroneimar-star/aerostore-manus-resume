#Requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$PrinterName,

    [Parameter(Mandatory = $true)]
    [string]$ImageListPath,

    [int]$Copies = 1,

    [int]$LabelWidthMm = 80,

    [int]$LabelHeightMm = 60,

    [double]$ScaleX = 1.0,

    [double]$ScaleY = 1.0,

    [double]$OffsetXMm = 0.0,

    [double]$OffsetYMm = 0.0
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Write-JsonResult($payload) {
    $payload | ConvertTo-Json -Compress
}

function Convert-MmToHundredthsInch([double]$mm) {
    return [int][Math]::Round(($mm / 25.4) * 100)
}

if (-not (Test-Path -LiteralPath $ImageListPath -PathType Leaf)) {
    Write-JsonResult @{ ok = $false; erro = "Manifesto de imagens nao encontrado: $ImageListPath" }
    exit 1
}

if ($Copies -lt 1) { $Copies = 1 }
if ($Copies -gt 1) { $Copies = 1 }
if ($ScaleX -le 0) { $ScaleX = 1.0 }
if ($ScaleY -le 0) { $ScaleY = 1.0 }

try {
    $rawList = Get-Content -LiteralPath $ImageListPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $imagePaths = @($rawList | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

    if (-not $imagePaths.Count) {
        throw "Nenhuma imagem informada no manifesto."
    }

    foreach ($imagePath in $imagePaths) {
        if (-not (Test-Path -LiteralPath $imagePath -PathType Leaf)) {
            throw "Imagem nao encontrada: $imagePath"
        }
    }

    $loadedImages = New-Object System.Collections.Generic.List[System.Drawing.Image]
    foreach ($imagePath in $imagePaths) {
        [void]$loadedImages.Add([System.Drawing.Image]::FromFile($imagePath))
    }

    $pd = New-Object System.Drawing.Printing.PrintDocument
    $pd.DocumentName = "AEROSTORE Argox Label Batch"
    $pd.PrinterSettings.PrinterName = $PrinterName
    $pd.PrinterSettings.Copies = [int16]$Copies
    $pd.PrinterSettings.PrintToFile = $false

    if (-not $pd.PrinterSettings.IsValid) {
        throw "Impressora invalida ou indisponivel: $PrinterName"
    }

    $paperWidth = Convert-MmToHundredthsInch $LabelWidthMm
    $paperHeight = Convert-MmToHundredthsInch $LabelHeightMm
    $paperName = if ($LabelWidthMm -ge 80) { "AEROSTORE_80x60" } else { "AEROSTORE_40x60" }
    $paperSize = New-Object System.Drawing.Printing.PaperSize($paperName, $paperWidth, $paperHeight)

    $pd.DefaultPageSettings.PaperSize = $paperSize
    $pd.DefaultPageSettings.Landscape = $false
    $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
    $pd.OriginAtMargins = $false
    $pd.PrinterSettings.PrintRange = [System.Drawing.Printing.PrintRange]::AllPages
    $pd.PrinterSettings.FromPage = 1
    $pd.PrinterSettings.ToPage = $imagePaths.Count
    $pd.PrinterSettings.MinimumPage = 1
    $pd.PrinterSettings.MaximumPage = $imagePaths.Count
    $pd.PrinterSettings.Collate = $false
    $pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController

    $driverScaleX = [double]$ScaleX
    $driverScaleY = [double]$ScaleY
    $driverOffsetXMm = [double]$OffsetXMm
    $driverOffsetYMm = [double]$OffsetYMm
    $labelWidthMmLocal = [double]$LabelWidthMm
    $labelHeightMmLocal = [double]$LabelHeightMm
    $script:pageIndex = 0
    $script:pagesPrinted = 0
    $pageBoundsLogged = @()

    $printPageHandler = {
        param($sender, $eventArgs)
        if ($script:pageIndex -ge $loadedImages.Count) {
            $eventArgs.HasMorePages = $false
            return
        }

        $imageToPrint = $loadedImages[$script:pageIndex]
        $script:pagesPrinted++

        $pageBounds = $eventArgs.PageBounds
        $marginBounds = $eventArgs.MarginBounds
        $printableArea = $eventArgs.PageSettings.PrintableArea
        $hardMarginX = [int]$eventArgs.PageSettings.HardMarginX
        $hardMarginY = [int]$eventArgs.PageSettings.HardMarginY

        $labelWidthHi = Convert-MmToHundredthsInch $labelWidthMmLocal
        $labelHeightHi = Convert-MmToHundredthsInch $labelHeightMmLocal
        $offsetXHi = Convert-MmToHundredthsInch $driverOffsetXMm
        $offsetYHi = Convert-MmToHundredthsInch $driverOffsetYMm
        $destWidthHi = [int][Math]::Round($labelWidthHi * $driverScaleX)
        $destHeightHi = [int][Math]::Round($labelHeightHi * $driverScaleY)
        $destX = $hardMarginX + $offsetXHi
        $destY = $hardMarginY + $offsetYHi

        $pageBoundsLogged += @{
            page_index = $script:pageIndex + 1
            image_path = $imagePaths[$script:pageIndex]
            page_x = $pageBounds.X
            page_y = $pageBounds.Y
            page_width = $pageBounds.Width
            page_height = $pageBounds.Height
            margin_x = $marginBounds.X
            margin_y = $marginBounds.Y
            margin_width = $marginBounds.Width
            margin_height = $marginBounds.Height
            printable_x = [int][Math]::Round($printableArea.X)
            printable_y = [int][Math]::Round($printableArea.Y)
            printable_width = [int][Math]::Round($printableArea.Width)
            printable_height = [int][Math]::Round($printableArea.Height)
            hard_margin_x = $hardMarginX
            hard_margin_y = $hardMarginY
            dest_x = $destX
            dest_y = $destY
            dest_width = $destWidthHi
            dest_height = $destHeightHi
            label_width_hundredths = $labelWidthHi
            label_height_hundredths = $labelHeightHi
            image_width_px = $imageToPrint.Width
            image_height_px = $imageToPrint.Height
            image_dpi_x = [single]$imageToPrint.HorizontalResolution
            image_dpi_y = [single]$imageToPrint.VerticalResolution
        }

        $eventArgs.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
        $eventArgs.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $eventArgs.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

        $dest = New-Object System.Drawing.Rectangle($destX, $destY, $destWidthHi, $destHeightHi)
        $eventArgs.Graphics.DrawImage($imageToPrint, $dest)

        $script:pageIndex++
        $eventArgs.HasMorePages = ($script:pageIndex -lt $loadedImages.Count)
    }.GetNewClosure()

    $pd.add_PrintPage($printPageHandler)
    $pd.Print()
    $pd.Dispose()

    foreach ($image in $loadedImages) {
        $image.Dispose()
    }

    $totalBytes = 0
    foreach ($imagePath in $imagePaths) {
        $totalBytes += (Get-Item -LiteralPath $imagePath).Length
    }

    Write-JsonResult @{
        ok = $true
        job_id = "DRV_MULTI_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        bytes = $totalBytes
        copies = $Copies
        pages_printed = $script:pagesPrinted
        images_count = $imagePaths.Count
        print_range = "AllPages"
        from_page = 1
        to_page = $imagePaths.Count
        maximum_page = $imagePaths.Count
        metodo = "WINDOWS_DRIVER_MULTIPAGE"
        impressora = $PrinterName
        paper_width_mm = $LabelWidthMm
        paper_height_mm = $LabelHeightMm
        paper_width_hundredths = $paperWidth
        paper_height_hundredths = $paperHeight
        scale_x = $ScaleX
        scale_y = $ScaleY
        offset_x_mm = $OffsetXMm
        offset_y_mm = $OffsetYMm
        page_bounds = $pageBoundsLogged
        image_paths = $imagePaths
    }
    exit 0
}
catch {
    Write-JsonResult @{ ok = $false; erro = $_.Exception.Message }
    exit 1
}
