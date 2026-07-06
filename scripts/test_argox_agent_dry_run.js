"use strict";

const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  buildArgoxCommandFromAgentItems,
  isPplaCommand
} = require("../modules/pdv/services/argoxCommandBuilder");

const AGENT_DIR = path.join(__dirname, "..", "agente-impressao-argox");
const BASE_PORT = 4011;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(port, method, route, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(`http://127.0.0.1:${port}${route}`, {
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

async function waitForAgent(port, maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await request(port, "GET", "/status");
      if (result.status === 200) return result.data;
    } catch {
      // booting
    }
    await wait(250);
  }
  throw new Error(`Agente nao respondeu na porta ${port}.`);
}

function samplePayload(language = "PPLB") {
  const item = {
    nome: "CALCA TECH FIVE POCKET AEROSTORE MASC.",
    marca: "AEROSTORE",
    tamanho: "42",
    cor: "VERDE-MUSGO",
    sku_variacao: "AERO-000098",
    codigo_barras: "7891234567890",
    preco_original: "397,00",
    preco_venda: "167,00",
    colunas: 2,
    language
  };
  return [item, { ...item }];
}

async function runAgentCase({ language, port }) {
  process.env.ARGOX_SAFE_TEST_MODE = "true";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: AGENT_DIR,
    env: {
      ...process.env,
      ARGOX_AGENT_DRY_RUN: "true",
      ARGOX_AGENT_PORT: String(port),
      ARGOX_LANGUAGE: language,
      ARGOX_SAFE_TEST_MODE: "true",
      ARGOX_DRIVER_COLUMNS: "2"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const status = await waitForAgent(port);
    assert.strictEqual(status.linguagem, language, `status linguagem deve ser ${language}`);
    assert.strictEqual(status.conectada, true, "agente simulado deve estar conectado");
    assert.strictEqual(status.driver_columns, 2, "status deve expor driver_columns");
    assert.strictEqual(status.raw_env_driver_columns, "2", "status deve expor raw_env_driver_columns");
    assert(typeof status.safe_test_mode === "boolean", "status deve expor safe_test_mode booleano");

    const built = buildArgoxCommandFromAgentItems(samplePayload(language), {
      columns: 2,
      config: { safe_test_mode: true }
    });
    assert.strictEqual(built.language, language, `builder deve gerar ${language}`);
    if (language === "PPLA") {
      assert(isPplaCommand(built.command), "comando PPLA deve iniciar com STX");
      assert.strictEqual(built.quantity_final, 1, "safe test mode deve forcar quantidade final 1");
      assert(built.command.includes("P1\r"), "PPLA deve terminar envelope com P1");
    } else {
      assert(!isPplaCommand(built.command), "comando PPLB nao deve iniciar com STX");
      assert(built.command.includes("\nN\n"), "comando PPLB deve conter N");
    }

    const print = await request(port, "POST", "/imprimir", samplePayload(language));
    assert.strictEqual(print.status, 200, `POST /imprimir ${language} deve retornar 200`);
    assert.strictEqual(print.data.sucesso, true, `POST /imprimir ${language} deve ter sucesso`);
    assert.strictEqual(print.data.linguagem, language, `resposta deve informar ${language}`);
    assert(print.data.bytes > 0, "bytes deve ser maior que zero");
    assert.strictEqual(print.data.metodo, "DRY_RUN_FILE", "dry-run deve usar DRY_RUN_FILE");
    assert.strictEqual(print.data.quantidade_final, 1, "agente deve forcar quantidade final 1 em safe mode");
    assert.strictEqual(print.data.safe_test_mode, true, "agente deve reportar safe test mode");
    assert(fs.existsSync(print.data.arquivo_path), "arquivo dry-run deve existir");

    const saved = fs.readFileSync(print.data.arquivo_path);
    if (language === "PPLA") {
      assert.strictEqual(saved[0], 0x02, "arquivo PPLA deve iniciar com STX");
      assert(saved.toString("ascii").includes("P1\r"), "arquivo PPLA deve conter P1");
    } else {
      assert(saved.toString("ascii").includes("POR: R$ 167,00"), "arquivo PPLB deve conter preco");
    }

    console.log(`Argox agent dry-run ${language} passed.`);
  } finally {
    child.kill();
    await wait(300);
  }
}

(async () => {
  await runAgentCase({ language: "PPLB", port: BASE_PORT });
  await runAgentCase({ language: "PPLA", port: BASE_PORT + 1 });
  console.log("Argox agent dry-run PPLB + PPLA passed.");
})().catch((error) => {
  console.error("Falha:", error.message);
  process.exit(1);
});
