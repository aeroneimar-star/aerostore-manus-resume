"use strict";

const { readEnvBoolean } = require("./argoxEnvBoolean");

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function padNumber(value = 0, size = 4) {
  return String(Math.max(0, Math.floor(normalizeNumber(value, 0)))).padStart(size, "0").slice(-size);
}

function resolveSafeTestMode(config = {}, item = {}) {
  const explicit = item.safe_test_mode ?? config.safe_test_mode ?? process.env.ARGOX_SAFE_TEST_MODE;
  return readEnvBoolean(explicit, false);
}

function resolveEffectiveQuantity(quantity = 1, options = {}) {
  const received = Math.max(1, Math.floor(normalizeNumber(quantity, 1)));
  if (resolveSafeTestMode(options.config || {}, options.item || {})) {
    return { received, final: 1, safeTestMode: true };
  }
  return { received, final: received, safeTestMode: false };
}

function splitCommandLines(command = "") {
  return String(command || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\x02/g, "<STX>"))
    .filter((line) => line.length > 0);
}

function summarizeCommand(command = "", lineCount = 8) {
  const lines = splitCommandLines(command);
  return {
    total_lines: lines.length,
    first_lines: lines.slice(0, lineCount),
    last_lines: lines.slice(-lineCount),
    ends_with_p1: /\bP1\b/.test(command),
    contains_p20: /\bP20\b/.test(command),
    contains_q480: /\bQ480\b/.test(command) || /\bQ0480\b/.test(command),
    contains_q0001: /\bQ0001\b/.test(command)
  };
}

function validatePplaCommand(command = "", options = {}) {
  const summary = summarizeCommand(command, options.previewLines || 8);
  const errors = [];
  if (!summary.ends_with_p1) errors.push("PPLA deve terminar com P1 antes de E.");
  if (summary.contains_p20) errors.push("PPLA nao pode conter P20.");
  if (summary.contains_q0001) errors.push("PPLA nao pode usar Q0001 como altura.");
  if (!summary.contains_q480 && options.requireQ480 !== false) {
    errors.push("PPLA deve conter Q480 (altura 60mm).");
  }
  return { ...summary, ok: errors.length === 0, errors };
}

function buildArgoxPplaMinimalCommand(config = {}) {
  const labelWidthDots = normalizeNumber(config.label_width_dots, 320);
  const labelHeightDots = normalizeNumber(config.label_height_dots, 480);
  const gapDots = normalizeNumber(config.label_gap_dots, 24);
  const x = normalizeNumber(config.origin_x, 14);
  const yTitle = normalizeNumber(config.title_y, 190);
  const yCode = normalizeNumber(config.code_y, 250);

  return [
    "\x02L\r",
    "D\r",
    `H${padNumber(gapDots, 3)}\r`,
    `Q${padNumber(labelHeightDots, 4)}\r`,
    `q${padNumber(labelWidthDots, 4)}\r`,
    `A${x},${yTitle},0,2,1,1,N,"TESTE AEROSTORE"\r`,
    `A${x},${yCode},0,2,1,1,N,"COD 123456"\r`,
    "P1\r",
    "E\r"
  ].join("");
}

module.exports = {
  padNumber,
  resolveSafeTestMode,
  resolveEffectiveQuantity,
  splitCommandLines,
  summarizeCommand,
  validatePplaCommand,
  buildArgoxPplaMinimalCommand
};
