"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { all, run } = require("../db");
const {
  listInventoryProducts,
  getInventoryMovements
} = require("../modules/pdv/inventory/pdvInventoryService");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.AEROSTORE_TEST_PASSWORD || "123456";

const USERS = {
  admin: "admin@aerostore.local",
  milene: "milene@aerostore.local",
  fabi: "fabi@aerostore.local",
  seller: "vendedor@aerostore.local",
  cashier: "caixa@aerostore.local",
  consult: "consulta@aerostore.local"
};

async function request(pathname, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      Connection: "close",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
}

async function login(email) {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  const body = await response.json().catch(() => ({}));
  assert.strictEqual(response.status, 200, body.error || `Login deveria funcionar para ${email}.`);
  return (response.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]).join("; ");
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function hashPassword(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

async function prepareLocalUser(user, permissionChanges = {}, allowedStores) {
  const permissions = {
    ...parseJsonObject(user.permissions_json),
    ...permissionChanges
  };
  await run(
    `UPDATE users
     SET password_hash = ?, permissions_json = ?, allowed_stores_json = ?
     WHERE id = ?`,
    [
      hashPassword(PASSWORD),
      JSON.stringify(permissions),
      allowedStores === undefined ? user.allowed_stores_json : JSON.stringify(allowedStores),
      user.id
    ]
  );
}

async function restoreLocalUser(user) {
  await run(
    `UPDATE users
     SET password_hash = ?, permissions_json = ?, allowed_stores_json = ?
     WHERE id = ?`,
    [user.password_hash, user.permissions_json, user.allowed_stores_json, user.id]
  );
}

function findTiny41286(storeId) {
  const payload = listInventoryProducts({ q: "41286", storeId, limit: 20 });
  return (payload.items || []).find((item) => [
    item.codigo_tiny,
    item.codigo,
    item.sku,
    item.product_id
  ].some((value) => String(value || "").includes("41286"))) || null;
}

function buildAdjustmentPayload(item, storeId) {
  return {
    mode: "stock_count",
    inventory_id: item.inventory_id || "",
    product_id: item.product_id || "",
    sku: item.sku || "",
    codigo: item.codigo || "",
    codigo_tiny: item.codigo_tiny || "",
    codigo_etiqueta: item.codigo_etiqueta || "",
    codigo_interno: item.codigo_interno || "",
    codigo_barras: item.codigo_barras || item.ean || "",
    nome: item.nome || "",
    source: item.source || item.origin || "",
    store_id: storeId,
    target_quantity: Number(item.available_qty || 0),
    notes: "Smoke de permissao especifica para ajuste operacional.",
    origin: "pdv_inventory_adjustment_permission_audit_smoke"
  };
}

async function adjust(cookie, item, storeId) {
  return request("/api/pdv/inventory/adjust", {
    method: "POST",
    cookie,
    body: buildAdjustmentPayload(item, storeId)
  });
}

async function main() {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert(
    /function canAdjustPdvInventoryFrontend\(\)/.test(appSource)
      && /hasPermission\("can_adjust_inventory"\)/.test(appSource),
    "Frontend deve possuir gate especifico can_adjust_inventory."
  );
  assert(
    /canAdjustPdvInventoryFrontend\(\)[\s\S]*?buildPdvStockAdjustmentForm\(item\)/.test(appSource),
    "Formulario de ajuste deve ser renderizado somente para usuario autorizado."
  );

  const users = await all(
    `SELECT id, email, name, username, role, store_id, allowed_stores_json,
            permissions_json, password_hash
     FROM users
     WHERE lower(email) IN (${Object.values(USERS).map(() => "?").join(", ")})`,
    Object.values(USERS)
  );
  const byEmail = new Map(users.map((user) => [String(user.email || "").toLowerCase(), user]));
  Object.values(USERS).forEach((email) => assert(byEmail.has(email), `Usuario ${email} deve existir no ambiente local.`));

  const snapshots = new Map(users.map((user) => [String(user.email || "").toLowerCase(), user]));
  try {
    await prepareLocalUser(byEmail.get(USERS.admin));
    await prepareLocalUser(byEmail.get(USERS.milene), {
      can_adjust_inventory: true,
      can_move_stock: false
    }, ["vila", "botanico"]);
    await prepareLocalUser(byEmail.get(USERS.fabi), {
      can_adjust_inventory: true,
      can_move_stock: false
    }, ["botanico"]);

    for (const email of [USERS.seller, USERS.cashier, USERS.consult]) {
      await prepareLocalUser(byEmail.get(email), {
        can_adjust_inventory: false,
        can_move_stock: false
      });
    }

    const cookies = {
      admin: await login(USERS.admin),
      milene: await login(USERS.milene),
      fabi: await login(USERS.fabi),
      seller: await login(USERS.seller),
      cashier: await login(USERS.cashier),
      consult: await login(USERS.consult)
    };

    const records = {
      vila: findTiny41286("vila"),
      botanico: findTiny41286("botanico"),
      sul: findTiny41286("sul")
    };
    Object.entries(records).forEach(([storeId, item]) => assert(item, `Tiny 41286 deve existir em ${storeId}.`));

    const mileneAllowed = await adjust(cookies.milene, records.vila, "vila");
    assert.strictEqual(mileneAllowed.status, 200, mileneAllowed.body.error || "Milene deveria ajustar Vila.");
    const mileneBlocked = await adjust(cookies.milene, records.sul, "sul");
    assert.strictEqual(mileneBlocked.status, 403, "Milene nao deveria ajustar Sul.");

    const fabiAllowed = await adjust(cookies.fabi, records.botanico, "botanico");
    assert.strictEqual(fabiAllowed.status, 200, fabiAllowed.body.error || "Fabi deveria ajustar Botanico.");
    for (const storeId of ["vila", "sul"]) {
      const blocked = await adjust(cookies.fabi, records[storeId], storeId);
      assert.strictEqual(blocked.status, 403, `Fabi nao deveria ajustar ${storeId}.`);
    }

    for (const profile of ["seller", "cashier", "consult"]) {
      const blocked = await adjust(cookies[profile], records.vila, "vila");
      assert.strictEqual(blocked.status, 403, `${profile} nao deveria ajustar estoque.`);
    }

    for (const storeId of ["vila", "botanico", "sul"]) {
      const allowed = await adjust(cookies.admin, records[storeId], storeId);
      assert.strictEqual(allowed.status, 200, allowed.body.error || `Admin deveria ajustar ${storeId}.`);
    }

    const auditRows = await all(
      `SELECT user_name, user_email, user_role, store_id, product_id, result, after_json
       FROM audit_logs
       WHERE module = 'inventory'
         AND action = 'inventory_adjusted'
         AND lower(user_email) IN (?, ?)
       ORDER BY id DESC
       LIMIT 20`,
      [USERS.milene, USERS.fabi]
    );
    for (const email of [USERS.milene, USERS.fabi]) {
      const audit = auditRows.find((row) => String(row.user_email || "").toLowerCase() === email && row.result === "success");
      assert(audit, `Auditoria central deve registrar ajuste de ${email}.`);
      const expectedStore = email === USERS.milene ? "vila" : "botanico";
      assert.strictEqual(audit.store_id, expectedStore, `Auditoria deve registrar a loja ajustada por ${email}.`);
      const after = JSON.parse(audit.after_json || "{}");
      assert.strictEqual(after.movement?.type, "STOCK_COUNT_ADJUSTMENT");
      assert(after.record?.product_id, "Auditoria deve registrar product_id.");
      assert(after.record?.sku || after.record?.codigo || after.record?.codigo_tiny, "Auditoria deve registrar identificador do produto.");
    }

    for (const [email, storeId] of [[USERS.milene, "vila"], [USERS.fabi, "botanico"]]) {
      const user = byEmail.get(email);
      const movements = getInventoryMovements({
        productId: records[storeId].product_id,
        storeId,
        limit: 30
      }).items || [];
      const movement = movements.find((item) =>
        item.type === "STOCK_COUNT_ADJUSTMENT"
        && String(item.created_by || "").toLowerCase().includes(String(user.name || email).toLowerCase())
      );
      assert(movement, `Movimento deve registrar created_by de ${email}.`);
    }

    console.log(JSON.stringify({
      ok: true,
      permission: "can_adjust_inventory",
      milene: { allowed: "vila", blocked: "sul" },
      fabi: { allowed: "botanico", blocked: ["vila", "sul"] },
      blocked_profiles: ["seller", "cashier", "consult"],
      admin_stores: ["vila", "botanico", "sul"],
      audit_users: auditRows.filter((row) => row.result === "success").map((row) => row.user_email)
    }, null, 2));
  } finally {
    for (const snapshot of snapshots.values()) {
      await restoreLocalUser(snapshot);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
