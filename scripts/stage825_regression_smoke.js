"use strict";

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";

const ROUTES = [
  "/settings",
  "/pdv/venda",
  "/pdv/caixa",
  "/pdv/produtos",
  "/pdv/clientes",
  "/pdv/estoque",
  "/pdv/relatorios/cockpit",
  "/whatsapp-crm",
  "/aerointel"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const results = {};

  const health = await fetch(`${BASE_URL}/api/health`);
  assert(health.ok, "Health deveria responder 200.");
  results.health = await health.json().catch(() => ({}));

  for (const route of ROUTES) {
    const response = await fetch(`${BASE_URL}${route}`, { redirect: "manual" });
    results[route] = {
      status: response.status,
      location: response.headers.get("location") || ""
    };
    assert(response.status === 200, `${route} deveria responder 200.`);
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
