"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SEND_RAW_SCRIPT = path.join(__dirname, "..", "scripts", "send-raw.ps1");
const LIST_PRINTERS_SCRIPT = path.join(__dirname, "..", "scripts", "list-printers.ps1");

function runPowerShell(scriptPath, args = []) {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    ...args
  ], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
}

function isTransportAvailable() {
  return process.platform === "win32";
}

function listPrinterNames() {
  if (!isTransportAvailable()) return [];
  const result = runPowerShell(LIST_PRINTERS_SCRIPT);
  if (result.error) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function printRawBuffer(printerName = "", buffer = Buffer.alloc(0)) {
  if (!isTransportAvailable()) {
    throw new Error("Transporte WINSPOOL_RAW disponivel apenas no Windows.");
  }
  if (!printerName) {
    throw new Error("Nome da impressora nao informado.");
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Buffer RAW vazio.");
  }

  const tempFile = path.join(
    os.tmpdir(),
    `argox-raw-${Date.now()}-${Math.random().toString(16).slice(2)}.prn`
  );
  fs.writeFileSync(tempFile, buffer);

  try {
    const result = runPowerShell(SEND_RAW_SCRIPT, [
      "-PrinterName", printerName,
      "-FilePath", tempFile
    ]);

    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();

    if (result.status !== 0) {
      throw new Error(stderr || stdout || "Falha ao enviar RAW via Winspool.");
    }

    let payload = {};
    try {
      payload = stdout ? JSON.parse(stdout) : {};
    } catch {
      payload = {};
    }

    return {
      jobId: payload.job_id || `RAW_${Date.now()}`,
      bytes: payload.bytes || buffer.length,
      metodo: payload.metodo || "WINSPOOL_RAW",
      impressora: payload.impressora || printerName
    };
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore temp cleanup errors
    }
  }
}

module.exports = {
  isTransportAvailable,
  listPrinterNames,
  printRawBuffer
};
