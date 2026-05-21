"use strict";

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";

const USERS = {
  admin: { email: "admin@aerostore.local", password: "123456" },
  managerVila: { email: "gerente@aerostore.local", password: "123456" },
  sellerBotanico: { email: "vendedor@aerostore.local", password: "123456" }
};

const SALE_VILA = "SAL_bf77cb2cf053";
const SALE_BOTANICO = "SAL_922f8359d11e";

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

async function main() {
  const adminCookie = await login(USERS.admin);
  const managerCookie = await login(USERS.managerVila);
  const sellerCookie = await login(USERS.sellerBotanico);

  const results = {};

  results.adminSaleVila = await request(`/api/pdv/sales/sale/${SALE_VILA}`, { cookie: adminCookie });
  assert(results.adminSaleVila.status === 200, "Admin deveria acessar a venda da Vila.");

  results.adminPending = await request("/api/pdv/sales/payment-links/pending", { cookie: adminCookie });
  assert(results.adminPending.status === 200, "Admin deveria listar pendencias globais.");

  results.managerSaleVila = await request(`/api/pdv/sales/sale/${SALE_VILA}`, { cookie: managerCookie });
  assert(results.managerSaleVila.status === 200, "Manager Vila deveria acessar a venda da Vila.");

  results.managerSaleBotanico = await request(`/api/pdv/sales/sale/${SALE_BOTANICO}`, { cookie: managerCookie });
  assert(results.managerSaleBotanico.status === 403, "Manager Vila nao deveria acessar venda do Botanico.");

  results.sellerSaleVila = await request(`/api/pdv/sales/sale/${SALE_VILA}`, { cookie: sellerCookie });
  assert(results.sellerSaleVila.status === 403, "Seller Botanico nao deveria acessar venda da Vila.");

  results.sellerIaSettings = await request("/api/ia/settings", { cookie: sellerCookie });
  assert(results.sellerIaSettings.status === 403, "Seller nao deveria acessar IA settings.");

  results.sellerRefreshVila = await request(`/api/pdv/sales/sale/${SALE_VILA}/payment-link/refresh`, {
    method: "POST",
    cookie: sellerCookie,
    body: {}
  });
  assert(results.sellerRefreshVila.status === 403, "Seller nao deveria atualizar link de venda fora do escopo.");

  results.sellerGenerateVila = await request(`/api/pdv/sales/sale/${SALE_VILA}/payment-link/generate`, {
    method: "POST",
    cookie: sellerCookie,
    body: {}
  });
  assert(results.sellerGenerateVila.status === 403, "Seller nao deveria gerar link de venda fora do escopo.");

  results.sellerCouponDocumentVila = await request(`/api/pdv/experience/coupon/${SALE_VILA}/document?format=html&mode=normal`, {
    cookie: sellerCookie
  });
  assert(results.sellerCouponDocumentVila.status === 403, "Seller nao deveria abrir documento de cupom fora do escopo.");

  results.sellerSendPendingVila = await request("/api/pdv/whatsapp/send", {
    method: "POST",
    cookie: sellerCookie,
    body: {
      type: "payment_pending",
      saleId: SALE_VILA
    }
  });
  assert(results.sellerSendPendingVila.status === 403, "Seller nao deveria reenviar link fora do escopo.");

  results.managerIaSettings = await request("/api/ia/settings", { cookie: managerCookie });
  assert(results.managerIaSettings.status === 200, "Manager deveria continuar acessando IA settings.");

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
