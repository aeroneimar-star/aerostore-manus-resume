"use strict";

const { loadSiteContentConfig, buildWhatsAppUrl } = require("../../public-site/services/publicSiteConfig");
const { listCatalog, listCatalogFilters, getProductBySlug } = require("../services/shopCatalogService");
const { formatPriceBrl } = require("../dto/publicProductDto");
const { COLOR_SWATCH_MAP, resolveActionLabel, resolveStatusCopy } = require("../dto/catalogListDto");

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderColorSwatches(colorSlugs = [], colors = []) {
  const slugs = Array.isArray(colorSlugs) ? colorSlugs : [];
  const labels = Array.isArray(colors) ? colors : [];
  if (!slugs.length) {
    return "";
  }
  return `
    <div class="shop-swatches" aria-label="Cores disponíveis">
      ${slugs.map((slug, index) => {
        const label = labels[index] || slug;
        const fill = COLOR_SWATCH_MAP[String(slug).toLowerCase()] || "#8f8268";
        const border = slug === "branco" ? " shop-swatch--light" : "";
        return `<span class="shop-swatch${border}" style="--swatch:${fill}" title="${escapeHtml(label)}" aria-hidden="true"></span>`;
      }).join("")}
      <span class="shop-swatches-label">${escapeHtml(labels.slice(0, 2).join(" · "))}${labels.length > 2 ? ` +${labels.length - 2}` : ""}</span>
    </div>
  `;
}

function renderSizePills(sizes = []) {
  const list = Array.isArray(sizes) ? sizes.filter(Boolean) : [];
  if (!list.length) {
    return "";
  }
  const visible = list.slice(0, 4);
  const extra = list.length > visible.length ? ` +${list.length - visible.length}` : "";
  return `
    <p class="shop-sizes">
      ${visible.map((size) => `<span class="shop-size-pill">${escapeHtml(size)}</span>`).join("")}
      ${extra ? `<span class="shop-size-more">${escapeHtml(extra.trim())}</span>` : ""}
    </p>
  `;
}

function renderShopHead(options = {}) {
  const title = escapeHtml(options.title || "AEROSTORE");
  const description = escapeHtml(options.description || "Catálogo AEROSTORE — moda premium.");
  const extraCss = Array.isArray(options.extraCss) ? options.extraCss : [];
  return `
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="index,follow">
  <link rel="icon" href="/assets/img/icone-dourado.png" type="image/png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400&family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/site.css">
  <link rel="stylesheet" href="/shop/assets/css/shop.css">
  ${extraCss.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("\n  ")}
  `;
}

function renderShopHeader(activePath = "") {
  const site = loadSiteContentConfig();
  const brand = site?.brand?.trade_name || "AEROSTORE";
  const whatsappUrl = buildWhatsAppUrl(site?.contact?.whatsapp_phone || "");
  const instagramUrl = site?.contact?.instagram_url || "";
  const instagramHandle = site?.contact?.instagram_handle || "aerostore.oficial";

  const navClass = (path) => (activePath === path ? "is-active" : "");

  return `
    <header class="site-header" data-site-header>
      <div class="site-header-inner">
        <a class="brand-lockup" href="/" aria-label="${escapeHtml(brand)} — página inicial">
          <img class="brand-logo-name" src="/assets/img/escrita-branca-aerostore.png" alt="${escapeHtml(brand)}" width="2000" height="2000" decoding="async">
        </a>
        <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav">
          <span class="nav-toggle-label">Menu</span>
        </button>
        <div class="header-end">
          <div class="header-actions" aria-label="Canais principais">
            ${whatsappUrl ? `<a class="header-action" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}
            ${instagramUrl ? `<a class="header-action" href="${escapeHtml(instagramUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(instagramHandle)}</a>` : ""}
          </div>
          <nav class="site-nav" id="site-nav" data-site-nav aria-label="Principal">
            <a href="/" class="${navClass("/")}">Início</a>
            <a href="/catalogo" class="${navClass("/catalogo")}">Catálogo</a>
            <a href="/#contato">Contato</a>
            <a href="/privacidade">Privacidade</a>
          </nav>
        </div>
      </div>
    </header>
  `;
}

function renderShopFooter() {
  const site = loadSiteContentConfig();
  const brand = site?.brand?.trade_name || "AEROSTORE";
  return `
    <footer class="site-footer shop-footer">
      <div class="site-footer-inner shop-footer-inner">
        <p class="shop-footer-note">Vitrine piloto · atendimento pelo WhatsApp em breve · compra online em fase de preparação.</p>
        <p>&copy; ${escapeHtml(brand)} · <a href="/privacidade">Privacidade</a> · <a href="/termos">Termos</a></p>
      </div>
    </footer>
  `;
}

function renderShopShell(bodyHtml = "", options = {}) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  ${renderShopHead(options)}
</head>
<body class="shop-body">
  <div class="site-shell shop-shell">
    ${renderShopHeader(options.activePath || "")}
    ${bodyHtml}
    ${renderShopFooter()}
  </div>
  <script src="/assets/js/site.js" defer></script>
  <script src="/shop/assets/js/shop.js" defer></script>
</body>
</html>`;
}

function renderFilterBar(filters = {}, activeCategory = "") {
  const categories = Array.isArray(filters.categories) ? filters.categories : [];
  if (!categories.length) {
    return "";
  }
  return `
    <div class="shop-filter-bar" role="navigation" aria-label="Filtrar por categoria">
      <a class="shop-filter-chip${activeCategory ? "" : " is-active"}" href="/catalogo">Todas</a>
      ${categories.map((item) => `
        <a class="shop-filter-chip${activeCategory === item.slug ? " is-active" : ""}" href="/catalogo?category=${escapeHtml(item.slug)}">
          ${escapeHtml(item.label)} <span class="shop-filter-count">${Number(item.count || 0)}</span>
        </a>
      `).join("")}
    </div>
  `;
}

function renderCatalogCard(item = {}) {
  const slug = escapeHtml(item.slug);
  const compareHtml = item.compare_at_price_cents
    ? `<span class="shop-price-compare">${escapeHtml(formatPriceBrl(item.compare_at_price_cents))}</span>`
    : "";
  const featuredBadge = item.featured
    ? `<span class="shop-card-badge">Destaque</span>`
    : "";

  return `
    <article class="shop-card">
      <a class="shop-card-media" href="/produto/${slug}" aria-label="${escapeHtml(item.title)}">
        ${featuredBadge}
        <img src="${escapeHtml(item.primary_image?.url || "/shop/assets/img/pilot/placeholder.svg")}" alt="${escapeHtml(item.primary_image?.alt || item.title)}" loading="lazy" decoding="async" class="shop-card-photo">
      </a>
      <div class="shop-card-body">
        <p class="shop-card-category">${escapeHtml(item.category_label || item.category_slug)}</p>
        <h2 class="shop-card-title"><a href="/produto/${slug}">${escapeHtml(item.title)}</a></h2>
        ${renderColorSwatches(item.color_slugs, item.colors)}
        ${renderSizePills(item.sizes)}
        <div class="shop-card-price-row">
          <span class="shop-price">${escapeHtml(formatPriceBrl(item.price_cents))}</span>
          ${compareHtml}
        </div>
        <p class="shop-card-status">${escapeHtml(item.status_copy || resolveStatusCopy(item.availability))}</p>
        <a class="shop-card-cta" href="/produto/${slug}">${escapeHtml(item.action_label || resolveActionLabel(item.availability))}</a>
      </div>
    </article>
  `;
}

function renderCatalogPage(query = {}) {
  const site = loadSiteContentConfig();
  const brand = site?.brand?.trade_name || "AEROSTORE";
  const activeCategory = String(query.category || "").trim().toLowerCase();
  const catalog = listCatalog({ ...query, limit: 48 });
  const filters = listCatalogFilters();
  const cards = (catalog.items || []).map(renderCatalogCard).join("");

  const body = `
    <main class="site-main shop-main">
      <section class="shop-hero">
        <div class="shop-hero-copy">
          <h1>Seleção ${escapeHtml(brand)}</h1>
          <p class="shop-hero-lead">Curadoria de moda masculina premium em Ribeirão Preto. Peças escolhidas para compor looks com a cara AEROSTORE — explore a vitrine piloto.</p>
        </div>
        <p class="shop-hero-meta">${Number(catalog.total || 0)} peça${Number(catalog.total || 0) === 1 ? "" : "s"} na vitrine</p>
      </section>
      ${renderFilterBar(filters, activeCategory)}
      <section class="shop-grid" aria-label="Produtos">
        ${cards || '<p class="shop-empty">Nenhum produto publicado no momento.</p>'}
      </section>
    </main>
  `;

  return renderShopShell(body, {
    title: `Catálogo | ${brand}`,
    description: "Catálogo AEROSTORE — moda premium com curadoria de boutique.",
    activePath: "/catalogo",
    extraCss: ["/shop/assets/css/catalog.css"]
  });
}

function renderProductColorBlock(variants = []) {
  const colors = [];
  const seen = new Set();
  for (const variant of variants) {
    const key = String(variant.color_slug || variant.color || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    colors.push({ slug: key, label: variant.color });
  }
  if (!colors.length) return "";
  return `
    <div class="shop-picker" aria-label="Cores na seleção">
      <p class="shop-picker-label">Cor</p>
      <div class="shop-picker-options">
        ${colors.map((item) => {
          const fill = COLOR_SWATCH_MAP[item.slug] || "#8f8268";
          const light = item.slug === "branco" || item.slug === "areia" ? " shop-swatch--light" : "";
          return `<span class="shop-picker-chip"><span class="shop-swatch${light}" style="--swatch:${fill}"></span>${escapeHtml(item.label)}</span>`;
        }).join("")}
      </div>
    </div>
  `;
}

function renderProductSizeBlock(variants = []) {
  const sizes = Array.from(new Set(variants.map((v) => v.size).filter(Boolean)));
  if (!sizes.length) return "";
  return `
    <div class="shop-picker" aria-label="Tamanhos na seleção">
      <p class="shop-picker-label">Tamanho</p>
      <div class="shop-picker-options shop-picker-options--sizes">
        ${sizes.map((size) => `<span class="shop-size-pill shop-size-pill--picker">${escapeHtml(size)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderProductGallery(images = [], title = "") {
  const list = Array.isArray(images) ? images : [];
  const primary = list[0] || { url: "/shop/assets/img/pilot/placeholder.svg", alt: title };
  const thumbs = list.length > 1
    ? `<div class="shop-gallery-thumbs">${list.map((img, i) => `
        <button type="button" class="shop-gallery-thumb${i === 0 ? " is-active" : ""}" data-gallery-src="${escapeHtml(img.url)}" data-gallery-alt="${escapeHtml(img.alt || title)}" aria-label="Ver imagem ${i + 1}">
          <img src="${escapeHtml(img.url)}" alt="" loading="lazy">
        </button>
      `).join("")}</div>`
    : "";
  return `
    <div class="shop-product-gallery" data-product-gallery>
      <div class="shop-gallery-stage">
        <img src="${escapeHtml(primary.url)}" alt="${escapeHtml(primary.alt || title)}" decoding="async" data-gallery-main>
      </div>
      ${thumbs}
    </div>
  `;
}

function renderVariantRows(variants = []) {
  return variants.map((variant) => `
    <tr>
      <td>${escapeHtml(variant.color)}</td>
      <td>${escapeHtml(variant.size)}</td>
      <td>${escapeHtml(formatPriceBrl(variant.price_cents))}</td>
      <td><span class="shop-variant-status shop-variant-status--${escapeHtml(variant.availability)}">${escapeHtml(resolveStatusCopy(variant.availability))}</span></td>
    </tr>
  `).join("");
}

function renderProductPage(slug = "") {
  const payload = getProductBySlug(slug);
  if (!payload?.product) {
    return null;
  }
  const product = payload.product;
  const site = loadSiteContentConfig();
  const brand = site?.brand?.trade_name || "AEROSTORE";
  const compareHtml = product.compare_at_price_cents
    ? `<span class="shop-price-compare">${escapeHtml(formatPriceBrl(product.compare_at_price_cents))}</span>`
    : "";

  const body = `
    <main class="site-main shop-main shop-product-main">
      <nav class="shop-breadcrumb" aria-label="Navegação">
        <a href="/">Início</a>
        <span aria-hidden="true">/</span>
        <a href="/catalogo">Catálogo</a>
        <span aria-hidden="true">/</span>
        <span>${escapeHtml(product.title)}</span>
      </nav>
      <article class="shop-product">
        ${renderProductGallery(product.images, product.title)}
        <div class="shop-product-info">
          <p class="shop-product-category">${escapeHtml(product.category_label)}</p>
          <h1>${escapeHtml(product.title)}</h1>
          <div class="shop-card-price-row shop-product-price-row">
            <span class="shop-price shop-price--large">${escapeHtml(formatPriceBrl(product.price_cents))}</span>
            ${compareHtml}
          </div>
          <p class="shop-product-description">${escapeHtml(product.description)}</p>
          ${renderProductColorBlock(product.variants)}
          ${renderProductSizeBlock(product.variants)}
          <p class="shop-product-status">${escapeHtml(resolveStatusCopy(product.availability))}</p>
          <button type="button" class="shop-card-cta shop-product-cta shop-product-cta--primary" disabled aria-disabled="true">Consultar disponibilidade</button>
          <p class="shop-product-note">Compra online em fase de preparação. Atendimento pelo WhatsApp em breve.</p>
          <a class="shop-product-back" href="/catalogo">← Voltar ao catálogo</a>
        </div>
      </article>
      ${product.variants?.length ? `
        <section class="shop-variant-table-wrap" aria-labelledby="variant-heading">
          <h2 id="variant-heading">Variações disponíveis na seleção</h2>
          <div class="shop-variant-table-scroll">
            <table class="shop-variant-table">
              <thead>
                <tr>
                  <th>Cor</th>
                  <th>Tamanho</th>
                  <th>Preço</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${renderVariantRows(product.variants)}
              </tbody>
            </table>
          </div>
        </section>
      ` : ""}
    </main>
  `;

  return renderShopShell(body, {
    title: product.seo?.title || `${product.title} | ${brand}`,
    description: product.seo?.description || product.description,
    activePath: "/catalogo",
    extraCss: ["/shop/assets/css/catalog.css", "/shop/assets/css/product.css"]
  });
}

module.exports = {
  renderCatalogPage,
  renderProductPage,
  renderShopShell
};
