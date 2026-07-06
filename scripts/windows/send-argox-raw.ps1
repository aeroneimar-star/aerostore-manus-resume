#Requires -Version 5.1
param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$PrinterName,

    [Parameter(Mandatory=$true, Position=1)]
    [string]$FilePath
)

$ErrorActionPreference = "Stop"

# ── All P/Invoke + DOCINFOA in ONE Add-Type ─────────────────────────────────
Add-Type -Namespace RawPrinter -Name Core -MemberDefinition @"

[System.Runtime.InteropServices.StructLayout(
    System.Runtime.InteropServices.LayoutKind.Sequential,
    CharSet = System.Runtime.InteropServices.CharSet.Ansi)]
public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)]
    public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)]
    public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)]
    public string pDataType;
}

public static class Winspool {
    [System.Runtime.InteropServices.DllImport("winspool.drv",
                EntryPoint = "OpenPrinterA",
                CharSet = System.Runtime.InteropServices.CharSet.Ansi,
                SetLastError = true)]
    public static extern bool OpenPrinter(string szPrinter,
                out System.IntPtr hPrinter, System.IntPtr pd);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(System.IntPtr hPrinter);

    [System.Runtime.InteropServices.DllImport("winspool.drv",
                EntryPoint = "StartDocPrinterA",
                CharSet = System.Runtime.InteropServices.CharSet.Ansi,
                SetLastError = true)]
    public static extern bool StartDocPrinter(System.IntPtr hPrinter, int level,
                [System.Runtime.InteropServices.In,
                 System.Runtime.InteropServices.MarshalAs(
                     System.Runtime.InteropServices.UnmanagedType.LPStruct)] DOCINFOA di);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(System.IntPtr hPrinter);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(System.IntPtr hPrinter, System.IntPtr pBytes,
                int dwCount, out int dwWritten);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(System.IntPtr hPrinter);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(System.IntPtr hPrinter);
}
"@

# ── Validate file ───────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    Write-Host "[ERRO] Arquivo nao encontrado: $FilePath" -ForegroundColor Red
    exit 1
}

$fileBytes = [System.IO.File]::ReadAllBytes($FilePath)
$fileSize  = $fileBytes.Length

if ($fileSize -eq 0) {
    Write-Host "[ERRO] Arquivo vazio: $FilePath" -ForegroundColor Red
    exit 1
}

# ── Hex preview ─────────────────────────────────────────────────────────────
$hexRows = @()
for ($i = 0; $i -lt [Math]::Min(32, $fileSize); $i += 16) {
    $end   = [Math]::Min($i + 15, $fileSize - 1)
    $chunk = @()
    for ($j = $i; $j -le $end; $j++) {
        $chunk += ('{0:X2}' -f $fileBytes[$j])
    }
    $hexRows += ($chunk -join ' ')
}
$hexPreview = $hexRows -join "`n               "

# ── Banner ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Argox RAW Sender  |  Winspool Direct API (ANSI)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Impressora   : $PrinterName"
Write-Host "  Arquivo      : $FilePath"
Write-Host "  Tamanho      : $fileSize bytes ($([Math]::Round($fileSize/1KB,2)) KB)"
Write-Host ""
Write-Host "  Primeiros 32 bytes (hex):" -ForegroundColor Yellow
Write-Host "  $hexPreview" -ForegroundColor Gray
Write-Host ""

# ── 1. OpenPrinter ─────────────────────────────────────────────────────────
$hPrinter = [IntPtr]::Zero
$opened   = [RawPrinter.Core+Winspool]::OpenPrinter(
    $PrinterName, [ref]$hPrinter, [IntPtr]::Zero)

if (-not $opened -or $hPrinter -eq [IntPtr]::Zero) {
    $winErr = [System.ComponentModel.Win32Exception]::new(
        [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())
    Write-Host "[ERRO] Falha ao abrir impressora: $PrinterName" -ForegroundColor Red
    Write-Host "       $($winErr.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Possiveis causas:" -ForegroundColor Yellow
    Write-Host "  - Nome da impressora esta incorreto" -ForegroundColor Yellow
    Write-Host "  - Impressora offline ou desconectada" -ForegroundColor Yellow
    Write-Host "  - Sem permissao (rode como Administrador)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Impressoras disponiveis:" -ForegroundColor Cyan
    Get-Printer | Select-Object -ExpandProperty Name | ForEach-Object {
        Write-Host "    * $_"
    }
    exit 1
}

Write-Host "[OK]   Impressora aberta (handle: $hPrinter)" -ForegroundColor Green

try {
    # ── 2. Build DOCINFOA ───────────────────────────────────────────────────
    $docInfo = [RawPrinter.Core+DOCINFOA]::new()
    $docInfo.pDocName    = "AEROSTORE Argox RAW"
    $docInfo.pOutputFile = $null
    $docInfo.pDataType   = "RAW"

    # ── 3. StartDocPrinter ──────────────────────────────────────────────────
    $started = [RawPrinter.Core+Winspool]::StartDocPrinter(
        $hPrinter, 1, $docInfo)

    if (-not $started) {
        $winErr = [System.ComponentModel.Win32Exception]::new(
            [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())
        throw "StartDocPrinter falhou: $($winErr.Message)"
    }
    Write-Host "[OK]   Documento RAW iniciado no spooler" -ForegroundColor Green

    # ── 4. StartPagePrinter ────────────────────────────────────────────────
    $pageStarted = [RawPrinter.Core+Winspool]::StartPagePrinter($hPrinter)
    if (-not $pageStarted) {
        $winErr = [System.ComponentModel.Win32Exception]::new(
            [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())
        throw "StartPagePrinter falhou: $($winErr.Message)"
    }
    Write-Host "[OK]   Pagina iniciada" -ForegroundColor Green

    # ── 5-9. WritePrinter ───────────────────────────────────────────────────
    $pMem = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($fileSize)
    try {
        [System.Runtime.InteropServices.Marshal]::Copy($fileBytes, 0, $pMem, $fileSize)

        $written = 0
        $ok = [RawPrinter.Core+Winspool]::WritePrinter(
            $hPrinter, $pMem, $fileSize, [ref]$written)

        if (-not $ok) {
            $winErr = [System.ComponentModel.Win32Exception]::new(
                [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())
            throw "WritePrinter falhou: $($winErr.Message)"
        }

        if ($written -ne $fileSize) {
            Write-Host "[AVISO] Bytes enviados ($written) difere do arquivo ($fileSize)" -ForegroundColor Yellow
        } else {
            Write-Host "[OK]   $written bytes enviados com sucesso" -ForegroundColor Green
        }
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($pMem)
    }

    # ── 10. EndPagePrinter ─────────────────────────────────────────────────
    $pageEnded = [RawPrinter.Core+Winspool]::EndPagePrinter($hPrinter)
    if (-not $pageEnded) {
        $winErr = [System.ComponentModel.Win32Exception]::new(
            [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())
        throw "EndPagePrinter falhou: $($winErr.Message)"
    }
    Write-Host "[OK]   Pagina finalizada" -ForegroundColor Green

    # ── 11. EndDocPrinter ──────────────────────────────────────────────────
    $docEnded = [RawPrinter.Core+Winspool]::EndDocPrinter($hPrinter)
    if (-not $docEnded) {
        $winErr = [System.ComponentModel.Win32Exception]::new(
            [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())
        throw "EndDocPrinter falhou: $($winErr.Message)"
    }
    Write-Host "[OK]   Documento fechado no spooler" -ForegroundColor Green

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " SUCESSO -- arquivo enviado para o spooler." -ForegroundColor Green
    Write-Host " Verifique a impressora fisica." -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Se a impressora nao imprimir:" -ForegroundColor Yellow
    Write-Host "  1. Confirme que ha etiquetas no rolo" -ForegroundColor Yellow
    Write-Host "  2. Verifique LED de erro na impressora" -ForegroundColor Yellow
    Write-Host "  3. Tente com a fila ArgoxRaw (driver PPLA original)" -ForegroundColor Yellow
}
catch {
    Write-Host ""
    Write-Host "[ERRO] Falha durante envio: $_" -ForegroundColor Red
    try {
        [void] [RawPrinter.Core+Winspool]::EndDocPrinter($hPrinter)
    } catch {}
}
finally {
    # ── 12. ClosePrinter ───────────────────────────────────────────────────
    if ($hPrinter -ne [IntPtr]::Zero) {
        [void] [RawPrinter.Core+Winspool]::ClosePrinter($hPrinter)
        Write-Host "[OK]   Handle da impressora fechado" -ForegroundColor Gray
    }
}
