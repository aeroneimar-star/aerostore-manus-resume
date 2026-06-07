"use strict";

const assert = require("assert");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";

async function request(path, { cookie = "", method = "GET", body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
    cookies: response.headers.getSetCookie?.() || []
  };
}

async function main() {
  const login = await request("/api/login", {
    method: "POST",
    body: { email: "gerente@aerostore.local", password: "123456" }
  });
  assert.strictEqual(login.status, 200, login.body.error);
  const cookie = login.cookies.map((value) => value.split(";")[0]).join("; ");

  const grade = await request(
    "/api/products?q=QA%20Grade%20API%201780836517493&store=vila&page=1&limit=25",
    { cookie }
  );
  assert.strictEqual(grade.status, 200, grade.body.error);
  assert.strictEqual(grade.body.items.length, 1);
  assert.strictEqual(grade.body.items[0].normalized_product, true);
  assert.strictEqual(grade.body.items[0].variants.length, 4);
  assert.strictEqual(grade.body.items[0].physical_qty, 5);
  assert.strictEqual(
    grade.body.items[0].available_qty,
    grade.body.items[0].physical_qty - grade.body.items[0].reserved_qty
  );

  const barcode = await request(
    "/api/products?q=178083651749302&store=vila&page=1&limit=25",
    { cookie }
  );
  assert.strictEqual(barcode.status, 200, barcode.body.error);
  assert.strictEqual(barcode.body.items.length, 1);
  assert.strictEqual(barcode.body.items[0].normalized_parent_product_id, 49);

  const movements = await request(
    `/api/products/${grade.body.items[0].id}/movements?store=vila&limit=20`,
    { cookie }
  );
  assert.strictEqual(movements.status, 200, movements.body.error);
  assert(Array.isArray(movements.body.items));

  const tiny = await request(
    "/api/products?q=41286&store=vila&page=1&limit=25",
    { cookie }
  );
  assert.strictEqual(tiny.status, 200, tiny.body.error);
  assert(tiny.body.items.some((item) => item.legacy_adapter));

  const invalidLimit = await request("/api/products?page=1&limit=200", { cookie });
  assert.strictEqual(invalidLimit.status, 400);

  console.log(JSON.stringify({
    grouped_items: grade.body.items.length,
    barcode_parent: barcode.body.items[0].normalized_parent_product_id,
    movement_count: movements.body.items.length,
    tiny_41286: tiny.body.items[0].id,
    invalid_limit_status: invalidLimit.status
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
