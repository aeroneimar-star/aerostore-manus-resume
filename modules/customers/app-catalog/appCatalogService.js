"use strict";

const { detailDto, envelope, listItemDto } = require("./appCatalogDto");

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 24;
const TEST_PRODUCT_PATTERNS = [
  /\bqa\b/i, /\bteste\b/i, /\btest\b/i, /testex/i, /manual normalizado/i,
  /grade api/i, /ciclo 2 api/i, /ciclo 3/i, /ciclo 4/i, /smoke/i,
  /sandbox/i, /\bmassa\b/i, /dummy/i, /fake/i
];

class AppCatalogError extends Error {
  constructor(code, status = 400, message = "Nao foi possivel carregar o catalogo.") {
    super(message); this.name = "AppCatalogError"; this.code = code; this.status = status;
  }
}

function clean(value = "") { return String(value || "").replace(/\s+/g, " ").trim(); }
function slugify(value = "") {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "produto";
}
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function positiveInteger(value, fallback, code) {
  if (value === undefined || value === "") return fallback;
  if (Array.isArray(value) || !/^\d+$/.test(String(value))) throw new AppCatalogError(code);
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AppCatalogError(code);
  return parsed;
}
function parseAttributes(value) { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; } }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function availability(qty) { return qty > 2 ? "in_stock" : qty > 0 ? "low_stock" : "out_of_stock"; }
function statusCopy(status) { return status === "in_stock" ? "Disponivel na colecao" : status === "low_stock" ? "Ultimas disponibilidades" : "Indisponivel no momento"; }
function publicImageUrl(filePath = "") {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const marker = "/public/"; const index = normalized.toLowerCase().lastIndexOf(marker);
  if (index < 0) return "";
  return `/${normalized.slice(index + marker.length).split("/").map(encodeURIComponent).join("/")}`;
}
function isTestProduct(name) { return TEST_PRODUCT_PATTERNS.some((pattern) => pattern.test(clean(name))); }

function normalizeQuery(query = {}) {
  const allowed = new Set(["page", "pageSize", "categoria", "marca", "busca", "ordenacao"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) throw new AppCatalogError("INVALID_FILTER");
  const page = positiveInteger(query.page, 1, "INVALID_PAGE");
  const pageSize = positiveInteger(query.pageSize, DEFAULT_PAGE_SIZE, "INVALID_PAGE_SIZE");
  if (pageSize > MAX_PAGE_SIZE) throw new AppCatalogError("INVALID_PAGE_SIZE");
  const sort = clean(query.ordenacao || "recentes").toLowerCase();
  if (!["recentes", "nome_asc", "nome_desc", "preco_asc", "preco_desc"].includes(sort)) throw new AppCatalogError("INVALID_SORT");
  return { page, pageSize, category: clean(query.categoria).toLowerCase(), brand: clean(query.marca).toLowerCase(), search: clean(query.busca).toLowerCase(), sort };
}

function createAppCatalogService(options = {}) {
  const db = options.dbApi;
  if (!db?.all) throw new Error("APP_CATALOG_DB_REQUIRED");

  async function loadProducts() {
    const rows = await db.all(`SELECT
      p.id AS product_id, p.legacy_ai_product_id, p.name, p.base_sku, p.sale_price_cents, p.updated_at,
      a.commercial_name, a.category, a.marca, a.short_description, a.ai_short_description,
      a.sales_argument, a.promotional_price, a.main_media_id, main_media.file_path AS main_media_path,
      v.id AS variant_id, v.sku AS variant_sku, v.attributes_json,
      COALESCE(v.sale_price_cents, p.sale_price_cents) AS variant_price_cents,
      b.available_qty, b.reserved_qty
    FROM pdv_products_v2 p
    INNER JOIN pdv_product_variants v ON v.product_id = p.id AND v.status = 'ativo'
    LEFT JOIN ai_products a ON a.id = p.legacy_ai_product_id
    LEFT JOIN campaign_media main_media ON main_media.id = a.main_media_id AND main_media.status = 'active'
    LEFT JOIN pdv_inventory_balances_v2 b ON b.variant_id = v.id
    WHERE p.status = 'ativo'
    ORDER BY p.updated_at DESC, p.id DESC, v.created_at ASC, v.id ASC`);
    const mediaRows = await db.all(`SELECT apm.product_id, apm.sort_order, cm.file_path
      FROM ai_product_media apm INNER JOIN campaign_media cm ON cm.id = apm.media_id AND cm.status = 'active'
      ORDER BY apm.product_id, apm.sort_order, apm.id`);
    const mediaByLegacy = new Map();
    mediaRows.forEach((row) => {
      const url = publicImageUrl(row.file_path); if (!url) return;
      if (!mediaByLegacy.has(String(row.product_id))) mediaByLegacy.set(String(row.product_id), []);
      mediaByLegacy.get(String(row.product_id)).push({ url, sort_order: number(row.sort_order), role: number(row.sort_order) === 0 ? "primary" : "gallery" });
    });
    const products = new Map();
    rows.forEach((row) => {
      if (isTestProduct(row.name)) return;
      const key = String(row.product_id);
      if (!products.has(key)) {
        const title = clean(row.commercial_name || row.name);
        const category = clean(row.category) || "Outros";
        const brand = clean(row.marca) || "AEROSTORE";
        const fallbackImage = publicImageUrl(row.main_media_path);
        const actualMedia = mediaByLegacy.get(String(row.legacy_ai_product_id || "")) || [];
        const mergedImages = (actualMedia.length ? actualMedia : (fallbackImage ? [{ url: fallbackImage, sort_order: 0 }] : []))
          .map((image, index) => ({ ...image, role: index === 0 ? "primary" : "gallery" }));
        const summary = clean(row.ai_short_description || row.short_description || row.sales_argument) || "Selecao oficial AEROSTORE.";
        const regular = number(row.sale_price_cents);
        const promo = Math.round(number(row.promotional_price) * 100);
        products.set(key, {
          id: key, sku: clean(row.base_sku), slug: `${slugify(title)}-${key}`, title,
          short_description: summary, description: summary, brand,
          category_slug: slugify(category), category_label: category,
          price_cents: promo > 0 && promo < regular ? promo : regular,
          compare_at_price_cents: promo > 0 && promo < regular ? regular : null,
          featured: false, updated_at: row.updated_at, images: mergedImages.map((image) => ({ ...image, alt: title })),
          variants: [], _variants: new Map()
        });
      }
      const product = products.get(key); const attrs = parseAttributes(row.attributes_json);
      if (!product._variants.has(row.variant_id)) product._variants.set(row.variant_id, { sku: row.variant_sku, color: clean(attrs.color), size: clean(attrs.size), price_cents: number(row.variant_price_cents), qty: 0 });
      const variant = product._variants.get(row.variant_id);
      variant.qty += Math.max(0, number(row.available_qty) - number(row.reserved_qty));
    });
    return [...products.values()].map((product) => {
      const variants = [...product._variants.values()].map((variant) => {
        const state = availability(variant.qty);
        return { slug: `${product.slug}-${slugify([variant.color, variant.size].filter(Boolean).join("-"))}`, color: variant.color, color_slug: slugify(variant.color), size: variant.size, size_slug: slugify(variant.size), price_cents: product.compare_at_price_cents ? product.price_cents : (variant.price_cents || product.price_cents), compare_at_price_cents: product.compare_at_price_cents, availability: state };
      });
      const totalQty = [...product._variants.values()].reduce((sum, variant) => sum + variant.qty, 0);
      const state = availability(totalQty); const { _variants, ...cleanProduct } = product;
      return { ...cleanProduct, availability: state, primary_image: product.images[0] || null, variant_count: variants.length, colors: unique(variants.map((item) => item.color)), color_slugs: unique(variants.map((item) => item.color_slug)), sizes: unique(variants.map((item) => item.size)), variants, action_label: "Ver produto", status_copy: statusCopy(state) };
    });
  }

  async function list(query = {}) {
    const params = normalizeQuery(query); let products = await loadProducts();
    products = products.filter((product) => (!params.category || product.category_slug === params.category || product.category_label.toLowerCase() === params.category)
      && (!params.brand || slugify(product.brand) === params.brand || product.brand.toLowerCase() === params.brand)
      && (!params.search || [product.title, product.sku, product.brand, product.category_label].some((value) => String(value).toLowerCase().includes(params.search))));
    const comparators = {
      recentes: (a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || Number(b.id) - Number(a.id),
      nome_asc: (a, b) => a.title.localeCompare(b.title, "pt-BR"), nome_desc: (a, b) => b.title.localeCompare(a.title, "pt-BR"),
      preco_asc: (a, b) => a.price_cents - b.price_cents, preco_desc: (a, b) => b.price_cents - a.price_cents
    };
    products.sort(comparators[params.sort]); const total = products.length; const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
    const items = products.slice((params.page - 1) * params.pageSize, params.page * params.pageSize).map(listItemDto);
    const categoryMap = new Map(); products.forEach((product) => { const current = categoryMap.get(product.category_slug) || { slug: product.category_slug, label: product.category_label, count: 0 }; current.count += 1; categoryMap.set(product.category_slug, current); });
    const filters = { categories: [...categoryMap.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR")) };
    return envelope({ items, pagination: { page: params.page, limit: params.pageSize, total, total_pages: totalPages }, filters });
  }

  async function categories() {
    const products = await loadProducts(); const map = new Map();
    products.forEach((product) => { const current = map.get(product.category_slug) || { slug: product.category_slug, label: product.category_label, count: 0 }; current.count += 1; map.set(product.category_slug, current); });
    return envelope({ categories: [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR")) });
  }

  async function detail(productId) {
    if (!/^\d+$/.test(String(productId || ""))) throw new AppCatalogError("PRODUCT_NOT_FOUND", 404, "Produto nao encontrado.");
    const product = (await loadProducts()).find((item) => item.id === String(productId));
    if (!product) throw new AppCatalogError("PRODUCT_NOT_FOUND", 404, "Produto nao encontrado.");
    return envelope({ product: detailDto(product) });
  }

  return { list, categories, detail, limits: { maxPageSize: MAX_PAGE_SIZE } };
}

module.exports = { AppCatalogError, createAppCatalogService, normalizeQuery, publicImageUrl, isTestProduct, MAX_PAGE_SIZE };
