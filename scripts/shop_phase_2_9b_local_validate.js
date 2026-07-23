"use strict";

/**
 * Fase 2.9B — validação local da migration/seed Shop.
 *
 * Só aceita banco cujo path contenha "shop-phase-2.9B-validation".
 * Não toca VPS. Não altera data/aerostore-crm.sqlite.
 *
 * Uso (após migration + seed na cópia):
 *   DATABASE_PATH=.../data/shop-phase-2.9B-validation.sqlite \
 *     node scripts/shop_phase_2_9b_local_validate.js
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EXPECTED_PRODUCT_IDS = [72, 63, 65, 66, 62, 68, 74, 75].slice().sort((a, b) => a - b);
const VALIDATION_MARKER = "shop-phase-2.9B-validation";

function assertSafeDatabasePath(dbPath) {
  const resolved = path.resolve(dbPath || "");
  if (!resolved.toLowerCase().includes(VALIDATION_MARKER.toLowerCase())) {
    throw new Error(
      `Recusado: DATABASE_PATH deve apontar para cópia *${VALIDATION_MARKER}*. Recebido: ${resolved}`
    );
  }
  if (path.basename(resolved).toLowerCase() === "aerostore-crm.sqlite") {
    throw new Error("Recusado: não use o SQLite principal nesta validação.");
  }
  return resolved;
}

async function collect(get, all) {
  const counts = {};
  for (const table of [
    "shop_product_publications",
    "shop_variant_publications",
    "shop_product_images",
    "shop_catalog_settings",
    "pdv_products_v2",
    "pdv_product_variants"
  ]) {
    const row = await get(`SELECT COUNT(*) AS c FROM ${table}`);
    counts[table] = Number(row.c);
  }

  const publications = await all(
    `SELECT product_id, public_slug, status, featured, sort_order
     FROM shop_product_publications
     ORDER BY sort_order ASC, product_id ASC`
  );
  const statuses = await all(
    `SELECT status, COUNT(*) AS c FROM shop_product_publications GROUP BY status`
  );
  const settings = await get(`SELECT * FROM shop_catalog_settings WHERE id = 1`);
  const reservations = await get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shop_stock_reservations'`
  );

  const productIds = publications.map((row) => Number(row.product_id)).sort((a, b) => a - b);
  const allDraft = publications.every((row) => row.status === "draft");
  const idsMatch =
    productIds.length === EXPECTED_PRODUCT_IDS.length
    && productIds.every((id, index) => id === EXPECTED_PRODUCT_IDS[index]);

  return {
    counts,
    statuses,
    publications,
    product_ids: productIds,
    settings,
    shop_stock_reservations_exists: Boolean(reservations?.name),
    checks: {
      publications_count_8: counts.shop_product_publications === 8,
      all_draft: allDraft,
      product_ids_match: idsMatch,
      variants_zero: counts.shop_variant_publications === 0,
      images_zero: counts.shop_product_images === 0,
      settings_singleton: counts.shop_catalog_settings === 1,
      no_reservations_table: !reservations?.name,
      pdv_products_unchanged: counts.pdv_products_v2 === 178,
      pdv_variants_unchanged: counts.pdv_product_variants === 555
    }
  };
}

async function main() {
  const mode = process.argv.includes("--run-seed-apply") ? "seed_apply_and_validate" : "validate_only";
  const dbPath = assertSafeDatabasePath(process.env.DATABASE_PATH);
  process.env.DATABASE_PATH = dbPath;

  const report = {
    phase: "2.9B",
    mode,
    database_path: dbPath,
    catalog_public_env: process.env.SHOP_PUBLIC_CATALOG_ENABLED || null,
    main_db_mtime: null,
    seed_apply_runs: [],
    validation: null,
    ok: false
  };

  const mainDb = path.join(ROOT, "data", "aerostore-crm.sqlite");
  if (fs.existsSync(mainDb)) {
    report.main_db_mtime = fs.statSync(mainDb).mtime.toISOString();
  }

  if (mode === "seed_apply_and_validate") {
    for (let i = 1; i <= 2; i += 1) {
      const result = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts", "shop_seed_pilot_publications.js"), "--apply"],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            DATABASE_PATH: dbPath,
            SHOP_SEED_CONFIRM: "true"
          },
          encoding: "utf8"
        }
      );
      report.seed_apply_runs.push({
        run: i,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr
      });
      if (result.status !== 0) {
        throw new Error(`Seed apply #${i} falhou: ${result.stderr || result.stdout}`);
      }
    }
  }

  const { get, all } = require("../db");
  report.validation = await collect(get, all);
  report.ok = Object.values(report.validation.checks).every(Boolean);

  const outDir = path.join(ROOT, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "shop-phase-2.9B-validation.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(report.ok ? "SHOP_PHASE_2_9B_VALIDATE_OK" : "SHOP_PHASE_2_9B_VALIDATE_FAIL");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.error("SHOP_PHASE_2_9B_VALIDATE_ERROR", error.message || error);
  process.exitCode = 1;
});
