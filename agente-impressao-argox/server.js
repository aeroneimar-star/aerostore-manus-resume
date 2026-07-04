"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const {
  buildArgoxPplbFromAgentItems
} = require(path.join(__dirname, "..", "modules", "pdv", "services", "argoxPplbGenerator"));

const PORT = Number(process.env.ARGOX_AGENT_PORT || 4000);
const PRINTER_NAME = String(process.env.ARGOX_PRINTER_NAME || "").trim();
const DRY_RUN = String(process.env.ARGOX_AGENT_DRY_RUN || "false").toLowerCase() === "true";
const OUTPUT_DIR = path.join(__dirname, "output");
const ALLOWED_ORIGIN_HINTS = String(process.env.ARGOX_AGENT_ORIGINS || "localhost,127.0.0.1,aerostore")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

let printer = null;
let lastDryRunFile = null;

if (!DRY_RUN) {
  try {
    printer = require("@thiagoelg/node-printer");
  } catch {
    console.warn("[AVISO] @thiagoelg/node-printer indisponivel. Use ARGOX_AGENT_DRY_RUN=true para testar em casa.");
  }
}

function responder(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function isAllowedOrigin(origin = "") {
  const normalized = String(origin || "").trim().toLowerCase();
  if (!normalized) return true;
  return ALLOWED_ORIGIN_HINTS.some((hint) => normalized.includes(hint));
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function listPrintersSafe() {
  if (!printer) return [];
  try {
    return printer.getPrinters().map((item) => item.name);
  } catch {
    return [];
  }
}

function findPrinterName() {
  if (DRY_RUN) return "SIMULADO (sem impressora)";
  if (PRINTER_NAME) return PRINTER_NAME;
  try {
    const list = printer ? printer.getPrinters() : [];
    const match = list.find((item) => {
      const name = String(item.name || "").toLowerCase();
      return name.includes("argox")
        || name.includes("os-214")
        || name.includes("generic / text");
    });
    return match ? match.name : null;
  } catch {
    return null;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload excede 1MB."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON invalido."));
      }
    });
    req.on("error", reject);
  });
}

function validateAgentItems(items = []) {
  const list = Array.isArray(items) ? items : [items];
  if (!list.length) {
    throw new Error("Nenhuma etiqueta enviada.");
  }
  const first = list[0] || {};
  if (!first.nome || !first.preco_venda) {
    const error = new Error("Campos obrigatorios: nome, preco_venda");
    error.example = {
      nome: "CALCA TECH FIVE POCKET",
      tamanho: "42",
      cor: "VERDE-MUSGO",
      sku_variacao: "AERO-000098",
      codigo_barras: "7891234567890",
      preco_original: "397,00",
      preco_venda: "167,00"
    };
    throw error;
  }
  return list;
}

function saveDryRunOutput(command = "") {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filename = `dry-run-${Date.now()}.prn`;
  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(command, "ascii"));
  lastDryRunFile = { filename, file_path: filePath, bytes: Buffer.byteLength(command, "ascii") };
  return {
    jobId: `DRY_${Date.now()}`,
    ...lastDryRunFile
  };
}

function printRaw(command = "", printerName = "") {
  if (DRY_RUN) {
    return Promise.resolve(saveDryRunOutput(command));
  }
  if (!printer) {
    return Promise.reject(new Error("node-printer indisponivel. Ative ARGOX_AGENT_DRY_RUN=true para testar sem impressora."));
  }
  return new Promise((resolve, reject) => {
    printer.printDirect({
      data: Buffer.from(command, "ascii"),
      printer: printerName,
      type: "RAW",
      success: (jobId) => resolve({ jobId }),
      error: (error) => reject(error instanceof Error ? error : new Error(String(error || "Falha na impressao.")))
    });
  });
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    const printerName = findPrinterName();
    return responder(res, 200, {
      status: "online",
      versao: "2.0.0",
      impressora: printerName,
      conectada: Boolean(printerName),
      dry_run: DRY_RUN,
      simulado: DRY_RUN,
      plataforma: os.platform(),
      hostname: os.hostname(),
      linguagem: "PPLB",
      ultimo_arquivo: lastDryRunFile
    });
  }

  if (req.method === "POST" && req.url === "/imprimir") {
    try {
      const payload = await readJsonBody(req);
      const items = validateAgentItems(payload);
      const printerName = findPrinterName();
      if (!printerName) {
        return responder(res, 500, {
          erro: "Impressora Argox nao encontrada",
          solucao: DRY_RUN
            ? "Modo simulado deveria estar ativo. Verifique ARGOX_AGENT_DRY_RUN=true."
            : "Instale o driver Argox OS-214 Plus, configure ARGOX_PRINTER_NAME ou use ARGOX_AGENT_DRY_RUN=true em casa.",
          impressoras: listPrintersSafe()
        });
      }

      const columns = Number(items[0]?.colunas || items[0]?.columns || 2);
      const command = buildArgoxPplbFromAgentItems(items, { columns });
      const result = await printRaw(command, printerName);
      return responder(res, 200, {
        sucesso: true,
        dry_run: DRY_RUN,
        simulado: DRY_RUN,
        etiquetas: items.length,
        job_id: result.jobId,
        impressora: printerName,
        arquivo: result.filename || null,
        arquivo_path: result.file_path || null,
        bytes: result.bytes || Buffer.byteLength(command, "ascii"),
        mensagem: DRY_RUN
          ? "Simulacao OK. Nenhuma etiqueta fisica foi impressa. Arquivo PPLB salvo localmente."
          : "Etiqueta enviada ao spooler Windows."
      });
    } catch (error) {
      const statusCode = error.example ? 400 : 500;
      return responder(res, statusCode, {
        erro: error.message || "Falha na impressao",
        exemplo: error.example || undefined
      });
    }
  }

  if (req.method === "POST" && req.url === "/imprimir-raw") {
    try {
      const payload = await readJsonBody(req);
      const command = String(payload.command || payload.raw || "");
      if (!command.trim()) {
        return responder(res, 400, { erro: "Campo command obrigatorio." });
      }
      const printerName = findPrinterName();
      if (!printerName) {
        return responder(res, 500, { erro: "Impressora Argox nao encontrada." });
      }
      const result = await printRaw(command, printerName);
      return responder(res, 200, {
        sucesso: true,
        dry_run: DRY_RUN,
        job_id: result.jobId,
        impressora: printerName,
        arquivo: result.filename || null,
        arquivo_path: result.file_path || null
      });
    } catch (error) {
      return responder(res, 500, { erro: error.message || "Falha na impressao RAW." });
    }
  }

  return responder(res, 404, { erro: "Rota nao encontrada" });
});

server.listen(PORT, () => {
  const printerName = findPrinterName();
  console.log("");
  console.log("Agente Argox AEROSTORE v2.0 (PPLB RAW)");
  console.log(`Porta: ${PORT}`);
  console.log(`Modo: ${DRY_RUN ? "SIMULADO (sem impressora)" : "IMPRESSAO REAL"}`);
  console.log("Status: GET /status");
  console.log("Imprimir: POST /imprimir");
  if (DRY_RUN) {
    console.log(`Saida simulada: ${OUTPUT_DIR}`);
  }
  console.log(`Impressora: ${printerName || "NAO ENCONTRADA"}`);
  if (!printerName && !DRY_RUN) {
    listPrintersSafe().forEach((name) => console.log(`  - ${name}`));
    if (!listPrintersSafe().length) {
      console.log("  Dica: em casa use ARGOX_AGENT_DRY_RUN=true");
    }
  }
});
