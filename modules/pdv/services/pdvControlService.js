"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { normalizeStoreKey, storesMatch, isActiveOperationalStore, isLegacyOperationalStore } = require("../utils/pdvStoreUtils");

const controlRootDir = path.join(process.cwd(), "data", "pdv", "control");
const controlFiles = {
  cashRegisters: path.join(controlRootDir, "cash-registers.json"),
  authorizations: path.join(controlRootDir, "authorization-pins.json"),
  auditLogs: path.join(controlRootDir, "audit-logs.json"),
  authorizers: path.join(controlRootDir, "authorizers.json"),
  authorizationAudit: path.join(controlRootDir, "authorization-audit.json")
};

const USER_ROLES = {
  vendedor: "VENDEDOR",
  seller: "VENDEDOR",
  gerente: "GERENTE",
  manager: "GERENTE",
  admin: "ADMIN"
};

const AUTHORIZATION_TYPES = [
  "DISCOUNT_OVERRIDE",
  "PERMUTA_APPROVAL",
  "SALE_CANCELLATION",
  "CASHBACK_ADJUSTMENT",
  "REOPEN_CASH_REGISTER",
  "REOPEN_SALE"
];

const AUTHORIZATION_OPERATION_TYPES = [
  "DISCOUNT_ABOVE_LIMIT",
  "ITEM_DISCOUNT_ABOVE_LIMIT",
  "SALE_DISCOUNT_ABOVE_LIMIT",
  "PERMUTA_AUTHORIZATION",
  "REGISTER_REOPEN",
  "SALE_CANCEL"
];

const CASH_MOVEMENT_TYPES = [
  "SALE",
  "SANGRIA",
  "SUPRIMENTO",
  "DESPESA",
  "AJUSTE",
  "EXCHANGE"
];

const CASH_REGISTER_STATUS = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  REOPENED: "REOPENED",
  CANCELLED: "CANCELLED"
};

const DISCOUNT_REASONS = [
  "QUEIMA",
  "CLIENTE_VIP",
  "PECA_PARADA",
  "DEFEITO",
  "NEGOCIACAO",
  "ACAO_GERENTE",
  "OUTRO"
];

const TOTP_ISSUER = "AEROSTORE OS";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const TOTP_DIGITS = 6;
const TOTP_SECRET_BYTES = 20;
const AUTHORIZATION_APPROVAL_TTL_MINUTES = 5;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const AUTOMATIC_DISCOUNT_ALLOWED_METHODS = new Set(["pix", "dinheiro"]);
const DISCOUNT_CONTEXT_IGNORED_METHODS = new Set(["cashback", "credito_troca"]);
const DISCOUNT_PAYMENT_METHOD_LABELS = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  debito: "Debito",
  debit: "Debito",
  cartao_debito: "Debito",
  credito: "Credito",
  credit: "Credito",
  cartao_credito: "Credito",
  credito_ate_10x: "Credito ate 10x",
  link_pagamento: "Link pagamento",
  vale_presente: "Vale-presente",
  credito_troca: "Credito troca",
  permuta: "Permuta"
};

function getSensitiveSecretSeed() {
  return String(
    process.env.PDV_TOTP_SECRET
    || process.env.AUTH_SECRET
    || process.env.APP_SECRET
    || process.env.CASHBACK_PIN_PEPPER
    || "aerostore-pdv-totp-local-secret"
  );
}

function getSensitiveCipherKey() {
  return crypto.createHash("sha256").update(getSensitiveSecretSeed()).digest();
}

function ensureControlDirs() {
  fs.mkdirSync(controlRootDir, { recursive: true });
  Object.values(controlFiles).forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]", "utf8");
    }
  });
}

function readJson(filePath, fallback = []) {
  ensureControlDirs();
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureControlDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(date, minutes) {
  const parsed = new Date(date);
  parsed.setMinutes(parsed.getMinutes() + minutes);
  return parsed.toISOString();
}

function buildId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeDiscountPaymentMethod(method = "") {
  const normalized = normalizeText(method || "").toLowerCase();
  if (!normalized) return "";
  if (["cash", "money"].includes(normalized)) return "dinheiro";
  if (["debit", "cartao_debito"].includes(normalized)) return "debito";
  if (["credit", "cartao_credito"].includes(normalized)) return "credito";
  return normalized;
}

function getDiscountPaymentMethodLabel(method = "") {
  const normalized = normalizeDiscountPaymentMethod(method);
  return DISCOUNT_PAYMENT_METHOD_LABELS[normalized] || formatMethodLabel(normalized);
}

function formatMethodLabel(method = "") {
  return normalizeText(method || "")
    .split("_")
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : "")
    .join(" ");
}

function uniqueStrings(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizeText(value || "");
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function getDiscountRelevantPaymentMethods(paymentMethods = []) {
  return uniqueStrings((paymentMethods || []).map((item) => {
    if (typeof item === "string") {
      const method = normalizeDiscountPaymentMethod(item);
      return DISCOUNT_CONTEXT_IGNORED_METHODS.has(method) ? "" : method;
    }
    if (!item || typeof item !== "object") {
      return "";
    }
    const method = normalizeDiscountPaymentMethod(item.method || item.value || "");
    if (!method || DISCOUNT_CONTEXT_IGNORED_METHODS.has(method)) {
      return "";
    }
    if (Object.prototype.hasOwnProperty.call(item, "amount") && roundMoney(item.amount || 0) <= 0) {
      return "";
    }
    return method;
  }).filter(Boolean));
}

function isAutomaticDiscountAllowedPaymentMethod(method = "") {
  return AUTOMATIC_DISCOUNT_ALLOWED_METHODS.has(normalizeDiscountPaymentMethod(method));
}

function getDiscountPolicyForSale({ paymentMethods = [], discountAmount = 0, discountPercent = 0, itemDiscountAmount = 0, discountBase = 0, subtotal = 0 } = {}) {
  const methods = getDiscountRelevantPaymentMethods(paymentMethods);
  const invalidMethods = methods.filter((method) => !isAutomaticDiscountAllowedPaymentMethod(method));
  const hasItemDiscount = roundMoney(itemDiscountAmount || 0) > 0;
  const generalDiscountAmount = roundMoney(discountAmount || 0);
  const policyBase = roundMoney(discountBase || 0);
  const hasGeneralDiscount = generalDiscountAmount > 0;
  const normalizedPercent = policyBase > 0
    ? Number(((generalDiscountAmount / policyBase) * 100).toFixed(2))
    : Number(toNumber(discountPercent || 0).toFixed(2));
  const automaticLimitAmount = roundMoney((policyBase * 10) / 100);
  const hasDiscount = hasItemDiscount || hasGeneralDiscount || normalizedPercent > 0;
  const generalWithinAutomaticPolicy = hasGeneralDiscount
    && methods.length > 0
    && !invalidMethods.length
    && generalDiscountAmount <= automaticLimitAmount + 0.01;
  const generalRequiresAuthorization = hasGeneralDiscount
    && !generalWithinAutomaticPolicy
    && !(!methods.length && normalizedPercent <= 10.001);
  const invalidMethodsLabel = invalidMethods.map((method) => getDiscountPaymentMethodLabel(method)).join(" + ");

  if (!hasDiscount) {
    return {
      limitPercent: 10,
      reason: "NO_DISCOUNT",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: false,
      requiresAuthorization: false,
      allowedWithoutAuthorization: true,
      message: "Sem desconto aplicado.",
      policyBase,
      automaticLimitAmount,
      generalDiscountPercent: normalizedPercent,
      generalWithinAutomaticPolicy,
      generalRequiresAuthorization: false,
      generalExceptionAmount: 0,
      authorizationAmount: 0,
      authorizationPercent: 0
    };
  }

  if (hasItemDiscount) {
    const generalExceptionAmount = roundMoney(generalRequiresAuthorization ? generalDiscountAmount : 0);
    const authorizationAmount = roundMoney(itemDiscountAmount + generalExceptionAmount);
    const authorizationPercent = subtotal > 0 ? Number(((authorizationAmount / subtotal) * 100).toFixed(2)) : 0;
    return {
      limitPercent: 10,
      reason: generalRequiresAuthorization && invalidMethods.length ? "ITEM_DISCOUNT_SPECIAL_WITH_NON_CASH_METHOD" : "ITEM_DISCOUNT_SPECIAL",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: hasGeneralDiscount && !methods.length,
      requiresAuthorization: true,
      allowedWithoutAuthorization: false,
      message: generalRequiresAuthorization && invalidMethods.length
        ? "Este desconto e permitido apenas para PIX ou dinheiro."
        : generalRequiresAuthorization
          ? "Autorizacao gerencial necessaria para desconto especial."
          : generalWithinAutomaticPolicy
            ? "Desconto de PIX/dinheiro dentro da politica."
            : "Autorizacao gerencial necessaria para desconto especial.",
      policyBase,
      automaticLimitAmount,
      generalDiscountPercent: normalizedPercent,
      generalWithinAutomaticPolicy,
      generalRequiresAuthorization,
      generalExceptionAmount,
      authorizationAmount,
      authorizationPercent
    };
  }

  if (normalizedPercent > 10.001) {
    return {
      limitPercent: 10,
      reason: methods.length ? "DISCOUNT_ABOVE_LIMIT" : "DISCOUNT_ABOVE_LIMIT_PENDING_PAYMENT_METHOD",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: !methods.length,
      requiresAuthorization: true,
      allowedWithoutAuthorization: false,
      message: "Autorizacao gerencial necessaria para desconto especial.",
      policyBase,
      automaticLimitAmount,
      generalDiscountPercent: normalizedPercent,
      generalWithinAutomaticPolicy,
      generalRequiresAuthorization: true,
      generalExceptionAmount: generalDiscountAmount,
      authorizationAmount: generalDiscountAmount,
      authorizationPercent: subtotal > 0 ? Number(((generalDiscountAmount / subtotal) * 100).toFixed(2)) : normalizedPercent
    };
  }

  if (!methods.length) {
    return {
      limitPercent: 10,
      reason: "PENDING_PAYMENT_METHOD",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: true,
      requiresAuthorization: false,
      allowedWithoutAuthorization: false,
      message: "Escolha a forma de pagamento para validar este desconto.",
      policyBase,
      automaticLimitAmount,
      generalDiscountPercent: normalizedPercent,
      generalWithinAutomaticPolicy,
      generalRequiresAuthorization: false,
      generalExceptionAmount: 0,
      authorizationAmount: 0,
      authorizationPercent: 0
    };
  }

  if (!invalidMethods.length) {
    return {
      limitPercent: 10,
      reason: "PIX_DINHEIRO_10",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: false,
      requiresAuthorization: false,
      allowedWithoutAuthorization: true,
      message: "Desconto de PIX/dinheiro dentro da politica.",
      policyBase,
      automaticLimitAmount,
      generalDiscountPercent: normalizedPercent,
      generalWithinAutomaticPolicy,
      generalRequiresAuthorization: false,
      generalExceptionAmount: 0,
      authorizationAmount: 0,
      authorizationPercent: 0
    };
  }

  return {
    limitPercent: 10,
    reason: "MANAGER_AUTH_REQUIRED_NON_CASH_METHOD",
    paymentMethods: methods,
    invalidMethods,
    invalidMethodsLabel,
    pendingPaymentMethod: false,
    requiresAuthorization: true,
    allowedWithoutAuthorization: false,
    message: "Este desconto e permitido apenas para PIX ou dinheiro.",
    policyBase,
    automaticLimitAmount,
    generalDiscountPercent: normalizedPercent,
    generalWithinAutomaticPolicy,
    generalRequiresAuthorization: true,
    generalExceptionAmount: generalDiscountAmount,
    authorizationAmount: generalDiscountAmount,
    authorizationPercent: subtotal > 0 ? Number(((generalDiscountAmount / subtotal) * 100).toFixed(2)) : normalizedPercent
  };
}

function buildDiscountAuthorizationError(policy = {}) {
  if (policy.pendingPaymentMethod && !policy.requiresAuthorization) {
    return "Escolha a forma de pagamento para validar este desconto.";
  }
  if (policy.invalidMethods?.length) {
    return "Este desconto e permitido apenas para PIX ou dinheiro.";
  }
  return "Autorizacao gerencial necessaria para desconto especial.";
}

function paymentMethodSetsMatch(left = [], right = []) {
  const normalizedLeft = getDiscountRelevantPaymentMethods(left).sort();
  const normalizedRight = getDiscountRelevantPaymentMethods(right).sort();
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function getPdvUserRole(user = {}) {
  const rawRole = String(user?.role || user?.perfil || "vendedor").trim().toLowerCase();
  return USER_ROLES[rawRole] || "VENDEDOR";
}

function getRolePriority(role) {
  if (role === "ADMIN") return 3;
  if (role === "GERENTE") return 2;
  return 1;
}

function requireMinimumRole(user, role) {
  const current = getPdvUserRole(user);
  if (getRolePriority(current) < getRolePriority(role)) {
    throw new Error(`Ação permitida apenas para ${role} ou superior.`);
  }
  return current;
}

function loadCashRegisters() {
  return readJson(controlFiles.cashRegisters, []);
}

function saveCashRegisters(rows) {
  writeJson(controlFiles.cashRegisters, rows);
}

function loadAuthorizations() {
  return readJson(controlFiles.authorizations, []);
}

function saveAuthorizations(rows) {
  writeJson(controlFiles.authorizations, rows);
}

function loadAuditLogs() {
  return readJson(controlFiles.auditLogs, []);
}

function saveAuditLogs(rows) {
  writeJson(controlFiles.auditLogs, rows.slice(0, 10000));
}

function loadAuthorizers() {
  return readJson(controlFiles.authorizers, []);
}

function saveAuthorizers(rows) {
  writeJson(controlFiles.authorizers, rows);
}

function loadAuthorizationAudit() {
  return readJson(controlFiles.authorizationAudit, []);
}

function saveAuthorizationAudit(rows) {
  writeJson(controlFiles.authorizationAudit, rows.slice(0, 10000));
}

function appendAuditLog(entry) {
  const logs = loadAuditLogs();
  logs.unshift(entry);
  saveAuditLogs(logs);
}

function appendAuthorizationAudit(entry) {
  const rows = loadAuthorizationAudit();
  rows.unshift(entry);
  saveAuthorizationAudit(rows);
}

function encryptSensitiveValue(value = "") {
  const plaintext = String(value || "");
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSensitiveCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64")
  });
}

function decryptSensitiveValue(payload = "") {
  const raw = String(payload || "").trim();
  if (!raw) return "";
  const parsed = JSON.parse(raw);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getSensitiveCipherKey(),
    Buffer.from(String(parsed.iv || ""), "base64")
  );
  decipher.setAuthTag(Buffer.from(String(parsed.tag || ""), "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(String(parsed.value || ""), "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function base32Encode(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(value = "") {
  const input = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let current = 0;
  const output = [];
  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(TOTP_SECRET_BYTES));
}

function buildTotpCounter(counter = null) {
  const safeCounter = Number.isFinite(counter)
    ? Math.floor(counter)
    : Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000));
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(safeCounter));
  return buffer;
}

function generateTotpCode(secret = "", counter = null) {
  const key = base32Decode(secret);
  const hmac = crypto.createHmac("sha1", key).update(buildTotpCounter(counter)).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

function verifyTotpCode(secret = "", code = "", { window = TOTP_WINDOW } = {}) {
  const normalizedCode = normalizeText(code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(normalizedCode)) {
    return { ok: false, counter: null };
  }
  const currentCounter = Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000));
  for (let delta = -window; delta <= window; delta += 1) {
    const counter = currentCounter + delta;
    const expected = generateTotpCode(secret, counter);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalizedCode))) {
      return { ok: true, counter };
    }
  }
  return { ok: false, counter: null };
}

function buildTotpUri({ secret = "", name = "" } = {}) {
  const label = `${TOTP_ISSUER} - ${normalizeText(name || "Autorizador")}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

async function generateTotpSetupBundle(name = "") {
  const secret = generateTotpSecret();
  const otpAuthUrl = buildTotpUri({ secret, name });
  const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240
  });
  return {
    secret,
    otpAuthUrl,
    qrCodeDataUrl,
    manualEntryKey: secret
  };
}

function sanitizeAuthorizer(authorizer = {}) {
  return {
    authorizer_id: authorizer.authorizer_id,
    name: normalizeText(authorizer.name || ""),
    role: normalizeText(authorizer.role || ""),
    notes: normalizeText(authorizer.notes || ""),
    linked_user_email: normalizeText(authorizer.linked_user_email || ""),
    linked_user_id: normalizeText(authorizer.linked_user_id || ""),
    is_active: Boolean(authorizer.is_active),
    created_at: authorizer.created_at || "",
    activated_at: authorizer.activated_at || "",
    last_used_at: authorizer.last_used_at || "",
    created_by: normalizeText(authorizer.created_by || ""),
    deactivated_at: authorizer.deactivated_at || ""
  };
}

function listAuthorizers({ activeOnly = false } = {}) {
  return loadAuthorizers()
    .filter((item) => !activeOnly || item.is_active)
    .map(sanitizeAuthorizer)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "pt-BR"));
}

async function createOrRefreshAuthorizer(payload = {}, user = {}) {
  requireMinimumRole(user, "ADMIN");
  const name = normalizeText(payload.name || "");
  if (!name) {
    throw new Error("Informe o nome do autorizador.");
  }
  const role = normalizeText(payload.role || "AUTORIZADOR");
  const notes = normalizeText(payload.notes || "");
  const linkedUserEmail = normalizeText(payload.linked_user_email || payload.user_email || "");
  const linkedUserId = normalizeText(payload.linked_user_id || payload.user_id || "");
  const authorizers = loadAuthorizers();
  const existing = authorizers.find((item) => normalizeText(item.name || "").toLowerCase() === name.toLowerCase());
  const setup = await generateTotpSetupBundle(name);
  const now = nowIso();
  const entry = existing || {
    authorizer_id: buildId("AUT"),
    created_at: now,
    created_by: user?.name || user?.email || "sistema"
  };
  entry.name = name;
  entry.role = role;
  entry.notes = notes;
  entry.linked_user_email = linkedUserEmail;
  entry.linked_user_id = linkedUserId;
  entry.totp_secret_encrypted = encryptSensitiveValue(setup.secret);
  entry.totp_algorithm = "SHA1";
  entry.totp_digits = TOTP_DIGITS;
  entry.totp_period = TOTP_PERIOD_SECONDS;
  entry.is_active = false;
  entry.activated_at = "";
  entry.deactivated_at = "";
  entry.updated_at = now;
  entry.last_used_at = entry.last_used_at || "";
  entry.last_approved_counter = null;
  if (!existing) {
    authorizers.unshift(entry);
  }
  saveAuthorizers(authorizers);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: existing ? "AUTHORIZER_RESET" : "AUTHORIZER_CREATED",
    created_at: now,
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: "",
    reason: notes,
    before: existing ? sanitizeAuthorizer(existing) : null,
    after: sanitizeAuthorizer(entry)
  });
  return {
    authorizer: sanitizeAuthorizer(entry),
    setup: {
      qr_code_data_url: setup.qrCodeDataUrl,
      otp_auth_url: setup.otpAuthUrl,
      manual_entry_key: setup.manualEntryKey
    }
  };
}

function verifyAuthorizerSetup(authorizerId = "", code = "", user = {}) {
  requireMinimumRole(user, "ADMIN");
  const authorizers = loadAuthorizers();
  const entry = authorizers.find((item) => item.authorizer_id === normalizeText(authorizerId || ""));
  if (!entry) {
    throw new Error("Autorizador nao encontrado.");
  }
  const secret = decryptSensitiveValue(entry.totp_secret_encrypted || "");
  const verification = verifyTotpCode(secret, code, { window: TOTP_WINDOW });
  if (!verification.ok) {
    throw new Error("Codigo invalido ou expirado.");
  }
  entry.is_active = true;
  entry.activated_at = nowIso();
  entry.updated_at = nowIso();
  saveAuthorizers(authorizers);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "AUTHORIZER_ACTIVATED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: "",
    reason: "",
    before: null,
    after: sanitizeAuthorizer(entry)
  });
  return sanitizeAuthorizer(entry);
}

async function resetAuthorizerTotp(authorizerId = "", user = {}) {
  requireMinimumRole(user, "ADMIN");
  const authorizers = loadAuthorizers();
  const entry = authorizers.find((item) => item.authorizer_id === normalizeText(authorizerId || ""));
  if (!entry) {
    throw new Error("Autorizador nao encontrado.");
  }
  const setup = await generateTotpSetupBundle(entry.name || "Autorizador");
  entry.totp_secret_encrypted = encryptSensitiveValue(setup.secret);
  entry.is_active = false;
  entry.activated_at = "";
  entry.updated_at = nowIso();
  entry.last_approved_counter = null;
  saveAuthorizers(authorizers);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "AUTHORIZER_SECRET_RESET",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: "",
    reason: "",
    before: null,
    after: sanitizeAuthorizer(entry)
  });
  return {
    authorizer: sanitizeAuthorizer(entry),
    setup: {
      qr_code_data_url: setup.qrCodeDataUrl,
      otp_auth_url: setup.otpAuthUrl,
      manual_entry_key: setup.manualEntryKey
    }
  };
}

function setAuthorizerStatus(authorizerId = "", isActive = true, user = {}) {
  requireMinimumRole(user, "ADMIN");
  const authorizers = loadAuthorizers();
  const entry = authorizers.find((item) => item.authorizer_id === normalizeText(authorizerId || ""));
  if (!entry) {
    throw new Error("Autorizador nao encontrado.");
  }
  if (isActive && !entry.activated_at) {
    throw new Error("Ative o autorizador com o primeiro codigo antes de liberar uso.");
  }
  entry.is_active = Boolean(isActive);
  entry.updated_at = nowIso();
  entry.deactivated_at = entry.is_active ? "" : nowIso();
  saveAuthorizers(authorizers);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: entry.is_active ? "AUTHORIZER_ENABLED" : "AUTHORIZER_DISABLED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: "",
    reason: "",
    before: null,
    after: sanitizeAuthorizer(entry)
  });
  return sanitizeAuthorizer(entry);
}

function getDiscountLimitForSale({ paymentMethods = [], discountAmount = 0, discountPercent = 0, itemDiscountAmount = 0, discountBase = 0, subtotal = 0 } = {}) {
  return getDiscountPolicyForSale({
    paymentMethods,
    discountAmount,
    discountPercent,
    itemDiscountAmount,
    discountBase,
    subtotal
  });
}

function validateOperationAuthorization(payload = {}, user = {}) {
  const authorizerId = normalizeText(payload.authorizer_id || "");
  const operationType = normalizeText(payload.operation_type || "").toUpperCase();
  const reason = normalizeText(payload.reason || "");
  const saleSessionId = normalizeText(payload.sale_session_id || "");
  const saleId = normalizeText(payload.sale_id || "");
  const code = normalizeText(payload.code || "").replace(/\D/g, "");
  const amount = roundMoney(payload.amount || 0);
  const percent = Number(toNumber(payload.percent || 0).toFixed(2));
  const metadata = payload.context && typeof payload.context === "object" ? payload.context : {};
  if (!AUTHORIZATION_OPERATION_TYPES.includes(operationType)) {
    throw new Error("Operacao sensivel invalida para autorizacao.");
  }
  if (!authorizerId) {
    throw new Error("Selecione um autorizador.");
  }
  if (!reason) {
    throw new Error("Informe o motivo da autorizacao.");
  }
  const authorizers = loadAuthorizers();
  const authorizer = authorizers.find((item) => item.authorizer_id === authorizerId);
  if (!authorizer || !authorizer.is_active) {
    throw new Error("Autorizador indisponivel para uso.");
  }
  const secret = decryptSensitiveValue(authorizer.totp_secret_encrypted || "");
  const verification = verifyTotpCode(secret, code, { window: TOTP_WINDOW });
  const attempt = {
    authorization_id: buildId("AUTZ"),
    operation_type: operationType,
    sale_session_id: saleSessionId,
    sale_id: saleId,
    requested_by_user_id: normalizeText(user?.id || user?.user_id || ""),
    requested_by_name: normalizeText(user?.name || user?.email || "sistema"),
    authorized_by_id: authorizer.authorizer_id,
    authorized_by_name: authorizer.name,
    amount,
    percent,
    reason,
    status: verification.ok ? "APPROVED" : "INVALID",
    created_at: nowIso(),
    expires_at: addMinutes(nowIso(), AUTHORIZATION_APPROVAL_TTL_MINUTES),
    used_at: "",
    ip: normalizeText(payload.ip || ""),
    user_agent: normalizeText(payload.user_agent || ""),
    metadata_json: metadata,
    totp_counter: verification.counter
  };
  if (!verification.ok) {
    appendAuthorizationAudit(attempt);
    appendAuditLog({
      audit_id: buildId("AUD"),
      action: "DISCOUNT_AUTH_INVALID",
      created_at: nowIso(),
      actor: attempt.requested_by_name,
      actor_role: getPdvUserRole(user),
      loja: normalizeStoreKey(payload.loja || metadata.loja || ""),
      reason,
      before: null,
      after: {
        operation_type: operationType,
        authorized_by_name: authorizer.name,
        status: "INVALID"
      }
    });
    throw new Error("Codigo invalido ou expirado.");
  }
  const reusedApproval = loadAuthorizationAudit().find((item) =>
    item.status === "APPROVED"
    && item.authorized_by_id === authorizer.authorizer_id
    && item.operation_type === operationType
    && item.sale_session_id === saleSessionId
    && Number(item.totp_counter || -1) === Number(verification.counter)
  );
  if (reusedApproval) {
    throw new Error("Esta autorizacao ja foi usada nesta operacao.");
  }
  authorizer.last_used_at = nowIso();
  authorizer.last_approved_counter = verification.counter;
  authorizer.updated_at = nowIso();
  saveAuthorizers(authorizers);
  appendAuthorizationAudit(attempt);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "DISCOUNT_AUTH_APPROVED",
    created_at: nowIso(),
    actor: attempt.requested_by_name,
    actor_role: getPdvUserRole(user),
    loja: normalizeStoreKey(payload.loja || metadata.loja || ""),
    reason,
    before: null,
    after: {
      authorization_id: attempt.authorization_id,
      operation_type: operationType,
      authorized_by_name: authorizer.name,
      amount,
      percent,
      status: "APPROVED"
    }
  });
  return {
    authorization_id: attempt.authorization_id,
    status: attempt.status,
    authorized_by_id: attempt.authorized_by_id,
    authorized_by_name: attempt.authorized_by_name,
    operation_type: attempt.operation_type,
    reason: attempt.reason,
    amount: attempt.amount,
    percent: attempt.percent,
    created_at: attempt.created_at,
    expires_at: attempt.expires_at
  };
}

function compareAuthorizedNumber(actual = 0, expected = 0, label = "valor") {
  if (roundMoney(actual) !== roundMoney(expected)) {
    throw new Error(`Autorizacao emitida para outro ${label}.`);
  }
}

function normalizeAuthorizationPaymentAmounts(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((item) => ({
      method: normalizeDiscountPaymentMethod(item?.method || ""),
      amount: roundMoney(item?.amount || 0)
    }))
    .filter((item) => item.method && item.amount > 0)
    .sort((left, right) => left.method.localeCompare(right.method) || left.amount - right.amount);
}

function paymentAmountSetsMatch(left = [], right = []) {
  const normalizedLeft = normalizeAuthorizationPaymentAmounts(left);
  const normalizedRight = normalizeAuthorizationPaymentAmounts(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((item, index) =>
    item.method === normalizedRight[index].method
    && Math.abs(item.amount - normalizedRight[index].amount) <= 0.01
  );
}

function consumeValidatedAuthorization({
  authorizationId = "",
  operationType = "",
  saleSessionId = "",
  saleId = "",
  amount = 0,
  percent = 0,
  paymentMethods = [],
  paymentAmounts = [],
  subtotal = 0,
  cashbackApplied = 0,
  amountToPay = 0,
  paidAmount = 0
} = {}, user = {}) {
  const rows = loadAuthorizationAudit();
  const entry = rows.find((item) => item.authorization_id === normalizeText(authorizationId || ""));
  if (!entry) {
    throw new Error("Autorizacao nao encontrada.");
  }
  if (entry.status !== "APPROVED") {
    throw new Error("Autorizacao invalida para concluir a operacao.");
  }
  if (entry.used_at) {
    throw new Error("Autorizacao ja utilizada.");
  }
  if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
    entry.status = "EXPIRED";
    saveAuthorizationAudit(rows);
    throw new Error("Autorizacao expirada. Gere uma nova aprovacao.");
  }
  if (normalizeText(operationType || "").toUpperCase() !== normalizeText(entry.operation_type || "").toUpperCase()) {
    throw new Error("Autorizacao emitida para outra operacao.");
  }
  if (normalizeText(saleSessionId || "") && normalizeText(entry.sale_session_id || "") !== normalizeText(saleSessionId || "")) {
    throw new Error("Autorizacao emitida para outra sessao de venda.");
  }
  if (normalizeText(saleId || "") && normalizeText(entry.sale_id || "") && normalizeText(entry.sale_id || "") !== normalizeText(saleId || "")) {
    throw new Error("Autorizacao emitida para outra venda.");
  }
  if (roundMoney(amount) > roundMoney(entry.amount || 0) + 0.01 || Number(percent || 0) > Number(entry.percent || 0) + 0.01) {
    throw new Error("Autorizacao insuficiente para o desconto solicitado.");
  }
  if (entry.metadata_json && Object.prototype.hasOwnProperty.call(entry.metadata_json, "subtotal")) {
    compareAuthorizedNumber(subtotal, entry.metadata_json.subtotal, "subtotal");
  }
  entry.status = "CONSUMED";
  entry.used_at = nowIso();
  entry.used_by = normalizeText(user?.name || user?.email || "sistema");
  saveAuthorizationAudit(rows);
  return entry;
}

function getOpenCashRegisterByStore(store = "") {
  const normalizedStore = normalizeStoreKey(store);
  return loadCashRegisters().find((item) =>
    storesMatch(item.loja, normalizedStore)
    && [CASH_REGISTER_STATUS.OPEN, CASH_REGISTER_STATUS.REOPENED].includes(item.status)
  ) || null;
}

function getCashRegisterById(cashRegisterId = "") {
  return loadCashRegisters().find((item) => item.cash_register_id === String(cashRegisterId || "").trim()) || null;
}

function issueAuthorizationPin(payload = {}, user = {}) {
  const userRole = requireMinimumRole(user, "GERENTE");
  const type = normalizeText(payload.type || "").toUpperCase();
  if (!AUTHORIZATION_TYPES.includes(type)) {
    throw new Error("Tipo de autorização do PDV inválido.");
  }
  const authorizations = loadAuthorizations();
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const entry = {
    authorization_id: buildId("PIN"),
    code: pin,
    type,
    status: "ACTIVE",
    loja: normalizeStoreKey(payload.loja || ""),
    reason: normalizeText(payload.reason || ""),
    context: payload.context || {},
    issued_by: user?.name || user?.email || "sistema",
    issued_role: userRole,
    issued_at: nowIso(),
    expires_at: addMinutes(nowIso(), 5),
    used_at: "",
    used_by: ""
  };
  authorizations.unshift(entry);
  saveAuthorizations(authorizations);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "PIN_ISSUED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: userRole,
    loja: entry.loja,
    reason: entry.reason,
    before: null,
    after: entry
  });
  return entry;
}

function validateAuthorizationPin({ code = "", type = "", loja = "", context = {} } = {}, user = {}) {
  const normalizedCode = normalizeText(code);
  const normalizedType = normalizeText(type).toUpperCase();
  if (!normalizedCode || !normalizedType) {
    throw new Error("Informe PIN e tipo de autorização do PDV.");
  }
  const authorizations = loadAuthorizations();
  const entry = authorizations.find((item) =>
    String(item.code || "") === normalizedCode
    && String(item.type || "") === normalizedType
    && item.status === "ACTIVE"
  );
  if (!entry) {
    throw new Error("PIN temporário inválido ou já utilizado.");
  }
  if (entry.loja && loja && normalizeStoreKey(entry.loja) !== normalizeStoreKey(loja)) {
    throw new Error("PIN temporário emitido para outra loja.");
  }
  if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
    entry.status = "EXPIRED";
    saveAuthorizations(authorizations);
    throw new Error("PIN temporário expirado.");
  }
  entry.status = "USED";
  entry.used_at = nowIso();
  entry.used_by = user?.name || user?.email || "sistema";
  entry.used_context = context || {};
  saveAuthorizations(authorizations);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "PIN_USED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: entry.loja,
    reason: entry.reason,
    before: { status: "ACTIVE" },
    after: { ...entry }
  });
  return entry;
}

function openCashRegister(payload = {}, user = {}) {
  const role = getPdvUserRole(user);
  const loja = normalizeStoreKey(payload.loja || "");
  if (!loja) {
    throw new Error("Informe a loja para abrir o caixa do PDV.");
  }
  if (!isActiveOperationalStore(loja)) {
    throw new Error("Selecione uma loja operacional ativa para abrir o caixa.");
  }
  const existingOpenRegister = getOpenCashRegisterByStore(loja);
  if (existingOpenRegister) {
    if (isLegacyOperationalStore(existingOpenRegister.loja)) {
      throw new Error("Este caixa pertence a uma loja legada/inativa. Use apenas para conferencia historica.");
    }
    throw new Error("Já existe um caixa aberto para esta loja.");
  }
  const cashRegisters = loadCashRegisters();
  const entry = {
    cash_register_id: buildId("CX"),
    loja,
    operador: normalizeText(payload.operador || user?.name || user?.email || "sistema"),
    operator_role: role,
    status: CASH_REGISTER_STATUS.OPEN,
    valor_inicial: roundMoney(payload.valor_inicial || 0),
    observacao: normalizeText(payload.observacao || ""),
    criado_em: nowIso(),
    confirmado_em: "",
    reaberto_em: "",
    fechado_em: "",
    closed_by: "",
    reopen_reason: "",
    linked_sales: 0,
    movements: []
  };
  cashRegisters.unshift(entry);
  saveCashRegisters(cashRegisters);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "OPEN_CASH_REGISTER",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: role,
    loja,
    reason: entry.observacao,
    before: null,
    after: entry
  });
  return entry;
}

function registerCashMovement({ cashRegisterId = "", type = "", value = 0, reason = "", observation = "", payload = {}, requireManager = false } = {}, user = {}) {
  const normalizedType = normalizeText(type).toUpperCase();
  if (!CASH_MOVEMENT_TYPES.includes(normalizedType)) {
    throw new Error("Tipo de movimentação de caixa do PDV inválido.");
  }
  if (normalizedType !== "SALE" && roundMoney(value) <= 0) {
    throw new Error("Movimentações operacionais do caixa exigem valor maior que zero.");
  }
  if (requireManager) {
    requireMinimumRole(user, "GERENTE");
  }
  const cashRegisters = loadCashRegisters();
  const register = cashRegisters.find((item) => item.cash_register_id === String(cashRegisterId || "").trim());
  if (!register) {
    throw new Error("Caixa do PDV não encontrado.");
  }
  if (register.status !== CASH_REGISTER_STATUS.OPEN && register.status !== CASH_REGISTER_STATUS.REOPENED) {
    throw new Error("Movimentação permitida apenas em caixa aberto.");
  }
  const movement = {
    movement_id: buildId("MOV"),
    type: normalizedType,
    value: roundMoney(value),
    reason: normalizeText(reason),
    observation: normalizeText(observation),
    responsible: user?.name || user?.email || "sistema",
    responsible_role: getPdvUserRole(user),
    loja: register.loja,
    created_at: nowIso(),
    payload
  };
  register.movements.unshift(movement);
  if (normalizedType === "SALE") {
    register.linked_sales += 1;
  }
  saveCashRegisters(cashRegisters);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: `CASH_MOVEMENT_${normalizedType}`,
    created_at: nowIso(),
    actor: movement.responsible,
    actor_role: movement.responsible_role,
    loja: register.loja,
    reason: movement.reason,
    before: null,
    after: movement
  });
  return movement;
}

function computeCashRegisterExpected(register) {
  const movements = register.movements || [];
  const sumByType = (type) => roundMoney(movements.filter((item) => item.type === type).reduce((sum, item) => sum + toNumber(item.value), 0));
  const saleMoney = roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.money_amount || 0), 0));
  return {
    dinheiro_esperado: roundMoney(toNumber(register.valor_inicial) + saleMoney + sumByType("SUPRIMENTO") - sumByType("SANGRIA") - sumByType("DESPESA") + sumByType("AJUSTE")),
    pix: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.pix_amount || 0), 0)),
    debito: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.debito_amount || 0), 0)),
    credito: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.credito_amount || 0), 0)),
    link_pagamento: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.link_pagamento_amount || 0), 0)),
    cashback_usado: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.cashback_amount || 0), 0)),
    vale_presente_usado: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.vale_presente_amount || 0), 0)),
    permuta: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.permuta_amount || 0), 0)),
    credito_troca: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.credito_troca_amount || 0), 0)),
    descontos: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + toNumber(item.payload?.desconto_extra || 0), 0)),
    sangrias: sumByType("SANGRIA"),
    suprimentos: sumByType("SUPRIMENTO"),
    despesas: sumByType("DESPESA"),
    ajustes: sumByType("AJUSTE"),
    exchanges: sumByType("EXCHANGE")
  };
}

function closeCashRegister({ cashRegisterId = "", dinheiro_informado = 0, observacao = "" } = {}, user = {}) {
  const cashRegisters = loadCashRegisters();
  const register = cashRegisters.find((item) => item.cash_register_id === String(cashRegisterId || "").trim());
  if (!register) {
    throw new Error("Caixa do PDV não encontrado.");
  }
  if (register.status !== CASH_REGISTER_STATUS.OPEN && register.status !== CASH_REGISTER_STATUS.REOPENED) {
    throw new Error("Somente caixas abertos podem ser fechados.");
  }
  const expected = computeCashRegisterExpected(register);
  const countedCash = roundMoney(dinheiro_informado);
  register.status = CASH_REGISTER_STATUS.CLOSED;
  register.fechado_em = nowIso();
  register.closed_by = user?.name || user?.email || "sistema";
  register.close_observation = normalizeText(observacao);
  register.close_summary = {
    ...expected,
    dinheiro_informado: countedCash,
    diferenca_final: roundMoney(countedCash - expected.dinheiro_esperado)
  };
  saveCashRegisters(cashRegisters);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "CLOSE_CASH_REGISTER",
    created_at: nowIso(),
    actor: register.closed_by,
    actor_role: getPdvUserRole(user),
    loja: register.loja,
    reason: register.close_observation,
    before: { status: "OPEN" },
    after: register.close_summary
  });
  return register;
}

function reopenCashRegister({ cashRegisterId = "", reason = "", pin = "" } = {}, user = {}) {
  requireMinimumRole(user, "GERENTE");
  const cashRegisters = loadCashRegisters();
  const register = cashRegisters.find((item) => item.cash_register_id === String(cashRegisterId || "").trim());
  if (!register) {
    throw new Error("Caixa do PDV não encontrado.");
  }
  validateAuthorizationPin({
    code: pin,
    type: "REOPEN_CASH_REGISTER",
    loja: register.loja,
    context: {
      action: "REOPEN_CASH_REGISTER",
      cash_register_id: register.cash_register_id,
      reason: normalizeText(reason)
    }
  }, user);
  register.status = CASH_REGISTER_STATUS.REOPENED;
  register.reaberto_em = nowIso();
  register.reopen_reason = normalizeText(reason);
  saveCashRegisters(cashRegisters);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "REOPEN_CASH_REGISTER",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: register.loja,
    reason: register.reopen_reason,
    before: { status: "CLOSED" },
    after: { status: "REOPENED" }
  });
  return register;
}

function validateSaleControlsLegacyUnused({ saleContext = {}, authorization = {} } = {}, user = {}) {
  const subtotal = roundMoney(saleContext.subtotal || 0);
  const extraDiscount = roundMoney(saleContext.extraDiscount || 0);
  const itemDiscountAmount = roundMoney(saleContext.itemDiscountAmount || 0);
  const items = saleContext.items || [];
  const permutaAmount = roundMoney(saleContext.permutaAmount || 0);
  const loja = normalizeStoreKey(saleContext.loja || "");
  const saleId = normalizeText(saleContext.saleId || "");
  const discountPercent = subtotal > 0 ? Number(((extraDiscount / subtotal) * 100).toFixed(2)) : 0;
  const discountLimit = getDiscountLimitForSale({ subtotal, items });

  if (discountPercent > discountLimit) {
    if (!authorization.pin || !authorization.reason) {
      throw new Error(`Desconto acima de ${discountLimit}% exige PIN temporário e motivo obrigatório.`);
    }
    if (!DISCOUNT_REASONS.includes(normalizeText(authorization.reason).toUpperCase())) {
      throw new Error("Motivo de desconto acima do limite inválido.");
    }
    validateAuthorizationPin({
      code: authorization.pin,
      type: "DISCOUNT_OVERRIDE",
      loja,
      context: {
        action: "DISCOUNT_OVERRIDE",
        sale_id: saleId,
        discount_percent: discountPercent,
        discount_limit: discountLimit,
        reason: normalizeText(authorization.reason).toUpperCase()
      }
    }, user);
  }

  if (permutaAmount > 0) {
    if (!authorization.permutaPin || !authorization.permutaReason) {
      throw new Error("Permuta exige PIN temporário e motivo obrigatório.");
    }
    if (!DISCOUNT_REASONS.includes(normalizeText(authorization.permutaReason).toUpperCase())) {
      throw new Error("Motivo de permuta inválido.");
    }
    validateAuthorizationPin({
      code: authorization.permutaPin,
      type: "PERMUTA_APPROVAL",
      loja,
      context: {
        action: "PERMUTA_APPROVAL",
        sale_id: saleId,
        permuta_amount: permutaAmount,
        reason: normalizeText(authorization.permutaReason).toUpperCase()
      }
    }, user);
  }

  return {
    discount_limit: discountLimit,
    discount_percent: discountPercent
  };
}

function validateSaleControls({ saleContext = {}, authorization = {} } = {}, user = {}) {
  const subtotal = roundMoney(saleContext.subtotal || 0);
  const extraDiscount = roundMoney(saleContext.extraDiscount || 0);
  const itemDiscountAmount = roundMoney(saleContext.itemDiscountAmount || 0);
  const permutaAmount = roundMoney(saleContext.permutaAmount || 0);
  const loja = normalizeStoreKey(saleContext.loja || "");
  const saleId = normalizeText(saleContext.saleId || "");
  const saleSessionId = normalizeText(saleContext.saleSessionId || "");
  const discountBase = roundMoney(saleContext.discountBase || 0);
  const discountPercent = discountBase > 0 ? Number(((extraDiscount / discountBase) * 100).toFixed(2)) : 0;
  const discountPolicy = getDiscountLimitForSale({
    subtotal,
    items: saleContext.items || [],
    paymentMethods: saleContext.paymentMethods || [],
    discountAmount: extraDiscount,
    discountPercent,
    itemDiscountAmount,
    discountBase
  });
  const discountLimit = Number(toNumber(discountPolicy.limitPercent || 10).toFixed(2));

  if (discountPolicy.pendingPaymentMethod && extraDiscount > 0) {
    throw new Error(buildDiscountAuthorizationError(discountPolicy));
  }

  if (discountPolicy.requiresAuthorization) {
    if (!authorization.discountAuthorizationId) {
      throw new Error(buildDiscountAuthorizationError(discountPolicy));
    }
    consumeValidatedAuthorization({
      authorizationId: authorization.discountAuthorizationId,
      operationType: "DISCOUNT_ABOVE_LIMIT",
      saleSessionId,
      saleId,
      amount: discountPolicy.authorizationAmount || (itemDiscountAmount + extraDiscount),
      percent: discountPolicy.authorizationPercent || discountPercent,
      paymentMethods: saleContext.paymentMethods || [],
      paymentAmounts: saleContext.paymentMethods || [],
      subtotal,
      cashbackApplied: saleContext.cashbackUsed || 0,
      amountToPay: saleContext.totalFinal || 0,
      paidAmount: saleContext.paidAmount || 0
    }, user);
  }

  if (permutaAmount > 0) {
    if (!authorization.permutaPin || !authorization.permutaReason) {
      throw new Error("Permuta exige PIN temporario e motivo obrigatorio.");
    }
    if (!DISCOUNT_REASONS.includes(normalizeText(authorization.permutaReason).toUpperCase())) {
      throw new Error("Motivo de permuta invalido.");
    }
    validateAuthorizationPin({
      code: authorization.permutaPin,
      type: "PERMUTA_APPROVAL",
      loja,
      context: {
        action: "PERMUTA_APPROVAL",
        sale_id: saleId,
        permuta_amount: permutaAmount,
        reason: normalizeText(authorization.permutaReason).toUpperCase()
      }
    }, user);
  }

  return {
    discount_limit: discountLimit,
    discount_percent: discountPercent,
    discount_policy: discountPolicy
  };
}

function listCashRegisters() {
  return loadCashRegisters();
}

function getCashDashboard() {
  const cashRegisters = loadCashRegisters();
  const activeRegisters = cashRegisters.filter((item) => item.status === CASH_REGISTER_STATUS.OPEN || item.status === CASH_REGISTER_STATUS.REOPENED);
  const latest = cashRegisters[0] || null;
  const auditLogs = loadAuditLogs();
  return {
    metrics: {
      caixas_abertos: activeRegisters.length,
      caixas_fechados: cashRegisters.filter((item) => item.status === CASH_REGISTER_STATUS.CLOSED).length,
      autorizacoes_ativas: loadAuthorizations().filter((item) => item.status === "ACTIVE").length,
      auditorias: auditLogs.length,
      autorizadores_ativos: loadAuthorizers().filter((item) => item.is_active).length
    },
    activeRegisters,
    latestRegister: latest,
    recentAudits: auditLogs.slice(0, 40),
    authorizations: loadAuthorizations().slice(0, 40),
    authorizers: listAuthorizers(),
    authorizationAudit: loadAuthorizationAudit().slice(0, 60)
  };
}

module.exports = {
  AUTHORIZATION_TYPES,
  AUTHORIZATION_OPERATION_TYPES,
  CASH_MOVEMENT_TYPES,
  CASH_REGISTER_STATUS,
  DISCOUNT_REASONS,
  isAutomaticDiscountAllowedPaymentMethod,
  getDiscountPolicyForSale,
  getPdvUserRole,
  requireMinimumRole,
  openCashRegister,
  registerCashMovement,
  closeCashRegister,
  reopenCashRegister,
  issueAuthorizationPin,
  validateAuthorizationPin,
  validateSaleControls,
  listCashRegisters,
  getCashRegisterById,
  getOpenCashRegisterByStore,
  getCashDashboard,
  computeCashRegisterExpected,
  appendAuditLog,
  loadAuditLogs,
  listAuthorizers,
  createOrRefreshAuthorizer,
  verifyAuthorizerSetup,
  resetAuthorizerTotp,
  setAuthorizerStatus,
  validateOperationAuthorization,
  consumeValidatedAuthorization,
  loadAuthorizationAudit
};
