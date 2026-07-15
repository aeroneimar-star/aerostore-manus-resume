"use strict";

const BRAZIL_UFS = Object.freeze([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO"
]);

const FISCAL_ORIGIN_CODES = Object.freeze(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeUf(value = "") {
  return normalizeText(value).toUpperCase().slice(0, 2);
}

function isValidUf(value = "") {
  const uf = normalizeUf(value);
  if (!uf) return false;
  return BRAZIL_UFS.includes(uf);
}

/** Aceita vazio (nulo) ou UF brasileira válida. */
function isValidUfOrEmpty(value = "") {
  const uf = normalizeUf(value);
  return !uf || BRAZIL_UFS.includes(uf);
}

function isValidFiscalOrigin(value = "") {
  if (value === 0 || value === "0") return true;
  const text = normalizeText(String(value ?? ""));
  return FISCAL_ORIGIN_CODES.includes(text);
}

function isValidCnpj(value = "") {
  const digits = normalizeDigits(value);
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) {
    return false;
  }
  const calc = (base, factors) => {
    const sum = factors.reduce((acc, factor, index) => acc + Number(base[index]) * factor, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(digits[12]) === d1 && Number(digits[13]) === d2;
}

function isValidNcm(value = "") {
  const digits = normalizeDigits(value);
  return digits.length === 8;
}

function isValidGtin(value = "") {
  const digits = normalizeDigits(value);
  if (![8, 12, 13, 14].includes(digits.length)) {
    return false;
  }
  if (/^0+$/.test(digits)) {
    return false;
  }
  return true;
}

function isValidCfop(value = "") {
  const digits = normalizeDigits(value);
  return digits.length === 4;
}

module.exports = {
  BRAZIL_UFS,
  FISCAL_ORIGIN_CODES,
  normalizeText,
  normalizeDigits,
  normalizeUf,
  isValidUf,
  isValidUfOrEmpty,
  isValidFiscalOrigin,
  isValidCnpj,
  isValidNcm,
  isValidGtin,
  isValidCfop
};
