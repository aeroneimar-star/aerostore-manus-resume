"use strict";

const crypto = require("node:crypto");
const { evaluateAppCustomerEligibility } = require("./evaluateAppCustomerEligibility");
const { sanitizeAdministrativeText } = require("../master/admin/customerIdentityAdminService");

class AppCustomerAccessError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AppCustomerAccessError";
    this.code = code;
    this.status = status;
  }
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length < 10 || local.length > 11) throw new AppCustomerAccessError("INVALID_PHONE", "Celular invalido.");
  return `55${local}`;
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? `+55 (***) *****-${digits.slice(-4)}` : "***";
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppCustomerAccessError("INVALID_EMAIL", "E-mail invalido.");
  return email;
}

function maskEmail(value) {
  const [local = "", domain = ""] = String(value || "").split("@");
  if (!domain) return "";
  return `${local.slice(0, 1) || "*"}***@${domain}`;
}

function maskDocument(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 ? `***.***.***-${digits.slice(-2)}` : "***";
}

function validateAndSanitizeRegistration(profile = {}) {
  const fullName = String(profile.fullName || profile.name || "").trim().replace(/\s+/g, " ");
  if (fullName.length < 5 || !fullName.includes(" ")) throw new AppCustomerAccessError("INVALID_FULL_NAME", "Nome completo obrigatorio.");
  const email = normalizeEmail(profile.email);
  if (!email) throw new AppCustomerAccessError("INVALID_EMAIL", "E-mail obrigatorio.");
  const phone = normalizePhone(profile.whatsappPhone || profile.phone);
  const cpf = String(profile.cpf || "").replace(/\D/g, "");
  if (cpf.length !== 11) throw new AppCustomerAccessError("INVALID_CPF", "CPF invalido.");
  const cep = String(profile.cep || "").replace(/\D/g, "");
  if (cep.length !== 8) throw new AppCustomerAccessError("INVALID_CEP", "CEP invalido.");
  const required = ["street", "neighborhood", "city", "state", "number"];
  for (const field of required) {
    if (!String(profile[field] || "").trim()) throw new AppCustomerAccessError("INVALID_ADDRESS", "Endereco incompleto.");
  }
  const initials = fullName.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 4).join("").toUpperCase();
  const protectedPayload = {
    schemaVersion: "app-registration-profile/v1",
    fullNameInitials: initials,
    fullNameHash: stableHash(fullName.toLocaleLowerCase("pt-BR")),
    emailMasked: maskEmail(email),
    emailHash: stableHash(email),
    phoneMasked: maskPhone(phone),
    phoneHash: stableHash(phone),
    cpfMasked: maskDocument(cpf),
    cpfHash: stableHash(cpf),
    cepMasked: `*****-${cep.slice(-3)}`,
    cepHash: stableHash(cep),
    city: String(profile.city).trim().slice(0, 80),
    state: String(profile.state).trim().toUpperCase().slice(0, 2),
    addressFingerprint: stableHash(required.map((field) => String(profile[field] || "").trim().toLowerCase()).join("|")),
    complementPresent: Boolean(String(profile.complement || "").trim()),
    deliveryNotesPresent: Boolean(String(profile.deliveryNotes || "").trim())
  };
  return { phone, email, protectedPayload };
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(String(value || "")) || fallback; } catch { return fallback; }
}

function normalizeRole(actor = {}) {
  const role = String(actor.role_key || actor.role || "").trim().toLowerCase();
  if (["admin", "master", "administrator", "administrador"].includes(role)) return "ADMIN";
  if (["manager", "gerente", "gestor", "supervisor"].includes(role)) return "SUPERVISOR";
  return "OTHER";
}

function createAppCustomerAccessService(dbApi) {
  if (!dbApi || ["run", "get", "all"].some((method) => typeof dbApi[method] !== "function")) {
    throw new Error("APP_CUSTOMER_ACCESS_DB_REQUIRED");
  }

  async function getCore(accountId) {
    return dbApi.get(
      `SELECT a.id, a.phone_masked, a.phone_verified_at, a.email_masked,
              a.account_status, a.access_status, a.version, a.created_at, a.updated_at,
              a.suspended_at, a.blocked_at, a.closed_at,
              r.id AS request_id, r.request_type, r.status AS request_status,
              r.submitted_profile_json, r.submitted_at, r.reviewed_at,
              r.current_decision_id, r.version AS request_version
         FROM app_customer_accounts a
         JOIN app_access_requests r ON r.account_id = a.id
        WHERE a.id = ?
        ORDER BY r.created_at DESC LIMIT 1`,
      [String(accountId)]
    );
  }

  async function getDetail(accountId) {
    const row = await getCore(accountId);
    if (!row) throw new AppCustomerAccessError("APP_CUSTOMER_NOT_FOUND", "Conta do app nao encontrada.", 404);
    const links = await dbApi.all(
      `SELECT l.id, l.master_id, l.link_status, l.link_type, l.reason_code, l.confidence,
              l.created_at, l.updated_at, l.revoked_at, m.status AS master_status,
              m.eligibility_status AS master_eligibility_status
         FROM app_customer_links l
         JOIN customer_master_records m ON m.id = l.master_id
        WHERE l.account_id = ? ORDER BY l.created_at ASC`,
      [row.id]
    );
    const decisions = await dbApi.all(
      `SELECT id, decision_type, actor_user_id, actor_role, reason, before_json, after_json, created_at
         FROM app_access_decisions WHERE account_id = ? ORDER BY created_at DESC, id DESC`,
      [row.id]
    );
    const masters = links.map((link) => link.master_id);
    let blockingConflicts = [];
    if (masters.length) {
      const placeholders = masters.map(() => "?").join(",");
      blockingConflicts = await dbApi.all(
        `SELECT DISTINCT c.id, c.conflict_type, c.severity, c.status
           FROM customer_identity_conflicts c
           JOIN customer_identity_conflict_participants p ON p.conflict_id = c.id
          WHERE p.participant_type = 'MASTER' AND p.participant_id IN (${placeholders})
            AND c.status NOT IN ('RESOLVED', 'ARCHIVED')
          ORDER BY c.severity DESC, c.conflict_type ASC`,
        masters
      );
    }
    return {
      id: row.id,
      phoneMasked: row.phone_masked,
      phoneVerified: Boolean(row.phone_verified_at),
      emailMasked: row.email_masked,
      accountStatus: row.account_status,
      accessStatus: row.access_status,
      version: Number(row.version),
      request: {
        id: row.request_id,
        type: row.request_type,
        status: row.request_status,
        version: Number(row.request_version),
        submittedProfile: safeJson(row.submitted_profile_json),
        submittedAt: row.submitted_at,
        reviewedAt: row.reviewed_at
      },
      links: links.map((link) => ({
        id: link.id, masterId: link.master_id, linkStatus: link.link_status,
        linkType: link.link_type, reasonCode: link.reason_code, confidence: Number(link.confidence),
        masterStatus: link.master_status, masterEligibilityStatus: link.master_eligibility_status
      })),
      blockingConflicts: blockingConflicts.map((conflict) => ({
        id: conflict.id, type: conflict.conflict_type, severity: conflict.severity, status: conflict.status
      })),
      decisions: decisions.map((decision) => ({
        id: decision.id, type: decision.decision_type, actorUserId: decision.actor_user_id,
        actorRole: decision.actor_role, reason: decision.reason, createdAt: decision.created_at,
        before: safeJson(decision.before_json), after: safeJson(decision.after_json)
      }))
    };
  }

  async function listPending(filters = {}) {
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize || 25)));
    const where = ["1 = 1"];
    const params = [];
    if (filters.status) { where.push("a.access_status = ?"); params.push(String(filters.status)); }
    else where.push("a.access_status IN ('PENDING_PHONE_VERIFICATION', 'PENDING_APPROVAL', 'REJECTED')");
    if (filters.type) { where.push("r.request_type = ?"); params.push(String(filters.type)); }
    if (filters.dateFrom) { where.push("r.submitted_at >= ?"); params.push(String(filters.dateFrom)); }
    if (filters.dateTo) { where.push("r.submitted_at <= ?"); params.push(String(filters.dateTo)); }
    const clause = where.join(" AND ");
    const total = Number((await dbApi.get(
      `SELECT COUNT(*) AS total FROM app_customer_accounts a JOIN app_access_requests r ON r.account_id = a.id WHERE ${clause}`,
      params
    ))?.total || 0);
    const rows = await dbApi.all(
      `SELECT a.id, a.phone_masked, a.email_masked, a.account_status, a.access_status, a.version,
              r.id AS request_id, r.request_type, r.status AS request_status, r.submitted_at
         FROM app_customer_accounts a JOIN app_access_requests r ON r.account_id = a.id
        WHERE ${clause} ORDER BY r.submitted_at ASC, a.id ASC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    return {
      rows: rows.map((row) => ({
        id: row.id, phoneMasked: row.phone_masked, emailMasked: row.email_masked,
        accountStatus: row.account_status, accessStatus: row.access_status, version: Number(row.version),
        requestId: row.request_id, requestType: row.request_type, requestStatus: row.request_status,
        submittedAt: row.submitted_at
      })),
      pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
    };
  }

  async function createAccountAndRequest(input = {}) {
    const now = String(input.now || new Date().toISOString());
    const requestType = String(input.requestType || "NEW_CUSTOMER_REGISTRATION");
    let normalized;
    if (requestType === "NEW_CUSTOMER_REGISTRATION") normalized = validateAndSanitizeRegistration(input.profile || {});
    else {
      const phone = normalizePhone(input.phone || input.profile?.phone);
      const email = normalizeEmail(input.email || input.profile?.email || "");
      normalized = { phone, email, protectedPayload: { schemaVersion: "app-access-profile/v1", phoneMasked: maskPhone(phone), emailMasked: maskEmail(email), phoneHash: stableHash(phone), emailHash: email ? stableHash(email) : "" } };
    }
    const accountId = String(input.accountId || crypto.randomUUID());
    const requestId = String(input.requestId || crypto.randomUUID());
    await dbApi.run("BEGIN IMMEDIATE");
    try {
      await dbApi.run(
        `INSERT INTO app_customer_accounts (
          id, phone_lookup_hash, phone_masked, phone_verified_at, email_lookup_hash, email_masked,
          account_status, access_status, version, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?, 'ACTIVE', 'PENDING_PHONE_VERIFICATION', 1, ?, ?)`,
        [accountId, stableHash(normalized.phone), maskPhone(normalized.phone), normalized.email ? stableHash(normalized.email) : "", maskEmail(normalized.email), now, now]
      );
      await dbApi.run(
        `INSERT INTO app_access_requests (
          id, account_id, request_type, status, submitted_profile_json, submitted_at, version, created_at, updated_at
        ) VALUES (?, ?, ?, 'PENDING_PHONE_VERIFICATION', ?, ?, 1, ?, ?)`,
        [requestId, accountId, requestType, JSON.stringify(normalized.protectedPayload), now, now, now]
      );
      await dbApi.run("COMMIT");
    } catch (error) {
      await dbApi.run("ROLLBACK").catch(() => null);
      throw error;
    }
    return getDetail(accountId);
  }

  async function addCandidateLink(accountId, masterId, input = {}) {
    const now = String(input.now || new Date().toISOString());
    const id = String(input.id || crypto.randomUUID());
    await dbApi.run(
      `INSERT INTO app_customer_links (
        id, account_id, master_id, link_status, link_type, reason_code, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, String(accountId), String(masterId), String(input.linkStatus || "PENDING_REVIEW"), String(input.linkType || "MASTER_CANDIDATE"), String(input.reasonCode || ""), Number(input.confidence || 0), now, now]
    );
    return getDetail(accountId);
  }

  async function decide(accountId, action, actor = {}, input = {}) {
    const role = normalizeRole(actor);
    const operation = String(action || "").toUpperCase();
    if (role === "OTHER") throw new AppCustomerAccessError("APP_CUSTOMER_FORBIDDEN", "Acesso administrativo negado.", 403);
    if (["SUSPEND", "REACTIVATE", "BLOCK"].includes(operation) && role !== "ADMIN") {
      throw new AppCustomerAccessError("APP_CUSTOMER_ADMIN_REQUIRED", "Acao exclusiva de Administrador.", 403);
    }
    const reason = sanitizeAdministrativeText(input.reason || "");
    const reasonRequired = role === "SUPERVISOR" || ["REJECT", "SUSPEND", "REACTIVATE", "BLOCK"].includes(operation);
    if (reasonRequired && !reason) throw new AppCustomerAccessError("APP_CUSTOMER_REASON_REQUIRED", "Motivo obrigatorio.", 400);
    const current = await getCore(accountId);
    if (!current) throw new AppCustomerAccessError("APP_CUSTOMER_NOT_FOUND", "Conta do app nao encontrada.", 404);
    const already = (
      (operation === "APPROVE" && current.access_status === "APPROVED")
      || (operation === "REJECT" && current.access_status === "REJECTED")
      || (operation === "SUSPEND" && current.account_status === "SUSPENDED")
      || (operation === "REACTIVATE" && current.account_status === "ACTIVE")
      || (operation === "BLOCK" && current.account_status === "BLOCKED")
    );
    if (already) return getDetail(accountId);
    if (Number(input.expectedVersion) !== Number(current.version)) {
      throw new AppCustomerAccessError("APP_CUSTOMER_VERSION_CONFLICT", "A conta mudou desde a ultima leitura.", 409);
    }
    const now = String(input.now || new Date().toISOString());
    const before = { accountStatus: current.account_status, accessStatus: current.access_status, version: Number(current.version) };
    let nextAccountStatus = current.account_status;
    let nextAccessStatus = current.access_status;
    let requestStatus = current.request_status;
    let decisionType;
    let selectedLink = null;
    if (operation === "APPROVE") {
      if (!current.phone_verified_at) throw new AppCustomerAccessError("PHONE_NOT_VERIFIED", "Telefone ainda nao confirmado.", 409);
      const links = await dbApi.all(
        `SELECT l.id, l.master_id, l.link_status, m.status AS master_status, m.deleted_at
           FROM app_customer_links l JOIN customer_master_records m ON m.id = l.master_id
          WHERE l.account_id = ? ORDER BY l.created_at ASC`, [current.id]
      );
      const chosenMasterId = String(input.masterId || "");
      selectedLink = links.find((link) => String(link.master_id) === chosenMasterId)
        || (links.length === 1 ? links[0] : null);
      if (!selectedLink) throw new AppCustomerAccessError("VALID_LINK_REQUIRED", "Selecione um unico vinculo mestre valido.", 409);
      const conflicts = await dbApi.all(
        `SELECT c.conflict_type,
                CASE WHEN c.severity = 'BLOCKING' OR EXISTS (
                  SELECT 1 FROM customer_identity_case_conflicts cc
                  JOIN customer_identity_cases ic ON ic.id = cc.case_id
                  WHERE cc.conflict_id = c.id AND ic.blocking = 1
                ) THEN 1 ELSE 0 END AS blocking
           FROM customer_identity_conflicts c
           JOIN customer_identity_conflict_participants p ON p.conflict_id = c.id
          WHERE p.participant_type = 'MASTER' AND p.participant_id = ? AND c.status NOT IN ('RESOLVED', 'ARCHIVED')`,
        [selectedLink.master_id]
      );
      const conflictingActiveLink = links.find((link) => link.link_status === "ACTIVE" && link.master_id !== selectedLink.master_id);
      if (conflictingActiveLink) {
        throw new AppCustomerAccessError("MULTIPLE_ACTIVE_LINKS", "A conta ja possui outro vinculo ativo.", 409);
      }
      const eligibility = evaluateAppCustomerEligibility({
        phoneConfirmed: true,
        masterCandidates: [{ id: selectedLink.master_id, status: selectedLink.master_status, deletedAt: selectedLink.deleted_at }],
        conflicts,
        accountStatus: current.account_status,
        links: links.filter((link) => link.link_status === "ACTIVE").map((link) => ({ masterId: link.master_id, linkStatus: link.link_status }))
      });
      if (!eligibility.autoApprovalEligible && conflicts.length) {
        throw new AppCustomerAccessError("BLOCKING_CONFLICT_REVIEW_REQUIRED", "Conflitos impedem a aprovacao.", 409);
      }
      if (selectedLink.master_status !== "ACTIVE" || selectedLink.deleted_at) {
        throw new AppCustomerAccessError("MASTER_INELIGIBLE", "Mestre inativo ou excluido.", 409);
      }
      nextAccessStatus = "APPROVED";
      requestStatus = "APPROVED";
      decisionType = role === "ADMIN" ? "ADMIN_APPROVED" : "SUPERVISOR_APPROVED";
    } else if (operation === "REJECT") {
      nextAccessStatus = "REJECTED"; requestStatus = "REJECTED";
      decisionType = role === "ADMIN" ? "ADMIN_REJECTED" : "SUPERVISOR_REJECTED";
    } else if (operation === "SUSPEND") {
      nextAccountStatus = "SUSPENDED"; decisionType = "ADMIN_SUSPENDED";
    } else if (operation === "REACTIVATE") {
      nextAccountStatus = "ACTIVE"; decisionType = "ADMIN_REACTIVATED";
    } else if (operation === "BLOCK") {
      nextAccountStatus = "BLOCKED"; decisionType = "ADMIN_BLOCKED";
    } else throw new AppCustomerAccessError("INVALID_APP_CUSTOMER_ACTION", "Acao invalida.");

    const decisionId = crypto.randomUUID();
    const nextVersion = Number(current.version) + 1;
    const after = { accountStatus: nextAccountStatus, accessStatus: nextAccessStatus, version: nextVersion };
    const idempotencyKey = stableHash([current.id, current.request_id, operation, current.version, selectedLink?.master_id || ""].join("|"));
    await dbApi.run("BEGIN IMMEDIATE");
    try {
      const update = await dbApi.run(
        `UPDATE app_customer_accounts SET account_status = ?, access_status = ?, version = ?, updated_at = ?,
          suspended_at = CASE WHEN ? = 'SUSPENDED' THEN ? WHEN ? = 'ACTIVE' THEN NULL ELSE suspended_at END,
          blocked_at = CASE WHEN ? = 'BLOCKED' THEN ? ELSE blocked_at END
         WHERE id = ? AND version = ?`,
        [nextAccountStatus, nextAccessStatus, nextVersion, now, nextAccountStatus, now, nextAccountStatus, nextAccountStatus, now, current.id, current.version]
      );
      if (Number(update.changes) !== 1) throw new AppCustomerAccessError("APP_CUSTOMER_VERSION_CONFLICT", "A conta mudou durante a decisao.", 409);
      await dbApi.run(
        `INSERT INTO app_access_decisions (
          id, request_id, account_id, decision_type, actor_user_id, actor_role, reason,
          before_json, after_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [decisionId, current.request_id, current.id, decisionType, String(actor.id || ""), role, reason, JSON.stringify(before), JSON.stringify(after), idempotencyKey, now]
      );
      if (operation === "APPROVE") {
        await dbApi.run(
          `UPDATE app_customer_links SET link_status = 'ACTIVE', updated_at = ?, decided_by = ?, decision_id = ?
            WHERE id = ? AND account_id = ?`, [now, String(actor.id || ""), decisionId, selectedLink.id, current.id]
        );
      }
      await dbApi.run(
        `UPDATE app_access_requests SET status = ?, reviewed_at = ?, current_decision_id = ?,
          version = version + 1, updated_at = ? WHERE id = ?`,
        [requestStatus, now, decisionId, now, current.request_id]
      );
      await dbApi.run("COMMIT");
    } catch (error) {
      await dbApi.run("ROLLBACK").catch(() => null);
      throw error;
    }
    return getDetail(accountId);
  }

  return { listPending, getDetail, createAccountAndRequest, addCandidateLink, decide };
}

module.exports = {
  AppCustomerAccessError,
  createAppCustomerAccessService,
  validateAndSanitizeRegistration,
  normalizePhone,
  maskPhone,
  maskEmail,
  maskDocument,
  stableHash,
  sanitizeAdministrativeText
};
