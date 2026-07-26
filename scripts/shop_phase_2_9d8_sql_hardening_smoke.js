"use strict";

/**
 * Shop 2.9D.8 — hardening SQL read-only (P2-1 / P2-2).
 * Cria SQLite temporários, NÃO toca a fixture 2.9B nem bancos operacionais.
 *
 * Uso:
 *   node scripts/shop_phase_2_9d8_sql_hardening_smoke.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();

const ROOT = path.join(__dirname, "..");
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shop-29d8-"));

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function sha(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function closeCachedDb() {
  try {
    const dbModulePath = require.resolve("../db");
    if (!require.cache[dbModulePath]) {
      return;
    }
    const { db } = require("../db");
    if (!db || typeof db.close !== "function") {
      return;
    }
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
  } catch (_) {
    /* ignore */
  }
}

async function clearShopCache() {
  await closeCachedDb();
  Object.keys(require.cache).forEach((key) => {
    if (
      key.endsWith(`${path.sep}db.js`)
      || key.includes(`${path.sep}modules${path.sep}shop${path.sep}`)
    ) {
      delete require.cache[key];
    }
  });
}

async function loadService(databasePath) {
  process.env.DATABASE_PATH = databasePath;
  process.env.SHOP_PUBLIC_CATALOG_ENABLED = "false";
  await clearShopCache();
  return require("../modules/shop/services/shopPublicationService");
}

async function cleanupTempDir() {
  await clearShopCache();
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (_) {
    // Best-effort on Windows file locks; tmp dir is under os.tmpdir().
  }
}

async function createPartialImagesDb(filePath) {
  const db = new sqlite3.Database(filePath);
  await run(db, `
    CREATE TABLE shop_product_publications (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL,
      public_slug TEXT,
      status TEXT,
      public_title TEXT,
      public_short_description TEXT,
      public_category_slug TEXT,
      public_category_label TEXT,
      featured INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      metadata_json TEXT,
      published_at TEXT,
      updated_at TEXT
    )
  `);
  await run(db, `
    CREATE TABLE pdv_products_v2 (
      id INTEGER PRIMARY KEY,
      name TEXT,
      product_type TEXT,
      status TEXT,
      sale_price_cents INTEGER,
      updated_at TEXT
    )
  `);
  await run(db, `
    CREATE TABLE pdv_product_variants (
      id INTEGER PRIMARY KEY,
      product_id INTEGER,
      status TEXT,
      attributes_json TEXT,
      sale_price_cents INTEGER,
      created_at TEXT
    )
  `);
  await run(db, `
    CREATE TABLE pdv_inventory_balances_v2 (
      id INTEGER PRIMARY KEY,
      variant_id INTEGER,
      store_id TEXT,
      available_qty INTEGER,
      reserved_qty INTEGER
    )
  `);
  await run(db, `
    INSERT INTO pdv_products_v2 (id, name, product_type, status, sale_price_cents, updated_at)
    VALUES (62, 'Camiseta X', 'simple', 'ativo', 9990, datetime('now'))
  `);
  await run(db, `
    INSERT INTO shop_product_publications
      (id, product_id, public_slug, status, public_title, featured, sort_order, metadata_json, updated_at)
    VALUES (1, 62, 'camiseta-x', 'draft', 'Camiseta X', 0, 1, '{}', datetime('now'))
  `);
  db.close();
}

async function createBadJsonDb(filePath) {
  const db = new sqlite3.Database(filePath);
  await run(db, `
    CREATE TABLE shop_product_publications (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL,
      public_slug TEXT,
      status TEXT,
      public_title TEXT,
      public_short_description TEXT,
      public_category_slug TEXT,
      public_category_label TEXT,
      featured INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      metadata_json TEXT,
      published_at TEXT,
      updated_at TEXT
    )
  `);
  await run(db, `
    CREATE TABLE shop_product_images (
      id INTEGER PRIMARY KEY,
      publication_id INTEGER NOT NULL
    )
  `);
  await run(db, `
    INSERT INTO shop_product_publications
      (id, product_id, public_slug, status, public_title, featured, sort_order, metadata_json, updated_at)
    VALUES
      (1, 62, 'ok', 'draft', 'OK', 0, 1, '{"needs_photo":true}', datetime('now')),
      (2, 63, 'bad', 'draft', 'BAD', 0, 2, '{not-json', datetime('now')),
      (3, 65, 'nullish', 'draft', 'NULL', 0, 3, NULL, datetime('now')),
      (4, 66, 'empty', 'draft', 'EMPTY', 0, 4, '', datetime('now'))
  `);
  db.close();
}

function assertNoAutoSchema(filePath, forbiddenTable) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY);
    db.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [forbiddenTable],
      (err, row) => {
        db.close();
        if (err) reject(err);
        else resolve(!row);
      }
    );
  });
}

async function main() {
  const partialPath = path.join(TMP_DIR, "partial-no-images.sqlite");
  const badJsonPath = path.join(TMP_DIR, "bad-metadata.sqlite");

  await createPartialImagesDb(partialPath);
  await createBadJsonDb(badJsonPath);

  const beforePartial = { sha: sha(partialPath), size: fs.statSync(partialPath).size };
  const beforeBad = { sha: sha(badJsonPath), size: fs.statSync(badJsonPath).size };

  const servicePartial = await loadService(partialPath);
  const candidates = await servicePartial.listPdvPublicationCandidates({
    limit: 50,
    include_test_candidates: true
  });
  const draft = (candidates.items || []).find((item) => Number(item.pdv_product_ref) === 62);
  if (!draft) {
    throw new Error("P2-1: draft 62 não retornado em schema parcial");
  }
  if (Number(draft.publication?.image_count || 0) !== 0) {
    throw new Error("P2-1: image_count deveria ser 0 sem tabela de imagens");
  }
  if (!draft.publication?.needs_photo) {
    throw new Error("P2-1: needs_photo deveria ser true sem imagens");
  }
  await closeCachedDb();
  if (!(await assertNoAutoSchema(partialPath, "shop_product_images"))) {
    throw new Error("P2-1: tabela shop_product_images foi criada automaticamente");
  }

  const serviceBad = await loadService(badJsonPath);
  const layer = await serviceBad.getPublicationLayerStats();
  if (Number(layer.needs_photo) !== 4) {
    throw new Error(`P2-2: needs_photo esperado 4, recebido ${layer.needs_photo}`);
  }
  if (Number(layer.draft) !== 4) {
    throw new Error(`P2-2: draft esperado 4, recebido ${layer.draft}`);
  }

  await closeCachedDb();
  const afterPartial = { sha: sha(partialPath), size: fs.statSync(partialPath).size };
  const afterBad = { sha: sha(badJsonPath), size: fs.statSync(badJsonPath).size };
  if (beforePartial.sha !== afterPartial.sha || beforePartial.size !== afterPartial.size) {
    throw new Error("P2-1 temp DB foi alterado");
  }
  if (beforeBad.sha !== afterBad.sha || beforeBad.size !== afterBad.size) {
    throw new Error("P2-2 temp DB foi alterado");
  }

  await cleanupTempDir();

  console.log("SHOP_PHASE_2_9D8_SQL_HARDENING_OK");
  console.log(JSON.stringify({
    partial_image_count: Number(draft.publication.image_count || 0),
    partial_needs_photo: Boolean(draft.publication.needs_photo),
    bad_json_needs_photo: Number(layer.needs_photo),
    public_catalog_enabled: false,
    temp_dir_removed: !fs.existsSync(TMP_DIR)
  }, null, 2));
}

main().catch(async (error) => {
  await cleanupTempDir();
  console.error("SHOP_PHASE_2_9D8_SQL_HARDENING_FAIL", error.message || error);
  process.exitCode = 1;
});
