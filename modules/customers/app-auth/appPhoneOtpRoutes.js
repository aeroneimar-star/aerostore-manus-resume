"use strict";

const express = require("express");
const { AppPhoneOtpError, createAppPhoneOtpService } = require("./appPhoneOtpService");
const { createAppSessionService } = require("./appSessionService");

function clientContext(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress || "unknown",
    deviceId: String(req.get("x-device-id") || req.body?.deviceId || "unknown"),
    deviceName: String(req.get("x-device-name") || req.body?.deviceName || ""),
    platform: String(req.get("x-app-platform") || req.body?.platform || "UNKNOWN"),
    appVersion: String(req.get("x-app-version") || req.body?.appVersion || ""),
    userAgent: String(req.get("user-agent") || "unknown")
  };
}

function sendError(res, error) {
  if (error instanceof AppPhoneOtpError) {
    const unavailable = error.code === "SMS_UNAVAILABLE";
    return res.status(error.status).json({
      error: unavailable ? "CHANNEL_UNAVAILABLE" : error.code,
      message: unavailable ? "O SMS nao esta disponivel agora. Continue pelo WhatsApp." : "Nao foi possivel concluir. Confira os dados ou tente novamente mais tarde."
    });
  }
  return res.status(500).json({ error: "APP_PHONE_AUTH_UNAVAILABLE", message: "Nao foi possivel concluir agora." });
}

function createAppPhoneOtpRouter(options = {}) {
  let service = options.service || null;
  let sessions = options.sessionService || null;
  const getSessions = () => { sessions ||= createAppSessionService(options); return sessions; };
  const getService = () => { service ||= createAppPhoneOtpService({ ...options, completeLogin: (input) => getSessions().createSession(input) }); return service; };
  const router = express.Router();
  router.use(express.json({ limit: "16kb" }));
  router.post("/auth/start", async (req, res) => {
    try { res.status(202).json(await getService().start({ ...(req.body || {}), ...clientContext(req) })); } catch (error) { sendError(res, error); }
  });
  router.post("/auth/verify", async (req, res) => {
    try { res.json(await getService().verify({ ...(req.body || {}), ...clientContext(req) })); } catch (error) { sendError(res, error); }
  });
  router.post("/auth/resend", async (req, res) => {
    try { res.status(202).json(await getService().resend({ ...(req.body || {}), ...clientContext(req) })); } catch (error) { sendError(res, error); }
  });
  router.post("/auth/sms", async (req, res) => {
    try { res.status(202).json(await getService().useSms({ ...(req.body || {}), ...clientContext(req) })); } catch (error) { sendError(res, error); }
  });
  return router;
}

module.exports = { createAppPhoneOtpRouter };
