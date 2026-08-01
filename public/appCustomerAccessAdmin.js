"use strict";

state.appCustomersAdmin = {
  loading: false,
  detailLoading: false,
  actionLoading: false,
  error: "",
  rows: [],
  selectedId: "",
  detail: null,
  pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 },
  filters: { status: "", type: "", dateFrom: "", dateTo: "" }
};
PATHNAME_SECTION_MAP["/admin/clientes-app"] = "app-customers-admin";
PATHNAME_SECTION_META["app-customers-admin"] = { displaySection: "app-customers-admin", title: "Clientes do app" };
OFFICIAL_ROUTE_SECTIONS.add("app-customers-admin");

const baseCanAccessOfficialSection = canAccessOfficialSection;
canAccessOfficialSection = function canAccessAppCustomerSection(sectionId = "") {
  if (sectionId === "app-customers-admin") return canReviewAppCustomersFront();
  return baseCanAccessOfficialSection(sectionId);
};

const baseRenderOfficialRouteSection = renderOfficialRouteSection;
renderOfficialRouteSection = function renderAppCustomerRouteSection(sectionId = "") {
  if (sectionId !== "app-customers-admin") return baseRenderOfficialRouteSection(sectionId);
  const title = document.getElementById("section-title");
  if (title) title.textContent = "Clientes do app";
  renderAppCustomersAdminFront();
  return loadAppCustomersAdmin().catch(handleAppCustomersAdminError);
};

const baseGetSidebarMenuGroups = getSidebarMenuGroups;
getSidebarMenuGroups = function getSidebarMenuGroupsWithAppCustomers() {
  const groups = baseGetSidebarMenuGroups();
  if (canReviewAppCustomersFront()) {
    groups.push({ title: "Acesso do app", items: [{ label: "Clientes do app", route: "/admin/clientes-app" }] });
  }
  return groups;
};

function canReviewAppCustomersFront() {
  return getCurrentRole() === "admin"
    || (isCurrentUserManagerProfile() && hasPermission("can_review_app_customers"));
}

function getAppCustomersAdminContainer() {
  return document.getElementById("app-customers-admin-content");
}

function handleAppCustomersAdminError(error) {
  const adminState = state.appCustomersAdmin;
  adminState.loading = false;
  adminState.detailLoading = false;
  adminState.actionLoading = false;
  adminState.error = Number(error?.status || 0) === 409
    ? "A solicitacao mudou desde a ultima leitura. Atualize antes de decidir."
    : (error?.message || "Falha ao carregar clientes do app.");
  renderAppCustomersAdminFront();
  showFeedback(adminState.error, "error");
}

function buildAppCustomersAdminParams() {
  const params = new URLSearchParams({
    page: String(state.appCustomersAdmin.pagination.page || 1),
    pageSize: String(state.appCustomersAdmin.pagination.pageSize || 25)
  });
  Object.entries(state.appCustomersAdmin.filters || {}).forEach(([key, value]) => {
    if (value) params.set(key, String(value));
  });
  return params;
}

async function loadAppCustomersAdmin({ preserveDetail = true } = {}) {
  if (!canReviewAppCustomersFront()) return;
  state.appCustomersAdmin.loading = true;
  state.appCustomersAdmin.error = "";
  renderAppCustomersAdminFront();
  try {
    const result = await api(`/api/admin/app-customers/pending?${buildAppCustomersAdminParams().toString()}`);
    state.appCustomersAdmin.rows = toArray(result.rows);
    state.appCustomersAdmin.pagination = result.pagination || state.appCustomersAdmin.pagination;
    if (!preserveDetail) {
      state.appCustomersAdmin.selectedId = "";
      state.appCustomersAdmin.detail = null;
    }
  } finally {
    state.appCustomersAdmin.loading = false;
    renderAppCustomersAdminFront();
  }
}

async function openAppCustomerAdmin(accountId) {
  const id = normalizeText(accountId || "");
  if (!id) return;
  state.appCustomersAdmin.selectedId = id;
  state.appCustomersAdmin.detailLoading = true;
  renderAppCustomersAdminFront();
  try {
    const result = await api(`/api/admin/app-customers/${encodeURIComponent(id)}`);
    state.appCustomersAdmin.detail = result.customer || null;
  } finally {
    state.appCustomersAdmin.detailLoading = false;
    renderAppCustomersAdminFront();
  }
}

async function runAppCustomerAdminAction(action, form) {
  const detail = state.appCustomersAdmin.detail;
  if (!detail?.id || state.appCustomersAdmin.actionLoading) return;
  const data = new FormData(form);
  const reason = normalizeText(data.get("reason") || "");
  const isAdmin = getCurrentRole() === "admin";
  if ((!isAdmin || action !== "approve") && !reason) {
    showFeedback("Informe o motivo administrativo.", "warning");
    return;
  }
  state.appCustomersAdmin.actionLoading = true;
  renderAppCustomersAdminFront();
  try {
    const result = await api(`/api/admin/app-customers/${encodeURIComponent(detail.id)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: Number(detail.version || 0),
        reason,
        masterId: normalizeText(data.get("masterId") || "")
      })
    });
    state.appCustomersAdmin.detail = result.customer || detail;
    showFeedback("Decisao registrada com auditoria.");
    await loadAppCustomersAdmin({ preserveDetail: true });
  } finally {
    state.appCustomersAdmin.actionLoading = false;
    renderAppCustomersAdminFront();
  }
}

function renderAppCustomerAdminDetail() {
  const adminState = state.appCustomersAdmin;
  if (adminState.detailLoading) return `<div class="app-customer-empty">Carregando detalhe sanitizado...</div>`;
  const detail = adminState.detail;
  if (!detail || detail.id !== adminState.selectedId) {
    return `<div class="app-customer-empty"><strong>Selecione uma solicitacao</strong><span>Telefone, e-mail e documento permanecem mascarados.</span></div>`;
  }
  const isAdmin = getCurrentRole() === "admin";
  const links = toArray(detail.links);
  const conflicts = toArray(detail.blockingConflicts);
  const decisions = toArray(detail.decisions);
  return `
    <article class="app-customer-detail">
      <header><div><p class="eyebrow">Conta do aplicativo</p><h3>${escapeHtml(detail.phoneMasked || "Dado protegido")}</h3><span>${escapeHtml(detail.emailMasked || "Sem e-mail exibivel")}</span></div><span class="app-access-status">${escapeHtml(detail.accessStatus)}</span></header>
      <div class="app-customer-facts">
        <span><small>Conta</small><strong>${escapeHtml(detail.accountStatus)}</strong></span>
        <span><small>Telefone confirmado</small><strong>${detail.phoneVerified ? "Sim" : "Nao"}</strong></span>
        <span><small>Solicitacao</small><strong>${escapeHtml(detail.request?.type || "-")}</strong></span>
        <span><small>Versao</small><strong>${escapeHtml(String(detail.version || 0))}</strong></span>
      </div>
      <section><h4>Vinculo com a Camada Mestre</h4><div class="app-customer-links">
        ${links.length ? links.map((link, index) => `<label><input type="radio" name="masterId" value="${escapeHtml(link.masterId)}"${index === 0 ? " checked" : ""}><span><strong>${escapeHtml(link.masterId)}</strong><small>${escapeHtml(link.linkStatus)} - confianca ${escapeHtml(String(link.confidence || 0))}%</small></span></label>`).join("") : `<p>Nenhum vinculo mestre valido.</p>`}
      </div></section>
      <section><h4>Conflitos bloqueantes</h4><div class="app-customer-conflicts">${conflicts.length ? conflicts.map((item) => `<span><strong>${escapeHtml(item.type)}</strong><small>${escapeHtml(item.severity)}</small></span>`).join("") : `<p>Nenhum conflito aberto para os mestres vinculados.</p>`}</div></section>
      <form class="app-customer-actions" data-app-customer-action-form>
        <label>Motivo administrativo<textarea name="reason" rows="2" maxlength="500" placeholder="Obrigatorio para Supervisor e acoes restritivas"></textarea></label>
        <div><button type="submit" class="primary-button" data-app-customer-action="approve">Aprovar</button><button type="submit" class="secondary-button" data-app-customer-action="reject">Rejeitar</button>${isAdmin ? `<button type="submit" class="ghost-button" data-app-customer-action="suspend">Suspender</button><button type="submit" class="ghost-button" data-app-customer-action="reactivate">Reativar</button><button type="submit" class="danger-button" data-app-customer-action="block">Bloquear</button>` : ""}</div>
      </form>
      <section><h4>Historico imutavel</h4><div class="app-customer-history">${decisions.length ? decisions.map((item) => `<article><strong>${escapeHtml(item.type)}</strong><span>${escapeHtml(formatDateTimeBR(item.createdAt))} - ${escapeHtml(item.actorRole)}</span><p>${escapeHtml(item.reason || "Sem observacao")}</p></article>`).join("") : `<p>Nenhuma decisao registrada.</p>`}</div></section>
    </article>`;
}

function renderAppCustomersAdminFront() {
  const container = getAppCustomersAdminContainer();
  if (!container) return;
  if (!canReviewAppCustomersFront()) {
    container.innerHTML = `<article class="hero-card"><p class="eyebrow">Acesso restrito</p><h3>Clientes do app</h3><p>E necessaria permissao individual de revisao.</p></article>`;
    return;
  }
  const adminState = state.appCustomersAdmin;
  const pagination = adminState.pagination;
  const statusOptions = ["PENDING_PHONE_VERIFICATION", "PENDING_APPROVAL", "REJECTED", "APPROVED"];
  const typeOptions = ["EXISTING_CUSTOMER_LINK", "NEW_CUSTOMER_REGISTRATION", "PHONE_CHANGE_RECOVERY", "MANUAL_REVIEW"];
  container.innerHTML = `
    <section class="app-customers-shell">
      <div class="users-admin-hero"><div><p class="eyebrow">Controle de acesso</p><h3>Clientes do app</h3><p>Aprovacao administrativa com vinculo mestre, concorrencia otimista e PII mascarada.</p></div><div class="users-admin-kpis"><span><strong>${escapeHtml(String(pagination.total || 0))}</strong> solicitacoes</span><span><strong>0</strong> liberacoes automaticas nesta fase</span></div></div>
      ${adminState.error ? `<div class="identity-cases-alert danger">${escapeHtml(adminState.error)}</div>` : ""}
      <form class="app-customer-filters" data-app-customer-filters>
        <select name="status"><option value="">Pendencias e rejeitados</option>${statusOptions.map((value) => `<option value="${value}"${adminState.filters.status === value ? " selected" : ""}>${value}</option>`).join("")}</select>
        <select name="type"><option value="">Todos os tipos</option>${typeOptions.map((value) => `<option value="${value}"${adminState.filters.type === value ? " selected" : ""}>${value}</option>`).join("")}</select>
        <input type="date" name="dateFrom" value="${escapeHtml(adminState.filters.dateFrom || "")}">
        <input type="date" name="dateTo" value="${escapeHtml(adminState.filters.dateTo || "")}">
        <button class="secondary-button" type="submit">Filtrar</button>
      </form>
      <div class="app-customers-workspace">
        <article class="app-customers-list"><header><strong>${adminState.loading ? "Carregando..." : `${pagination.total || 0} solicitacao(oes)`}</strong><button class="ghost-button small" type="button" data-app-customers-refresh>Atualizar</button></header>
          ${toArray(adminState.rows).length ? toArray(adminState.rows).map((row) => `<button type="button" class="app-customer-row${row.id === adminState.selectedId ? " active" : ""}" data-app-customer-open="${escapeHtml(row.id)}"><span><strong>${escapeHtml(row.phoneMasked)}</strong><small>${escapeHtml(row.emailMasked || "Dado protegido")}</small></span><span><strong>${escapeHtml(row.requestType)}</strong><small>${escapeHtml(row.accessStatus)}</small></span></button>`).join("") : `<div class="app-customer-empty">Nenhuma solicitacao encontrada.</div>`}
          <footer><button class="ghost-button" type="button" data-app-customers-page="${Math.max(1, pagination.page - 1)}"${pagination.page <= 1 ? " disabled" : ""}>Anterior</button><span>${pagination.page} / ${pagination.pageCount}</span><button class="ghost-button" type="button" data-app-customers-page="${Math.min(pagination.pageCount, pagination.page + 1)}"${pagination.page >= pagination.pageCount ? " disabled" : ""}>Proxima</button></footer>
        </article>
        ${renderAppCustomerAdminDetail()}
      </div>
    </section>`;
}

document.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-app-customer-open]");
  if (openButton) {
    openAppCustomerAdmin(openButton.dataset.appCustomerOpen || "").catch(handleAppCustomersAdminError);
    return;
  }
  const pageButton = event.target.closest("[data-app-customers-page]");
  if (pageButton && !pageButton.disabled) {
    state.appCustomersAdmin.pagination.page = Number(pageButton.dataset.appCustomersPage || 1);
    loadAppCustomersAdmin({ preserveDetail: true }).catch(handleAppCustomersAdminError);
    return;
  }
  if (event.target.closest("[data-app-customers-refresh]")) {
    loadAppCustomersAdmin({ preserveDetail: true }).catch(handleAppCustomersAdminError);
    return;
  }
  const actionButton = event.target.closest("[data-app-customer-action]");
  if (actionButton) {
    event.preventDefault();
    runAppCustomerAdminAction(actionButton.dataset.appCustomerAction || "", actionButton.closest("form"))
      .catch(handleAppCustomersAdminError);
  }
});

document.addEventListener("submit", (event) => {
  const filters = event.target.closest("[data-app-customer-filters]");
  if (!filters) return;
  event.preventDefault();
  const data = new FormData(filters);
  state.appCustomersAdmin.filters = {
    status: normalizeText(data.get("status") || ""),
    type: normalizeText(data.get("type") || ""),
    dateFrom: normalizeText(data.get("dateFrom") || ""),
    dateTo: normalizeText(data.get("dateTo") || "")
  };
  state.appCustomersAdmin.pagination.page = 1;
  loadAppCustomersAdmin({ preserveDetail: true }).catch(handleAppCustomersAdminError);
});
