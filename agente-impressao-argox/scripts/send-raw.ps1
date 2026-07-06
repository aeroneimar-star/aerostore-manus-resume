#Requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$PrinterName,

    [Parameter(Mandatory = $true)]
    [string]$FilePath
)

$ErrorActionPreference = "Stop"

Add-Type -Namespace RawPrinter -Name Core -MemberDefinition @"
[System.Runtime.InteropServices.StructLayout(
    System.Runtime.InteropServices.LayoutKind.Sequential,
    CharSet = System.Runtime.InteropServices.CharSet.Ansi)]
public class DOCINFOA {
    [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPStr)]
    public string pDocName;
    [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPStr)]
    public string pOutputFile;
    [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPStr)]
    public string pDataType;
}

public static class Winspool {
    [System.Runtime.InteropServices.DllImport("winspool.drv",
                EntryPoint = "OpenPrinterA",
                CharSet = System.Runtime.InteropServices.CharSet.Ansi,
                SetLastError = true)]
    public static extern bool OpenPrinter(string szPrinter, out System.IntPtr hPrinter, System.IntPtr pd);

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
    public static extern bool WritePrinter(System.IntPtr hPrinter, System.IntPtr pBytes, int dwCount, out int dwWritten);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(System.IntPtr hPrinter);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(System.IntPtr hPrinter);
}
"@

if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    Write-Error "Arquivo nao encontrado: $FilePath"
    exit 1
}

$fileBytes = [System.IO.File]::ReadAllBytes($FilePath)
$fileSize = $fileBytes.Length
if ($fileSize -eq 0) {
    Write-Error "Arquivo vazio: $FilePath"
    exit 1
}

$hPrinter = [IntPtr]::Zero
$opened = [RawPrinter.Core+Winspool]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)
if (-not $opened -or $hPrinter -eq [IntPtr]::Zero) {
    $winErr = [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    Write-Error "OpenPrinter falhou para '$PrinterName': $($winErr.Message)"
    exit 1
}

try {
    $docInfo = [RawPrinter.Core+DOCINFOA]::new()
    $docInfo.pDocName = "AEROSTORE Argox RAW"
    $docInfo.pOutputFile = $null
    $docInfo.pDataType = "RAW"

    if (-not [RawPrinter.Core+Winspool]::StartDocPrinter($hPrinter, 1, $docInfo)) {
        $winErr = [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
        throw "StartDocPrinter falhou: $($winErr.Message)"
    }

    if (-not [RawPrinter.Core+Winspool]::StartPagePrinter($hPrinter)) {
        $winErr = [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
        throw "StartPagePrinter falhou: $($winErr.Message)"
    }

    $pMem = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($fileSize)
    try {
        [Runtime.InteropServices.Marshal]::Copy($fileBytes, 0, $pMem, $fileSize)
        $written = 0
        if (-not [RawPrinter.Core+Winspool]::WritePrinter($hPrinter, $pMem, $fileSize, [ref]$written)) {
            $winErr = [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
            throw "WritePrinter falhou: $($winErr.Message)"
        }
        if ($written -ne $fileSize) {
            throw "WritePrinter enviou $written bytes de $fileSize"
        }
    }
    finally {
        [Runtime.InteropServices.Marshal]::FreeCoTaskMem($pMem)
    }

    if (-not [RawPrinter.Core+Winspool]::EndPagePrinter($hPrinter)) {
        $winErr = [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
        throw "EndPagePrinter falhou: $($winErr.Message)"
    }

    if (-not [RawPrinter.Core+Winspool]::EndDocPrinter($hPrinter)) {
        $winErr = [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
        throw "EndDocPrinter falhou: $($winErr.Message)"
    }

    $payload = @{
        ok = $true
        job_id = "RAW_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        bytes = $fileSize
        metodo = "WINSPOOL_RAW"
        impressora = $PrinterName
    } | ConvertTo-Json -Compress
    Write-Output $payload
    exit 0
}
catch {
    Write-Error $_.Exception.Message
    try { [void][RawPrinter.Core+Winspool]::EndDocPrinter($hPrinter) } catch {}
    exit 1
}
finally {
    if ($hPrinter -ne [IntPtr]::Zero) {
        [void][RawPrinter.Core+Winspool]::ClosePrinter($hPrinter)
    }
}
