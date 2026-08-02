"use strict";

/**
 * PostalCodeService — CEP lookup isolado
 *
 * Regras:
 * - normalizar CEP brasileiro (8 digitos)
 * - usar timeout
 * - resposta sanitizada
 * - cache curto em memoria (LRU simples)
 * - nao persistir resposta externa integral
 * - nao expor erro tecnico
 * - se provedor indisponivel: permitir entrada manual
 */

const DEFAULT_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const MAX_CACHE_SIZE = 200;

class PostalCodeError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "PostalCodeError";
    this.code = code;
    this.status = status || 500;
  }
}

function normalizePostalCode(value) {
  const raw = String(value || "").replace(/\D/g, "");
  if (raw.length !== 8) return null;
  return raw;
}

function maskPostalCode(cep) {
  const raw = String(cep || "").replace(/\D/g, "");
  if (raw.length !== 8) return "";
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function createLruCache(maxSize, ttlMs) {
  const map = new Map();
  function get(key) {
    if (!map.has(key)) return null;
    const entry = map.get(key);
    if (Date.now() - entry.timestamp > ttlMs) { map.delete(key); return null; }
    map.delete(key); map.set(key, entry);
    return entry.value;
  }
  function set(key, value) {
    if (map.has(key)) map.delete(key);
    if (map.size >= maxSize) { const firstKey = map.keys().next().value; map.delete(firstKey); }
    map.set(key, { value, timestamp: Date.now() });
  }
  function clear() { map.clear(); }
  return { get, set, clear };
}

function createPostalCodeService(options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const apiUrl = options.apiUrl || process.env.VIA_CEP_API_URL || "https://viacep.com.br/ws";
  const cache = options.cache || createLruCache(MAX_CACHE_SIZE, CACHE_TTL_MS);
  const clock = options.clock || (() => Date.now());

  function sanitizeViaCep(raw) {
    if (!raw || typeof raw !== "object") return null;
    const city = String(raw.localidade || "").trim();
    const state = String(raw.uf || "").trim().toUpperCase();
    if (city.length < 2 || state.length !== 2) return null;
    return {
      postalCode: String(raw.cep || "").replace(/\D/g, ""),
      street: String(raw.logradouro || "").trim(),
      neighborhood: String(raw.bairro || "").trim(),
      city,
      state,
      source: "viacep",
      found: Boolean(raw.logradouro || raw.bairro || raw.localidade),
      manualEntryAllowed: true
    };
  }

  async function lookup(cep) {
    const normalized = normalizePostalCode(cep);
    if (!normalized) throw new PostalCodeError("INVALID_POSTAL_CODE", 400, "CEP deve conter 8 digitos.");

    const cached = cache.get(normalized);
    if (cached) return { ...cached, postalCode: normalized, postalCodeMasked: maskPostalCode(normalized) };

    if (!fetchImpl) {
      return { postalCode: normalized, postalCodeMasked: maskPostalCode(normalized), street: "", neighborhood: "", city: "", state: "", source: "unavailable", found: false, manualEntryAllowed: true };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${apiUrl}/${normalized}/json/`, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) {
          const code = response.status === 404 ? "POSTAL_CODE_NOT_FOUND" : "POSTAL_CODE_SERVICE_UNAVAILABLE";
          throw new PostalCodeError(code, response.status === 404 ? 404 : 503, code === "POSTAL_CODE_NOT_FOUND" ? "CEP nao encontrado." : "Servico de CEP indisponivel no momento.");
        }
        const data = await response.json();
        if (data && data.erro === true) {
          return { postalCode: normalized, postalCodeMasked: maskPostalCode(normalized), street: "", neighborhood: "", city: "", state: "", source: "viacep", found: false, manualEntryAllowed: true };
        }
        const sanitized = sanitizeViaCep(data);
        if (sanitized) {
          sanitized.postalCode = normalized;
          sanitized.postalCodeMasked = maskPostalCode(normalized);
          cache.set(normalized, sanitized);
          return sanitized;
        }
        return { postalCode: normalized, postalCodeMasked: maskPostalCode(normalized), street: "", neighborhood: "", city: "", state: "", source: "viacep", found: false, manualEntryAllowed: true };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error instanceof PostalCodeError) throw error;
      if (error && error.name === "AbortError") {
        throw new PostalCodeError("POSTAL_CODE_SERVICE_TIMEOUT", 504, "Servico de CEP excedeu o tempo de resposta.");
      }
      throw new PostalCodeError("POSTAL_CODE_SERVICE_UNAVAILABLE", 503, "Servico de CEP indisponivel no momento.");
    }
  }

  function clearCache() { cache.clear(); }

  return { lookup, clearCache, normalizePostalCode, maskPostalCode };
}

module.exports = { PostalCodeError, createPostalCodeService, normalizePostalCode, maskPostalCode };
