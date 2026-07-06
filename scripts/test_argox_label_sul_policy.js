"use strict";

const {
  DEFAULT_LABEL_HEADER,
  SUL_LABEL_HEADER,
  SUL_LABEL_PRINT_ALLOWLIST,
  resolveLabelHeaderText,
  canPrintSulStoreLabel,
  assertCanPrintSulStoreLabel
} = require("../modules/pdv/services/argoxLabelStorePolicy");
const {
  buildFullLabelImageSpec,
  buildFullLabelNormalSampleAgentItems,
  buildFullLabelSulSampleAgentItems,
  buildFullLabelOsklenSampleAgentItems
} = require("../agente-impressao-argox/lib/fullLabelDriver");

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: esperado "${expected}", recebido "${actual}"`);
  }
}

function assertThrows(fn, expectedMessage, message) {
  try {
    fn();
    throw new Error(`${message}: deveria lançar erro.`);
  } catch (error) {
    if (error.message !== expectedMessage) {
      throw new Error(`${message}: mensagem esperada "${expectedMessage}", recebida "${error.message}"`);
    }
    if (error.statusCode !== 403) {
      throw new Error(`${message}: statusCode esperado 403, recebido ${error.statusCode}`);
    }
  }
}

function assertDoesNotThrow(fn, message) {
  try {
    fn();
  } catch (error) {
    throw new Error(`${message}: não deveria lançar erro (${error.message}).`);
  }
}

function readBrandHeader(imageSpec = {}) {
  const brand = (imageSpec.elements || []).find((item) => item.role === "brand");
  if (!brand) {
    throw new Error("Elemento brand ausente no layout.");
  }
  return brand.text;
}

function readProductName(imageSpec = {}) {
  const name = (imageSpec.elements || []).find((item) => item.role === "name");
  if (!name) {
    throw new Error("Elemento name ausente no layout.");
  }
  return name.text;
}

function testHeaderRules() {
  assertEqual(resolveLabelHeaderText("vila"), DEFAULT_LABEL_HEADER, "A) loja normal");
  assertEqual(resolveLabelHeaderText("botanico"), DEFAULT_LABEL_HEADER, "A) botanico");

  const osklen = buildFullLabelImageSpec({ items: buildFullLabelOsklenSampleAgentItems() });
  assertEqual(readBrandHeader(osklen.imageSpec), DEFAULT_LABEL_HEADER, "B) Osklen em loja normal");
  if (!/osklen/i.test(readProductName(osklen.imageSpec))) {
    throw new Error("B) nome do produto deveria conter Osklen.");
  }

  const sul = buildFullLabelImageSpec({ items: buildFullLabelSulSampleAgentItems() });
  assertEqual(readBrandHeader(sul.imageSpec), SUL_LABEL_HEADER, "C) loja Sul");

  const normal = buildFullLabelImageSpec({ items: buildFullLabelNormalSampleAgentItems() });
  assertEqual(readBrandHeader(normal.imageSpec), DEFAULT_LABEL_HEADER, "A) dry-run loja normal");
}

function testPermissions() {
  assertThrows(
    () => assertCanPrintSulStoreLabel({ id: 99, email: "seller@aerostore.local" }, "sul"),
    "Você não tem permissão para imprimir etiquetas da loja Sul.",
    "D) usuário não autorizado"
  );

  assertDoesNotThrow(
    () => assertCanPrintSulStoreLabel({ id: 1, email: "admin@aerostore.local" }, "sul"),
    "E) Neimar/admin"
  );
  assertDoesNotThrow(
    () => assertCanPrintSulStoreLabel({ id: 10, email: "stela@aerostore.local" }, "sul"),
    "E) Stela"
  );

  assertDoesNotThrow(
    () => assertCanPrintSulStoreLabel({ id: 99, email: "seller@aerostore.local" }, "vila"),
    "Loja normal não deve exigir allowlist"
  );

  if (!canPrintSulStoreLabel({ id: 1 })) {
    throw new Error("Allowlist por id=1 deveria permitir.");
  }
  if (!canPrintSulStoreLabel({ email: "stela@aerostore.local" })) {
    throw new Error("Allowlist por email Stela deveria permitir.");
  }
  if (canPrintSulStoreLabel({ id: 2, email: "manager@aerostore.local", role: "admin" })) {
    throw new Error("Outro admin não deve entrar na allowlist Sul.");
  }
}

function testPdvRealSulPayload() {
  const { buildLabelPreview } = require("../modules/pdv/services/pdvLabelPrintService");
  const user = { id: 1, email: "admin@aerostore.local", role: "admin" };
  return buildLabelPreview({
    product_id: "299",
    variation_id: "VAR_120A35F2524241EC8F35C68C8EE6D80D",
    store_id: "sul",
    loja: "sul"
  }, user).then((preview) => {
    assertEqual(preview.product.store_id, "sul", "PDV real Sul store_id");
    assertEqual(preview.label_debug.label_header, SUL_LABEL_HEADER, "PDV real Sul label_header");
    assertEqual(preview.agent_payload.marca, SUL_LABEL_HEADER, "PDV real Sul agent_payload.marca");
    const brand = (preview.preview_elements || []).find((item) => item.role === "brand");
    assertEqual(brand?.text, SUL_LABEL_HEADER, "PDV real Sul header renderizado");
    return preview.label_debug;
  });
}

async function main() {
  testHeaderRules();
  testPermissions();
  const pdvDebug = await testPdvRealSulPayload();
  console.log("Argox label Sul policy tests passed.");
  console.log(JSON.stringify({
    default_header: DEFAULT_LABEL_HEADER,
    sul_header: SUL_LABEL_HEADER,
    allowlist: SUL_LABEL_PRINT_ALLOWLIST,
    resolved_users: [
      { id: 1, email: "admin@aerostore.local", name: "Neimar" },
      { id: 10, email: "stela@aerostore.local", name: "Stela" }
    ],
    pdv_real_payload_debug: pdvDebug
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
