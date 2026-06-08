"use strict";

const crypto = require("crypto");

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D+/g, "");
}

function normalizePhoneForWhatsApp(phone = "") {
  const digits = normalizeDigits(phone);
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

function maskPhone(phone = "") {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return "";
  return `***${normalized.slice(-4)}`;
}

function hashPhone(phone = "") {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function maskIdentifier(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 4) return "***";
  return `***${text.slice(-4)}`;
}

function maskToken(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return "***";
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function buildTextPreview(value = "", maxLength = 12) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return `${text.slice(0, Math.min(3, text.length))}***`;
  return `${text.slice(0, maxLength)}***`;
}

function buildTextMetadata(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return {
    hasText: Boolean(text),
    textLength: text.length
  };
}

function sanitizeForWhatsAppLog(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForWhatsAppLog(item, depth + 1));
  }
  if (typeof value !== "object") return value;
  return Object.entries(value).reduce((acc, [key, item]) => {
    const normalizedKey = String(key || "").toLowerCase();
    if (typeof item === "number" || typeof item === "boolean") {
      acc[key] = item;
    } else if (normalizedKey.includes("token") || normalizedKey.includes("secret") || normalizedKey.includes("authorization")) {
      acc[key] = maskToken(item);
    } else if (normalizedKey.includes("phone") || normalizedKey.includes("telefone") || normalizedKey.includes("wa_id") || normalizedKey.includes("recipient")) {
      acc[key] = maskPhone(item);
    } else if (normalizedKey === "to" || normalizedKey === "from") {
      acc[key] = maskPhone(item);
    } else if (normalizedKey.includes("length") || normalizedKey.includes("count")) {
      acc[key] = item;
    } else if (normalizedKey.includes("body") || normalizedKey.includes("message") || normalizedKey.includes("text") || normalizedKey.includes("pin")) {
      acc[key] = item && typeof item === "object" ? sanitizeForWhatsAppLog(item, depth + 1) : buildTextMetadata(item);
    } else {
      acc[key] = sanitizeForWhatsAppLog(item, depth + 1);
    }
    return acc;
  }, {});
}

module.exports = {
  normalizeDigits,
  normalizePhoneForWhatsApp,
  maskPhone,
  hashPhone,
  maskIdentifier,
  maskToken,
  buildTextPreview,
  buildTextMetadata,
  sanitizeForWhatsAppLog
};
