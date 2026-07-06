"use strict";

const VALID_TRANSPORTS = new Set(["RAW", "WINDOWS_DRIVER"]);

function resolvePrintTransport(config = {}) {
  const raw = String(
    config.print_transport
    ?? process.env.ARGOX_PRINT_TRANSPORT
    ?? "RAW"
  ).trim().toUpperCase();
  if (raw === "WINDOWS_DRIVER" || raw === "DRIVER" || raw === "WIN_DRIVER") {
    return "WINDOWS_DRIVER";
  }
  return VALID_TRANSPORTS.has(raw) ? raw : "RAW";
}

function isWindowsDriverTransport(config = {}) {
  return resolvePrintTransport(config) === "WINDOWS_DRIVER";
}

module.exports = {
  resolvePrintTransport,
  isWindowsDriverTransport,
  VALID_TRANSPORTS
};
