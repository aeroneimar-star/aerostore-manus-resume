"use strict";

const BLOCKING_PHONE_CONFLICTS = new Set(["PHONE_DUPLICATE", "PHONE_SHARED", "PHONE_RECYCLED"]);
const CPF_CONFLICTS = new Set(["CPF_DUPLICATE", "CPF_INVALID", "CPF_CONFLICT"]);

function evaluateAppCustomerEligibility(input = {}) {
  const candidates = Array.isArray(input.masterCandidates) ? input.masterCandidates : [];
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts : [];
  const accountStatus = String(input.accountStatus || "ACTIVE").toUpperCase();
  const activeLinks = (Array.isArray(input.links) ? input.links : [])
    .filter((link) => String(link?.linkStatus || link?.link_status || "").toUpperCase() === "ACTIVE");
  const reasons = [];

  if (["SUSPENDED", "BLOCKED", "CLOSED"].includes(accountStatus)) {
    return { outcome: "BLOCKED", autoApprovalEligible: false, reasons: [`ACCOUNT_${accountStatus}`] };
  }
  if (!input.phoneConfirmed) reasons.push("PHONE_NOT_CONFIRMED");
  if (candidates.length !== 1) reasons.push(candidates.length ? "MULTIPLE_MASTER_CANDIDATES" : "NO_MASTER_CANDIDATE");
  const master = candidates.length === 1 ? candidates[0] : null;
  const masterStatus = String(master?.status || "").toUpperCase();
  if (master && (master.deletedAt || master.deleted_at || ["BLOCKED", "INACTIVE", "DELETED", "SUSPENDED"].includes(masterStatus))) {
    reasons.push("MASTER_INELIGIBLE");
  }
  for (const conflict of conflicts) {
    const type = String(conflict?.type || conflict?.conflictType || conflict?.conflict_type || "").toUpperCase();
    if (BLOCKING_PHONE_CONFLICTS.has(type)) reasons.push(type);
    if (CPF_CONFLICTS.has(type)) reasons.push("CPF_CONFLICT");
    if (conflict?.blocking === true || Number(conflict?.blocking || 0) === 1) reasons.push("STRUCTURAL_BLOCKING_CONFLICT");
  }
  if (activeLinks.length > 1) reasons.push("MULTIPLE_ACTIVE_LINKS");
  if (activeLinks.length === 1 && master && String(activeLinks[0].masterId || activeLinks[0].master_id) !== String(master.id)) {
    reasons.push("ACTIVE_LINK_MISMATCH");
  }
  const uniqueReasons = [...new Set(reasons)];
  if (!uniqueReasons.length && masterStatus === "ACTIVE") {
    return { outcome: "AUTO_APPROVAL_ELIGIBLE", autoApprovalEligible: true, masterId: String(master.id), reasons: [] };
  }
  if (uniqueReasons.includes("MASTER_INELIGIBLE")) return { outcome: "INELIGIBLE", autoApprovalEligible: false, reasons: uniqueReasons };
  if (uniqueReasons.some((reason) => reason.includes("CONFLICT") || reason.includes("MULTIPLE") || BLOCKING_PHONE_CONFLICTS.has(reason))) {
    return { outcome: "REVIEW_REQUIRED", autoApprovalEligible: false, reasons: uniqueReasons };
  }
  return { outcome: "PENDING_APPROVAL", autoApprovalEligible: false, reasons: uniqueReasons };
}

module.exports = { evaluateAppCustomerEligibility };
