"use strict";

const assert = require("assert");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const MANAGER = {
  email: process.env.AEROSTORE_TEST_EMAIL || "gerente@aerostore.local",
  password: process.env.AEROSTORE_TEST_PASSWORD || "123456"
};

async function login() {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(MANAGER)
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok, `Falha no login: ${body.error || response.status}`);
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const cookie = cookies.map((item) => item.split(";")[0]).join("; ");
  assert(cookie, "Sessao de teste ausente.");
  return cookie;
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
  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
}

function assertStatus(result, expected, message) {
  assert.strictEqual(result.status, expected, `${message}: ${result.status} ${result.body?.error || ""}`);
}

function findOperationalSize(items, size) {
  return (items || []).find((item) => String(item.manual_size_key || item.tamanho || "").toUpperCase() === size);
}

function buildProductPayload(suffix, overrides = {}) {
  return {
    name: `QA Produto manual ${suffix}`,
    commercial_name: `QA Grade ${suffix}`,
    category: "QA",
    price: 10,
    stock: 0,
    store: "vila_masc",
    source: "manual",
    use_in_ai: 0,
    use_in_pos: 0,
    ...overrides
  };
}

async function main() {
  const cookie = await login();
  const suffix = Date.now();
  const createdIds = [];

  try {
    const suggestion = await request("/api/products/internal-code/reserve", { method: "POST", cookie });
    assertStatus(suggestion, 200, "Deveria sugerir codigo interno automatico");
    assert(/^AERO-\d{6,}$/.test(suggestion.body?.code || ""), "Sugestao deveria seguir o formato AERO-000001.");

    const first = await request("/api/products", {
      method: "POST",
      cookie,
      body: buildProductPayload(`${suffix}-A`, {
        auto_generate_code: 1,
        size_stock: [
          { size: "P", quantity: 2 },
          { size: "M", quantity: 3 },
          { size: "G", quantity: 5 },
          { size: "GG", quantity: 0 }
        ],
        stock: 999
      })
    });
    assertStatus(first, 201, "Primeiro produto automatico deveria salvar");
    createdIds.push(first.body.product.id);
    assert(/^AERO-\d{6,}$/.test(first.body.product.codigo_interno || ""), "Produto deveria receber codigo automatico.");
    assert.strictEqual(first.body.product.stock, 10, "Estoque deveria refletir a soma da grade.");
    assert.deepStrictEqual(first.body.product.size_stock, [
      { size: "P", quantity: 2 },
      { size: "M", quantity: 3 },
      { size: "G", quantity: 5 },
      { size: "GG", quantity: 0 }
    ]);
    const firstProductsList = await request(`/api/products?q=${encodeURIComponent(first.body.product.codigo_interno)}&limit=20`, { cookie });
    assertStatus(firstProductsList, 200, "Listagem de produtos deveria encontrar o cadastro manual");
    assert.strictEqual(firstProductsList.body.items?.length, 1, "A tela Produtos deve listar somente o produto pai, sem cards por tamanho.");
    assert.strictEqual(String(firstProductsList.body.items?.[0]?.id || ""), String(first.body.product.id));
    assert.deepStrictEqual(firstProductsList.body.items?.[0]?.size_stock, [
      { size: "P", quantity: 2 },
      { size: "M", quantity: 3 },
      { size: "G", quantity: 5 },
      { size: "GG", quantity: 0 }
    ]);
    assert.strictEqual(firstProductsList.body.pagination?.total, 1, "Contadores da busca devem contar apenas o produto pai.");
    const firstOperational = await request(`/api/pdv/operational/search/products?q=${encodeURIComponent(first.body.product.codigo_interno)}&store=vila&limit=20`, { cookie });
    assertStatus(firstOperational, 200, "Busca operacional deveria reconhecer a grade manual");
    assert.strictEqual(findOperationalSize(firstOperational.body.items, "P")?.available_in_sale_store_qty, 2);
    assert.strictEqual(findOperationalSize(firstOperational.body.items, "P")?.operational_stock_status, "AVAILABLE_LOCAL");
    assert.strictEqual(findOperationalSize(firstOperational.body.items, "M")?.available_in_sale_store_qty, 3);
    assert.strictEqual(findOperationalSize(firstOperational.body.items, "GG")?.operational_stock_status, "OUT_OF_STOCK_LOCAL");

    const second = await request("/api/products", {
      method: "POST",
      cookie,
      body: buildProductPayload(`${suffix}-B`, { auto_generate_code: 1 })
    });
    assertStatus(second, 201, "Segundo produto automatico deveria salvar");
    createdIds.push(second.body.product.id);
    assert.notStrictEqual(
      second.body.product.codigo_interno,
      first.body.product.codigo_interno,
      "Codigos automaticos nao podem duplicar."
    );
    const secondOperational = await request(`/api/pdv/operational/search/products?q=${encodeURIComponent(second.body.product.codigo_interno)}&store=vila&limit=20`, { cookie });
    assertStatus(secondOperational, 200, "Produto manual sem grade deveria continuar pesquisavel");
    assert.strictEqual(
      secondOperational.body.items?.[0]?.operational_stock_status,
      "OUT_OF_STOCK_LOCAL",
      "Produto simples sem grade deve possuir variacao padrao com saldo zero confirmado."
    );

    const manualCode = `QA-MANUAL-${suffix}`;
    const manual = await request("/api/products", {
      method: "POST",
      cookie,
      body: buildProductPayload(`${suffix}-C`, {
        sku: manualCode,
        codigo: manualCode,
        auto_generate_code: 0,
        stock: 7
      })
    });
    assertStatus(manual, 201, "Produto com codigo manual deveria salvar");
    createdIds.push(manual.body.product.id);
    assert.strictEqual(manual.body.product.codigo_interno, manualCode);
    assert.strictEqual(manual.body.product.stock, 7);

    const duplicate = await request("/api/products", {
      method: "POST",
      cookie,
      body: buildProductPayload(`${suffix}-D`, {
        sku: manualCode,
        codigo: manualCode,
        auto_generate_code: 0
      })
    });
    assertStatus(duplicate, 400, "Codigo manual duplicado deveria ser bloqueado");

    const negativeQuantity = await request("/api/products", {
      method: "POST",
      cookie,
      body: buildProductPayload(`${suffix}-NEG`, {
        auto_generate_code: 1,
        size_stock: [{ size: "P", quantity: -1 }]
      })
    });
    assertStatus(negativeQuantity, 400, "Quantidade negativa deveria ser bloqueada");

    const updated = await request(`/api/products/${first.body.product.id}`, {
      method: "PUT",
      cookie,
      body: buildProductPayload(`${suffix}-A`, {
        sku: first.body.product.sku,
        codigo: first.body.product.codigo_interno,
        auto_generate_code: 0,
        size_stock: [
          { size: "P", quantity: 4 },
          { size: "M", quantity: 3 }
        ]
      })
    });
    assertStatus(updated, 200, "Grade deveria ser editavel");
    assert.strictEqual(updated.body.product.stock, 7);
    const updatedProductsList = await request(`/api/products?q=${encodeURIComponent(first.body.product.codigo_interno)}&limit=20`, { cookie });
    assertStatus(updatedProductsList, 200, "Listagem cadastral deveria refletir a grade editada");
    assert.strictEqual(updatedProductsList.body.items?.length, 1, "Edicao da grade nao pode recriar cards separados por tamanho.");
    assert.deepStrictEqual(updatedProductsList.body.items?.[0]?.size_stock, [
      { size: "P", quantity: 4 },
      { size: "M", quantity: 3 }
    ]);
    assert.strictEqual(updatedProductsList.body.pagination?.total, 1, "Contador deve continuar representando somente o produto pai.");
    const updatedOperational = await request(`/api/pdv/operational/search/products?q=${encodeURIComponent(first.body.product.codigo_interno)}&store=vila&limit=20`, { cookie });
    assertStatus(updatedOperational, 200, "Busca operacional deveria refletir a edicao absoluta");
    assert.strictEqual(findOperationalSize(updatedOperational.body.items, "P")?.available_in_sale_store_qty, 4, "P deveria virar 4, nao 6.");
    assert.strictEqual(findOperationalSize(updatedOperational.body.items, "G")?.operational_stock_status, "OUT_OF_STOCK_LOCAL", "G removido deveria ficar indisponivel.");

    const reopened = await request(`/api/products/${first.body.product.id}`, { cookie });
    assertStatus(reopened, 200, "Produto deveria reabrir");
    assert.strictEqual(reopened.body.product.stock, 7);
    assert.deepStrictEqual(reopened.body.product.size_stock, [
      { size: "P", quantity: 4 },
      { size: "M", quantity: 3 }
    ]);

    const zeroed = await request(`/api/products/${first.body.product.id}`, {
      method: "PUT",
      cookie,
      body: buildProductPayload(`${suffix}-A`, {
        sku: first.body.product.sku,
        codigo: first.body.product.codigo_interno,
        auto_generate_code: 0,
        size_stock: [
          { size: "P", quantity: 0 },
          { size: "M", quantity: 0 }
        ]
      })
    });
    assertStatus(zeroed, 200, "Grade zerada deveria salvar");
    const zeroOperational = await request(`/api/pdv/operational/search/products?q=${encodeURIComponent(first.body.product.codigo_interno)}&store=vila&limit=20`, { cookie });
    assertStatus(zeroOperational, 200, "Busca operacional deveria reconhecer saldo zero confirmado");
    assert.strictEqual(findOperationalSize(zeroOperational.body.items, "P")?.operational_stock_status, "OUT_OF_STOCK_LOCAL");
    assert.strictEqual(findOperationalSize(zeroOperational.body.items, "M")?.operational_stock_status, "OUT_OF_STOCK_LOCAL");

    console.log(JSON.stringify({
      ok: true,
      automatic_codes: [
        first.body.product.codigo_interno,
        second.body.product.codigo_interno
      ],
      manual_code: manualCode,
      size_stock_total_before_zero: reopened.body.product.stock,
      zero_stock_status: findOperationalSize(zeroOperational.body.items, "P")?.operational_stock_status
    }, null, 2));
  } finally {
    for (const id of createdIds.reverse()) {
      await request(`/api/products/${id}`, { method: "DELETE", cookie });
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
