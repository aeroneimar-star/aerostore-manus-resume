"use strict";

/**
 * UI administrativa do módulo fiscal (Stage 2).
 * Sem emissão, certificado ou CSC.
 */
(function (global) {
  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function canManageFiscal(hasPermission, role) {
    if (typeof hasPermission === "function" && hasPermission("can_manage_fiscal")) return true;
    if (typeof hasPermission === "function" && hasPermission("can_manage_global_settings")) return true;
    return String(role || "").toLowerCase() === "admin";
  }

  function canViewFiscal(hasPermission, role) {
    if (canManageFiscal(hasPermission, role)) return true;
    if (typeof hasPermission === "function" && hasPermission("can_view_fiscal")) return true;
    if (typeof hasPermission === "function" && hasPermission("can_view_audit")) return true;
    return ["admin", "manager", "gestor", "gerente"].includes(String(role || "").toLowerCase());
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Falha HTTP ${response.status}`);
    }
    return data;
  }

  function renderShell(canWrite) {
    return `
      <div class="fiscal-admin">
        <header class="panel-header settings-panel-header">
          <div>
            <p class="eyebrow">Módulo fiscal · Stage 2</p>
            <h3>Cadastro fiscal</h3>
            <p class="settings-panel-note">Sem emissão, sem certificado e sem CSC nesta etapa. Apenas configuração e pendências.</p>
          </div>
        </header>
        <div class="fiscal-admin-tabs" role="tablist">
          <button type="button" class="secondary-button fiscal-tab active" data-fiscal-tab="establishments">Estabelecimentos</button>
          <button type="button" class="secondary-button fiscal-tab" data-fiscal-tab="profiles">Perfis tributários</button>
          <button type="button" class="secondary-button fiscal-tab" data-fiscal-tab="products">Produtos fiscais</button>
          <button type="button" class="secondary-button fiscal-tab" data-fiscal-tab="gaps">Pendências</button>
        </div>
        <div class="fiscal-admin-panels">
          <section class="fiscal-panel active" data-fiscal-panel="establishments">
            <div class="action-row">
              <button type="button" class="primary-button" data-fiscal-action="reload-establishments">Atualizar</button>
              ${canWrite ? '<button type="button" class="secondary-button" data-fiscal-action="new-establishment">Novo estabelecimento</button>' : ""}
            </div>
            <div class="table-wrap"><table class="fiscal-table"><thead><tr>
              <th>ID</th><th>Código</th><th>Razão social</th><th>CNPJ</th><th>UF</th><th>Lojas</th><th>Gaps</th><th></th>
            </tr></thead><tbody id="fiscal-establishments-body"><tr><td colspan="8">Carregando…</td></tr></tbody></table></div>
            <form id="fiscal-establishment-form" class="settings-store-form-grid" style="display:none;margin-top:16px;">
              <input type="hidden" name="id" />
              <label>Código<input name="code" /></label>
              <label>Razão social<input name="legal_name" required /></label>
              <label>Nome fantasia<input name="trade_name" /></label>
              <label>CNPJ<input name="cnpj" required /></label>
              <label>IE<input name="ie" /></label>
              <label>IM<input name="im" /></label>
              <label>CRT<input name="crt" placeholder="ex.: 1" /></label>
              <label>Regime<input name="tax_regime" /></label>
              <label>CNAE<input name="cnae_principal" /></label>
              <label>UF<input name="uf" maxlength="2" required /></label>
              <label>Cidade<input name="city" /></label>
              <label>IBGE<input name="city_ibge_code" /></label>
              <label>CEP<input name="zip" /></label>
              <label>Rua<input name="street" /></label>
              <label>Número<input name="number" /></label>
              <label>Bairro<input name="district" /></label>
              <label>Telefone<input name="phone" /></label>
              <label>Ambiente<select name="environment"><option value="homologacao">Homologação</option><option value="producao">Produção</option></select></label>
              <label>Ativo<select name="active"><option value="1">Sim</option><option value="0">Não</option></select></label>
              <label>Certificado configurado?<select name="certificate_configured"><option value="0">Não</option><option value="1">Sim (marcador)</option></select></label>
              <label>CSC configurado?<select name="csc_configured"><option value="0">Não</option><option value="1">Sim (marcador)</option></select></label>
              <div class="action-row" style="grid-column:1/-1;">
                <button type="submit" class="primary-button">Salvar estabelecimento</button>
              </div>
            </form>
            <form id="fiscal-store-link-form" class="action-row" style="display:none;margin-top:12px;">
              <input type="hidden" name="establishment_id" />
              <label>Vincular loja
                <select name="store_id">
                  <option value="vila">vila</option>
                  <option value="botanico">botanico</option>
                  <option value="sul">sul</option>
                </select>
              </label>
              <button type="submit" class="secondary-button">Vincular ativa</button>
              <button type="button" class="danger-button" data-fiscal-action="unlink-store">Desativar vínculo</button>
            </form>
          </section>

          <section class="fiscal-panel" data-fiscal-panel="profiles">
            <div class="action-row">
              <button type="button" class="primary-button" data-fiscal-action="reload-profiles">Atualizar</button>
              ${canWrite ? '<button type="button" class="secondary-button" data-fiscal-action="new-profile">Novo perfil</button>' : ""}
            </div>
            <div class="table-wrap"><table class="fiscal-table"><thead><tr>
              <th>Code</th><th>Nome</th><th>Operação</th><th>CFOP</th><th>CSOSN</th><th>Teste?</th><th></th>
            </tr></thead><tbody id="fiscal-profiles-body"><tr><td colspan="7">Carregando…</td></tr></tbody></table></div>
            <form id="fiscal-profile-form" class="settings-store-form-grid" style="display:none;margin-top:16px;">
              <input type="hidden" name="id" />
              <label>Code<input name="code" required /></label>
              <label>Nome<input name="name" required /></label>
              <label>Descrição<input name="description" /></label>
              <label>Operação<select name="operation_type"><option value="sale_internal">sale_internal</option></select></label>
              <label>UF origem<input name="origin_uf" maxlength="2" /></label>
              <label>UF destino<input name="destination_uf" maxlength="2" /></label>
              <label>CFOP<input name="cfop" placeholder="deixe vazio se pendente" /></label>
              <label>CSOSN<input name="csosn" /></label>
              <label>CST ICMS<input name="cst_icms" /></label>
              <label>CST PIS<input name="pis_cst" /></label>
              <label>CST COFINS<input name="cofins_cst" /></label>
              <label>CST IPI<input name="ipi_cst" /></label>
              <label>Alíq. ICMS<input name="icms_rate" type="number" step="0.01" /></label>
              <label>Alíq. PIS<input name="pis_rate" type="number" step="0.01" /></label>
              <label>Alíq. COFINS<input name="cofins_rate" type="number" step="0.01" /></label>
              <label>Benefício<input name="benefit_code" /></label>
              <label>Info adicional<input name="additional_info" /></label>
              <label>Perfil de teste?<select name="is_test_profile"><option value="0">Não</option><option value="1">Sim</option></select></label>
              <label>Ativo<select name="active"><option value="1">Sim</option><option value="0">Não</option></select></label>
              <div class="action-row" style="grid-column:1/-1;">
                <button type="submit" class="primary-button">Salvar perfil</button>
              </div>
            </form>
          </section>

          <section class="fiscal-panel" data-fiscal-panel="products">
            <div class="action-row">
              <button type="button" class="primary-button" data-fiscal-action="reload-products">Atualizar</button>
            </div>
            <form id="fiscal-product-form" class="settings-store-form-grid">
              <label>product_ref<input name="product_ref" placeholder="product:1 ou variant:VAR_..." /></label>
              <label>product_id<input name="product_id" type="number" /></label>
              <label>variant_id<input name="variant_id" /></label>
              <label>legacy_ai_product_id<input name="legacy_ai_product_id" type="number" /></label>
              <label>NCM<input name="ncm" /></label>
              <label>CEST<input name="cest" /></label>
              <label>Origem<input name="origin" /></label>
              <label>Unidade<input name="unit" /></label>
              <label>GTIN/EAN<input name="gtin_ean" /></label>
              <label>profile_id<input name="profile_id" type="number" /></label>
              <label>Herdar do pai?<select name="inherit_from_parent"><option value="1">Sim</option><option value="0">Não</option></select></label>
              <label>CEST obrigatório?<select name="cest_required"><option value="0">Não</option><option value="1">Sim</option></select></label>
              <div class="action-row" style="grid-column:1/-1;">
                ${canWrite ? '<button type="submit" class="primary-button">Salvar dados fiscais do produto</button>' : "<p class='settings-panel-note'>Somente leitura</p>"}
              </div>
            </form>
            <div class="table-wrap" style="margin-top:16px;"><table class="fiscal-table"><thead><tr>
              <th>Ref</th><th>NCM</th><th>Origem</th><th>Unidade</th><th>Perfil</th><th>Herda</th>
            </tr></thead><tbody id="fiscal-products-body"><tr><td colspan="6">Carregando…</td></tr></tbody></table></div>
          </section>

          <section class="fiscal-panel" data-fiscal-panel="gaps">
            <div class="action-row">
              <label>Loja
                <select id="fiscal-gaps-store">
                  <option value="">Todas</option>
                  <option value="vila">vila</option>
                  <option value="botanico">botanico</option>
                  <option value="sul">sul</option>
                </select>
              </label>
              <label>Tipo de gap<input id="fiscal-gaps-type" placeholder="ex.: ncm_missing" /></label>
              <button type="button" class="primary-button" data-fiscal-action="reload-gaps">Atualizar pendências</button>
            </div>
            <p class="settings-panel-note">Filtro por categoria de produto ainda não é confiável no Stage 2 e não está exposto aqui. Marcadores de certificado/CSC/provedor não comprovam configuração operacional.</p>
            <pre id="fiscal-gaps-summary" class="settings-panel-note" style="white-space:pre-wrap;"></pre>
            <div class="table-wrap"><table class="fiscal-table"><thead><tr>
              <th>Tipo</th><th>Label</th><th>Gaps</th>
            </tr></thead><tbody id="fiscal-gaps-body"><tr><td colspan="3">Carregue o relatório.</td></tr></tbody></table></div>
          </section>
        </div>
        <p id="fiscal-admin-feedback" class="settings-panel-note" role="status"></p>
      </div>
    `;
  }

  function setFeedback(message, isError) {
    const el = document.getElementById("fiscal-admin-feedback");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = isError ? "#f0a0a0" : "";
  }

  function switchTab(tab) {
    document.querySelectorAll(".fiscal-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-fiscal-tab") === tab);
    });
    document.querySelectorAll(".fiscal-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.getAttribute("data-fiscal-panel") === tab);
    });
  }

  async function loadEstablishments() {
    const body = document.getElementById("fiscal-establishments-body");
    if (!body) return;
    const data = await api("/api/fiscal/establishments");
    const rows = data.establishments || [];
    body.innerHTML = rows.length
      ? rows.map((item) => `
        <tr>
          <td>${esc(item.id)}</td>
          <td>${esc(item.code)}</td>
          <td>${esc(item.legal_name)}</td>
          <td>${esc(item.cnpj)}</td>
          <td>${esc(item.uf)}</td>
          <td>${esc((item.store_ids || []).join(", "))}</td>
          <td>${esc((item.gaps || []).join(", ") || "—")}</td>
          <td><button type="button" class="secondary-button" data-fiscal-edit-establishment="${esc(item.id)}">Editar</button></td>
        </tr>`).join("")
      : '<tr><td colspan="8">Nenhum estabelecimento cadastrado.</td></tr>';
  }

  async function loadProfiles() {
    const body = document.getElementById("fiscal-profiles-body");
    if (!body) return;
    const data = await api("/api/fiscal/tax-profiles?include_test=1");
    const rows = data.profiles || [];
    body.innerHTML = rows.length
      ? rows.map((item) => `
        <tr>
          <td>${esc(item.code)}</td>
          <td>${esc(item.name)}</td>
          <td>${esc(item.operation_type)}</td>
          <td>${esc(item.cfop ?? "—")}</td>
          <td>${esc(item.csosn ?? "—")}</td>
          <td>${item.is_test_profile ? "sim" : "não"}</td>
          <td><button type="button" class="secondary-button" data-fiscal-edit-profile="${esc(item.id)}">Editar</button></td>
        </tr>`).join("")
      : '<tr><td colspan="7">Nenhum perfil cadastrado.</td></tr>';
  }

  async function loadProducts() {
    const body = document.getElementById("fiscal-products-body");
    if (!body) return;
    const data = await api("/api/fiscal/product-tax?limit=100");
    const rows = data.items || [];
    body.innerHTML = rows.length
      ? rows.map((item) => `
        <tr>
          <td>${esc(item.product_ref)}</td>
          <td>${esc(item.ncm ?? "—")}</td>
          <td>${esc(item.origin ?? "—")}</td>
          <td>${esc(item.unit ?? "—")}</td>
          <td>${esc(item.profile_id ?? "—")}</td>
          <td>${item.inherit_from_parent ? "sim" : "não"}</td>
        </tr>`).join("")
      : '<tr><td colspan="6">Nenhum cadastro fiscal de produto.</td></tr>';
  }

  async function loadGaps() {
    const store = document.getElementById("fiscal-gaps-store")?.value || "";
    const gapType = document.getElementById("fiscal-gaps-type")?.value || "";
    const qs = new URLSearchParams();
    if (store) qs.set("store_id", store);
    if (gapType) qs.set("gap_type", gapType);
    const data = await api(`/api/fiscal/gaps?${qs.toString()}`);
    const summary = document.getElementById("fiscal-gaps-summary");
    const body = document.getElementById("fiscal-gaps-body");
    if (summary) {
      summary.textContent = JSON.stringify({ totals: data.totals, counts_by_gap: data.counts_by_gap }, null, 2);
    }
    if (body) {
      const items = data.items || [];
      body.innerHTML = items.length
        ? items.slice(0, 200).map((item) => `
          <tr>
            <td>${esc(item.type)}</td>
            <td>${esc(item.label)}</td>
            <td>${esc((item.gaps || []).join(", "))}</td>
          </tr>`).join("")
        : '<tr><td colspan="3">Sem pendências para o filtro.</td></tr>';
    }
  }

  function fillForm(form, data) {
    if (!form || !data) return;
    Array.from(form.elements).forEach((el) => {
      if (!el.name) return;
      if (data[el.name] === undefined || data[el.name] === null) return;
      if (el.tagName === "SELECT" && (el.name === "active" || el.name.endsWith("_configured") || el.name === "is_test_profile" || el.name === "inherit_from_parent" || el.name === "cest_required")) {
        el.value = data[el.name] === true || data[el.name] === 1 || data[el.name] === "1" ? "1" : "0";
        if (el.name === "environment") el.value = data.environment || "homologacao";
        return;
      }
      if (el.name === "environment") {
        el.value = data.environment || "homologacao";
        return;
      }
      el.value = data[el.name];
    });
  }

  function formToPayload(form) {
    const payload = {};
    Array.from(form.elements).forEach((el) => {
      if (!el.name || el.disabled) return;
      if (["active", "certificate_configured", "csc_configured", "provider_configured", "is_test_profile", "inherit_from_parent", "cest_required"].includes(el.name)) {
        payload[el.name] = el.value === "1";
        return;
      }
      if (el.value === "" && ["cfop", "csosn", "cst_icms", "pis_cst", "cofins_cst", "ipi_cst", "icms_rate", "pis_rate", "cofins_rate", "ipi_rate", "base_reduction_rate", "benefit_code", "additional_info", "profile_id", "product_id", "legacy_ai_product_id"].includes(el.name)) {
        payload[el.name] = null;
        return;
      }
      payload[el.name] = el.value;
    });
    return payload;
  }

  async function mount(root, ctx = {}) {
    if (!root) return;
    const hasPermission = ctx.hasPermission;
    const role = ctx.role || "";
    const canWrite = canManageFiscal(hasPermission, role);
    root.innerHTML = renderShell(canWrite);

    root.addEventListener("click", async (event) => {
      const tab = event.target.closest("[data-fiscal-tab]");
      if (tab) {
        switchTab(tab.getAttribute("data-fiscal-tab"));
        return;
      }
      const action = event.target.closest("[data-fiscal-action]")?.getAttribute("data-fiscal-action");
      try {
        if (action === "reload-establishments") await loadEstablishments();
        if (action === "reload-profiles") await loadProfiles();
        if (action === "reload-products") await loadProducts();
        if (action === "reload-gaps") await loadGaps();
        if (action === "new-establishment") {
          const form = document.getElementById("fiscal-establishment-form");
          form.reset();
          form.id.value = "";
          form.style.display = "";
          document.getElementById("fiscal-store-link-form").style.display = "none";
        }
        if (action === "new-profile") {
          const form = document.getElementById("fiscal-profile-form");
          form.reset();
          form.id.value = "";
          form.style.display = "";
        }
        if (action === "unlink-store") {
          const linkForm = document.getElementById("fiscal-store-link-form");
          const establishmentId = linkForm.establishment_id.value;
          const storeId = linkForm.store_id.value;
          await api(`/api/fiscal/establishments/${encodeURIComponent(establishmentId)}/stores`, {
            method: "POST",
            body: JSON.stringify({ store_id: storeId, active: false })
          });
          setFeedback("Vínculo desativado (histórico preservado).");
          await loadEstablishments();
        }
      } catch (error) {
        setFeedback(error.message, true);
      }
    });

    root.addEventListener("click", async (event) => {
      const editEst = event.target.closest("[data-fiscal-edit-establishment]");
      if (editEst) {
        try {
          const id = editEst.getAttribute("data-fiscal-edit-establishment");
          const data = await api(`/api/fiscal/establishments/${encodeURIComponent(id)}`);
          const form = document.getElementById("fiscal-establishment-form");
          fillForm(form, data.establishment);
          form.style.display = "";
          const linkForm = document.getElementById("fiscal-store-link-form");
          linkForm.establishment_id.value = id;
          linkForm.style.display = canWrite ? "" : "none";
        } catch (error) {
          setFeedback(error.message, true);
        }
      }
      const editProfile = event.target.closest("[data-fiscal-edit-profile]");
      if (editProfile) {
        try {
          const id = editProfile.getAttribute("data-fiscal-edit-profile");
          const data = await api(`/api/fiscal/tax-profiles/${encodeURIComponent(id)}`);
          const form = document.getElementById("fiscal-profile-form");
          fillForm(form, data.profile);
          form.style.display = "";
        } catch (error) {
          setFeedback(error.message, true);
        }
      }
    });

    document.getElementById("fiscal-establishment-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!canWrite) return;
      try {
        const form = event.target;
        const payload = formToPayload(form);
        const id = payload.id;
        delete payload.id;
        if (id) {
          await api(`/api/fiscal/establishments/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(payload)
          });
        } else {
          await api("/api/fiscal/establishments", {
            method: "POST",
            body: JSON.stringify(payload)
          });
        }
        setFeedback("Estabelecimento salvo.");
        form.style.display = "none";
        await loadEstablishments();
      } catch (error) {
        setFeedback(error.message, true);
      }
    });

    document.getElementById("fiscal-store-link-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!canWrite) return;
      try {
        const form = event.target;
        await api(`/api/fiscal/establishments/${encodeURIComponent(form.establishment_id.value)}/stores`, {
          method: "POST",
          body: JSON.stringify({ store_id: form.store_id.value, active: true })
        });
        setFeedback("Loja vinculada.");
        await loadEstablishments();
      } catch (error) {
        setFeedback(error.message, true);
      }
    });

    document.getElementById("fiscal-profile-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!canWrite) return;
      try {
        const form = event.target;
        const payload = formToPayload(form);
        const id = payload.id;
        delete payload.id;
        if (id) {
          await api(`/api/fiscal/tax-profiles/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(payload)
          });
        } else {
          await api("/api/fiscal/tax-profiles", {
            method: "POST",
            body: JSON.stringify(payload)
          });
        }
        setFeedback("Perfil salvo. Campos vazios permanecem pendentes (sem inventar tributação).");
        form.style.display = "none";
        await loadProfiles();
      } catch (error) {
        setFeedback(error.message, true);
      }
    });

    document.getElementById("fiscal-product-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!canWrite) return;
      try {
        const payload = formToPayload(event.target);
        await api("/api/fiscal/product-tax", {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        setFeedback("Dados fiscais do produto salvos.");
        await loadProducts();
      } catch (error) {
        setFeedback(error.message, true);
      }
    });

    try {
      await Promise.all([loadEstablishments(), loadProfiles(), loadProducts()]);
      setFeedback("Módulo fiscal carregado.");
    } catch (error) {
      setFeedback(error.message, true);
    }
  }

  global.AerostoreFiscalAdmin = {
    canViewFiscal,
    canManageFiscal,
    mount
  };
})(typeof window !== "undefined" ? window : global);
