"use strict";

const fs = require("fs");
const path = require("path");

const BASE = process.env.AEROSTORE_BASE_URL || "http://127.0.0.1:3000";

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      email: process.env.AEROSTORE_LOGIN_EMAIL || "admin@aerostore.local",
      password: process.env.AEROSTORE_LOGIN_PASSWORD || "123456"
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Login failed ${response.status}`);
  }
  const setCookie = response.headers.get("set-cookie") || "";
  const token = data.token || data.access_token || "";
  if (!token && !setCookie) {
    throw new Error("Token ou cookie ausente no login");
  }
  return { token, setCookie };
}

async function apiGet(path, auth) {
  const headers = { Accept: "application/json" };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.setCookie) headers.Cookie = auth.setCookie.split(";")[0];
  const response = await fetch(`${BASE}${path}`, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `GET ${path} failed ${response.status}`);
  }
  return data;
}

async function main() {
  const auth = await login();
  const candidates = await apiGet("/api/shop/publication/candidates?limit=200", auth);

  const catalogRes = await fetch(`${BASE}/public-api/catalog?limit=3`, {
    headers: { Accept: "application/json", Host: "aerostore.site" }
  });
  const catalog = await catalogRes.json().catch(() => ({}));

  const report = {
    captured_at: new Date().toISOString(),
    candidates_total: candidates.total,
    candidates_loaded: Array.isArray(candidates.items) ? candidates.items.length : 0,
    schema_ready: candidates.schema_ready,
    pilot_json_active: candidates.pilot_json_active,
    public_catalog_items: Array.isArray(catalog.items) ? catalog.items.length : 0,
    sample_fields: candidates.items?.[0] ? Object.keys(candidates.items[0]) : []
  };

  const outDir = path.join(__dirname, "..", "output");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "shop-phase-2.8-validation.json");
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("SHOP_PHASE_28_VALIDATION_OK", report);
}

main().catch((error) => {
  console.error("SHOP_PHASE_28_VALIDATION_FAIL", error.message);
  process.exit(1);
});
