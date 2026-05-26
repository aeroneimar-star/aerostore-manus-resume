"use strict";

function hasFlag(flagName = "--confirm") {
  return process.argv.includes(flagName);
}

function blockProduction(scriptName = "script") {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error(`${scriptName} bloqueado em producao. Scripts em /scripts sao ferramentas locais/QA.`);
  }
}

function requireExplicitConfirmation(flagName = "--confirm") {
  if (!hasFlag(flagName)) {
    throw new Error(`Este script pode alterar dados. Rode com ${flagName} apenas em ambiente local/QA.`);
  }
}

function isDryRun() {
  return hasFlag("--dry-run");
}

function warnLocalOnly(scriptName = "script") {
  console.warn(`[AEROSTORE scripts] ${scriptName}: uso local/QA. Nao execute em producao.`);
}

module.exports = {
  blockProduction,
  requireExplicitConfirmation,
  isDryRun,
  warnLocalOnly
};
