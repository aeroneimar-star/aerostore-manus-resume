"use strict";
const crypto = require("node:crypto");
const { WhatsAppCloudProvider } = require("../../../src/notification/providers/WhatsAppCloudProvider");

function protectProviderId(value, pepper) {
  return value ? crypto.createHmac("sha256", pepper).update(String(value)).digest("hex") : "";
}

function createWhatsAppOtpProvider(options = {}) {
  const provider = options.provider || new WhatsAppCloudProvider(options);
  return {
    async send({ phone, code, dryRun }) {
      const result = await provider.sendTemplateMessage({
        to: phone,
        templateName: options.templateName || process.env.WHATSAPP_TEMPLATE_APP_OTP || "aerostore_app_otp",
        languageCode: options.language || process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR",
        parameters: [code, "5"],
        dryRun: dryRun ?? String(process.env.APP_OTP_DRY_RUN || "false") === "true"
      });
      return { success: result.success, status: result.status, messageId: result.metaMessageId || "", errorCode: result.errorCode || "" };
    }
  };
}

function createTwilioVerifyProvider(options = {}) {
  const accountSid = options.accountSid || process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = options.authToken || process.env.TWILIO_AUTH_TOKEN || "";
  const serviceSid = options.serviceSid || process.env.TWILIO_VERIFY_SERVICE_SID || "";
  const fetchImpl = options.fetchImpl || fetch;
  const available = Boolean(accountSid && authToken && serviceSid);
  const request = async (suffix, body) => {
    if (!available) return { success: false, errorCode: "SMS_UNAVAILABLE" };
    const response = await fetchImpl(`https://verify.twilio.com/v2/Services/${serviceSid}/${suffix}`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString()
    });
    const payload = await response.json().catch(() => ({}));
    return { success: response.ok, status: payload.status || "", messageId: payload.sid || "", errorCode: response.ok ? "" : String(payload.code || response.status) };
  };
  return {
    available,
    send: ({ phone }) => request("Verifications", { To: `+${phone}`, Channel: "sms" }),
    verify: ({ phone, code }) => request("VerificationCheck", { To: `+${phone}`, Code: code })
  };
}

module.exports = { createWhatsAppOtpProvider, createTwilioVerifyProvider, protectProviderId };
