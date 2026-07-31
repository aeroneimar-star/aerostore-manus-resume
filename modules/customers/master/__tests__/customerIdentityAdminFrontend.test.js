"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..", "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

test("FASE 3.1-G.1 - frente administrativa", async (t) => {
  await t.test("rota e seção dedicada estão registradas", () => {
    assert.match(appSource, /"\/admin\/casos-identidade": "identity-cases-admin"/);
    assert.match(htmlSource, /id="identity-cases-admin-content"/);
    assert.match(htmlSource, /"\/admin\/casos-identidade": "identity-cases-admin"/);
  });

  await t.test("menu e gate visual são exclusivos de ADMIN", () => {
    assert.match(appSource, /Casos de identidade", route: "\/admin\/casos-identidade"/);
    assert.match(appSource, /sectionId === "identity-cases-admin"[\s\S]*getCurrentRole\(\) === "admin"/);
  });

  await t.test("dados são carregados do endpoint real paginado", () => {
    assert.match(appSource, /api\/admin\/customer-identity-cases\?/);
    assert.match(appSource, /pageSize/);
    assert.doesNotMatch(appSource, /identityCasesAdminMock/);
  });

  await t.test("estados obrigatórios aparecem na interface", () => {
    for (const text of [
      "Carregando fila",
      "Nenhum caso encontrado",
      "Sem autorização",
      "concurrencyError",
      "Ação administrativa registrada",
      "filtros ativos"
    ]) {
      assert.equal(appSource.includes(text), true, `estado ausente: ${text}`);
    }
  });

  await t.test("layout preserva leitura responsiva sem tabela larga", () => {
    assert.match(cssSource, /\.identity-cases-workspace/);
    assert.match(cssSource, /@media \(max-width: 720px\)/);
    assert.match(cssSource, /\.identity-case-participants[\s\S]*overflow-y: auto/);
  });
});
