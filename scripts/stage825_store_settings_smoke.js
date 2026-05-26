"use strict";

const { blockProduction, requireExplicitConfirmation, warnLocalOnly } = require("./scriptSafety");

blockProduction("stage825_store_settings_smoke.js");
warnLocalOnly("stage825_store_settings_smoke.js");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";

const USERS = {
  admin: { email: "admin@aerostore.local", password: "123456" },
  managerVila: { email: "gerente@aerostore.local", password: "123456" },
  sellerVila: { email: "vendedor.vila@aerostore.local", password: "123456" }
};

const STORE_VILA = "vila_masc";
const STORE_BOTANICO = "botanico";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function buildAdminUpdatePayload(current = {}) {
  const next = clone(current);
  next.address = next.address || {};
  next.contact = next.contact || {};
  next.terminal = next.terminal || {};
  next.policies = next.policies || {};

  next.address.street = "Rua Stage 825";
  next.address.number = "825";
  next.address.city = "Sao Paulo";
  next.address.state = "SP";
  next.contact.whatsapp = "11999888777";
  next.contact.email = "loja.vila.stage825@aerostore.local";
  next.contact.opening_hours = "Seg-Sab 09:00-20:00";
  next.terminal.default_terminal_label = "Terminal Stage 825";
  next.policies.operational_notes = "Stage 825 admin save";
  return next;
}

function buildManagerAttemptPayload(current = {}) {
  const next = clone(current);
  next.contact = next.contact || {};
  next.company = next.company || {};
  next.integrations = next.integrations || {};
  next.policies = next.policies || {};

  next.contact.whatsapp = "11999111222";
  next.contact.email = "gestor.vila.stage825@aerostore.local";
  next.contact.opening_hours = "Seg-Sex 10:00-19:00";
  next.policies.operational_notes = "Stage 825 manager save";

  next.company.cnpj = "12345678000199";
  next.integrations.pagbank_account_label = "NAO_DEVERIA_ALTERAR";
  return next;
}

async function main() {
  requireExplicitConfirmation("--confirm");
  const adminCookie = await login(USERS.admin);
  const managerCookie = await login(USERS.managerVila);
  const sellerCookie = await login(USERS.sellerVila);

  const results = {};

  results.adminList = await request("/api/settings/stores", { cookie: adminCookie });
  assert(results.adminList.status === 200, "Admin deveria listar todas as lojas.");
  assert(Array.isArray(results.adminList.body?.stores), "Admin deveria receber lista de lojas.");
  assert(results.adminList.body.stores.some((item) => item.store_id === STORE_VILA), "Admin deveria receber Vila Masc.");
  assert(results.adminList.body.stores.some((item) => item.store_id === STORE_BOTANICO), "Admin deveria receber Botanico.");

  const originalVilaResponse = await request(`/api/settings/stores/${STORE_VILA}`, { cookie: adminCookie });
  assert(originalVilaResponse.status === 200, "Admin deveria carregar a configuracao da Vila.");
  const originalVila = clone(originalVilaResponse.body?.store || {});
  const adminPayload = buildAdminUpdatePayload(originalVila);

  results.adminUpdate = await request(`/api/settings/stores/${STORE_VILA}`, {
    method: "PUT",
    cookie: adminCookie,
    body: adminPayload
  });
  assert(results.adminUpdate.status === 200, "Admin deveria salvar a configuracao da Vila.");

  results.adminReload = await request(`/api/settings/stores/${STORE_VILA}`, { cookie: adminCookie });
  assert(results.adminReload.status === 200, "Admin deveria reler a configuracao da Vila.");
  assert(results.adminReload.body?.store?.contact?.whatsapp === adminPayload.contact.whatsapp, "WhatsApp salvo pelo admin deveria persistir.");
  assert(results.adminReload.body?.store?.contact?.email === adminPayload.contact.email, "E-mail salvo pelo admin deveria persistir.");
  assert(results.adminReload.body?.store?.address?.street === adminPayload.address.street, "Endereco salvo pelo admin deveria persistir.");
  assert(results.adminReload.body?.store?.terminal?.default_terminal_label === adminPayload.terminal.default_terminal_label, "Terminal salvo pelo admin deveria persistir.");

  results.managerOwnStore = await request(`/api/settings/stores/${STORE_VILA}`, { cookie: managerCookie });
  assert(results.managerOwnStore.status === 200, "Manager Vila deveria carregar a propria loja.");

  results.managerOutsideStore = await request(`/api/settings/stores/${STORE_BOTANICO}`, { cookie: managerCookie });
  assert(results.managerOutsideStore.status === 403, "Manager Vila nao deveria carregar loja fora do escopo.");

  const beforeManager = clone(results.adminReload.body?.store || {});
  const managerPayload = buildManagerAttemptPayload(beforeManager);
  results.managerUpdate = await request(`/api/settings/stores/${STORE_VILA}`, {
    method: "PUT",
    cookie: managerCookie,
    body: managerPayload
  });
  assert(results.managerUpdate.status === 200, "Manager Vila deveria salvar os campos limitados da propria loja.");

  results.managerReload = await request(`/api/settings/stores/${STORE_VILA}`, { cookie: adminCookie });
  assert(results.managerReload.status === 200, "Admin deveria reler a loja apos alteracao do manager.");
  assert(results.managerReload.body?.store?.contact?.whatsapp === managerPayload.contact.whatsapp, "WhatsApp alterado pelo manager deveria persistir.");
  assert(results.managerReload.body?.store?.contact?.email === managerPayload.contact.email, "E-mail alterado pelo manager deveria persistir.");
  assert(results.managerReload.body?.store?.policies?.operational_notes === managerPayload.policies.operational_notes, "Observacao operacional alterada pelo manager deveria persistir.");
  assert(results.managerReload.body?.store?.company?.cnpj === beforeManager.company?.cnpj, "Manager nao deveria alterar CNPJ.");
  assert(results.managerReload.body?.store?.integrations?.pagbank_account_label === beforeManager.integrations?.pagbank_account_label, "Manager nao deveria alterar integracao PagBank.");

  results.sellerList = await request("/api/settings/stores", { cookie: sellerCookie });
  assert(results.sellerList.status === 403, "Seller nao deveria listar configuracoes estrategicas.");

  results.sellerDetail = await request(`/api/settings/stores/${STORE_VILA}`, { cookie: sellerCookie });
  assert(results.sellerDetail.status === 403, "Seller nao deveria carregar configuracao estrategica da loja.");

  results.sellerUpdate = await request(`/api/settings/stores/${STORE_VILA}`, {
    method: "PUT",
    cookie: sellerCookie,
    body: adminPayload
  });
  assert(results.sellerUpdate.status === 403, "Seller nao deveria editar configuracao da loja.");

  results.sellerIaSettings = await request("/api/ia/settings", { cookie: sellerCookie });
  assert(results.sellerIaSettings.status === 403, "Seller deveria continuar bloqueado em IA settings.");

  results.publicOwnStore = await request(`/api/settings/stores/${STORE_VILA}/public`, { cookie: managerCookie });
  assert(results.publicOwnStore.status === 200, "Manager deveria acessar a leitura publica sanitizada da propria loja.");

  results.restore = await request(`/api/settings/stores/${STORE_VILA}`, {
    method: "PUT",
    cookie: adminCookie,
    body: originalVila
  });
  assert(results.restore.status === 200, "Admin deveria conseguir restaurar a configuracao original da loja.");

  results.restoreReload = await request(`/api/settings/stores/${STORE_VILA}`, { cookie: adminCookie });
  assert(results.restoreReload.status === 200, "Admin deveria reler a configuracao restaurada.");
  assert(results.restoreReload.body?.store?.contact?.whatsapp === (originalVila.contact?.whatsapp || ""), "Restauro do WhatsApp deveria concluir.");
  assert(results.restoreReload.body?.store?.address?.street === (originalVila.address?.street || ""), "Restauro do endereco deveria concluir.");
  assert(results.restoreReload.body?.store?.policies?.operational_notes === (originalVila.policies?.operational_notes || ""), "Restauro das observacoes deveria concluir.");

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
