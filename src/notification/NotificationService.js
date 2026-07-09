const { all, get, run } = require("../../db");
const {
  WhatsAppCloudProvider,
  normalizePhoneForWhatsApp,
  maskPhone,
  hashPhone,
  isWhatsAppCloudEnabled
} = require("./providers/WhatsAppCloudProvider");
const { defaultRegistry } = require("../whatsapp/WhatsAppProviderRegistry");
const { getWhatsAppStoreConfig } = require("../whatsapp/whatsappStoreConfigService");
const { normalizeStoreKey } = require("../../modules/pdv/utils/pdvStoreUtils");

// Resolve storeId a partir de um cashback row (sem query assíncrona).
// Tenta varias fontes e normaliza para a chave canônica usada em
// whatsapp_store_configs.store_id (ex.: "vila", "sul", "botanico").
// Se nada bater, retorna "" e o caller cai no provider legado.
function resolveStoreIdForCashback(cashback = {}) {
  const candidates = [
    cashback.store,
    cashback.store_id,
    cashback.store_key,
    cashback.contact_store,
    cashback.preferred_store,
    process.env.STORE_ID
  ];
  for (const candidate of candidates) {
    const normalized = normalizeStoreKey(candidate || "");
    if (normalized) return normalized;
  }
  return "";
}

function buildCashbackEarnedComponents(cashback = {}) {
  // Legado: 5 vars (incluindo data_inicio). Mantido para retro-compat
  // com templates antigos aprovados sob o formato 5-params.
  return [{
    type: "body",
    parameters: [
      { type: "text", text: getFirstName(cashback.customer_name) },
      { type: "text", text: formatCurrencyBRL(cashback.generated_value || cashback.available_balance || 0) },
      { type: "text", text: formatDateBR(cashback.valid_from || cashback.created_at) },
      { type: "text", text: formatDateBR(cashback.expires_at) },
      { type: "text", text: formatCurrencyBRL(cashback.minimum_purchase || 0) }
    ]
  }];
}

// Variante 4-vars para templates cashback_notificacao_v7 (e variantes _v7+).
// O template aprovado na Meta tem somente 4 placeholders:
//   {{1}} nome, {{2}} valor, {{3}} validade (data_fim), {{4}} compra_minima.
// O codigo legado envia 5 params (com data_inicio separada), o que faz a Meta
// retornar "(#100) Invalid parameter" quando o template tem 4 vars.
function buildCashbackEarnedComponentsV7(cashback = {}) {
  return [{
    type: "body",
    parameters: [
      { type: "text", text: getFirstName(cashback.customer_name) },
      { type: "text", text: formatCurrencyBRL(cashback.generated_value || cashback.available_balance || 0) },
      { type: "text", text: formatDateBR(cashback.expires_at) },
      { type: "text", text: formatCurrencyBRL(cashback.minimum_purchase || 0) }
    ]
  }];
}

function buildCashbackReminderComponents(cashback = {}) {
  return [{
    type: "body",
    parameters: [
      { type: "text", text: getFirstName(cashback.customer_name) },
      { type: "text", text: formatCurrencyBRL(getCashbackBalance(cashback)) },
      { type: "text", text: formatDateBR(cashback.expires_at) },
      { type: "text", text: formatCurrencyBRL(cashback.minimum_purchase || 0) }
    ]
  }];
}

function buildTestComponents(parameters = []) {
  return [{
    type: "body",
    parameters: parameters.map((text) => ({ type: "text", text: String(text ?? "") }))
  }];
}

const REMINDER_TYPES = {
  CREDITED: "CREDITED",
  D10: "D10",
  D3: "D3"
};

const CASHBACK_NOTIFICATION_EVENTS = {
  EARNED: "cashback_earned",
  EXPIRING_10_DAYS: "cashback_expiring_10_days",
  EXPIRING_3_DAYS: "cashback_expiring_3_days"
};

function getNotificationDryRunDefault() {
  return String(process.env.NOTIFICATION_DRY_RUN || "true").trim().toLowerCase() !== "false";
}

function formatCurrencyBRL(value = 0) {
  return Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDateBR(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const text = String(value || "").slice(0, 10);
    const parts = text.split("-");
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return text;
  }
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

function getFirstName(name = "") {
  return String(name || "Cliente").trim().split(/\s+/)[0] || "Cliente";
}

function getCashbackBalance(cashback = {}) {
  return Number(cashback.available_balance ?? cashback.balance_amount ?? cashback.generated_value ?? 0);
}

function isCashbackUsedOrUnavailable(cashback = {}) {
  const status = String(cashback.status || "").trim().toLowerCase();
  return Boolean(
    cashback.used_at
    || cashback.canceled_at
    || cashback.cancelled_at
    || cashback.expired_at
    || Number(cashback.used_value || 0) > 0
    || ["usado", "used", "cancelado", "cancelled", "vencido", "expired"].includes(status)
  );
}

function isCashbackExpired(cashback = {}, date = new Date()) {
  const expiresAt = String(cashback.expires_at || "").trim();
  if (!expiresAt) return false;
  const expiryDate = new Date(expiresAt.includes("T") ? expiresAt : `${expiresAt}T23:59:59-03:00`);
  return !Number.isNaN(expiryDate.getTime()) && expiryDate < date;
}

function isWithinBusinessHours(date = new Date()) {
  const localHour = Number(new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false
  }).format(date));
  return localHour >= 9 && localHour < 18;
}

function shouldEnforceBusinessHours() {
  return String(process.env.NOTIFICATION_ENFORCE_BUSINESS_HOURS || "true").trim().toLowerCase() !== "false";
}

function normalizeNotificationStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (["sent", "delivered", "read", "failed", "dry_run", "skipped_duplicate", "skipped_outside_business_hours"].includes(normalized)) {
    return normalized;
  }
  return normalized || "unknown";
}

class NotificationService {
  constructor(options = {}) {
    this.provider = options.provider || new WhatsAppCloudProvider();
  }

  async resolveOperationalStoreConfig(storeId = "") {
    if (!storeId) return null;
    try {
      const config = await getWhatsAppStoreConfig(storeId);
      if (!config || config.status !== "active") return null;
      return config;
    } catch (_) {
      return null;
    }
  }

  async sendViaMetaCloud({ phone, storeId, storeConfig, templateName, languageCode, components, dryRun }) {
    const config = storeConfig || (storeId ? await this.resolveOperationalStoreConfig(storeId) : null);
    const resolvedStoreId = storeId || (config ? config.storeId : "") || "";
    const context = {
      storeId: resolvedStoreId,
      storeConfig: config || undefined,
      provider: "meta_cloud",
      dryRun: Boolean(dryRun),
      enabled: true
    };
    const payload = {
      to: phone,
      templateName,
      languageCode: languageCode
        || (config && config.templates && config.templates.language)
        || process.env.WHATSAPP_TEMPLATE_LANG
        || "pt_BR",
      components: components || []
    };
    const provider = defaultRegistry.getProvider({ storeId: resolvedStoreId, provider: "meta_cloud" });
    return provider.sendTemplate(context, payload);
  }

  async hasNotificationLog({ cashbackId, customerId, eventType, templateName }) {
    if (!cashbackId || !eventType || !templateName) return false;
    const row = await get(
      `SELECT id FROM notification_logs
       WHERE cashback_id = ?
         AND event_type = ?
         AND template_name = ?
         AND (? = '' OR customer_id = ?)
         AND status IN ('dry_run', 'sent', 'delivered', 'read')
       LIMIT 1`,
      [String(cashbackId), String(eventType), String(templateName), String(customerId || ""), String(customerId || "")]
    ).catch(() => null);
    return Boolean(row?.id);
  }

  async createLog(input = {}) {
    const status = normalizeNotificationStatus(input.status || (input.success ? "sent" : "failed"));
    const nowExpr = "datetime('now')";
    const result = await run(
      `INSERT INTO notification_logs
      (provider, channel, template_name, phone_masked, phone_hash, cashback_id, customer_id, reminder_type, event_type,
       status, meta_message_id, error_code, error_message, dry_run, payload_summary_json,
       created_at, sent_at, failed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowExpr}, ${status === "sent" ? nowExpr : "''"}, ${status === "failed" ? nowExpr : "''"})`,
      [
        input.provider || "meta_whatsapp_cloud",
        input.channel || "whatsapp",
        input.templateName || input.template_name || "",
        input.phoneMasked || input.phone_masked || input.toMasked || "",
        input.phoneHash || input.phone_hash || "",
        input.cashbackId ? String(input.cashbackId) : "",
        input.customerId ? String(input.customerId) : "",
        input.reminderType || "",
        input.eventType || input.event_type || "",
        status,
        input.metaMessageId || "",
        input.errorCode || "",
        String(input.errorMessage || "").slice(0, 240),
        input.dryRun ? 1 : 0,
        JSON.stringify(input.payloadSummary || {})
      ]
    );
    return { id: result.lastID, status };
  }

  async resolveStoreConfigTemplate(cashback, key, envVarName, fallback) {
    // Stage 17 — helper generico para resolver o nome do template por contexto de loja.
    // Prioridade: whatsapp_store_configs.<storeId>.templates_json[key] > process.env[envVarName] > fallback literal.
    // Usado por sendCashbackNotification, sendCashbackAviso10Dias e sendCashbackAviso3Dias para garantir
    // override consistente por loja, com fallback seguro para .env ja configurado e para o default legado.
    try {
      const storeIdForTemplate = resolveStoreIdForCashback(cashback);
      if (storeIdForTemplate) {
        const cfg = await this.resolveOperationalStoreConfig(storeIdForTemplate);
        const t = cfg && cfg.templates && cfg.templates[key];
        if (typeof t === "string" && t.trim()) return t.trim();
      }
    } catch (_) { /* mantem empty e cai nos fallbacks */ }
    return process.env[envVarName] || fallback;
  }

  async sendCashbackNotification(cashback = {}, options = {}) {
    const templateName = await this.resolveStoreConfigTemplate(
      cashback,
      "cashback",
      "WHATSAPP_TEMPLATE_CASHBACK",
      "cashback_notificacao"
    );
    // Templates da familia *_v7 (ex.: cashback_notificacao_v7) tem 4 vars:
    // {{1}} nome, {{2}} valor, {{3}} validade, {{4}} compra_minima.
    // Templates legados tem 5 vars (com data_inicio separada).
    const components = /_v7$/.test(templateName)
      ? buildCashbackEarnedComponentsV7(cashback)
      : buildCashbackEarnedComponents(cashback);
    return this.sendCashbackTemplate({
      cashback,
      reminderType: REMINDER_TYPES.CREDITED,
      eventType: CASHBACK_NOTIFICATION_EVENTS.EARNED,
      templateName,
      dryRun: options.dryRun ?? getNotificationDryRunDefault(),
      components,
      sender: () => this.provider.sendCashbackNotification({
        phone: cashback.customer_phone,
        name: getFirstName(cashback.customer_name),
        value: formatCurrencyBRL(cashback.generated_value || cashback.available_balance || 0),
        startDate: formatDateBR(cashback.valid_from || cashback.created_at),
        endDate: formatDateBR(cashback.expires_at),
        minPurchase: formatCurrencyBRL(cashback.minimum_purchase || 0),
        dryRun: options.dryRun ?? getNotificationDryRunDefault()
      })
    });
  }

  async sendCashbackAviso10Dias(cashback = {}, options = {}) {
    const templateName = await this.resolveStoreConfigTemplate(
      cashback,
      "aviso10",
      "WHATSAPP_TEMPLATE_AVISO_10",
      "cashback_aviso_10dias"
    );
    return this.sendCashbackTemplate({
      cashback,
      reminderType: REMINDER_TYPES.D10,
      eventType: CASHBACK_NOTIFICATION_EVENTS.EXPIRING_10_DAYS,
      templateName,
      dryRun: options.dryRun ?? getNotificationDryRunDefault(),
      components: buildCashbackReminderComponents(cashback),
      sender: () => this.provider.sendCashbackAviso10Dias({
        phone: cashback.customer_phone,
        name: getFirstName(cashback.customer_name),
        value: formatCurrencyBRL(getCashbackBalance(cashback)),
        expiryDate: formatDateBR(cashback.expires_at),
        minPurchase: formatCurrencyBRL(cashback.minimum_purchase || 0),
        dryRun: options.dryRun ?? getNotificationDryRunDefault()
      })
    });
  }

  async sendCashbackAviso3Dias(cashback = {}, options = {}) {
    const templateName = await this.resolveStoreConfigTemplate(
      cashback,
      "aviso3",
      "WHATSAPP_TEMPLATE_AVISO_3",
      "cashback_aviso_3dias"
    );
    return this.sendCashbackTemplate({
      cashback,
      reminderType: REMINDER_TYPES.D3,
      eventType: CASHBACK_NOTIFICATION_EVENTS.EXPIRING_3_DAYS,
      templateName,
      dryRun: options.dryRun ?? getNotificationDryRunDefault(),
      components: buildCashbackReminderComponents(cashback),
      sender: () => this.provider.sendCashbackAviso3Dias({
        phone: cashback.customer_phone,
        name: getFirstName(cashback.customer_name),
        value: formatCurrencyBRL(getCashbackBalance(cashback)),
        expiryDate: formatDateBR(cashback.expires_at),
        minPurchase: formatCurrencyBRL(cashback.minimum_purchase || 0),
        dryRun: options.dryRun ?? getNotificationDryRunDefault()
      })
    });
  }

async sendCashbackTemplate({ cashback, reminderType, eventType, templateName, dryRun, sender, components }) {
    return this._dispatchCashback({
      cashback,
      reminderType,
      eventType,
      templateName,
      dryRun,
      sender,
      components
    });
  }

  async _resolveDispatchTarget(cashback = {}, options = {}) {
    // Primeiro: se caller passou storeConfig explícito, usa direto.
    if (options.storeConfig && options.storeConfig.provider === "meta_cloud") {
      return { useMetaCloud: true, storeId: options.storeConfig.storeId || options.storeConfig.store_id || "", storeConfig: options.storeConfig };
    }
    if (options.storeId && options.storeConfig) {
      return { useMetaCloud: options.storeConfig.provider === "meta_cloud", storeId: options.storeId, storeConfig: options.storeConfig };
    }
    // Segundo: extrai storeId do cashback.
    const storeId = resolveStoreIdForCashback(cashback);
    if (!storeId) return { useMetaCloud: false, storeId: "", storeConfig: null };
    const storeConfig = await this.resolveOperationalStoreConfig(storeId);
    return {
      useMetaCloud: Boolean(storeConfig && storeConfig.provider === "meta_cloud"),
      storeId,
      storeConfig: storeConfig || null
    };
  }

  async _dispatchCashback({ cashback, reminderType, eventType, templateName, dryRun, sender, components }) {
    // ----- Dedup e regras de pulo (inalteradas) -----
    const cashbackId = cashback?.id ? String(cashback.id) : "";
    const customerId = cashback?.contact_id ? String(cashback.contact_id) : "";
    if (!cashbackId || !customerId) {
      await this.createLog({
        templateName,
        cashbackId,
        customerId,
        reminderType,
        eventType,
        status: "failed",
        dryRun,
        errorCode: "missing_cashback_identity",
        errorMessage: "Cashback ou cliente sem identificador para notificacao."
      });
      return { success: false, status: "failed", errorCode: "missing_cashback_identity" };
    }
    if (isCashbackUsedOrUnavailable(cashback) || isCashbackExpired(cashback)) {
      await this.createLog({
        templateName,
        phoneMasked: maskPhone(cashback?.customer_phone || ""),
        phoneHash: hashPhone(cashback?.customer_phone || ""),
        cashbackId,
        customerId,
        reminderType,
        eventType,
        status: "skipped_unavailable",
        dryRun,
        payloadSummary: { reason: "cashback_used_expired_cancelled_or_unavailable" }
      });
      return { success: true, status: "skipped_unavailable" };
    }
    if (!dryRun && shouldEnforceBusinessHours() && !isWithinBusinessHours()) {
      const phone = normalizePhoneForWhatsApp(cashback?.customer_phone || "");
      await this.createLog({
        templateName,
        phoneMasked: maskPhone(phone),
        phoneHash: hashPhone(phone),
        cashbackId,
        customerId,
        reminderType,
        eventType,
        status: "skipped_outside_business_hours",
        dryRun: false,
        payloadSummary: { reason: "outside_business_hours" }
      });
      return { success: false, status: "skipped_outside_business_hours" };
    }
    if (await this.hasNotificationLog({ cashbackId, customerId, eventType, templateName })) {
      await this.createLog({
        templateName,
        phoneMasked: maskPhone(cashback?.customer_phone || ""),
        phoneHash: hashPhone(cashback?.customer_phone || ""),
        cashbackId,
        customerId,
        reminderType,
        eventType,
        status: "skipped_duplicate",
        dryRun,
        payloadSummary: { reason: "already_logged_for_event" }
      });
      return { success: true, status: "skipped_duplicate" };
    }

    // ----- Resolve provider alvo -----
    const target = await this._resolveDispatchTarget(cashback, {});

    let result;
    if (target.useMetaCloud) {
      // Caminho NOVO: WhatsAppProviderRegistry -> MetaWhatsAppCloudProvider
      result = await this.sendViaMetaCloud({
        phone: cashback?.customer_phone || "",
        storeId: target.storeId,
        storeConfig: target.storeConfig,
        templateName,
        languageCode: target.storeConfig?.templates?.language,
        components,
        dryRun
      });
    } else {
      // Caminho LEGADO (WhatsApp Web ou Cloud legado via env)
      result = await sender();
    }

    await this.createLog({
      ...result,
      templateName,
      cashbackId,
      customerId,
      reminderType,
      eventType,
      status: result.status,
      dryRun: result.dryRun
    });
    return result;
  }

  async sendTemplateTest(input = {}) {
    // Resolver provider alvo: se storeConfig pedir meta_cloud OU caller pediu meta_cloud, usa o novo.
    const storeId = input.storeId || resolveStoreIdForCashback({ store: input.store }) || process.env.STORE_ID || "";
    const explicitProvider = String(input.provider || "").trim().toLowerCase();
    let storeConfig = null;
    if (storeId) {
      storeConfig = await this.resolveOperationalStoreConfig(storeId).catch(() => null);
    }
    const useMetaCloud = explicitProvider === "meta_cloud"
      || (!explicitProvider && storeConfig && storeConfig.provider === "meta_cloud");

    // dryRun: se caller passou explicitamente, respeita. Senão, default dry-run seguro.
    const dryRun = input.dryRun !== undefined
      ? Boolean(input.dryRun)
      : (explicitProvider === "meta_cloud" ? true : (!isWhatsAppCloudEnabled() || getNotificationDryRunDefault()));

    let result;
    if (useMetaCloud) {
      result = await this.sendViaMetaCloud({
        phone: input.phone,
        storeId,
        storeConfig,
        templateName: input.template,
        languageCode: input.languageCode,
        components: buildTestComponents(input.parameters || []),
        dryRun
      });
    } else {
      result = await this.provider.sendTemplateMessage({
        to: input.phone,
        templateName: input.template,
        languageCode: input.languageCode,
        parameters: input.parameters || [],
        dryRun
      });
    }
    await this.createLog({
      ...result,
      templateName: input.template,
      reminderType: "TEST",
      eventType: "template_test",
      status: result.status,
      dryRun: result.dryRun
    });
    return result;
  }

  async updateLogFromWebhook(statusPayload = {}) {
    const messageId = String(statusPayload.id || statusPayload.message_id || "").trim();
    const status = normalizeNotificationStatus(statusPayload.status || "");
    if (!messageId || !status) return false;
    const timestampColumn = status === "delivered"
      ? "delivered_at"
      : status === "read"
        ? "read_at"
        : status === "failed"
          ? "failed_at"
          : "";
    const params = [status];
    let sql = "UPDATE notification_logs SET status = ?";
    if (timestampColumn) {
      sql += `, ${timestampColumn} = datetime('now')`;
    }
    if (statusPayload.errors?.[0]?.code) {
      sql += ", error_code = ?, error_message = ?";
      params.push(String(statusPayload.errors[0].code), String(statusPayload.errors[0].title || statusPayload.errors[0].message || "").slice(0, 240));
    }
    sql += " WHERE meta_message_id = ?";
    params.push(messageId);
    const result = await run(sql, params);
    return result.changes > 0;
  }

  async getStatus() {
    const lastLog = await get(
      `SELECT id, provider, channel, template_name, event_type, status, dry_run, created_at, sent_at, failed_at, error_code, error_message
       FROM notification_logs ORDER BY id DESC LIMIT 1`
    ).catch(() => null);
    const errors = await all(
      `SELECT id, template_name, event_type, status, error_code, error_message, created_at
       FROM notification_logs
       WHERE status = 'failed'
       ORDER BY id DESC LIMIT 5`
    ).catch(() => []);
    return {
      provider: "meta_whatsapp_cloud",
      channel: process.env.NOTIFICATION_CHANNEL || "whatsapp",
      enabled: isWhatsAppCloudEnabled(),
      dryRun: getNotificationDryRunDefault(),
      phone_number_id_present: Boolean(process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID),
      business_account_id_present: Boolean(process.env.WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID),
      templates: {
        cashback: process.env.WHATSAPP_TEMPLATE_CASHBACK || "cashback_notificacao",
        aviso10: process.env.WHATSAPP_TEMPLATE_AVISO_10 || "cashback_aviso_10dias",
        aviso3: process.env.WHATSAPP_TEMPLATE_AVISO_3 || "cashback_aviso_3dias",
        language: process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR",
        events: CASHBACK_NOTIFICATION_EVENTS
      },
      lastLog,
      recentErrors: errors
    };
  }
}

let singleton = null;

function getNotificationService() {
  if (!singleton) {
    singleton = new NotificationService();
  }
  return singleton;
}

module.exports = {
  NotificationService,
  getNotificationService,
  getNotificationDryRunDefault,
  formatCurrencyBRL,
  formatDateBR,
  getFirstName,
  getCashbackBalance,
  isCashbackUsedOrUnavailable,
  isCashbackExpired,
  REMINDER_TYPES,
  CASHBACK_NOTIFICATION_EVENTS
};
