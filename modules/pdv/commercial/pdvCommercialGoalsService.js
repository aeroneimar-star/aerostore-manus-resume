"use strict";

const fs = require("fs");
const path = require("path");
const { get, run, all } = require("../../../db");
const { recordAuditEvent } = require("../../audit/auditService");

// ── Constantes do Motor de Metas ──────────────────────────────────────

const VALID_METRICS = [
  "net_revenue",
  "average_ticket",
  "pa",
  "customer_linked_percent",
  "customer_size_percent"
];

const VALID_TARGET_TYPES = ["store", "seller"];

const VALID_STATUSES = ["draft", "active", "closed", "cancelled"];

const METRIC_LABELS = {
  net_revenue: "Faturamento líquido",
  average_ticket: "Ticket médio",
  pa: "PA (peças por atendimento)",
  customer_linked_percent: "% vendas com cliente vinculado",
  customer_size_percent: "% cadastro com tamanho"
};

const STORE_LABELS = {
  vila: "Vila",
  botanico: "Botânico",
  sul: "Sul"
};

// ── Helpers básicos ───────────────────────────────────────────────────

function getToday(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

function safeJsonParse(value, fallback) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeStoreKey(value = "") {
  const key = String(value || "").trim().toLowerCase().replace(/[\s\-_]+/g, "");
  if (["vila", "vilamasc", "vilafem", "vilainfant", "vilafeminino", "vilamasculino"].includes(key)) return "vila";
  if (["botanico", "botan", "bot"].includes(key)) return "botanico";
  if (["sul", "sulbr"].includes(key)) return "sul";
  return key;
}

function getStoreLabel(storeKey) {
  const key = normalizeStoreKey(storeKey);
  return STORE_LABELS[key] || storeKey;
}

function safeText(value) {
  return String(value || "").trim();
}

// ── Leitura de vendas (espelha padrão do Corridinha sem acoplamento) ──

function readSalesJson() {
  try {
    const filePath = path.join(process.cwd(), "data", "pdv", "sales", "sales.json");
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function filterSalesByDateRange(sales, startDate, endDate) {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate + "T23:59:59.999Z") : null;
  return sales.filter((sale) => {
    if (!sale) return false;
    if (sale.status === "CANCELLED") return false;
    const saleDate = new Date(sale.created_at || sale.data_hora || "");
    if (!saleDate.getTime()) return false;
    if (start && saleDate < start) return false;
    if (end && saleDate > end) return false;
    return true;
  });
}

function filterSalesByStore(sales, storeKey) {
  const key = normalizeStoreKey(storeKey);
  if (!key) return sales;
  return sales.filter((sale) => {
    const saleStore = normalizeStoreKey(sale.loja || sale.loja_venda || sale.sale_store_id || sale.cash_register_store || "");
    return saleStore === key;
  });
}

function filterSalesBySellerName(sales, sellerName) {
  const target = safeText(sellerName).toLowerCase();
  if (!target) return [];
  return sales.filter((sale) => safeText(sale.vendedor || "").toLowerCase() === target);
}

function getSaleNetTotal(sale = {}) {
  return toNumber(sale.total_final ?? sale.net_amount ?? sale.total ?? 0);
}

function getSaleItemsCount(sale = {}) {
  const items = Array.isArray(sale.items) ? sale.items : [];
  return items.reduce((sum, item) => sum + toNumber(item.quantidade ?? item.quantity ?? 0), 0);
}

function getSaleHasCustomer(sale = {}) {
  const customer = sale.customer || {};
  const masterId = safeText(customer.master_customer_id);
  const crmId = safeText(customer.crm_contact_id);
  const phone = safeText(customer.phone || customer.mobile);
  return Boolean(masterId || crmId || phone);
}

// ── Cálculos de KPI ───────────────────────────────────────────────────

function computeMetricsFromSales(sales = []) {
  const valid = Array.isArray(sales) ? sales : [];
  const salesCount = valid.length;
  const netRevenue = valid.reduce((sum, s) => sum + getSaleNetTotal(s), 0);
  const itemsCount = valid.reduce((sum, s) => sum + getSaleItemsCount(s), 0);
  const salesWithCustomer = valid.filter(getSaleHasCustomer).length;

  return {
    sales_count: salesCount,
    net_revenue: roundMoney(netRevenue),
    average_ticket: salesCount > 0 ? roundMoney(netRevenue / salesCount) : 0,
    pa: salesCount > 0 ? roundMoney(itemsCount / salesCount) : 0,
    customer_linked_percent: salesCount > 0 ? roundMoney((salesWithCustomer / salesCount) * 100) : 0,
    items_count: itemsCount
  };
}

async function computeCustomerSizePercentForStores(storeIds = []) {
  // Considera contatos ativos (não soft-deletados) cujo cadastro contenha ao menos
  // um indicador de tamanho: top_size, bottom_size, shoe_size ou size_profile_json não-vazio.
  const where = ["(deleted_at = '' OR deleted_at IS NULL)"];
  const params = [];
  if (Array.isArray(storeIds) && storeIds.length > 0) {
    const placeholders = storeIds.map(() => "?").join(",");
    const normalized = storeIds.map((s) => normalizeStoreKey(s)).filter(Boolean);
    if (normalized.length > 0) {
      where.push(`LOWER(REPLACE(REPLACE(REPLACE(COALESCE(preferred_store, store, ''), ' ', ''), '-', ''), '_', '')) IN (${normalized.map(() => "?")})`);
      params.push(...normalized);
    }
  }
  const totalRow = await get(
    `SELECT COUNT(*) AS total FROM contacts WHERE ${where.join(" AND ")}`,
    params
  );
  const total = Number(totalRow?.total || 0);
  if (total === 0) {
    return { total_contacts: 0, contacts_with_size: 0, customer_size_percent: 0 };
  }
  const withSizeRow = await get(
    `SELECT COUNT(*) AS total FROM contacts
     WHERE ${where.join(" AND ")}
       AND (
         LENGTH(COALESCE(NULLIF(top_size, ''), '')) > 0
         OR LENGTH(COALESCE(NULLIF(bottom_size, ''), '')) > 0
         OR LENGTH(COALESCE(NULLIF(shoe_size, ''), '')) > 0
         OR LENGTH(COALESCE(NULLIF(size_profile_json, ''), '{}')) > 2
       )`,
    params
  );
  const withSize = Number(withSizeRow?.total || 0);
  return {
    total_contacts: total,
    contacts_with_size: withSize,
    customer_size_percent: roundMoney((withSize / total) * 100)
  };
}

// ── Período e projeção ────────────────────────────────────────────────

function parseIsoDate(value) {
  if (!value) return null;
  const trimmed = String(value).slice(0, 10);
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildProjection(currentValue, periodStart, periodEnd, today = new Date()) {
  const start = parseIsoDate(periodStart);
  const end = parseIsoDate(periodEnd);
  const ref = new Date(today.toISOString().slice(0, 10));
  if (!start || !end || end < start) {
    return { days_total: 0, days_elapsed: 0, projection_value: null };
  }
  const totalDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
  let elapsed;
  if (ref < start) {
    elapsed = 0;
  } else if (ref > end) {
    elapsed = totalDays;
  } else {
    elapsed = Math.round((ref - start) / (1000 * 60 * 60 * 24)) + 1;
  }
  if (elapsed <= 0) {
    return { days_total: totalDays, days_elapsed: 0, projection_value: null };
  }
  const projection = (toNumber(currentValue) / elapsed) * totalDays;
  return {
    days_total: totalDays,
    days_elapsed: Math.min(elapsed, totalDays),
    projection_value: roundMoney(projection)
  };
}

// ── Medição consolidada por alvo ──────────────────────────────────────

async function measureTargetPerformance(target = {}) {
  const startDate = target.period_start;
  const endDate = target.period_end;
  const allSales = readSalesJson();
  let scoped = filterSalesByDateRange(allSales, startDate, endDate);

  // Aplica escopo de lojas quando informado.
  const storeIds = Array.isArray(target.store_ids) ? target.store_ids.map(normalizeStoreKey).filter(Boolean) : [];
  if (storeIds.length > 0) {
    scoped = scoped.filter((sale) => {
      const saleStore = normalizeStoreKey(sale.loja || sale.loja_venda || sale.sale_store_id || sale.cash_register_store || "");
      return storeIds.includes(saleStore);
    });
  }

  const metric = target.metric;
  const metrics = computeMetricsFromSales(scoped);
  const result = { metrics };

  if (metric === "net_revenue") {
    result.current_value = metrics.net_revenue;
  } else if (metric === "average_ticket") {
    result.current_value = metrics.average_ticket;
  } else if (metric === "pa") {
    result.current_value = metrics.pa;
  } else if (metric === "customer_linked_percent") {
    result.current_value = metrics.customer_linked_percent;
  } else if (metric === "customer_size_percent") {
    const sizeInfo = await computeCustomerSizePercentForStores(storeIds);
    result.current_value = sizeInfo.customer_size_percent;
    result.contacts_total = sizeInfo.total_contacts;
    result.contacts_with_size = sizeInfo.contacts_with_size;
  } else {
    result.current_value = 0;
  }

  result.projection = buildProjection(result.current_value, startDate, endDate);
  return result;
}

// ── Validação ─────────────────────────────────────────────────────────

function validateGoalPayload(data = {}) {
  const errors = [];
  const name = safeText(data.name);
  if (!name) errors.push("Nome da meta e obrigatorio.");
  const startDate = safeText(data.period_start);
  const endDate = safeText(data.period_end);
  if (!startDate) errors.push("period_start e obrigatorio (YYYY-MM-DD).");
  if (!endDate) errors.push("period_end e obrigatorio (YYYY-MM-DD).");
  if (startDate && endDate && endDate < startDate) {
    errors.push("period_end nao pode ser anterior a period_start.");
  }
  const storeIds = Array.isArray(data.store_ids) ? data.store_ids.map(normalizeStoreKey).filter(Boolean) : [];
  const sellerIds = Array.isArray(data.seller_ids)
    ? data.seller_ids.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
    : [];
  if (storeIds.length === 0 && sellerIds.length === 0) {
    errors.push("Selecione ao menos uma loja ou vendedor.");
  }
  const targets = Array.isArray(data.targets) ? data.targets : [];
  const enabledTargets = targets.filter((t) => t && t.enabled !== false);
  if (enabledTargets.length === 0) {
    errors.push("Inclua ao menos um KPI ativo.");
  }
  enabledTargets.forEach((t, idx) => {
    const metric = safeText(t.metric);
    if (!VALID_METRICS.includes(metric)) {
      errors.push(`KPI #${idx + 1}: metric invalido.`);
    }
    const targetValue = toNumber(t.target_value);
    if (!(targetValue > 0)) {
      errors.push(`KPI #${idx + 1}: target_value deve ser maior que zero.`);
    }
    const targetType = safeText(t.target_type);
    if (!VALID_TARGET_TYPES.includes(targetType)) {
      errors.push(`KPI #${idx + 1}: target_type invalido (use 'store' ou 'seller').`);
    }
  });
  if (errors.length > 0) {
    const err = new Error(errors.join(" "));
    err.status = 400;
    throw err;
  }
  return { name, startDate, endDate, storeIds, sellerIds, targets: enabledTargets };
}

function normalizeGoal(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: Number(row.id),
    name: row.name || "",
    description: row.description || "",
    period_start: row.period_start || "",
    period_end: row.period_end || "",
    store_ids: safeJsonParse(row.store_ids_json, []),
    seller_ids: safeJsonParse(row.seller_ids_json, []),
    status: row.status || "draft",
    created_by: row.created_by ? Number(row.created_by) : null,
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

function normalizeTarget(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: Number(row.id),
    goal_id: Number(row.goal_id),
    target_type: row.target_type || "",
    target_id: safeText(row.target_id),
    metric: row.metric || "",
    target_value: toNumber(row.target_value),
    weight: toNumber(row.weight, 1),
    enabled: Boolean(row.enabled),
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

function goalWithTargets(goal, targets) {
  return {
    ...goal,
    targets: Array.isArray(targets) ? targets : []
  };
}

// ── Auditoria ─────────────────────────────────────────────────────────

async function logGoalAudit(req, action, goal, before = null, after = null, message = "") {
  try {
    await recordAuditEvent({
      req,
      module: "commercial_goals",
      action,
      entity_type: "commercial_goal",
      entity_id: goal?.id ? String(goal.id) : "",
      entity_label: goal?.name || "",
      before: before || null,
      after: after || null,
      message,
      result: "success"
    });
  } catch (error) {
    console.error("[commercial_goals] falha ao registrar auditoria", error?.message || error);
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────

async function listGoals(options = {}) {
  const { store_id, status, seller_id } = options;
  let query = "SELECT * FROM commercial_goals WHERE 1=1";
  const params = [];
  if (status && VALID_STATUSES.includes(status)) {
    query += " AND status = ?";
    params.push(status);
  }
  query += " ORDER BY datetime(created_at) DESC, id DESC";
  const rows = await all(query, params);

  const goals = rows.map(normalizeGoal).filter(Boolean);

  // Anexa targets a cada goal
  const goalIds = goals.map((g) => g.id);
  const targetMap = {};
  if (goalIds.length > 0) {
    const placeholders = goalIds.map(() => "?").join(",");
    const targetRows = await all(
      `SELECT * FROM commercial_goal_targets WHERE goal_id IN (${placeholders}) ORDER BY id ASC`,
      goalIds
    );
    for (const row of targetRows) {
      const t = normalizeTarget(row);
      if (!t) continue;
      if (!targetMap[t.goal_id]) targetMap[t.goal_id] = [];
      targetMap[t.goal_id].push(t);
    }
  }

  let filtered = goals.map((g) => goalWithTargets(g, targetMap[g.id] || []));

  if (store_id) {
    const key = normalizeStoreKey(store_id);
    filtered = filtered.filter((g) => Array.isArray(g.store_ids) && g.store_ids.map(normalizeStoreKey).includes(key));
  }
  if (seller_id) {
    const sid = Number(seller_id);
    if (Number.isFinite(sid) && sid > 0) {
      filtered = filtered.filter((g) => Array.isArray(g.seller_ids) && g.seller_ids.includes(sid));
    }
  }

  return filtered;
}

async function getGoalById(id) {
  const goalRow = await get("SELECT * FROM commercial_goals WHERE id = ?", [id]);
  const goal = normalizeGoal(goalRow);
  if (!goal) return null;
  const targetRows = await all(
    "SELECT * FROM commercial_goal_targets WHERE goal_id = ? ORDER BY id ASC",
    [goal.id]
  );
  return goalWithTargets(goal, targetRows.map(normalizeTarget).filter(Boolean));
}

async function createGoal(data = {}, user = {}, req = null) {
  const validated = validateGoalPayload(data);
  const now = getToday();
  const userId = user.id ? Number(user.id) : null;

  const insert = await run(
    `INSERT INTO commercial_goals
     (name, description, period_start, period_end, store_ids_json, seller_ids_json, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      validated.name,
      safeText(data.description || ""),
      validated.startDate,
      validated.endDate,
      JSON.stringify(validated.storeIds),
      JSON.stringify(validated.sellerIds),
      "draft",
      userId,
      now,
      now
    ]
  );

  for (const target of validated.targets) {
    await run(
      `INSERT INTO commercial_goal_targets
       (goal_id, target_type, target_id, metric, target_value, weight, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        insert.lastID,
        safeText(target.target_type),
        safeText(target.target_id || ""),
        safeText(target.metric),
        toNumber(target.target_value),
        toNumber(target.weight, 1),
        target.enabled === false ? 0 : 1,
        now,
        now
      ]
    );
  }

  const created = await getGoalById(insert.lastID);
  await logGoalAudit(req, "goal_created", created, null, created, "Meta criada em rascunho.");
  return created;
}

async function updateGoal(id, data = {}, user = {}, req = null) {
  const existing = await getGoalById(id);
  if (!existing) {
    const err = new Error("Meta nao encontrada.");
    err.status = 404;
    throw err;
  }
  if (existing.status !== "draft") {
    const err = new Error("Apenas metas em rascunho podem ser editadas.");
    err.status = 400;
    throw err;
  }

  // Reaplica validacao sobre payload mesclado (campos faltantes caem no valor existente).
  const merged = {
    name: data.name ?? existing.name,
    description: data.description ?? existing.description,
    period_start: data.period_start ?? existing.period_start,
    period_end: data.period_end ?? existing.period_end,
    store_ids: Array.isArray(data.store_ids) ? data.store_ids : existing.store_ids,
    seller_ids: Array.isArray(data.seller_ids) ? data.seller_ids : existing.seller_ids,
    targets: Array.isArray(data.targets) && data.targets.length > 0
      ? data.targets
      : existing.targets.map((t) => ({
          target_type: t.target_type,
          target_id: t.target_id,
          metric: t.metric,
          target_value: t.target_value,
          weight: t.weight,
          enabled: t.enabled
        }))
  };
  const validated = validateGoalPayload(merged);
  const now = getToday();

  await run(
    `UPDATE commercial_goals SET
      name = ?,
      description = ?,
      period_start = ?,
      period_end = ?,
      store_ids_json = ?,
      seller_ids_json = ?,
      updated_at = ?
     WHERE id = ?`,
    [
      validated.name,
      safeText(merged.description || ""),
      validated.startDate,
      validated.endDate,
      JSON.stringify(validated.storeIds),
      JSON.stringify(validated.sellerIds),
      now,
      id
    ]
  );

  // Substitui targets para manter consistencia com validacao.
  await run("DELETE FROM commercial_goal_targets WHERE goal_id = ?", [id]);
  for (const target of validated.targets) {
    await run(
      `INSERT INTO commercial_goal_targets
       (goal_id, target_type, target_id, metric, target_value, weight, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        safeText(target.target_type),
        safeText(target.target_id || ""),
        safeText(target.metric),
        toNumber(target.target_value),
        toNumber(target.weight, 1),
        target.enabled === false ? 0 : 1,
        now,
        now
      ]
    );
  }

  const updated = await getGoalById(id);
  await logGoalAudit(req, "goal_updated", updated, existing, updated, "Meta editada.");
  return updated;
}

async function activateGoal(id, user = {}, req = null) {
  const existing = await getGoalById(id);
  if (!existing) {
    const err = new Error("Meta nao encontrada.");
    err.status = 404;
    throw err;
  }
  if (existing.status === "active") return existing;
  if (existing.status === "closed") {
    const err = new Error("Meta encerrada nao pode ser reativada.");
    err.status = 400;
    throw err;
  }
  if (existing.status === "cancelled") {
    const err = new Error("Meta cancelada nao pode ser ativada.");
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(existing.targets) || existing.targets.length === 0) {
    const err = new Error("Meta sem KPI ativo nao pode ser ativada.");
    err.status = 400;
    throw err;
  }
  const now = getToday();
  await run(
    "UPDATE commercial_goals SET status = 'active', updated_at = ? WHERE id = ?",
    [now, id]
  );
  const updated = await getGoalById(id);
  await logGoalAudit(req, "goal_activated", updated, existing, updated, "Meta ativada.");
  return updated;
}

async function cancelGoal(id, user = {}, req = null) {
  const existing = await getGoalById(id);
  if (!existing) {
    const err = new Error("Meta nao encontrada.");
    err.status = 404;
    throw err;
  }
  if (existing.status === "cancelled") return existing;
  if (existing.status === "closed") {
    const err = new Error("Meta encerrada nao pode ser cancelada.");
    err.status = 400;
    throw err;
  }
  const now = getToday();
  await run(
    "UPDATE commercial_goals SET status = 'cancelled', updated_at = ? WHERE id = ?",
    [now, id]
  );
  const updated = await getGoalById(id);
  await logGoalAudit(req, "goal_cancelled", updated, existing, updated, "Meta cancelada.");
  return updated;
}

async function closeGoal(id, user = {}, req = null) {
  const existing = await getGoalById(id);
  if (!existing) {
    const err = new Error("Meta nao encontrada.");
    err.status = 404;
    throw err;
  }
  if (existing.status !== "active") {
    const err = new Error("Apenas metas ativas podem ser encerradas.");
    err.status = 400;
    throw err;
  }
  const now = getToday();
  await run(
    "UPDATE commercial_goals SET status = 'closed', updated_at = ? WHERE id = ?",
    [now, id]
  );
  const updated = await getGoalById(id);
  await logGoalAudit(req, "goal_closed", updated, existing, updated, "Meta encerrada.");
  return updated;
}

async function deleteGoal(id, user = {}, req = null) {
  const existing = await getGoalById(id);
  if (!existing) {
    const err = new Error("Meta nao encontrada.");
    err.status = 404;
    throw err;
  }
  if (existing.status === "active") {
    const err = new Error("Meta ativa nao pode ser excluida. Cancele antes.");
    err.status = 400;
    throw err;
  }
  await run("DELETE FROM commercial_goal_progress_snapshot WHERE goal_id = ?", [id]);
  await run("DELETE FROM commercial_goal_targets WHERE goal_id = ?", [id]);
  await run("DELETE FROM commercial_goals WHERE id = ?", [id]);
  await logGoalAudit(req, "goal_deleted", existing, existing, null, "Meta excluida.");
  return { id: Number(id), deleted: true };
}

// ── Progresso / projeção ──────────────────────────────────────────────

async function getGoalProgress(id) {
  const goal = await getGoalById(id);
  if (!goal) {
    const err = new Error("Meta nao encontrada.");
    err.status = 404;
    throw err;
  }
  const allSales = readSalesJson();
  let scoped = filterSalesByDateRange(allSales, goal.period_start, goal.period_end);
  if (Array.isArray(goal.store_ids) && goal.store_ids.length > 0) {
    const storeKeys = goal.store_ids.map(normalizeStoreKey).filter(Boolean);
    scoped = scoped.filter((sale) => {
      const saleStore = normalizeStoreKey(sale.loja || sale.loja_venda || sale.sale_store_id || sale.cash_register_store || "");
      return storeKeys.includes(saleStore);
    });
  }
  const aggregate = computeMetricsFromSales(scoped);

  const targetRows = (goal.targets || []).map((t) => ({
    ...t,
    metric_label: METRIC_LABELS[t.metric] || t.metric
  }));

  const targetResults = [];
  for (const t of targetRows) {
    const target = {
      target_type: t.target_type,
      target_id: t.target_id,
      metric: t.metric,
      metric_label: t.metric_label,
      target_value: t.target_value,
      weight: t.weight,
      enabled: t.enabled
    };

    let currentValue = 0;
    if (t.metric === "net_revenue") {
      currentValue = aggregate.net_revenue;
    } else if (t.metric === "average_ticket") {
      currentValue = aggregate.average_ticket;
    } else if (t.metric === "pa") {
      currentValue = aggregate.pa;
    } else if (t.metric === "customer_linked_percent") {
      currentValue = aggregate.customer_linked_percent;
    } else if (t.metric === "customer_size_percent") {
      const sizeInfo = await computeCustomerSizePercentForStores(goal.store_ids || []);
      currentValue = sizeInfo.customer_size_percent;
      target.contacts_total = sizeInfo.total_contacts;
      target.contacts_with_size = sizeInfo.contacts_with_size;
    }

    const progressPercent = t.target_value > 0 ? roundMoney((currentValue / t.target_value) * 100) : 0;
    const projection = buildProjection(currentValue, goal.period_start, goal.period_end);
    target.current_value = currentValue;
    target.progress_percent = progressPercent;
    target.projection_value = projection.projection_value;
    target.days_elapsed = projection.days_elapsed;
    target.days_total = projection.days_total;
    targetResults.push(target);
  }

  return {
    goal: {
      id: goal.id,
      name: goal.name,
      description: goal.description,
      status: goal.status,
      period_start: goal.period_start,
      period_end: goal.period_end,
      store_ids: goal.store_ids,
      seller_ids: goal.seller_ids,
      created_at: goal.created_at,
      updated_at: goal.updated_at
    },
    aggregate: {
      metrics: aggregate,
      store_ids: goal.store_ids || [],
      seller_ids: goal.seller_ids || []
    },
    targets: targetResults
  };
}

async function snapshotGoalProgress(id) {
  const progress = await getGoalProgress(id);
  const now = getToday();
  const snapshotRows = [];
  for (const t of progress.targets) {
    const result = await run(
      `INSERT INTO commercial_goal_progress_snapshot
       (goal_id, target_id, metric, current_value, target_value, progress_percent, projection_value, snapshot_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        Number(t.target_id) || null,
        t.metric,
        t.current_value,
        t.target_value,
        t.progress_percent,
        t.projection_value,
        now,
        now
      ]
    );
    snapshotRows.push({ id: Number(result.lastID), ...t });
  }
  return { goal_id: Number(id), snapshots: snapshotRows, snapshot_date: now };
}

// ── Performance para rotas /goals/performance/* ───────────────────────

async function getGoalsSellerPerformance(sellerId, options = {}) {
  const { start_date, end_date } = options;
  const sellerNum = Number(sellerId);
  if (!sellerNum) return null;
  const seller = await get("SELECT * FROM sellers WHERE id = ?", [sellerNum]);
  if (!seller) return null;

  const allSales = readSalesJson();
  const sellerSales = filterSalesByDateRange(
    filterSalesBySellerName(allSales, seller.name),
    start_date,
    end_date
  );
  const metrics = computeMetricsFromSales(sellerSales);

  return {
    seller_id: sellerNum,
    seller_name: seller.name || "",
    store: seller.store || "",
    metrics,
    period: {
      start_date: start_date || "",
      end_date: end_date || ""
    }
  };
}

async function getGoalsStorePerformance(storeId, options = {}) {
  const { start_date, end_date } = options;
  const key = normalizeStoreKey(storeId);
  if (!key) return null;

  const allSales = readSalesJson();
  const storeSales = filterSalesByDateRange(
    filterSalesByStore(allSales, key),
    start_date,
    end_date
  );
  const metrics = computeMetricsFromSales(storeSales);
  const sizeInfo = await computeCustomerSizePercentForStores([key]);

  return {
    store_id: key,
    store_name: getStoreLabel(key),
    metrics,
    contacts: {
      total: sizeInfo.total_contacts,
      with_size: sizeInfo.contacts_with_size,
      size_percent: sizeInfo.customer_size_percent
    },
    period: {
      start_date: start_date || "",
      end_date: end_date || ""
    }
  };
}

// ── Catálogos auxiliares (para o frontend futuro) ─────────────────────

async function listSellerOptions() {
  const rows = await all("SELECT id, name, store FROM sellers WHERE status = 'ativo' ORDER BY name ASC");
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name || "",
    store: row.store || "",
    store_key: normalizeStoreKey(row.store || "")
  }));
}

module.exports = {
  // CRUD
  listGoals,
  getGoalById,
  createGoal,
  updateGoal,
  activateGoal,
  cancelGoal,
  closeGoal,
  deleteGoal,
  // Progresso
  getGoalProgress,
  snapshotGoalProgress,
  // Performance dedicada às metas
  getGoalsSellerPerformance,
  getGoalsStorePerformance,
  // Catálogos
  listSellerOptions,
  // Util
  VALID_METRICS,
  VALID_TARGET_TYPES,
  VALID_STATUSES,
  METRIC_LABELS,
  STORE_LABELS,
  normalizeStoreKey,
  getStoreLabel
};