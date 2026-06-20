"use strict";

/**
 * SMOKE TEST RUNNER — scripts/smoke/runner.js
 *
 * Executa todos os smokes ou um escopo específico.
 *
 * Uso:
 *   node scripts/smoke/runner.js                   — todos
 *   node scripts/smoke/runner.js --scope=critical  — só críticos
 *   node scripts/smoke/runner.js --domain=cash      — só caixa
 *   node scripts/smoke/runner.js --dry-run          — lista sem rodar
 */

const { blockProduction } = require("../scriptSafety");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

blockProduction("runner.js");

// ============================================================
// Catálogo de smokes
// ============================================================

const SMOKE_CATALOG = {
  // ---- CRÍTICOS ----
  critical: [
    "pdv_cash_simultaneous_open_smoke",
    "pdv_cash_empty_close_smoke",
    "pdv_cash_double_close_smoke",
    // gaps críticos do plano
    "pdv_inventory_underflow_smoke",       // ainda não criado
    "pdv_sale_unauthorized_discount_smoke", // ainda não criado
    "pdv_cashback_pin_expiry_smoke",        // ainda não criado
    "pdv_cashback_pin_3_attempts_smoke",    // ainda não criado
  ],

  // ---- CAIXA ----
  cash: [
    "pdv_cash_simultaneous_open_smoke",
    "pdv_cash_empty_close_smoke",
    "pdv_cash_double_close_smoke",
  ],

  // ---- ESTOQUE ----
  inventory: [
    "pdv_inventory_underflow_smoke",       // ainda não criado
    "pdv_inventory_reserve_sell_conflict_smoke", // ainda não criado
  ],

  // ---- VENDA ----
  sale: [
    "pdv_sale_unauthorized_discount_smoke", // ainda não criado
    "pdv_sale_manager_approved_discount_smoke", // ainda não criado
  ],

  // ---- CASHBACK ----
  cashback: [
    "pdv_cashback_pin_expiry_smoke",        // ainda não criado
    "pdv_cashback_pin_3_attempts_smoke",   // ainda não criado
  ],

  // ---- PERMISSÃO ----
  permission: [
    "pdv_permission_cashier_opens_register_smoke",   // ainda não criado
    "pdv_permission_cashier_global_reports_smoke",  // ainda não criado
  ],

  // ---- TROCA / VALE ----
  exchange: [
    "pdv_exchange_expired_window_smoke",   // ainda não criado
    "pdv_exchange_vale_calculation_smoke",  // ainda não criado
  ],

  // ---- WHATSAPP ----
  whatsapp: [
    "pdv_whatsapp_warmup_limit_smoke",      // ainda não criado
  ],

  // ---- IMPORTAÇÃO ----
  import: [
    "pdv_import_duplicate_sku_smoke",       // ainda não criado
  ],

  // ---- TODOS ----
  all: [
    "pdv_cash_simultaneous_open_smoke",
    "pdv_cash_empty_close_smoke",
    "pdv_cash_double_close_smoke",
    "pdv_inventory_underflow_smoke",
    "pdv_inventory_reserve_sell_conflict_smoke",
    "pdv_sale_unauthorized_discount_smoke",
    "pdv_sale_manager_approved_discount_smoke",
    "pdv_cashback_pin_expiry_smoke",
    "pdv_cashback_pin_3_attempts_smoke",
    "pdv_permission_cashier_opens_register_smoke",
    "pdv_permission_cashier_global_reports_smoke",
    "pdv_exchange_expired_window_smoke",
    "pdv_exchange_vale_calculation_smoke",
    "pdv_whatsapp_warmup_limit_smoke",
    "pdv_import_duplicate_sku_smoke",
  ],
};

// ============================================================
// Parse args
// ============================================================

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const SCOPE = getArgValue("--scope") || getArgValue("--domain") || "critical";
const DRY_RUN = hasFlag("--dry-run");
const SMOKE_DIR = path.join(__dirname);

// ============================================================
// Execução
// ============================================================

function resolveSmokes() {
  const key = SCOPE.toLowerCase();
  if (!SMOKE_CATALOG[key]) {
    console.error(`[RUNNER] Escopo "${SCOPE}" desconhecido. Opcoes: ${Object.keys(SMOKE_CATALOG).join(", ")}`);
    process.exit(1);
  }
  return SMOKE_CATALOG[key];
}

function findSmokeFile(name) {
  // Tenta com _smoke.js
  const candidates = [
    path.join(SMOKE_DIR, `${name}.js`),
    path.join(SMOKE_DIR, `${name}.js`)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function runSmoke(name) {
  const filePath = findSmokeFile(name);
  if (!filePath) {
    return { name, ok: false, skipped: true, reason: "arquivo nao encontrado" };
  }

  if (DRY_RUN) {
    return { name, ok: null, dry_run: true, file: filePath };
  }

  const start = Date.now();
  try {
    execSync(`node "${filePath}"`, {
      stdio: "inherit",
      cwd: path.join(__dirname, "../.."),
      timeout: 60000 // 60s max por smoke
    });
    const elapsed = Date.now() - start;
    return { name, ok: true, elapsed_ms: elapsed };
  } catch (error) {
    const elapsed = Date.now() - start;
    return {
      name,
      ok: false,
      elapsed_ms: elapsed,
      error: (error.message || "").replace(/\n.*/g, "").trim().slice(0, 120)
    };
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const smokes = resolveSmokes();

  console.log(`\n========================================`);
  console.log(`  AEROSTORE — Smoke Test Runner`);
  console.log(`  Escopo: ${SCOPE}`);
  console.log(`  Smokes: ${smokes.length}`);
  console.log(`  Dry-run: ${DRY_RUN ? "SIM" : "NAO"}`);
  console.log(`========================================\n`);

  const results = [];

  for (const smoke of smokes) {
    const filePath = findSmokeFile(smoke);
    if (!filePath && !DRY_RUN) {
      console.warn(`[SKIP] ${smoke} — arquivo nao encontrado (ainda nao criado)`);
      results.push({ name: smoke, ok: false, skipped: true });
      continue;
    }

    const label = filePath ? smoke : `${smoke} (nao criado)`;
    console.log(`\n[${results.length + 1}/${smokes.length}] ${"=".repeat(50 - label.length)}> ${label}`);

    if (DRY_RUN) {
      console.log(`  -> ${filePath || "PENDENTE"}`);
      results.push({ name: smoke, ok: null, dry_run: true, file: filePath });
      continue;
    }

    const result = runSmoke(smoke);
    results.push(result);

    if (result.skipped) {
      console.warn(`  [SKIPPED] ${result.reason}`);
    } else if (result.ok) {
      console.log(`  [OK] ${result.elapsed_ms}ms`);
    } else {
      console.error(`  [FAIL] ${result.error}`);
    }
  }

  // ============================================================
  // Resumo
  // ============================================================

  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped || r.dry_run).length;
  const total = results.length;

  console.log(`\n========================================`);
  console.log(`  RESUMO`);
  console.log(`========================================`);
  console.log(`  Total:  ${total}`);
  console.log(`  OK:     ${passed} ${passed === total ? "✓" : ""}`);
  if (failed > 0) console.error(`  FALHOU: ${failed}`);
  if (skipped > 0) console.warn(`  Pulo:   ${skipped}`);
  console.log(`========================================\n`);

  // Detalhe de falhas
  if (failed > 0) {
    console.error("Falhas:");
    results.filter((r) => r.ok === false && !r.skipped).forEach((r) => {
      console.error(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(`\n(Dry-run — nenhum smoke foi executado)\n`);
    process.exit(0);
  }

  if (passed === total && skipped === 0) {
    console.log("Todos os smokes passaram! ✓\n");
    process.exit(0);
  } else if (skipped > 0) {
    console.log(`${skipped} smoke(s) ainda pendente(s).\n`);
    process.exit(0);
  }

  process.exit(1);
}

main().catch((error) => {
  console.error("[RUNNER] Erro fatal:", error.message || error);
  process.exit(1);
});
