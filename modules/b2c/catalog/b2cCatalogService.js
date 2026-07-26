"use strict";

const {
  loadShopSettings,
  isShopPublicCatalogEnabled
} = require("../../shop/services/shopSettingsService");
const { createPilotCatalogSource } = require("./sources/pilotCatalogSource");
const {
  toB2cCatalogResponse,
  toB2cFiltersResponse,
  toB2cProductResponse
} = require("./b2cCatalogDto");

const ALLOWED_CATALOG_FILTERS = new Set(["page", "limit", "category", "featured"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ERROR_DEFINITIONS = Object.freeze({
  INVALID_PAGE: {
    status: 400,
    message: "O parâmetro page deve ser um número inteiro maior ou igual a 1."
  },
  INVALID_LIMIT: {
    status: 400,
    message: "O parâmetro limit está fora do intervalo permitido."
  },
  INVALID_FILTER: {
    status: 400,
    message: "Um ou mais filtros informados são inválidos."
  },
  PRODUCT_NOT_FOUND: {
    status: 404,
    message: "Produto não encontrado."
  },
  CATALOG_SOURCE_UNAVAILABLE: {
    status: 503,
    message: "Catálogo temporariamente indisponível."
  },
  CATALOG_DISABLED: {
    status: 404,
    message: "Catálogo público desabilitado."
  },
  INTERNAL_ERROR: {
    status: 500,
    message: "Não foi possível processar a solicitação."
  }
});

class B2cCatalogError extends Error {
  constructor(code, details) {
    const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.INTERNAL_ERROR;
    super(definition.message);
    this.name = "B2cCatalogError";
    this.code = ERROR_DEFINITIONS[code] ? code : "INTERNAL_ERROR";
    this.status = definition.status;
    if (details && typeof details === "object") {
      this.details = details;
    }
  }
}

function readPositiveInteger(value, code, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (Array.isArray(value) || !/^\d+$/.test(String(value).trim())) {
    throw new B2cCatalogError(code);
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new B2cCatalogError(code);
  }
  return parsed;
}

function normalizeCatalogParams(query = {}, limits = {}) {
  const unknownFilter = Object.keys(query).find((key) => !ALLOWED_CATALOG_FILTERS.has(key));
  if (unknownFilter) {
    throw new B2cCatalogError("INVALID_FILTER", { filter: unknownFilter });
  }

  const page = readPositiveInteger(query.page, "INVALID_PAGE", 1);
  const limit = readPositiveInteger(query.limit, "INVALID_LIMIT", limits.defaultLimit);
  if (limit > limits.maxLimit) {
    throw new B2cCatalogError("INVALID_LIMIT", { max_limit: limits.maxLimit });
  }

  const params = { page, limit };
  if (query.category !== undefined) {
    if (Array.isArray(query.category)) {
      throw new B2cCatalogError("INVALID_FILTER", { filter: "category" });
    }
    const category = String(query.category).trim().toLowerCase();
    if (!category || !SLUG_PATTERN.test(category)) {
      throw new B2cCatalogError("INVALID_FILTER", { filter: "category" });
    }
    params.category = category;
  }
  if (query.featured !== undefined) {
    if (Array.isArray(query.featured)) {
      throw new B2cCatalogError("INVALID_FILTER", { filter: "featured" });
    }
    const featured = String(query.featured).trim().toLowerCase();
    if (!["true", "false"].includes(featured)) {
      throw new B2cCatalogError("INVALID_FILTER", { filter: "featured" });
    }
    params.featured = featured;
  }
  return params;
}

function normalizeProductSlug(value) {
  if (Array.isArray(value)) {
    throw new B2cCatalogError("INVALID_FILTER", { filter: "slug" });
  }
  const slug = String(value || "").trim().toLowerCase();
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new B2cCatalogError("INVALID_FILTER", { filter: "slug" });
  }
  return slug;
}

function isSourceUnavailableError(error) {
  return error?.code === "CATALOG_SOURCE_UNAVAILABLE"
    || error?.code === "ENOENT"
    || error?.code === "EACCES"
    || error instanceof SyntaxError;
}

function createB2cCatalogService(options = {}) {
  const settings = loadShopSettings();
  const defaultLimit = Number(options.defaultLimit || settings?.catalog?.default_page_limit || 24);
  const maxLimit = Number(options.maxLimit || settings?.catalog?.max_page_limit || 48);
  const source = options.source || createPilotCatalogSource();
  const catalogEnabled = options.isCatalogEnabled || isShopPublicCatalogEnabled;

  function ensureCatalogEnabled() {
    if (!catalogEnabled()) {
      throw new B2cCatalogError("CATALOG_DISABLED");
    }
  }

  function callSource(method, ...args) {
    if (!source || typeof source[method] !== "function") {
      throw new B2cCatalogError("CATALOG_SOURCE_UNAVAILABLE");
    }
    try {
      return source[method](...args);
    } catch (error) {
      if (error instanceof B2cCatalogError) {
        throw error;
      }
      if (isSourceUnavailableError(error)) {
        throw new B2cCatalogError("CATALOG_SOURCE_UNAVAILABLE");
      }
      throw new B2cCatalogError("INTERNAL_ERROR");
    }
  }

  function listCatalog(query = {}) {
    ensureCatalogEnabled();
    const params = normalizeCatalogParams(query, { defaultLimit, maxLimit });
    return toB2cCatalogResponse(callSource("listCatalog", params));
  }

  function getFilters() {
    ensureCatalogEnabled();
    return toB2cFiltersResponse(callSource("getFilters"));
  }

  function getProductBySlug(value) {
    ensureCatalogEnabled();
    const slug = normalizeProductSlug(value);
    const payload = callSource("getProductBySlug", slug);
    if (!payload?.product) {
      throw new B2cCatalogError("PRODUCT_NOT_FOUND");
    }
    return toB2cProductResponse(payload);
  }

  return {
    listCatalog,
    getFilters,
    getProductBySlug,
    limits: {
      defaultLimit,
      maxLimit
    }
  };
}

function toB2cErrorResponse(error) {
  const publicError = error instanceof B2cCatalogError
    ? error
    : new B2cCatalogError("INTERNAL_ERROR");
  const payload = {
    success: false,
    error: {
      code: publicError.code,
      message: publicError.message
    },
    meta: {
      api_version: "v1"
    }
  };
  if (publicError.details) {
    payload.error.details = publicError.details;
  }
  return {
    status: publicError.status,
    payload
  };
}

module.exports = {
  ALLOWED_CATALOG_FILTERS,
  ERROR_DEFINITIONS,
  B2cCatalogError,
  createB2cCatalogService,
  normalizeCatalogParams,
  normalizeProductSlug,
  toB2cErrorResponse
};
