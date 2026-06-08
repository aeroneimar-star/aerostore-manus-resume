"use strict";

const {
  maskPhone,
  maskIdentifier,
  hashPhone,
  buildTextMetadata
} = require("./whatsappLogSanitizer");

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

module.exports = {
  normalizeMetaWebhookPayload
};
