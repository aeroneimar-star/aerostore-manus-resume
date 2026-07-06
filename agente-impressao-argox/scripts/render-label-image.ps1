#Requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$SpecPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Write-JsonResult($payload) {
    $payload | ConvertTo-Json -Compress
}

function Get-LabelFontStyle($element) {
    $role = [string]$element.role
    $boldRoles = @("brand", "name", "price", "compare_price", "size_color", "sku", "code", "barcode_text")
    if ($element.bold -eq $true -or ($boldRoles -contains $role)) {
        return [System.Drawing.FontStyle]::Bold
    }
    return [System.Drawing.FontStyle]::Regular
}

function Get-LabelFontFamily($element) {
    if ($element.isBarcode -eq $true) { return "Courier New" }
    if ([string]$element.role -eq "barcode_text") { return "Arial" }
    if ($null -ne $element.fontFamily -and [string]$element.fontFamily) { return [string]$element.fontFamily }
    return "Arial"
}

function New-LabelFont($element, [single]$fontSize) {
    $family = Get-LabelFontFamily $element
    $style = Get-LabelFontStyle $element
    return New-Object System.Drawing.Font($family, $fontSize, $style, [System.Drawing.GraphicsUnit]::Pixel)
}
function Get-Align($value) {
    switch ([string]$value) {
        "left" { return [System.Drawing.StringAlignment]::Near }
        "right" { return [System.Drawing.StringAlignment]::Far }
        default { return [System.Drawing.StringAlignment]::Center }
    }
}

function Split-VisualLines([string]$text, [int]$maxChars, [int]$maxLines) {
    $words = @([string]$text -split '\s+' | Where-Object { $_ })
    if (-not $words.Count) { return @("") }
    $lines = New-Object System.Collections.Generic.List[string]
    $current = ""
    foreach ($word in $words) {
        $candidate = if ($current) { "$current $word" } else { $word }
        if ($candidate.Length -le $maxChars) {
            $current = $candidate
            continue
        }
        if ($current) { [void]$lines.Add($current) }
        $current = $word
        if ($lines.Count -ge ($maxLines - 1)) { break }
    }
    if ($current -and $lines.Count -lt $maxLines) {
        [void]$lines.Add($current)
    }
    if (-not $lines.Count) { return @($text) }
    return ,$lines.ToArray()
}

if (-not (Test-Path -LiteralPath $SpecPath -PathType Leaf)) {
    Write-JsonResult @{ ok = $false; erro = "Spec nao encontrado: $SpecPath" }
    exit 1
}

try {
    $spec = Get-Content -LiteralPath $SpecPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $width = [int]$spec.widthPx
    $height = [int]$spec.heightPx
    if ($width -le 0 -or $height -le 0) {
        throw "widthPx/heightPx invalidos."
    }

    $dir = Split-Path -Parent $OutputPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $bmp.SetResolution([single]($spec.dpi), [single]($spec.dpi))
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    foreach ($element in @($spec.elements)) {
        $text = [string]$element.text
        if ([string]::IsNullOrWhiteSpace($text)) { continue }

        $fontSize = [single][Math]::Max(8, [double]$element.fontSize)

        $x = [int]$element.x
        $y = [int]$element.y
        $boxWidth = [int][Math]::Max(1, $(if ($null -ne $element.width -and [int]$element.width -gt 0) { $element.width } else { $width - $x }))

        if ($element.isBarcode -eq $true) {
            $barHeight = [single][Math]::Max(18, $(if ($null -ne $element.height -and [double]$element.height -gt 0) { [double]$element.height } else { $fontSize * 2.5 }))
            $barTop = [single]$y
            $barLeft = [single]$x
            $barWidth = [single]$boxWidth
            $barcodeImagePath = [string]$element.barcodeImagePath
            if ($barcodeImagePath -and (Test-Path -LiteralPath $barcodeImagePath)) {
                $barcodeImage = [System.Drawing.Image]::FromFile($barcodeImagePath)
                try {
                    $imgW = [single]$barcodeImage.Width
                    $imgH = [single]$barcodeImage.Height
                    if ($imgW -gt 0 -and $imgH -gt 0) {
                        $savedInterpolation = $graphics.InterpolationMode
                        $savedPixelOffset = $graphics.PixelOffsetMode
                        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
                        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

                        $scaleW = if ($imgW -gt $barWidth) { $barWidth / $imgW } else { 1.0 }
                        $scaleH = if ($imgH -gt $barHeight) { $barHeight / $imgH } else { 1.0 }
                        $scale = [Math]::Min($scaleW, $scaleH)
                        $drawW = $imgW * $scale
                        $drawH = $imgH * $scale
                        $drawX = $barLeft + (($barWidth - $drawW) / 2)
                        $drawY = $barTop + (($barHeight - $drawH) / 2)
                        $graphics.DrawImage($barcodeImage, $drawX, $drawY, $drawW, $drawH)

                        $graphics.InterpolationMode = $savedInterpolation
                        $graphics.PixelOffsetMode = $savedPixelOffset
                    }
                    else {
                        $graphics.DrawImage($barcodeImage, $barLeft, $barTop, $barWidth, $barHeight)
                    }
                }
                finally {
                    $barcodeImage.Dispose()
                }
            }
            else {
                throw "Barcode real nao encontrado para renderizacao: $barcodeImagePath"
            }
            continue
        }

        $font = New-LabelFont $element $fontSize
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = Get-Align $element.align
        $format.LineAlignment = [System.Drawing.StringAlignment]::Near
        $format.Trimming = [System.Drawing.StringTrimming]::None
        if ($element.role -in @("name", "price", "compare_price", "code", "sku", "brand", "size_color", "barcode_text")) {
            $format.Trimming = [System.Drawing.StringTrimming]::None
        } else {
            $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
        }

        $maxLines = [int][Math]::Max(1, $(if ($null -ne $element.maxLines) { $element.maxLines } else { 1 }))
        if ($element.role -eq "barcode_text") {
            $savedHint = $graphics.TextRenderingHint
            $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
            $format.LineAlignment = [System.Drawing.StringAlignment]::Center
            $format.Alignment = [System.Drawing.StringAlignment]::Center
            $lineHeight = [single][Math]::Max(
                $(if ($null -ne $element.lineHeight -and [double]$element.lineHeight -gt 0) { [double]$element.lineHeight } else { $fontSize * 1.12 }),
                14
            )
            $lines = @()
            if ($null -ne $element.textLines -and $element.textLines.Count -gt 0) {
                foreach ($line in @($element.textLines)) {
                    if (-not [string]::IsNullOrWhiteSpace([string]$line)) {
                        $lines += [string]$line
                    }
                }
            }
            if (-not $lines.Count) {
                $lines = @($text)
            }
            $solidBlack = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
            for ($lineIndex = 0; $lineIndex -lt $lines.Count; $lineIndex++) {
                $lineY = [single]$y + ($lineHeight * $lineIndex)
                $rect = New-Object System.Drawing.RectangleF([single]$x, $lineY, [single]$boxWidth, $lineHeight)
                $graphics.DrawString($lines[$lineIndex], $font, $solidBlack, $rect, $format)
            }
            $solidBlack.Dispose()
            $graphics.TextRenderingHint = $savedHint
            $font.Dispose()
            $format.Dispose()
            continue
        }
        $charFactor = if ($element.role -eq "name") { 0.48 } else { 0.52 }
        $maxChars = [int][Math]::Max(8, [Math]::Floor($boxWidth / [Math]::Max(1, ($fontSize * $charFactor))))
        $lines = Split-VisualLines $text $maxChars $maxLines
        $lineHeight = [single][Math]::Max($fontSize * 1.08, 12)
        for ($lineIndex = 0; $lineIndex -lt $lines.Count; $lineIndex++) {
            $lineY = [single]$y + ($lineHeight * $lineIndex)
            $rect = New-Object System.Drawing.RectangleF([single]$x, $lineY, [single]$boxWidth, $lineHeight)
            $graphics.DrawString($lines[$lineIndex], $font, [System.Drawing.Brushes]::Black, $rect, $format)
        }

        $font.Dispose()
        $format.Dispose()
    }

    if ($spec.debugGrid -eq $true -and $null -ne $spec.grid) {
        $grid = $spec.grid
        $cellW = [int]$grid.cellWidthPx
        $cellH = [int]$grid.cellHeightPx
        $mainArea = [int]$grid.mainAreaPx
        $cols = [int]$grid.cols
        $rows = [int]$grid.rows
        $cellPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 160, 160, 160), 1)
        $stubPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 0, 150, 90), 1)
        $stubPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash

        for ($row = 0; $row -lt $rows; $row++) {
            for ($col = 0; $col -lt $cols; $col++) {
                $cellX = $col * $cellW
                $cellY = $row * $cellH
                $graphics.DrawRectangle($cellPen, $cellX, $cellY, ($cellW - 1), ($cellH - 1))
                $stubY = $cellY + $mainArea
                $graphics.DrawLine($stubPen, $cellX, $stubY, ($cellX + $cellW - 1), $stubY)
            }
        }

        $cellPen.Dispose()
        $stubPen.Dispose()
    }

    if ($spec.debugBorder -eq $true) {
        $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 220, 0, 0), 2)
        $centerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 120, 220), 1)
        $stubPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 0, 150, 90), 1)
        $stubPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
        $graphics.DrawRectangle($borderPen, 1, 1, ($width - 3), ($height - 3))
        $graphics.DrawLine($centerPen, [int]($width / 2), 0, [int]($width / 2), ($height - 1))
        if ($null -ne $spec.grid -and [int]$spec.grid.mainAreaPx -gt 0) {
            $stubY = [int]$spec.grid.mainAreaPx
            $graphics.DrawLine($stubPen, 0, $stubY, ($width - 1), $stubY)
        } elseif ($height -gt 0) {
            $stubY = [int][Math]::Round($height * 0.8)
            $graphics.DrawLine($stubPen, 0, $stubY, ($width - 1), $stubY)
        }
        $borderPen.Dispose()
        $centerPen.Dispose()
        $stubPen.Dispose()
    }

    $graphics.Dispose()
    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    $bytes = (Get-Item -LiteralPath $OutputPath).Length
    Write-JsonResult @{
        ok = $true
        file_path = $OutputPath
        bytes = $bytes
        width_px = $width
        height_px = $height
        metodo = "WINDOWS_DRIVER_RENDER"
    }
    exit 0
}
catch {
    Write-JsonResult @{ ok = $false; erro = $_.Exception.Message }
    exit 1
}
