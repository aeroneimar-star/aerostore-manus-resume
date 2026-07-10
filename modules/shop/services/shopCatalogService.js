"use strict";

const {
  loadShopSettings,
  loadPilotPublications,
  isPilotJsonEnabled
} = require("./shopSettingsService");
const {
  toCatalogListItem,
  toCatalogDetail
} = require("../dto/publicProductDto");

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getPublishedPublications() {
  if (!isPilotJsonEnabled()) {
    return [];
  }
  const pilot = loadPilotPublications();
  return (Array.isArray(pilot.publications) ? pilot.publications : [])
    .filter((item) => normalizeText(item.status) === "published")
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function buildCategoryFilters(publications = []) {
  const map = new Map();
  for (const pub of publications) {
    const slug = normalizeText(pub.public_category_slug);
    if (!slug) continue;
    const current = map.get(slug) || {
      slug,
      label: normalizeText(pub.public_category_label || slug),
      count: 0
    };
    current.count += 1;
    map.set(slug, current);
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

function buildColorFilters(publications = []) {
  const map = new Map();
  for (const pub of publications) {
    for (const variant of Array.isArray(pub.variants) ? pub.variants : []) {
      const slug = normalizeText(variant.color_slug);
      if (!slug) continue;
      const current = map.get(slug) || {
        slug,
        label: normalizeText(variant.color),
        count: 0
      };
      current.count += 1;
      map.set(slug, current);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

function buildSizeFilters(publications = []) {
  const map = new Map();
  for (const pub of publications) {
    for (const variant of Array.isArray(pub.variants) ? pub.variants : []) {
      const slug = normalizeText(variant.size_slug);
      if (!slug) continue;
      const current = map.get(slug) || {
        slug,
        label: normalizeText(variant.size),
        count: 0
      };
      current.count += 1;
      map.set(slug, current);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

function listCatalog(query = {}) {
  const settings = loadShopSettings();
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(
    settings?.catalog?.max_page_limit || 48,
    Math.max(1, Number.parseInt(query.limit, 10) || settings?.catalog?.default_page_limit || 24)
  );
  const category = normalizeText(query.category).toLowerCase();
  const featuredOnly = String(query.featured || "").toLowerCase() === "true";

  let publications = getPublishedPublications();
  if (category) {
    publications = publications.filter((item) => (
      normalizeText(item.public_category_slug).toLowerCase() === category
    ));
  }
  if (featuredOnly) {
    publications = publications.filter((item) => Boolean(item.featured));
  }

  const total = publications.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;
  const slice = publications.slice(offset, offset + limit);

  return {
    success: true,
    page,
    limit,
    total,
    total_pages: totalPages,
    items: slice.map(toCatalogListItem),
    filters: {
      categories: buildCategoryFilters(getPublishedPublications())
    }
  };
}

function listCatalogFilters() {
  const publications = getPublishedPublications();
  return {
    success: true,
    categories: buildCategoryFilters(publications),
    colors: buildColorFilters(publications),
    sizes: buildSizeFilters(publications)
  };
}

function getProductBySlug(slug = "") {
  const normalizedSlug = normalizeText(slug).toLowerCase();
  if (!normalizedSlug) {
    return null;
  }
  const publication = getPublishedPublications().find((item) => (
    normalizeText(item.public_slug).toLowerCase() === normalizedSlug
  ));
  if (!publication) {
    return null;
  }
  return {
    success: true,
    product: toCatalogDetail(publication)
  };
}

module.exports = {
  listCatalog,
  listCatalogFilters,
  getProductBySlug,
  getPublishedPublications
};
