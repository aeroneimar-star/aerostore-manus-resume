"use strict";

const path = require("path");
const { readEnvBoolean } = require(path.join(__dirname, "..", "..", "modules", "pdv", "services", "argoxEnvBoolean"));

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveDriverPrintOptions(config = {}) {
  const columnsRaw = config.driver_columns ?? config.driverColumns ?? process.env.ARGOX_DRIVER_COLUMNS ?? "2";
  const driverColumns = Math.floor(normalizeNumber(columnsRaw, 2)) === 1 ? 1 : 2;
  return {
    scaleX: normalizeNumber(
      config.scale_x ?? config.scaleX ?? process.env.ARGOX_DRIVER_SCALE_X,
      1
    ),
    scaleY: normalizeNumber(
      config.scale_y ?? config.scaleY ?? process.env.ARGOX_DRIVER_SCALE_Y,
      1
    ),
    offsetXMm: normalizeNumber(
      config.offset_x_mm ?? config.offsetXMm ?? process.env.ARGOX_DRIVER_OFFSET_X_MM,
      0
    ),
    offsetYMm: normalizeNumber(
      config.offset_y_mm ?? config.offsetYMm ?? process.env.ARGOX_DRIVER_OFFSET_Y_MM,
      0
    ),
    debugBorder: readEnvBoolean(
      config.debug_border ?? config.debugBorder ?? process.env.ARGOX_DRIVER_DEBUG_BORDER,
      false
    ),
    driverColumns
  };
}

module.exports = {
  resolveDriverPrintOptions
};
