"use strict";

const express = require("express");
const {
  CustomerIdentityAdminError,
  createCustomerIdentityAdminService
} = require("./customerIdentityAdminService");

function sendError(res, error) {
  if (error instanceof CustomerIdentityAdminError) {
    return res.status(error.status).json({
      error: error.code,
      message: error.message
    });
  }
  return res.status(500).json({
    error: "CUSTOMER_IDENTITY_ADMIN_INTERNAL_ERROR",
    message: "Falha ao processar a fila administrativa de identidade."
  });
}

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendError(res, error);
    }
  };
}

function createCustomerIdentityAdminRouter({ dbApi, databasePath, requireAdmin } = {}) {
  if (typeof requireAdmin !== "function") {
    throw new Error("CUSTOMER_IDENTITY_ADMIN_AUTH_REQUIRED");
  }
  const service = createCustomerIdentityAdminService(dbApi, { databasePath });
  const router = express.Router();

  router.use(requireAdmin);

  router.get("/", asyncHandler(async (req, res) => {
    res.json(await service.listCases(req.query || {}));
  }));

  router.get("/:caseId/events", asyncHandler(async (req, res) => {
    res.json({ events: await service.getEvents(req.params.caseId) });
  }));

  router.get("/:caseId", asyncHandler(async (req, res) => {
    res.json({ case: await service.getCase(req.params.caseId) });
  }));

  router.post("/:caseId/review/start", asyncHandler(async (req, res) => {
    res.json({ case: await service.startReview(req.params.caseId, req.user, req.body || {}) });
  }));

  router.post("/:caseId/review/release", asyncHandler(async (req, res) => {
    res.json({ case: await service.releaseReview(req.params.caseId, req.user, req.body || {}) });
  }));

  router.post("/:caseId/notes", asyncHandler(async (req, res) => {
    const body = {
      ...(req.body || {}),
      reason: req.body?.reason || req.body?.note
    };
    res.json({ case: await service.addNote(req.params.caseId, req.user, body) });
  }));

  router.post("/:caseId/review/waiting-information", asyncHandler(async (req, res) => {
    res.json({
      case: await service.markWaitingInformation(req.params.caseId, req.user, req.body || {})
    });
  }));

  router.post("/:caseId/review/end-without-resolution", asyncHandler(async (req, res) => {
    res.json({
      case: await service.endWithoutResolution(req.params.caseId, req.user, req.body || {})
    });
  }));

  router.post("/:caseId/reopen", asyncHandler(async (req, res) => {
    res.json({ case: await service.reopenCase(req.params.caseId, req.user, req.body || {}) });
  }));

  router.post("/:caseId/resolution/confirm-same-person", asyncHandler(async (req, res) => {
    res.json({ case: await service.confirmSamePerson(req.params.caseId, req.user, req.body || {}) });
  }));

  router.post("/:caseId/resolution/keep-separate", asyncHandler(async (req, res) => {
    res.json({ case: await service.keepSeparate(req.params.caseId, req.user, req.body || {}) });
  }));

  router.post("/:caseId/resolution/phone-shared", asyncHandler(async (req, res) => {
    res.json({ case: await service.markPhoneShared(req.params.caseId, req.user, req.body || {}) });
  }));

  router.post("/:caseId/resolution/phone-recycled", asyncHandler(async (req, res) => {
    res.json({ case: await service.markPhoneRecycled(req.params.caseId, req.user, req.body || {}) });
  }));

  router.post("/:caseId/resolution/cpf-validate", asyncHandler(async (req, res) => {
    res.json({ case: await service.validateCpf(req.params.caseId, req.user, req.body || {}) });
  }));

  router.post("/:caseId/resolution/cpf-reject", asyncHandler(async (req, res) => {
    res.json({ case: await service.rejectCpf(req.params.caseId, req.user, req.body || {}) });
  }));

  return router;
}

module.exports = {
  createCustomerIdentityAdminRouter
};
