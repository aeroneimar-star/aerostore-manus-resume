"use strict";

/**
 * Aplica DDL da publication layer Shop.
 *
 * SEGURANÇA: não executa sem confirmação explícita.
 *   SHOP_APPLY_MIGRATION=true node scripts/shop_apply_publication_migration.js
 *
 * Não faz seed. Não liga catálogo público. Não cria reservas.
 * Não é chamado no boot do server.
 */

const path = require("path");
const {
  applyShopPublicationMigration,
  getShopPublicationSchemaStatus,
  getDdlPath
} = require("../modules/shop/database/shopPublicationMigration");

function isConfirmed() {
  return String(process.env.SHOP_APPLY_MIGRATION || "").trim().toLowerCase() === "true";
}

async function main() {
  const dryProbe = process.argv.includes("--status-only");
  const { get, run } = require("../db");

  if (dryProbe) {
    const status = await getShopPublicationSchemaStatus(get);
    console.log("SHOP_PUBLICATION_MIGRATION_STATUS");
    console.log(JSON.stringify({ ddl_path: getDdlPath(), ...status }, null, 2));
    return;
  }

  if (!isConfirmed()) {
    console.error("SHOP_PUBLICATION_MIGRATION_BLOCKED");
    console.error("Defina SHOP_APPLY_MIGRATION=true para aplicar a DDL.");
    console.error("Status-only: node scripts/shop_apply_publication_migration.js --status-only");
    process.exitCode = 2;
    return;
  }

  const result = await applyShopPublicationMigration({ run, get });
  console.log("SHOP_PUBLICATION_MIGRATION_OK");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("SHOP_PUBLICATION_MIGRATION_FAIL", error.message || error);
  process.exitCode = 1;
});
