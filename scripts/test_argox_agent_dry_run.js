"use strict";

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const AGENT_DIR = path.join(__dirname, "..", "agente-impressao-argox");
const PORT = 4010;
const BASE = `http://127.0.0.1:${PORT}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(method, route, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(`${BASE}${route}`, {
      method,
      headers: payload
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        : {}
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : {} });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForAgent(maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await request("GET", "/status");
      if (result.status === 200) return result.data;
    } catch {
      // agent still booting
    }
    await wait(250);
  }
  throw new Error("Agente nao respondeu a tempo.");
}

(async () => {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: AGENT_DIR,
    env: {
      ...process.env,
      ARGOX_AGENT_DRY_RUN: "true",
      ARGOX_AGENT_PORT: String(PORT)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });

  try {
    const status = await waitForAgent();
    console.log("GET /status OK");
    console.log(JSON.stringify(status, null, 2));

    if (!status.dry_run || !status.conectada) {
      throw new Error("Status esperado: dry_run=true e conectada=true");
    }

    const payload = [{
      nome: "CALCA TECH FIVE POCKET AEROSTORE MASC.",
      marca: "AEROSTORE",
      tamanho: "42",
      cor: "VERDE-MUSGO",
      sku_variacao: "AERO-000098",
      codigo_barras: "7891234567890",
      preco_original: "397,00",
      preco_venda: "167,00",
      colunas: 2
    }, {
      nome: "CALCA TECH FIVE POCKET AEROSTORE MASC.",
      marca: "AEROSTORE",
      tamanho: "42",
      cor: "VERDE-MUSGO",
      sku_variacao: "AERO-000098",
      codigo_barras: "7891234567890",
      preco_original: "397,00",
      preco_venda: "167,00",
      colunas: 2
    }];

    const print = await request("POST", "/imprimir", payload);
    console.log("");
    console.log("POST /imprimir OK");
    console.log(JSON.stringify(print.data, null, 2));

    if (print.status !== 200 || !print.data.sucesso || !print.data.dry_run) {
      throw new Error("Impressao simulada falhou.");
    }
    if (!print.data.arquivo_path) {
      throw new Error("Arquivo simulado nao foi retornado.");
    }

    console.log("");
    console.log("Validacao completa: agente simulado pronto para testar com o PDV.");
    console.log(`Arquivo gerado: ${print.data.arquivo_path}`);
    console.log("");
    console.log("Para usar manualmente agora:");
    console.log(`  cd agente-impressao-argox`);
    console.log(`  $env:ARGOX_AGENT_DRY_RUN="true"; node server.js`);
    console.log(`  curl ${BASE.replace(String(PORT), "4000")}/status`);
  } finally {
    child.kill();
    await wait(300);
    if (stdout.trim()) {
      console.log("");
      console.log("Log do agente:");
      console.log(stdout.trim());
    }
  }
})().catch((error) => {
  console.error("Falha:", error.message);
  process.exit(1);
});
