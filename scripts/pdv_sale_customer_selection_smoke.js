"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const MANAGER = {
  email: process.env.AEROSTORE_TEST_EMAIL || "gerente@aerostore.local",
  password: process.env.AEROSTORE_TEST_PASSWORD || "123456"
};

async function request(urlPath, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${BASE_URL}${urlPath}`, {
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
    headers: response.headers
  };
}

async function login() {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(MANAGER)
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok, body.error || "Login deveria funcionar.");
  const cookie = (response.headers.getSetCookie?.() || [])
    .map((item) => item.split(";")[0])
    .join("; ");
  assert(cookie, "Cookie de sessao ausente.");
  return cookie;
}

function assertFrontendCustomerSearchContract() {
  const source = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  assert(
    source.includes("/api/pdv/operational/search/customers?q="),
    "Busca de cliente da venda deve usar o endpoint operacional."
  );
  assert(
    !source.includes("pdv-sale-customer-toolbar\" style=\"display:none;\""),
    "Botao/toolbar de busca de cliente nao deve ficar oculto se o fluxo depende dele."
  );
  assert(
    source.includes("customerSearchDebounce"),
    "Busca de cliente da venda deve ter debounce ao digitar."
  );
}

function buildCustomerSessionPayload(customer = {}) {
  return {
    id: customer.id || customer.master_customer_id || "",
    contact_id: customer.contact_id || customer.legacy_contact_id || customer.id || "",
    master_customer_id: customer.master_customer_id || customer.id || "",
    crm_contact_id: customer.crm_contact_id || "",
    legacy_contact_id: customer.legacy_contact_id || "",
    name: customer.name || "",
    phone: customer.phone || customer.mobile || "",
    document: customer.document || "",
    email: customer.email || "",
    status: customer.status || "",
    origin: customer.origin || customer.source || "PDV",
    origin_label: customer.origin_label || customer.source || "Cliente PDV",
    saldo_cashback: customer.saldo_cashback || customer.cashback_available || customer.cashback || 0,
    cashback_legado: customer.cashback_legado || 0
  };
}

async function main() {
  assertFrontendCustomerSearchContract();

  const cookie = await login();
  const search = await request("/api/pdv/operational/search/customers?q=cliente&limit=5", { cookie });
  assert.strictEqual(search.status, 200, search.body.error || "Busca operacional de clientes deveria responder.");
  const customer = (search.body.items || []).find((item) => item.name && (item.phone || item.master_customer_id || item.id));
  assert(customer, "Busca operacional deveria retornar ao menos um cliente selecionavel.");

  const opened = await request("/api/pdv/operational/session/open", {
    method: "POST",
    cookie,
    body: {
      seller: "QA Ciclo 4.4",
      loja: "vila",
      force_new: true
    }
  });
  assert.strictEqual(opened.status, 200, opened.body.error || "Sessao de venda deveria abrir.");

  const attached = await request(`/api/pdv/operational/session/${opened.body.session_id}/customer`, {
    method: "POST",
    cookie,
    body: buildCustomerSessionPayload(customer)
  });
  assert.strictEqual(attached.status, 200, attached.body.error || "Cliente deveria ser vinculado na sessao.");
  assert(attached.body.customer?.name, "Sessao deveria manter cliente selecionado.");

  const detached = await request(`/api/pdv/operational/session/${opened.body.session_id}/customer`, {
    method: "DELETE",
    cookie
  });
  assert.strictEqual(detached.status, 200, detached.body.error || "Cliente deveria ser removido da sessao.");
  assert.strictEqual(detached.body.customer, null, "Sessao deveria ficar sem cliente apos remocao.");

  console.log(JSON.stringify({
    ok: true,
    selected_customer: attached.body.customer.name,
    session_id: opened.body.session_id
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
