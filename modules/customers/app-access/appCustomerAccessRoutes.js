"use strict";

const express = require("express");
const {
  AppCustomerAccessError,
  createAppCustomerAccessService,
  sanitizeAdministrativeText
} = require("./appCustomerAccessService");

function roleOf(user = {}) {
  const role = String(user.role_key || user.role || "").trim().toLowerCase();
  if (["admin", "master", "administrator", "administrador"].includes(role)) return "ADMIN";
  if (["manager", "gerente", "gestor", "supervisor"].includes(role)) return "SUPERVISOR";
  return "OTHER";
}

function canReview(user = {}) {
  return roleOf(user) === "ADMIN"
    || (roleOf(user) === "SUPERVISOR" && Boolean(user.permissions?.can_review_app_customers));
}

function sendError(res, error) {
  if (error instanceof AppCustomerAccessError) {
    return res.status(error.status).json({ error: error.code, message: error.message });
  }
  return res.status(500).json({ error: "APP_CUSTOMER_ACCESS_INTERNAL_ERROR", message: "Falha no fluxo administrativo do app." });
}

function createAppCustomerAccessRouter({ dbApi, recordAudit } = {}) {
  const service = createAppCustomerAccessService(dbApi);
  const router = express.Router();
  router.use((req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (!canReview(req.user)) return res.status(403).json({ error: "APP_CUSTOMER_REVIEW_FORBIDDEN" });
    return next();
  });

  router.get("/pending", async (req, res) => {
    try { res.json(await service.listPending(req.query || {})); } catch (error) { sendError(res, error); }
  });
  router.get("/:id", async (req, res) => {
    try { res.json({ customer: await service.getDetail(req.params.id) }); } catch (error) { sendError(res, error); }
  });

  for (const action of ["approve", "reject", "suspend", "reactivate", "block"]) {
    router.post(`/:id/${action}`, async (req, res) => {
      try {
        const customer = await service.decide(req.params.id, action, req.user, req.body || {});
        if (typeof recordAudit === "function") {
          await Promise.resolve(recordAudit({
            req,
            module: "app_customer_access",
            action: `app_customer_${action}`,
            entityType: "app_customer_account",
            entityId: req.params.id,
            result: "success",
            reason: sanitizeAdministrativeText(req.body?.reason || ""),
            message: "Decisao administrativa de acesso ao app registrada.",
            includeBody: false,
            metadata: { accountStatus: customer.accountStatus, accessStatus: customer.accessStatus, version: customer.version }
          }));
        }
        res.json({ customer });
      } catch (error) { sendError(res, error); }
    });
  }
  return router;
}

function createAppCustomerReviewPermissionHandler({ dbApi, recordAudit } = {}) {
  return async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "AUTH_REQUIRED" });
      if (roleOf(req.user) !== "ADMIN") return res.status(403).json({ error: "ADMIN_REQUIRED" });
      const target = await dbApi.get("SELECT id, role, permissions_json FROM users WHERE id = ? LIMIT 1", [req.params.id]);
      if (!target) return res.status(404).json({ error: "USER_NOT_FOUND" });
      let permissions = {};
      try { permissions = JSON.parse(String(target.permissions_json || "{}")) || {}; } catch { permissions = {}; }
      const enabled = req.body?.enabled === true;
      const next = { ...permissions, can_review_app_customers: enabled };
      await dbApi.run("UPDATE users SET permissions_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(next), new Date().toISOString(), target.id]);
      if (typeof recordAudit === "function") {
        await Promise.resolve(recordAudit({
          req, module: "app_customer_access", action: enabled ? "grant_review_permission" : "revoke_review_permission",
          entityType: "user", entityId: String(target.id), result: "success", includeBody: false,
          message: "Permissao individual de revisao de clientes do app atualizada.",
          metadata: { permission: "can_review_app_customers", enabled }
        }));
      }
      return res.json({ userId: target.id, permission: "can_review_app_customers", enabled });
    } catch (error) {
      return res.status(500).json({ error: "APP_CUSTOMER_PERMISSION_UPDATE_FAILED" });
    }
  };
}

module.exports = {
  createAppCustomerAccessRouter,
  createAppCustomerReviewPermissionHandler,
  canReview,
  roleOf
};
