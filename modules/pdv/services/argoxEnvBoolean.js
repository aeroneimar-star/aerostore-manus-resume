"use strict";

function readEnvBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "sim", "on"].includes(raw)) return true;
  if (["0", "false", "no", "nao", "não", "off"].includes(raw)) return false;
  return fallback;
}

function readEnvBooleanFromProcess(name, fallback = false) {
  return readEnvBoolean(process.env[name], fallback);
}

function getEnvRaw(name) {
  if (!Object.prototype.hasOwnProperty.call(process.env, name)) {
    return undefined;
  }
  return String(process.env[name]);
}

module.exports = {
  readEnvBoolean,
  readEnvBooleanFromProcess,
  getEnvRaw
};
