"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config", "site-content.json");

let cachedConfig = null;
let cachedMtimeMs = 0;

function normalizeText(value = "") {
  return String(value || "").trim();
}

function getNestedValue(source, keyPath = "") {
  return String(keyPath || "")
    .split(".")
    .reduce((current, key) => (current && current[key] !== undefined ? current[key] : ""), source);
}

function loadSiteContentConfig() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (!cachedConfig || stat.mtimeMs !== cachedMtimeMs) {
      cachedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      cachedMtimeMs = stat.mtimeMs;
    }
    return cachedConfig;
  } catch (error) {
    throw new Error(`Falha ao carregar config do site público: ${error.message}`);
  }
}

function getPublicSiteBaseUrl() {
  const configured = normalizeText(process.env.AEROSTORE_PUBLIC_BASE_URL || "");
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const fromConfig = normalizeText(loadSiteContentConfig()?.seo?.site_url || "");
  return fromConfig.replace(/\/+$/, "");
}

function buildWhatsAppUrl(phone = "") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return `https://wa.me/${digits}`;
}

function buildInstagramUrl(handle = "") {
  const normalized = normalizeText(handle).replace(/^@+/, "");
  if (!normalized) {
    return "";
  }
  return `https://www.instagram.com/${normalized}`;
}

function formatStoreAddress(store = {}) {
  const lines = [
    normalizeText(store.street),
    normalizeText(store.district),
    [normalizeText(store.city), normalizeText(store.state)].filter(Boolean).join("/"),
    normalizeText(store.postal_code) ? `CEP ${normalizeText(store.postal_code)}` : ""
  ].filter(Boolean);
  return lines.join(" · ");
}

function renderStoreCards(stores = []) {
  const list = Array.isArray(stores) ? stores : [];
  if (!list.length) {
    return "";
  }
  return list.map((store, index) => `
    <article class="store-card">
      <span class="store-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
      <div class="store-body">
        <h3>${escapeHtml(store.name || "Loja")}</h3>
        <p class="store-address">${escapeHtml(formatStoreAddress(store))}</p>
        <p class="store-hours">${escapeHtml(store.hours || "")}</p>
      </div>
    </article>
  `).join("");
}

function renderExtraInstagramProfiles(profiles = []) {
  const list = Array.isArray(profiles) ? profiles : [];
  if (!list.length) {
    return "";
  }
  const links = list.map((profile) => {
    const handle = normalizeText(profile?.handle).replace(/^@+/, "");
    if (!handle) {
      return "";
    }
    const url = buildInstagramUrl(handle);
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(handle)}</a>`;
  }).filter(Boolean);
  if (!links.length) {
    return "";
  }
  return `
    <section class="section section-muted" id="canais-grupo" aria-label="Outros perfis do grupo">
      <div class="section-intro">
        <h2 class="section-title">Perfis complementares</h2>
        <p class="section-lead">Outros canais ligados à operação AEROSTORE. O perfil principal de marca e atendimento é @aerostore.oficial, nos canais oficiais acima.</p>
      </div>
      <div class="profile-links">
        ${links.join("")}
      </div>
    </section>
  `;
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTemplate(template = "", config = {}) {
  const baseUrl = getPublicSiteBaseUrl();
  const whatsappUrl = buildWhatsAppUrl(config.contact?.whatsapp_phone);
  const replacements = {
    "brand.trade_name": config.brand?.trade_name || "AEROSTORE",
    "brand.region_label": config.brand?.region_label || "",
    "brand.tagline": config.brand?.tagline || "",
    "brand.description": config.brand?.description || "",
    "brand.stores_intro": config.brand?.stores_intro || "",
    "company.legal_name": config.company?.legal_name || "",
    "company.cnpj_formatted": config.company?.cnpj_formatted || config.company?.cnpj || "",
    "contact.whatsapp_display": config.contact?.whatsapp_display || "",
    "contact.whatsapp_url": whatsappUrl,
    "contact.instagram_handle": config.contact?.instagram_handle || "",
    "contact.instagram_url": config.contact?.instagram_url || "",
    "contact.email": config.contact?.email || "",
    "seo.title": config.seo?.title || "AEROSTORE",
    "seo.description": config.seo?.description || "",
    "seo.og_image": config.seo?.og_image || "/assets/img/og-aerostore.png",
    "seo.site_url": baseUrl || "https://aerostore.site",
    "legal.privacy_updated": config.legal?.privacy_updated || "",
    "legal.terms_updated": config.legal?.terms_updated || "",
    "stores.cards_html": renderStoreCards(config.stores),
    "instagram.extra_profiles_html": renderExtraInstagramProfiles(config.instagram_profiles_extra),
    "year": String(new Date().getFullYear())
  };

  let output = String(template || "");
  Object.entries(replacements).forEach(([key, value]) => {
    output = output.split(`{{${key}}}`).join(String(value));
  });
  return output;
}

function readSiteTemplate(fileName = "") {
  const safeName = path.basename(String(fileName || ""));
  const templatePath = path.join(__dirname, "..", "..", "..", "public", "site", safeName);
  const resolved = path.resolve(templatePath);
  const siteRoot = path.resolve(path.join(__dirname, "..", "..", "..", "public", "site"));
  if (!resolved.startsWith(siteRoot)) {
    throw new Error("Caminho de template inválido.");
  }
  return fs.readFileSync(resolved, "utf8");
}

function renderSitePage(fileName = "") {
  const config = loadSiteContentConfig();
  const template = readSiteTemplate(fileName);
  return renderTemplate(template, config);
}

module.exports = {
  CONFIG_PATH,
  loadSiteContentConfig,
  getPublicSiteBaseUrl,
  buildWhatsAppUrl,
  renderSitePage,
  renderTemplate,
  escapeHtml
};
