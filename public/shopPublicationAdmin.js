"use strict";

(function initShopPublicationAdmin(global) {
  const stateKey = "shopPublication";

  function ensureState(rootState) {
    if (!rootState[stateKey]) {
      rootState[stateKey] = {
        loading: false,
        error: "",
        schemaReady: false,
        pilotJsonActive: true,
        items: [],
        total: 0,
        page: 1,
        limit: 24,
        selectedKey: "",
        filters: {
          q: "",
          product_type: "",
          sellable: "",
          availability: "",
          publication_status: ""
        }
      };
    }
    return rootState[stateKey];
  }

  function canViewPanel(ctx = {}) {
    if (typeof ctx.getCurrentRole === "function" && ctx.getCurrentRole() === "admin") {
      return true;
    }
    return Boolean(
      typeof ctx.hasPermission === "function" && ctx.hasPermission("can_manage_global_settings")
    );
  }

  function formatMoney(ctx, cents = 0) {
    if (ctx.brlFormatter) {
      return ctx.brlFormatter.format(Math.max(0, Number(cents || 0)) / 100);
    }
    return `R$ ${(Number(cents || 0) / 100).toFixed(2).replace(".", ",")}`;
  }

  function availabilityLabel(value = "") {
    const map = {
      in_stock: "Em estoque",
      low_stock: "Estoque baixo",
      out_of_stock: "Indisponível"
    };
    return map[String(value || "").trim()] || "Indisponível";
  }

  function publicationStatusLabel(item = {}, schemaReady = false) {
    if (!schemaReady) {
      return "Schema pendente";
    }
    const map = {
      none: "Não publicado",
      draft: "Rascunho",
      published: "Publicado",
      archived: "Arquivado"
    };
    return map[String(item.publication_status || "none").trim()] || "Não publicado";
  }

  function getFilteredItems(pubState, ctx) {
    const filters = pubState.filters || {};
    return ctx.toArray(pubState.items).filter((item) => {
      const q = ctx.normalizeText(filters.q).toLowerCase();
      if (q && !ctx.normalizeText(item.name).toLowerCase().includes(q)) {
        return false;
      }
      if (filters.product_type && ctx.normalizeText(item.product_type) !== ctx.normalizeText(filters.product_type)) {
        return false;
      }
      if (filters.sellable === "true" && !item.sellable) return false;
      if (filters.sellable === "false" && item.sellable) return false;
      if (filters.availability && ctx.normalizeText(item.availability) !== ctx.normalizeText(filters.availability)) {
        return false;
      }
      if (filters.publication_status && ctx.normalizeText(item.publication_status) !== ctx.normalizeText(filters.publication_status)) {
        return false;
      }
      return true;
    });
  }

  function getPagedItems(pubState, ctx) {
    const filtered = getFilteredItems(pubState, ctx);
    const limit = Math.max(1, Number(pubState.limit || 24));
    const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
    const page = Math.min(Math.max(1, Number(pubState.page || 1)), totalPages);
    pubState.page = page;
    const start = (page - 1) * limit;
    return {
      filtered,
      rows: filtered.slice(start, start + limit),
      total: filtered.length,
      totalPages,
      page
    };
  }

  function buildChips(values = [], ctx) {
    return ctx.toArray(values).filter(Boolean).slice(0, 8)
      .map((value) => `<span class="shop-pub-chip">${ctx.escapeHtml(value)}</span>`)
      .join("");
  }

  function rowKey(item = {}) {
    return String(item.pdv_product_ref || item.name || "");
  }

  function buildTableRows(rows = [], pubState, ctx) {
    if (!rows.length) {
      return `
        <tr><td colspan="8">
          <div class="empty-state compact"><strong>Nenhum candidato nesta página.</strong><span>Ajuste os filtros ou atualize a lista.</span></div>
        </td></tr>`;
    }
    return rows.map((item) => {
      const key = rowKey(item);
      const selected = ctx.normalizeText(pubState.selectedKey) === ctx.normalizeText(key);
      return `
        <tr class="shop-pub-row${selected ? " is-selected" : ""}" data-shop-pub-select="${ctx.escapeHtml(key)}">
          <td><strong>${ctx.escapeHtml(item.name || "-")}</strong><small>${item.product_type === "variable" ? "Grade" : "Simples"}</small></td>
          <td>${formatMoney(ctx, item.price_cents)}</td>
          <td>${ctx.escapeHtml(String(item.variant_count || 0))}</td>
          <td><div class="shop-pub-chip-row">${buildChips(item.colors, ctx)}</div></td>
          <td><div class="shop-pub-chip-row">${buildChips(item.sizes, ctx)}</div></td>
          <td><span class="shop-pub-badge shop-pub-badge--${item.sellable ? "ok" : "muted"}">${item.sellable ? "Vendável" : "Bloqueado"}</span></td>
          <td><span class="shop-pub-badge shop-pub-badge--${ctx.escapeHtml(item.availability || "out_of_stock")}">${ctx.escapeHtml(availabilityLabel(item.availability))}</span></td>
          <td><span class="shop-pub-badge shop-pub-badge--pub">${ctx.escapeHtml(publicationStatusLabel(item, pubState.schemaReady))}</span></td>
        </tr>`;
    }).join("");
  }

  function buildDetailPanel(item, pubState, ctx) {
    if (!item) {
      return `
        <aside class="shop-pub-detail shop-pub-detail--empty">
          <p class="eyebrow">Detalhe editorial</p>
          <h4>Selecione um produto</h4>
          <p>Visualize variações, preço público e disponibilidade agregada.</p>
        </aside>`;
    }
    const variants = ctx.toArray(item.variants);
    return `
      <aside class="shop-pub-detail">
        <div class="shop-pub-detail-head">
          <p class="eyebrow">Candidato PDV</p>
          <h4>${ctx.escapeHtml(item.name || "-")}</h4>
          <p>${item.product_type === "variable" ? "Produto com grade" : "Produto simples"} · ${ctx.escapeHtml(String(item.variant_count || 0))} variações</p>
        </div>
        <div class="shop-pub-detail-kpis">
          <div><span>Preço base</span><strong>${formatMoney(ctx, item.price_cents)}</strong></div>
          <div><span>Disponibilidade</span><strong>${ctx.escapeHtml(availabilityLabel(item.availability))}</strong></div>
          <div><span>Publicação</span><strong>${ctx.escapeHtml(publicationStatusLabel(item, pubState.schemaReady))}</strong></div>
        </div>
        <div class="shop-pub-detail-section">
          <h5>Variações</h5>
          <div class="shop-pub-variant-list">
            ${variants.length ? variants.map((variant) => `
              <article class="shop-pub-variant-card">
                <div>
                  <strong>${ctx.escapeHtml([variant.color, variant.size].filter(Boolean).join(" · ") || "Variação")}</strong>
                  <small>${formatMoney(ctx, variant.price_cents)}</small>
                </div>
                <div class="shop-pub-variant-meta">
                  <span class="shop-pub-badge shop-pub-badge--${variant.sellable ? "ok" : "muted"}">${variant.sellable ? "Vendável" : "Bloqueado"}</span>
                  <span class="shop-pub-badge shop-pub-badge--${ctx.escapeHtml(variant.availability || "out_of_stock")}">${ctx.escapeHtml(availabilityLabel(variant.availability))}</span>
                </div>
              </article>
            `).join("") : `<div class="empty-state compact"><strong>Sem variações mapeadas.</strong></div>`}
          </div>
        </div>
        <div class="shop-pub-detail-actions">
          <button class="primary-button" type="button" disabled title="Disponível na Fase 2.9">Publicar</button>
          <button class="secondary-button" type="button" disabled title="Disponível após DDL + UI de escrita">Editar publicação</button>
        </div>
        <p class="shop-pub-readonly-note">Somente leitura — nenhuma alteração é gravada nesta fase.</p>
      </aside>`;
  }

  function renderFront(ctx) {
    const container = document.getElementById("shop-publication-content");
    if (!container) return;
    if (!canViewPanel(ctx)) {
      container.innerHTML = `
        <article class="hero-card">
          <p class="eyebrow">Acesso restrito</p>
          <h3>Shop — candidatos para publicação</h3>
          <p>Seu perfil não tem permissão para visualizar a fila editorial do e-commerce.</p>
        </article>`;
      return;
    }

    const pubState = ensureState(ctx.state);
    const filters = pubState.filters || {};
    const paged = getPagedItems(pubState, ctx);
    const selected = ctx.toArray(pubState.items).find((item) => ctx.normalizeText(rowKey(item)) === ctx.normalizeText(pubState.selectedKey)) || null;
    const sellableCount = paged.filtered.filter((item) => item.sellable).length;
    const inStockCount = paged.filtered.filter((item) => item.availability === "in_stock").length;

    container.innerHTML = `
      <section class="shop-pub-shell">
        <header class="shop-pub-hero">
          <div>
            <p class="eyebrow">E-commerce AEROSTORE · Fase 2.8</p>
            <h3>Candidatos PDV para publicação</h3>
            <p>Produtos reais do PDV prontos para virar vitrine online. Camada editorial ainda não grava alterações.</p>
          </div>
          <div class="shop-pub-hero-badges">
            <span class="shop-pub-status-pill${pubState.schemaReady ? " is-ready" : ""}">${pubState.schemaReady ? "Schema shop pronto" : "schema_ready=false"}</span>
            <span class="shop-pub-status-pill${pubState.pilotJsonActive ? " is-live" : ""}">${pubState.pilotJsonActive ? "Catálogo live: pilot JSON" : "Pilot JSON inativo"}</span>
          </div>
        </header>
        <div class="shop-pub-kpis">
          <article><span>Total PDV</span><strong>${ctx.escapeHtml(String(pubState.total || 0))}</strong></article>
          <article><span>Filtrados</span><strong>${ctx.escapeHtml(String(paged.total))}</strong></article>
          <article><span>Vendáveis</span><strong>${ctx.escapeHtml(String(sellableCount))}</strong></article>
          <article><span>Em estoque</span><strong>${ctx.escapeHtml(String(inStockCount))}</strong></article>
        </div>
        <form class="shop-pub-toolbar" data-shop-pub-filters>
          <input name="q" value="${ctx.escapeHtml(filters.q || "")}" placeholder="Buscar por nome" />
          <select name="product_type">
            <option value="">Tipo</option>
            <option value="simple"${filters.product_type === "simple" ? " selected" : ""}>Simples</option>
            <option value="variable"${filters.product_type === "variable" ? " selected" : ""}>Grade</option>
          </select>
          <select name="sellable">
            <option value="">Vendável</option>
            <option value="true"${filters.sellable === "true" ? " selected" : ""}>Sim</option>
            <option value="false"${filters.sellable === "false" ? " selected" : ""}>Não</option>
          </select>
          <select name="availability">
            <option value="">Disponibilidade</option>
            <option value="in_stock"${filters.availability === "in_stock" ? " selected" : ""}>Em estoque</option>
            <option value="low_stock"${filters.availability === "low_stock" ? " selected" : ""}>Estoque baixo</option>
            <option value="out_of_stock"${filters.availability === "out_of_stock" ? " selected" : ""}>Indisponível</option>
          </select>
          <select name="publication_status">
            <option value="">Publicação</option>
            <option value="none"${filters.publication_status === "none" ? " selected" : ""}>Não publicado</option>
            <option value="draft"${filters.publication_status === "draft" ? " selected" : ""}>Rascunho</option>
            <option value="published"${filters.publication_status === "published" ? " selected" : ""}>Publicado</option>
          </select>
          <button class="secondary-button" type="submit"${pubState.loading ? " disabled" : ""}>Filtrar</button>
          <button class="ghost-button" type="button" data-shop-pub-reset${pubState.loading ? " disabled" : ""}>Limpar</button>
          <button class="ghost-button" type="button" data-shop-pub-refresh${pubState.loading ? " disabled" : ""}>${pubState.loading ? "Atualizando..." : "Atualizar PDV"}</button>
        </form>
        ${pubState.error ? `<div class="login-error">${ctx.escapeHtml(pubState.error)}</div>` : ""}
        <div class="shop-pub-grid">
          <div class="shop-pub-table-wrap">
            <table class="shop-pub-table">
              <thead>
                <tr>
                  <th>Produto</th><th>Preço</th><th>Var.</th><th>Cores</th><th>Tamanhos</th><th>Vendável</th><th>Disponibilidade</th><th>Publicação</th>
                </tr>
              </thead>
              <tbody>
                ${pubState.loading
      ? `<tr><td colspan="8"><div class="empty-state compact"><strong>Carregando candidatos...</strong><span>Lendo produtos reais do PDV.</span></div></td></tr>`
      : buildTableRows(paged.rows, pubState, ctx)}
              </tbody>
            </table>
            <div class="shop-pub-pagination">
              <button class="ghost-button" type="button" data-shop-pub-page="prev"${paged.page <= 1 ? " disabled" : ""}>Anterior</button>
              <span>Página ${paged.page} de ${paged.totalPages}</span>
              <button class="ghost-button" type="button" data-shop-pub-page="next"${paged.page >= paged.totalPages ? " disabled" : ""}>Próxima</button>
            </div>
          </div>
          ${buildDetailPanel(selected, pubState, ctx)}
        </div>
      </section>`;
  }

  async function loadCandidates(ctx) {
    if (!canViewPanel(ctx)) {
      renderFront(ctx);
      return;
    }
    const pubState = ensureState(ctx.state);
    pubState.loading = true;
    pubState.error = "";
    renderFront(ctx);
    try {
      const response = await ctx.api("/api/shop/publication/candidates?limit=200");
      pubState.items = ctx.toArray(response.items);
      pubState.total = Number(response.total || pubState.items.length || 0);
      pubState.schemaReady = Boolean(response.schema_ready);
      pubState.pilotJsonActive = Boolean(response.pilot_json_active);
      pubState.page = 1;
      if (!pubState.selectedKey && pubState.items.length) {
        pubState.selectedKey = rowKey(pubState.items[0]);
      }
    } catch (error) {
      pubState.error = error.message || "Falha ao carregar candidatos PDV.";
      pubState.items = [];
      pubState.total = 0;
    } finally {
      pubState.loading = false;
      renderFront(ctx);
    }
  }

  function handleClick(event, ctx) {
    const selectRow = event.target.closest("[data-shop-pub-select]");
    if (selectRow) {
      ensureState(ctx.state).selectedKey = selectRow.dataset.shopPubSelect || "";
      renderFront(ctx);
      return true;
    }
    if (event.target.closest("[data-shop-pub-refresh]")) {
      loadCandidates(ctx).catch((error) => ctx.handleUiError("Erro ao atualizar candidatos shop", error));
      return true;
    }
    if (event.target.closest("[data-shop-pub-reset]")) {
      const pubState = ensureState(ctx.state);
      pubState.filters = { q: "", product_type: "", sellable: "", availability: "", publication_status: "" };
      pubState.page = 1;
      renderFront(ctx);
      return true;
    }
    const pageBtn = event.target.closest("[data-shop-pub-page]");
    if (pageBtn) {
      const pubState = ensureState(ctx.state);
      if (pageBtn.dataset.shopPubPage === "prev") pubState.page = Math.max(1, Number(pubState.page || 1) - 1);
      if (pageBtn.dataset.shopPubPage === "next") pubState.page = Number(pubState.page || 1) + 1;
      renderFront(ctx);
      return true;
    }
    return false;
  }

  function handleSubmit(event, ctx) {
    const form = event.target.closest("[data-shop-pub-filters]");
    if (!form) return false;
    event.preventDefault();
    const pubState = ensureState(ctx.state);
    const data = new FormData(form);
    pubState.filters = {
      q: ctx.normalizeText(data.get("q") || ""),
      product_type: ctx.normalizeText(data.get("product_type") || ""),
      sellable: ctx.normalizeText(data.get("sellable") || ""),
      availability: ctx.normalizeText(data.get("availability") || ""),
      publication_status: ctx.normalizeText(data.get("publication_status") || "")
    };
    pubState.page = 1;
    renderFront(ctx);
    return true;
  }

  function getContext() {
    const ctx = global.__aerostoreCtx || {};
    return {
      state: ctx.state,
      api: ctx.api,
      toArray: ctx.toArray,
      escapeHtml: ctx.escapeHtml,
      normalizeText: ctx.normalizeText,
      getCurrentRole: ctx.getCurrentRole,
      hasPermission: ctx.hasPermission,
      handleUiError: ctx.handleUiError,
      brlFormatter: ctx.brlFormatter
    };
  }

  global.AeroStoreShopPublication = {
    canViewPanel: () => canViewPanel(getContext()),
    renderFront: () => renderFront(getContext()),
    loadCandidates: () => loadCandidates(getContext()),
    handleClick: (event) => handleClick(event, getContext()),
    handleSubmit: (event) => handleSubmit(event, getContext())
  };
}(window));
