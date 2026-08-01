"use strict";

const crypto = require("node:crypto");

class AppProfileError extends Error {
  constructor(code, status = 400, message = "Nao foi possivel atualizar o perfil.") {
    super(message); this.name = "AppProfileError"; this.code = code; this.status = status;
  }
}

function createAppProfileService(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) throw new Error("APP_PROFILE_DB_REQUIRED");
  const secret = String(options.profileSecret || options.pepper || process.env.APP_PROFILE_SECRET || process.env.APP_SESSION_PEPPER || "");
  if (secret.length < 32) throw new Error("APP_PROFILE_SECRET_REQUIRED");
  const clock = options.now || (() => new Date());
  const audit = options.recordAudit || (() => undefined);
  const key = crypto.createHash("sha256").update(`app-profile/v1|${secret}`).digest();
  const hash = (scope, value) => crypto.createHmac("sha256", secret).update(`${scope}/v1|${String(value)}`).digest("base64url");
  const clean = (value, max) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const normalizeEmail = (value) => {
    const email = clean(value, 254).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppProfileError("APP_PROFILE_EMAIL_INVALID", 400, "Informe um e-mail valido.");
    return email;
  };
  const maskEmail = (email) => {
    const [local = "", domain = ""] = String(email || "").split("@");
    return domain ? `${local.slice(0, 1) || "*"}***@${domain}` : "";
  };
  const protect = (value) => {
    if (!value) return "";
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  };
  const safePreferences = (value = {}) => ({
    marketingOptIn: value.marketingOptIn === true,
    styleUpdates: value.styleUpdates === true
  });
  const emit = (action, accountId, extra = {}, result = "success") => Promise.resolve(audit({
    module: "app_profiles", action, entityType: "app_customer_profile", entityId: accountId,
    result, includeBody: false, metadata: { accountId, ...extra }
  }));

  function effectiveStatus(account) {
    return account.account_status === "ACTIVE" ? account.access_status : account.account_status;
  }

  function statusPolicy(status) {
    const policies = {
      PENDING_PHONE_VERIFICATION: [true, "PHONE_VERIFICATION_REQUIRED"],
      PENDING_APPROVAL: [false, "ACCESS_REVIEW_PENDING"],
      APPROVED: [true, "CATALOG_AVAILABLE"],
      REJECTED: [true, "CONTACT_SUPPORT"],
      SUSPENDED: [true, "CONTACT_SUPPORT"],
      BLOCKED: [true, "CONTACT_SUPPORT"],
      CLOSED: [true, "ACCOUNT_UNAVAILABLE"]
    };
    return policies[status] || [true, "ACCOUNT_UNAVAILABLE"];
  }

  async function getAccessStatus(context) {
    const row = await db.get(
      `SELECT a.account_status, a.access_status, a.phone_verified_at, a.updated_at,
              r.status AS request_status,
              EXISTS(SELECT 1 FROM app_customer_links l WHERE l.account_id=a.id AND l.link_status='ACTIVE') AS has_active_master_link
         FROM app_customer_accounts a
         LEFT JOIN app_access_requests r ON r.id=(
           SELECT r2.id FROM app_access_requests r2 WHERE r2.account_id=a.id ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1
         )
        WHERE a.id=?`,
      [context.account.id]
    );
    if (!row) throw new AppProfileError("APP_ACCOUNT_NOT_FOUND", 404, "Conta nao encontrada.");
    const status = effectiveStatus(row); const [requiresAction, safeReasonCode] = statusPolicy(status);
    if (status !== context.payload.access_status) await emit("APP_ACCESS_STATUS_CHANGED_OBSERVED", context.account.id, { previousStatus: context.payload.access_status, currentStatus: status });
    if (status === "CLOSED") {
      const now = clock().toISOString();
      await db.run("UPDATE app_sessions SET status='REVOKED',revoked_at=?,revoke_reason='ACCOUNT_CLOSED',updated_at=? WHERE id=? AND status='ACTIVE'", [now, now, context.session.id]);
      await emit("APP_SESSION_CLOSED_ACCOUNT_STATUS", context.account.id, { sessionId: context.session.id });
    }
    return {
      accountStatus: row.account_status,
      accessStatus: row.access_status,
      effectiveStatus: status,
      phoneVerified: Boolean(row.phone_verified_at),
      hasActiveMasterLink: Boolean(row.has_active_master_link),
      requestStatus: row.request_status || null,
      updatedAt: row.updated_at,
      canViewCatalog: status === "APPROVED",
      requiresAction,
      safeReasonCode,
      permissions: { canViewProfile: !["BLOCKED", "CLOSED"].includes(status), canEditProfile: ["PENDING_APPROVAL", "APPROVED"].includes(status), canViewCatalog: status === "APPROVED" }
    };
  }

  async function profileRow(accountId) {
    return db.get(
      `SELECT p.id,p.account_id,p.display_name,p.full_name,p.email_lookup_hash,p.email_masked,p.preferences_json,p.profile_status,p.version,p.created_at,p.updated_at,
              a.phone_masked,a.account_status,a.access_status,
              EXISTS(SELECT 1 FROM app_customer_links l WHERE l.account_id=a.id AND l.link_status='ACTIVE') AS has_active_master_link
         FROM app_customer_profiles p JOIN app_customer_accounts a ON a.id=p.account_id WHERE p.account_id=?`,
      [accountId]
    );
  }

  function dto(row) {
    return {
      displayName: row.display_name,
      fullName: row.full_name,
      email: row.email_masked,
      emailMasked: row.email_masked,
      phoneMasked: row.phone_masked,
      accountStatus: row.account_status,
      accessStatus: row.access_status,
      hasActiveMasterLink: Boolean(row.has_active_master_link),
      profileStatus: row.profile_status,
      profileComplete: row.profile_status === "COMPLETE",
      primaryAddressConsolidated: false,
      preferences: JSON.parse(row.preferences_json || "{}"),
      version: Number(row.version),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async function getProfile(context) {
    let row = await profileRow(context.account.id);
    if (!row) {
      const now = clock().toISOString(); const id = crypto.randomUUID();
      await db.run(
        `INSERT OR IGNORE INTO app_customer_profiles
          (id,account_id,display_name,full_name,email_lookup_hash,email_protected,email_masked,preferences_json,profile_status,version,created_at,updated_at)
         SELECT ?,a.id,'','',a.email_lookup_hash,'',a.email_masked,'{}','INCOMPLETE',1,?,?
           FROM app_customer_accounts a WHERE a.id=?`,
        [id, now, now, context.account.id]
      );
      row = await profileRow(context.account.id);
      if (row?.id === id) await emit("APP_PROFILE_CREATED", context.account.id, { version: 1 });
    }
    return dto(row);
  }

  async function updateProfile(context, input = {}) {
    const allowed = new Set(["displayName", "fullName", "email", "preferences", "version"]);
    const forbidden = Object.keys(input).filter((keyName) => !allowed.has(keyName));
    if (forbidden.length) {
      await emit("APP_PROFILE_UPDATE_REJECTED", context.account.id, { reasonCode: "FIELD_NOT_ALLOWED", fields: forbidden.map(() => "[REDACTED]") }, "rejected");
      throw new AppProfileError("APP_PROFILE_FIELD_NOT_ALLOWED", 400, "Este dado nao pode ser alterado pelo aplicativo.");
    }
    const current = await getProfile(context); const internalCurrent = await profileRow(context.account.id);
    const displayName = clean(input.displayName ?? current.displayName, 60);
    const fullName = clean(input.fullName ?? current.fullName, 120);
    if (fullName && fullName.length < 3) { await emit("APP_PROFILE_UPDATE_REJECTED", context.account.id, { reasonCode: "APP_PROFILE_NAME_INVALID" }, "rejected"); throw new AppProfileError("APP_PROFILE_NAME_INVALID", 400, "Informe um nome valido."); }
    let email = "";
    try { email = Object.prototype.hasOwnProperty.call(input, "email") ? normalizeEmail(input.email) : ""; }
    catch (error) { await emit("APP_PROFILE_UPDATE_REJECTED", context.account.id, { reasonCode: error.code || "VALIDATION_FAILED" }, "rejected"); throw error; }
    const emailMasked = Object.prototype.hasOwnProperty.call(input, "email") ? maskEmail(email) : current.emailMasked;
    const preferences = safePreferences(input.preferences ?? current.preferences);
    const profileStatus = fullName && emailMasked ? "COMPLETE" : "INCOMPLETE";
    const emailChanged = Object.prototype.hasOwnProperty.call(input, "email") && (email ? hash("email", email) : "") !== internalCurrent.email_lookup_hash;
    const unchanged = displayName === current.displayName && fullName === current.fullName && !emailChanged
      && JSON.stringify(preferences) === JSON.stringify(safePreferences(current.preferences));
    if (unchanged) return current;
    if (Number(input.version) !== current.version) {
      await emit("APP_PROFILE_UPDATE_REJECTED", context.account.id, { reasonCode: "VERSION_CONFLICT", expectedVersion: input.version, currentVersion: current.version }, "rejected");
      throw new AppProfileError("APP_PROFILE_VERSION_CONFLICT", 409, "Seu perfil mudou desde a ultima leitura. Atualize e tente novamente.");
    }
    const now = clock().toISOString();
    await db.run("BEGIN IMMEDIATE");
    try {
      const result = await db.run(
        `UPDATE app_customer_profiles SET display_name=?,full_name=?,
          email_lookup_hash=CASE WHEN ? THEN ? ELSE email_lookup_hash END,
          email_protected=CASE WHEN ? THEN ? ELSE email_protected END,
          email_masked=?,preferences_json=?,profile_status=?,version=version+1,updated_at=?
         WHERE account_id=? AND version=?`,
        [displayName, fullName, Object.prototype.hasOwnProperty.call(input, "email") ? 1 : 0, email ? hash("email", email) : "",
          Object.prototype.hasOwnProperty.call(input, "email") ? 1 : 0, protect(email), emailMasked, JSON.stringify(preferences), profileStatus, now, context.account.id, current.version]
      );
      if (Number(result.changes) !== 1) throw new AppProfileError("APP_PROFILE_VERSION_CONFLICT", 409, "Seu perfil mudou durante a atualizacao.");
      await db.run("COMMIT");
    } catch (error) {
      await db.run("ROLLBACK").catch(() => null);
      if (error instanceof AppProfileError) await emit("APP_PROFILE_UPDATE_REJECTED", context.account.id, { reasonCode: error.code }, "rejected");
      throw error;
    }
    const updated = await profileRow(context.account.id);
    await emit("APP_PROFILE_UPDATED", context.account.id, { beforeVersion: current.version, afterVersion: Number(updated.version), changedFields: [displayName !== current.displayName ? "displayName" : null, fullName !== current.fullName ? "fullName" : null, emailMasked !== current.emailMasked ? "email" : null, JSON.stringify(preferences) !== JSON.stringify(current.preferences) ? "preferences" : null].filter(Boolean) });
    return dto(updated);
  }

  return { getAccessStatus, getProfile, updateProfile };
}

module.exports = { AppProfileError, createAppProfileService };
