"use strict";

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";

const USERS = {
  admin: { email: "admin@aerostore.local", password: "123456" },
  managerVila: { email: "gerente@aerostore.local", password: "123456" },
  sellerVila: { email: "vendedor.vila@aerostore.local", password: "123456" },
  sellerBotanico: { email: "vendedor@aerostore.local", password: "123456" }
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function login(credentials) {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials)
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok, `Falha no login de ${credentials.email}: ${body.error || response.status}`);
  const rawCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const cookieHeader = rawCookies.map((item) => item.split(";")[0]).join("; ");
  assert(cookieHeader, `Sessao nao retornada para ${credentials.email}.`);
  return cookieHeader;
}

async function request(path, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, body: json };
}

function matchesStoreScope(value, expectedScope) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }
  const scope = String(expectedScope || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (scope === "vila") {
    return normalized === "vila" || normalized === "vila masc" || normalized === "vila masc.";
  }
  if (scope === "botanico") {
    return normalized === "botanico";
  }
  return normalized === scope;
}

function everySellerMatchesStore(rows, expectedStore) {
  return Array.isArray(rows) && rows.every((row) => matchesStoreScope(row.store || row.store_id || "", expectedStore));
}

async function main() {
  const adminCookie = await login(USERS.admin);
  const managerCookie = await login(USERS.managerVila);
  const sellerVilaCookie = await login(USERS.sellerVila);
  const sellerBotanicoCookie = await login(USERS.sellerBotanico);

  const results = {};

  results.adminCashbackGet = await request("/api/cashback/settings", { cookie: adminCookie });
  assert(results.adminCashbackGet.status === 200, "Admin deveria ler cashback settings.");

  const adminPayload = {
    percentages: results.adminCashbackGet.body?.percentages || [12],
    defaultValidityDays: Number(results.adminCashbackGet.body?.defaultValidityDays || 30),
    defaultMinimumPurchase: Number(results.adminCashbackGet.body?.defaultMinimumPurchase || 0),
    reactivationLimitPerStore: Number(results.adminCashbackGet.body?.reactivationLimitPerStore || 10),
    reactivatedValidityDays: Number(results.adminCashbackGet.body?.reactivatedValidityDays || 1),
    anticipatedValidityDays: Number(results.adminCashbackGet.body?.anticipatedValidityDays || 7)
  };

  results.adminCashbackPut = await request("/api/cashback/settings", {
    method: "PUT",
    cookie: adminCookie,
    body: adminPayload
  });
  assert(results.adminCashbackPut.status === 200, "Admin deveria salvar cashback settings.");

  results.managerCashbackGet = await request("/api/cashback/settings", { cookie: managerCookie });
  assert(results.managerCashbackGet.status === 200, "Manager deveria ler cashback settings em somente leitura.");

  results.managerCashbackPut = await request("/api/cashback/settings", {
    method: "PUT",
    cookie: managerCookie,
    body: adminPayload
  });
  assert(results.managerCashbackPut.status === 403, "Manager nao deveria salvar cashback settings globais.");

  results.sellerIaSettings = await request("/api/ia/settings", { cookie: sellerVilaCookie });
  assert(results.sellerIaSettings.status === 403, "Seller Vila nao deveria acessar IA settings.");

  results.sellerIaLogs = await request("/api/ia/logs", { cookie: sellerVilaCookie });
  assert(results.sellerIaLogs.status === 403, "Seller Vila nao deveria acessar IA logs.");

  results.adminSellers = await request("/api/sellers", { cookie: adminCookie });
  assert(results.adminSellers.status === 200, "Admin deveria listar vendedores.");
  assert(Array.isArray(results.adminSellers.body) && results.adminSellers.body.length > 0, "Admin deveria receber vendedores.");

  results.managerSellers = await request("/api/sellers", { cookie: managerCookie });
  assert(results.managerSellers.status === 200, "Manager deveria listar vendedores do proprio escopo.");
  assert(everySellerMatchesStore(results.managerSellers.body, "vila"), "Manager Vila deveria receber apenas vendedores de Vila.");

  results.sellerVilaSellers = await request("/api/sellers", { cookie: sellerVilaCookie });
  assert(results.sellerVilaSellers.status === 200, "Seller Vila deveria receber vendedores do proprio escopo operacional.");
  assert(everySellerMatchesStore(results.sellerVilaSellers.body, "vila"), "Seller Vila deveria receber apenas vendedores de Vila.");

  results.sellerBotanicoSellers = await request("/api/sellers", { cookie: sellerBotanicoCookie });
  assert(results.sellerBotanicoSellers.status === 200, "Seller Botanico deveria receber vendedores do proprio escopo operacional.");
  assert(everySellerMatchesStore(results.sellerBotanicoSellers.body, "botanico"), "Seller Botanico deveria receber apenas vendedores de Botanico.");

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
