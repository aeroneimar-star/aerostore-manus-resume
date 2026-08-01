"use strict";

const express = require("express");
const { AppSessionError, createAppSessionService } = require("./appSessionService");
const { AppProfileError, createAppProfileService } = require("./appProfileService");

function bearer(req) { return String(req.get("authorization") || "").replace(/^Bearer\s+/i, ""); }
function context(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress || "unknown",
    userAgent: req.get("user-agent") || "unknown",
    deviceId: req.get("x-device-id") || req.body?.deviceId || "unknown",
    deviceName: req.get("x-device-name") || req.body?.deviceName || "",
    platform: req.get("x-app-platform") || req.body?.platform || "UNKNOWN",
    appVersion: req.get("x-app-version") || req.body?.appVersion || ""
  };
}
function sendError(res, error) {
  if (error instanceof AppProfileError) return res.status(error.status).json({ error: error.code, message: error.message });
  if (error instanceof AppSessionError) return res.status(error.status).json({
    error: error.code,
    message: error.status === 403 ? "Seu acesso esta indisponivel." : "Sua sessao expirou. Entre novamente.",
    ...(error.accessStatus ? { accessStatus: error.accessStatus } : {})
  });
  return res.status(500).json({ error: "APP_SESSION_UNAVAILABLE", message: "Nao foi possivel concluir agora." });
}

function createRequireAppSession(service, options = {}) {
  return async (req, res, next) => {
    try { req.appSession = await service.authenticateAccess(bearer(req), options); next(); }
    catch (error) { sendError(res, error); }
  };
}

function createAppSessionRouter(options = {}) {
  const service = options.service || createAppSessionService(options);
  const profileService = options.profileService || createAppProfileService(options);
  const router = express.Router(); router.use(express.json({ limit: "16kb" }));
  const requireSession = createRequireAppSession(service);
  const requireStatusSession = createRequireAppSession(service, { allowPending: true });
  const requireObservableSession = createRequireAppSession(service, { observeStatus: true });
  router.post("/auth/refresh", async (req,res)=>{try{res.json(await service.refresh({...(req.body||{}),...context(req)}));}catch(error){sendError(res,error);}});
  router.post("/auth/logout",requireStatusSession,async(req,res)=>{try{await service.logout(req.appSession.session.id);res.status(204).end();}catch(error){sendError(res,error);}});
  router.post("/auth/logout-all",requireStatusSession,async(req,res)=>{try{await service.logoutAll(req.appSession.account.id);res.status(204).end();}catch(error){sendError(res,error);}});
  router.get("/access/status",requireObservableSession,async(req,res)=>{try{res.json(await profileService.getAccessStatus(req.appSession));}catch(error){sendError(res,error);}});
  router.get("/profile",requireStatusSession,async(req,res)=>{try{res.json(await profileService.getProfile(req.appSession));}catch(error){sendError(res,error);}});
  router.patch("/profile",requireStatusSession,async(req,res)=>{try{res.json(await profileService.updateProfile(req.appSession,req.body||{}));}catch(error){sendError(res,error);}});
  return router;
}

module.exports={createAppSessionRouter,createRequireAppSession,sendAppSessionError:sendError};
