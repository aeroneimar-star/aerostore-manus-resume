"use strict";

const { initializeDatabase, all, run } = require("../db");

const TARGETS = [
  { email: "milene@aerostore.local", allowedStores: ["vila", "botanico"], canAdjustInventory: true },
  { email: "fabi@aerostore.local", allowedStores: ["botanico"], canAdjustInventory: true },
  { email: "fabiana@aerosotre.local", allowedStores: ["botanico"], canAdjustInventory: false }
];

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function buildPlan() {
  const placeholders = TARGETS.map(() => "?").join(", ");
  const users = await all(
    `SELECT id, name, email, role, store_id, allowed_stores_json, permissions_json
     FROM users
     WHERE lower(email) IN (${placeholders})
     ORDER BY id`,
    TARGETS.map((target) => target.email)
  );
  const byEmail = new Map(users.map((user) => [String(user.email || "").toLowerCase(), user]));
  return TARGETS.map((target) => {
    const user = byEmail.get(target.email);
    if (!user) {
      return { ...target, eligible: false, reason: "Usuario nao encontrado." };
    }
    const permissions = parseJson(user.permissions_json, {});
    const allowedStores = parseJson(user.allowed_stores_json, []);
    const nextPermissions = { ...permissions, can_adjust_inventory: target.canAdjustInventory };
    return {
      ...target,
      eligible: true,
      user_id: user.id,
      current: {
        name: user.name,
        role: user.role,
        store_id: user.store_id,
        allowed_stores: allowedStores,
        can_adjust_inventory: Boolean(permissions.can_adjust_inventory)
      },
      next: {
        allowed_stores: target.allowedStores,
        can_adjust_inventory: target.canAdjustInventory,
        permissions: nextPermissions
      },
      changed: Boolean(permissions.can_adjust_inventory) !== target.canAdjustInventory
        || JSON.stringify(allowedStores) !== JSON.stringify(target.allowedStores)
    };
  });
}

async function applyPlan(plan) {
  for (const item of plan) {
    if (!item.eligible || !item.changed) continue;
    await run(
      `UPDATE users
       SET allowed_stores_json = ?,
           permissions_json = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [JSON.stringify(item.next.allowed_stores), JSON.stringify(item.next.permissions), item.user_id]
    );
  }
}

async function main() {
  await initializeDatabase();
  const plan = await buildPlan();
  const apply = process.argv.includes("--apply");
  if (apply) {
    await applyPlan(plan);
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", applied: apply, plan }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
