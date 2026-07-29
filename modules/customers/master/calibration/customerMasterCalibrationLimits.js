"use strict";

const {
  DEFAULT_LIMITS
} = require("../backfill/customerMasterDryRunService");

const SYNTHETIC_59143_LIMIT_PROFILE = "synthetic-59143-v1";
const SYNTHETIC_59143_LIMITS = Object.freeze({
  ...DEFAULT_LIMITS,
  maxRecords: 59143,
  maxConflicts: 5000,
  maxApproxMemoryBytes: 128 * 1024 * 1024
});

function resolveCalibrationLimits(profile, overrides = {}) {
  if (!profile) return { ...DEFAULT_LIMITS, ...overrides };
  if (profile !== SYNTHETIC_59143_LIMIT_PROFILE) {
    throw new Error("CUSTOMER_MASTER_CALIBRATION_LIMIT_PROFILE_INVALID");
  }
  return { ...SYNTHETIC_59143_LIMITS, ...overrides };
}

module.exports = {
  SYNTHETIC_59143_LIMIT_PROFILE,
  SYNTHETIC_59143_LIMITS,
  resolveCalibrationLimits
};
