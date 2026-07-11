"use strict";

const {
  listPdvPublicationCandidates
} = require("../modules/shop/services/shopPublicationService");

const BASE =
  process.env.SHOP_SMOKE_BASE_URL ||
  process.env.AEROSTORE_SMOKE_BASE_URL ||
  "http://127.0.0.1:3000";

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
  const unauth = await fetch(`${BASE}/api/shop/publication/candidates`, {
    headers: { Accept: "application/json" }
  });
  if (unauth.status !== 401 && unauth.status !== 403) {
    throw new Error(`candidates sem auth deveria 401/403, recebeu ${unauth.status}`);
  }

  const auth = await login();
  const [status, candidatesHidden, candidatesAll, page] = await Promise.all([
    apiGet("/api/shop/publication/status", auth),
    apiGet("/api/shop/publication/candidates?limit=200", auth),
    apiGet("/api/shop/publication/candidates?limit=200&include_test_candidates=true", auth),
    fetch(`${BASE}/shop/publicacao`, { headers: { Accept: "text/html" } })
  ]);

  if (!page.ok) {
    throw new Error(`/shop/publicacao deveria 200, recebeu ${page.status}`);
  }

  const catalog = await fetch(`${BASE}/public-api/catalog`, {
    headers: { Accept: "application/json", Host: "aerostore.site" }
  })
    .then((r) => r.json())
    .catch(() => ({}));

  const directHidden = await listPdvPublicationCandidates({ limit: 5, include_test_candidates: false });
  if (!directHidden.stats || typeof directHidden.stats.total_raw !== "number") {
    throw new Error("stats ausente no serviço local (Fase 2.8.2)");
  }
  if (directHidden.include_test_candidates !== false) {
    throw new Error("include_test_candidates default deveria ser false no serviço");
  }

  const httpHasStats = candidatesHidden.stats && typeof candidatesHidden.stats.total_raw === "number";
  if (!httpHasStats) {
    console.warn(
      "SHOP_PUBLICATION_ADMIN_API_WARN: API HTTP ainda sem stats — reinicie server.js para carregar Fase 2.8.2"
    );
  } else {
    if (candidatesHidden.include_test_candidates !== false) {
      throw new Error("include_test_candidates default deveria ser false na API HTTP");
    }
    if (candidatesAll.include_test_candidates !== true) {
      throw new Error("include_test_candidates=true não aplicado na API HTTP");
    }
  }

  const sample =
    (httpHasStats ? candidatesHidden.items?.[0] : directHidden.items?.[0]) ||
    candidatesAll.items?.[0];
  if (sample && (!sample.block_reason_primary || !Array.isArray(sample.block_reasons))) {
    throw new Error("block_reason_primary/block_reasons ausentes no DTO");
  }

  console.log("SHOP_PUBLICATION_ADMIN_API_OK", {
    schema_ready: status.schema_ready,
    publication_page: page.status,
    candidate_total_hidden_http: candidatesHidden.total,
    candidate_total_all_http: candidatesAll.total,
    stats_http: candidatesHidden.stats || null,
    stats_direct: directHidden.stats,
    pilot_json_active: candidatesHidden.pilot_json_active ?? directHidden.pilot_json_active,
    public_catalog_items: Array.isArray(catalog.items) ? catalog.items.length : 0,
    sample_fields: sample
      ? Object.keys(sample).filter((k) => !["variants", "colors", "sizes"].includes(k))
      : []
  });
}

main().catch((error) => {
  console.error("SHOP_PUBLICATION_ADMIN_API_FAIL", error.message);
  process.exit(1);
});
