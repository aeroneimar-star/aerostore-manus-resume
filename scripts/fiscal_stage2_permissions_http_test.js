"use strict";

/**
 * Gate Stage 2 — testes HTTP reais de permissão nas rotas /api/fiscal.
 * Não sobe o server.js completo; monta o fiscalRouter com req.user injetado.
 */

const assert = require("assert");
const http = require("http");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-fiscal-perm-"));
const tempDb = path.join(tempRoot, "test.sqlite");

process.env.DATABASE_PATH = tempDb;
process.env.FISCAL_MODULE_ENABLED = "false";
process.env.FISCAL_DEFAULT_ENVIRONMENT = "homologacao";
process.env.NODE_ENV = "test";

const { initializeDatabase } = require("../db");
const { fiscalRouter } = require("../modules/fiscal");
const { FiscalEstablishmentRepository } = require("../modules/fiscal");

function buildUser(role, permissions) {
  return {
    id: `u_${role}`,
    name: role,
    email: `${role}@teste.local`,
    role,
    permissions
  };
}

const USERS = {
  admin: buildUser("admin", {
    can_view_fiscal: true,
    can_manage_fiscal: true,
    can_manage_global_settings: true
  }),
  manager: buildUser("manager", {
    can_view_fiscal: true,
    can_manage_fiscal: false,
    can_manage_store_settings: true
  }),
  seller: buildUser("seller", {
    can_view_fiscal: false,
    can_manage_fiscal: false,
    can_sell: true
  }),
  cashier: buildUser("cashier", {
    can_view_fiscal: false,
    can_manage_fiscal: false,
    can_open_close_register: true
  }),
  consult: buildUser("consult", {
    can_view_fiscal: false,
    can_manage_fiscal: false,
    can_view_products: true
  })
};

function request(app, { method = "GET", path: urlPath, user, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = body == null ? null : JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: urlPath,
          method,
          headers: {
            "Content-Type": "application/json",
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
          }
        },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => { raw += chunk; });
          res.on("end", () => {
            server.close();
            let data = {};
            try { data = raw ? JSON.parse(raw) : {}; } catch (_e) { data = { raw }; }
            resolve({ status: res.statusCode, data });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      // injeta user via middleware já setado no app
      req.userHint = user;
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function main() {
  await initializeDatabase();
  const establishmentRepository = new FiscalEstablishmentRepository();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // role vem do header de teste
    const role = String(req.headers["x-test-role"] || "seller");
    req.user = USERS[role] || USERS.seller;
    next();
  });
  app.use("/api/fiscal", fiscalRouter);

  function call(role, method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        const payload = body == null ? null : JSON.stringify(body);
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: urlPath,
            method,
            headers: {
              "Content-Type": "application/json",
              "x-test-role": role,
              ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
            }
          },
          (res) => {
            let raw = "";
            res.on("data", (chunk) => { raw += chunk; });
            res.on("end", () => {
              server.close();
              let data = {};
              try { data = raw ? JSON.parse(raw) : {}; } catch (_e) { data = { raw }; }
              resolve({ status: res.statusCode, data });
            });
          }
        );
        req.on("error", (err) => {
          server.close();
          reject(err);
        });
        if (payload) req.write(payload);
        req.end();
      });
    });
  }

  // Admin: consulta + escrita
  const adminStatus = await call("admin", "GET", "/api/fiscal/status");
  assert.strictEqual(adminStatus.status, 200);
  assert.ok(Number(adminStatus.data.stage) >= 2);

  const adminCreate = await call("admin", "POST", "/api/fiscal/establishments", {
    code: "QA_PERM",
    legal_name: "QA Permissao Ltda",
    trade_name: "QA Perm",
    cnpj: "11222333000181",
    uf: "SP",
    environment: "homologacao",
    active: true
  });
  assert.ok([200, 201].includes(adminCreate.status), JSON.stringify(adminCreate.data));
  const estId = adminCreate.data.establishment.id;

  const adminLink = await call("admin", "POST", `/api/fiscal/establishments/${estId}/stores`, {
    store_id: "vila",
    active: true
  });
  assert.ok([200, 201].includes(adminLink.status), JSON.stringify(adminLink.data));

  const adminGaps = await call("admin", "GET", "/api/fiscal/gaps");
  assert.strictEqual(adminGaps.status, 200);

  const adminCoverage = await call("admin", "GET", "/api/fiscal/coverage");
  assert.strictEqual(adminCoverage.status, 200);

  const adminRules = await call("admin", "GET", "/api/fiscal/readiness/rules");
  assert.strictEqual(adminRules.status, 200);

  const adminPayments = await call("admin", "GET", "/api/fiscal/payments/mapping");
  assert.strictEqual(adminPayments.status, 200);

  const adminExport = await call("admin", "GET", "/api/fiscal/sanitation/export.csv");
  assert.strictEqual(adminExport.status, 200);

  // Gestor: consulta OK, escrita 403
  const mgrStatus = await call("manager", "GET", "/api/fiscal/status");
  assert.strictEqual(mgrStatus.status, 200);

  const mgrList = await call("manager", "GET", "/api/fiscal/establishments");
  assert.strictEqual(mgrList.status, 200);

  const mgrGaps = await call("manager", "GET", "/api/fiscal/gaps");
  assert.strictEqual(mgrGaps.status, 200);

  const mgrCoverage = await call("manager", "GET", "/api/fiscal/coverage");
  assert.strictEqual(mgrCoverage.status, 200);

  const mgrExport = await call("manager", "GET", "/api/fiscal/sanitation/export.csv");
  assert.strictEqual(mgrExport.status, 200);

  const mgrCreate = await call("manager", "POST", "/api/fiscal/establishments", {
    legal_name: "Nao deve",
    cnpj: "04252011000110",
    uf: "SP"
  });
  assert.strictEqual(mgrCreate.status, 403);

  const mgrLink = await call("manager", "POST", `/api/fiscal/establishments/${estId}/stores`, {
    store_id: "botanico",
    active: true
  });
  assert.strictEqual(mgrLink.status, 403);

  const mgrProfile = await call("manager", "POST", "/api/fiscal/tax-profiles", {
    code: "SHOULD_FAIL",
    name: "fail"
  });
  assert.strictEqual(mgrProfile.status, 403);

  const mgrBatch = await call("manager", "POST", "/api/fiscal/sanitation/batch-apply", {
    product_refs: ["product:1"],
    profile_code: "X",
    confirm: true
  });
  assert.strictEqual(mgrBatch.status, 403);

  const mgrImport = await call("manager", "POST", "/api/fiscal/sanitation/import-apply", {
    csv: "product_ref,ncm\nproduct:1,61091000\n",
    confirm: true
  });
  assert.strictEqual(mgrImport.status, 403);

  const mgrRuleWrite = await call("manager", "PUT", "/api/fiscal/readiness/rules/GTIN_MISSING", {
    severity: "blocking"
  });
  assert.strictEqual(mgrRuleWrite.status, 403);

  const mgrPayWrite = await call("manager", "PUT", "/api/fiscal/payments/mapping/pix", {
    mapping_status: "confirmed",
    nfce_tpag: "17"
  });
  assert.strictEqual(mgrPayWrite.status, 403);

  // Vendedor / Caixa / Consulta: sem acesso
  for (const role of ["seller", "cashier", "consult"]) {
    const denied = await call(role, "GET", "/api/fiscal/status");
    assert.strictEqual(denied.status, 403, `${role} should be 403`);
    const deniedCoverage = await call(role, "GET", "/api/fiscal/coverage");
    assert.strictEqual(deniedCoverage.status, 403, `${role} coverage should be 403`);
    const deniedWrite = await call(role, "POST", "/api/fiscal/establishments", {
      legal_name: "X",
      cnpj: "11444777000161",
      uf: "SP"
    });
    assert.strictEqual(deniedWrite.status, 403, `${role} write should be 403`);
  }

  // Sanity: estabelecimento criado existe
  const listed = await establishmentRepository.list();
  assert.ok(listed.some((item) => item.id === estId));

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "admin_read_write_link_gaps_coverage_export",
      "manager_read_export_only",
      "manager_write_batch_import_rules_payments_forbidden",
      "seller_cashier_consult_forbidden"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error("[fiscal_stage2_permissions_http_test] FAILED", error);
  process.exit(1);
});
