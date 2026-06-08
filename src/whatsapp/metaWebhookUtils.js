"use strict";

const {
  maskPhone,
  maskIdentifier,
  hashPhone,
  buildTextMetadata
} = require("./whatsappLogSanitizer");
const { readBoolean } = require("./whatsappConfigService");

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractTextMetadata(message = {}) {
  if (message.type === "text") return buildTextMetadata(message.text?.body || "");
  if (message.type === "button") return buildTextMetadata(message.button?.text || "");
  if (message.type === "interactive") {
    return buildTextMetadata(message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "");
  }
  return buildTextMetadata("");
}

function normalizeMetaWebhookPayload(payload = {}) {
  const messages = [];
  const statuses = [];
  const summaries = [];

  for (const entry of safeArray(payload.entry)) {
    for (const change of safeArray(entry.changes)) {
      const value = change.value || {};
      const metadata = value.metadata || {};
      for (const message of safeArray(value.messages)) {
        const contact = safeArray(value.contacts).find((item) => item.wa_id === message.from) || {};
        const textMetadata = extractTextMetadata(message);
        messages.push({
          provider: "meta_cloud",
          messageId: String(message.id || ""),
          from: String(message.from || ""),
          fromMasked: maskPhone(message.from || ""),
          waIdMasked: maskPhone(contact.wa_id || message.from || ""),
          phoneHash: hashPhone(message.from || ""),
          timestamp: String(message.timestamp || ""),
          type: String(message.type || ""),
          hasText: textMetadata.hasText,
          textLength: textMetadata.textLength,
          customerNamePresent: Boolean(contact.profile?.name),
          phoneNumberId: String(metadata.phone_number_id || ""),
          phoneNumberIdMasked: maskIdentifier(metadata.phone_number_id || ""),
          displayPhoneNumberMasked: maskPhone(metadata.display_phone_number || "")
        });
      }
      for (const status of safeArray(value.statuses)) {
        statuses.push({
          provider: "meta_cloud",
          id: String(status.id || status.message_id || ""),
          message_id: String(status.id || status.message_id || ""),
          status: String(status.status || ""),
          timestamp: String(status.timestamp || ""),
          recipient_id: String(status.recipient_id || ""),
          recipientMasked: maskPhone(status.recipient_id || ""),
          phoneHash: hashPhone(status.recipient_id || ""),
          phoneNumberId: String(metadata.phone_number_id || ""),
          phoneNumberIdMasked: maskIdentifier(metadata.phone_number_id || ""),
          errors: safeArray(status.errors).slice(0, 3).map((error) => ({
            code: error.code || "",
            title: String(error.title || error.message || "").slice(0, 160)
          }))
        });
      }
      summaries.push({
        field: change.field || "",
        phoneNumberIdMasked: maskIdentifier(metadata.phone_number_id || ""),
        displayPhoneNumberMasked: maskPhone(metadata.display_phone_number || ""),
        messages: safeArray(value.messages).length,
        statuses: safeArray(value.statuses).length
      });
    }
  }

  return {
    messages,
    statuses,
    safeSummary: {
      entries: safeArray(payload.entry).length,
      changes: summaries.length,
      messages: messages.length,
      statuses: statuses.length,
      summaries
    }
  };
}

function normalizeQueryValue(value = "") {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function verifyMetaWebhookChallenge({ query = {}, expectedVerifyToken = "" } = {}) {
  const mode = normalizeQueryValue(query["hub.mode"]).trim();
  const receivedVerifyToken = normalizeQueryValue(query["hub.verify_token"]).trim();
  const challenge = normalizeQueryValue(query["hub.challenge"]);
  const configuredVerifyToken = String(expectedVerifyToken || "").trim();
  const hasChallenge = challenge.length > 0;
  const verifyTokenMatch = Boolean(configuredVerifyToken && receivedVerifyToken && receivedVerifyToken === configuredVerifyToken);
  const ok = mode === "subscribe" && verifyTokenMatch && hasChallenge;
  return {
    ok,
    status: ok ? 200 : 403,
    body: ok ? challenge : "Forbidden",
    safeLog: {
      mode,
      hasChallenge,
      hasConfiguredVerifyToken: Boolean(configuredVerifyToken),
      verifyTokenMatch
    }
  };
}

function buildMetaCredentialsStatus(options = {}) {
  const token = String(options.token ?? process.env.WHATSAPP_CLOUD_TOKEN ?? "").trim();
  const phoneNumberId = String(options.phoneNumberId ?? process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID ?? "").trim();
  const businessAccountId = String(options.businessAccountId ?? process.env.WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID ?? "").trim();
  const verifyToken = String(options.verifyToken ?? process.env.WHATSAPP_CLOUD_VERIFY_TOKEN ?? "").trim();
  const appSecret = String(options.appSecret ?? process.env.WHATSAPP_CLOUD_APP_SECRET ?? "").trim();
  const cloudEnabled = readBoolean(options.cloudEnabled ?? process.env.WHATSAPP_CLOUD_ENABLED, false);
  const dryRun = String(options.notificationDryRun ?? process.env.NOTIFICATION_DRY_RUN ?? "true").trim().toLowerCase() !== "false";
  return {
    provider: "meta_cloud",
    hasToken: Boolean(token),
    hasPhoneNumberId: Boolean(phoneNumberId),
    hasBusinessAccountId: Boolean(businessAccountId),
    hasVerifyToken: Boolean(verifyToken),
    hasAppSecret: Boolean(appSecret),
    phoneNumberIdMasked: maskIdentifier(phoneNumberId),
    businessAccountIdMasked: maskIdentifier(businessAccountId),
    dryRun,
    cloudEnabled,
    canSendRealMessage: Boolean(cloudEnabled && !dryRun && token && phoneNumberId),
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  normalizeMetaWebhookPayload,
  verifyMetaWebhookChallenge,
  buildMetaCredentialsStatus
};
