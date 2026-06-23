"use strict";

const { get, run, all } = require("../../../db");

function getToday(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

// ── Normalização ─────────────────────────────────────────────────────

function normalizeChallenge(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: Number(row.id),
    name: row.name || "",
    description: row.description || "",
    store_id: row.store_id || "",
    start_date: row.start_date || "",
    end_date: row.end_date || "",
    status: row.status || "draft",
    rule_type: row.rule_type || "",
    rules: safeJsonParse(row.rules_json, {}),
    target_skus: safeJsonParse(row.target_skus_json, []),
    target_categories: safeJsonParse(row.target_categories_json, []),
    prize: safeJsonParse(row.prize_json, {}),
    created_by: row.created_by ? Number(row.created_by) : null,
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

function normalizeResult(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: Number(row.id),
    challenge_id: Number(row.challenge_id),
    seller_id: Number(row.seller_id),
    seller_name: row.seller_name || "",
    current_value: toNumber(row.current_value),
    eligible_sales_count: Number(row.eligible_sales_count) || 0,
    eligible_items_count: Number(row.eligible_items_count) || 0,
    rank_position: row.rank_position ? Number(row.rank_position) : null,
    prize_earned: toNumber(row.prize_earned),
    settled: Boolean(row.settled),
    settled_at: row.settled_at || "",
    settled_by: row.settled_by ? Number(row.settled_by) : null,
    paid: Boolean(row.paid),
    paid_at: row.paid_at || "",
    paid_by: row.paid_by ? Number(row.paid_by) : null,
    evidence: safeJsonParse(row.evidence_json, {}),
    updated_at: row.updated_at || ""
  };
}

// ── Regras de Corridinha ─────────────────────────────────────────────

function buildRuleConfig(ruleType = "", rulesJson = {}) {
  const defaults = {
    quantity_target: 0,
    ticket_threshold: 0,
    ticket_threshold_count: 0,
    highest_quantity: false
  };
  const overrides = safeJsonParse(rulesJson, {});
  return { ...defaults, ...overrides, rule_type: ruleType };
}

function isSaleEligible(sale = {}, ruleType = "", config = {}) {
  if (!sale || !sale.id) return false;
  const total = toNumber(sale.total || sale.total_venda || 0);
  const items = Array.isArray(sale.items || sale.produtos) ? sale.items || sale.produtos : [];

  const hasSkuFilter = Array.isArray(config.target_skus) && config.target_skus.length > 0;
  const hasCategoryFilter = Array.isArray(config.target_categories) && config.target_categories.length > 0;
  const hasItemFilter = hasSkuFilter || hasCategoryFilter;

  function matchesItemFilter(item) {
    const sku = String(item.sku || item.product_sku || "").trim();
    const category = String(item.category || item.categoria || "").trim();
    if (hasSkuFilter) return config.target_skus.includes(sku);
    if (hasCategoryFilter) return config.target_categories.includes(category);
    return true;
  }

  if (ruleType === "quantity_target") {
    const target = toNumber(config.quantity_target, 0);
    const ticketThreshold = toNumber(config.ticket_threshold, 0);
    const ticketCount = toNumber(config.ticket_threshold_count, 0);
    if (ticketThreshold > 0 && total < ticketThreshold) return false;
    const qualifyingItems = hasItemFilter ? items.filter(matchesItemFilter) : items;
    if (ticketCount > 0 && qualifyingItems.length < ticketCount) return false;
    const totalItems = qualifyingItems.reduce((sum, item) => sum + Number(item.quantity || item.quantidade || 0), 0);
    return totalItems >= target;
  }

  if (ruleType === "ticket_threshold_count") {
    const threshold = toNumber(config.ticket_threshold, 0);
    const count = toNumber(config.ticket_threshold_count, 0);
    if (threshold > 0 && total < threshold) return false;
    return items.length >= count;
  }

  if (ruleType === "highest_quantity") {
    const threshold = toNumber(config.ticket_threshold, 0);
    if (threshold > 0 && total < threshold) return false;
    return true;
  }

  return false;
}

// ── Performance Base ─────────────────────────────────────────────────

async function getSellerPerformance(sellerId, options = {}) {
  const { store_id, start_date, end_date } = options;
  const sellerNum = Number(sellerId);
  if (!sellerNum) return null;

  const seller = await get("SELECT * FROM sellers WHERE id = ?", [sellerNum]);
  if (!seller) return null;

  let salesQuery = "SELECT * FROM pdv_sales WHERE seller_id = ?";
  const params = [sellerNum];

  if (start_date) {
    salesQuery += " AND created_at >= ?";
    params.push(start_date);
  }
  if (end_date) {
    salesQuery += " AND created_at <= ?";
    params.push(end_date + " 23:59:59");
  }

  const sales = await all(salesQuery, params);
  const validSales = sales.filter((s) => s.operational_status !== "cancelled");
  const totalSold = validSales.reduce((sum, s) => sum + toNumber(s.total || 0), 0);
  const totalItems = validSales.reduce((sum, s) => {
    const items = Array.isArray(s.items) ? s.items : safeJsonParse(s.items_json, []);
    return sum + items.reduce((is, item) => is + Number(item.quantity || item.quantidade || 0), 0);
  }, 0);

  return {
    seller_id: sellerNum,
    seller_name: seller.name || "",
    store: seller.store || "",
    total_sales: validSales.length,
    total_sold: roundMoney(totalSold),
    total_items: totalItems,
    average_ticket: validSales.length ? roundMoney(totalSold / validSales.length) : 0,
    sales: validSales.slice(0, 20).map((s) => ({
      id: s.id || s.sale_id,
      date: s.created_at,
      total: toNumber(s.total || 0),
      status: s.operational_status
    }))
  };
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

async function getPerformanceRanking(options = {}) {
  const { store_id, start_date, end_date, limit = 20 } = options;

  let sellersQuery = "SELECT * FROM sellers WHERE status = 'ativo'";
  const sellersParams = [];
  if (store_id) {
    sellersQuery += " AND store = ?";
    sellersParams.push(store_id);
  }

  const sellers = await all(sellersQuery, sellersParams);
  const today = getToday();

  const rankings = [];
  for (const seller of sellers) {
    let salesQuery = "SELECT * FROM pdv_sales WHERE seller_id = ? AND operational_status != 'cancelled'";
    const salesParams = [seller.id];

    if (start_date) {
      salesQuery += " AND created_at >= ?";
      salesParams.push(start_date);
    }
    if (end_date) {
      salesQuery += " AND created_at <= ?";
      salesParams.push(end_date + " 23:59:59");
    }

    const sales = await all(salesQuery, salesParams);
    const totalSold = sales.reduce((sum, s) => sum + toNumber(s.total || 0), 0);
    const totalItems = sales.reduce((sum, s) => {
      const items = Array.isArray(s.items) ? s.items : safeJsonParse(s.items_json, []);
      return sum + items.reduce((is, item) => is + Number(item.quantity || item.quantidade || 0), 0);
    }, 0);

    rankings.push({
      seller_id: Number(seller.id),
      seller_name: seller.name || "",
      store: seller.store || "",
      total_sales: sales.length,
      total_sold: roundMoney(totalSold),
      total_items: totalItems,
      average_ticket: sales.length ? roundMoney(totalSold / sales.length) : 0
    });
  }

  rankings.sort((a, b) => b.total_sold - a.total_sold);
  rankings.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  return rankings.slice(0, Number(limit));
}

async function getStorePerformance(storeId, options = {}) {
  const { start_date, end_date } = options;
  if (!storeId) return null;

  let salesQuery = "SELECT * FROM pdv_sales WHERE store_id = ? AND operational_status != 'cancelled'";
  const params = [storeId];

  if (start_date) {
    salesQuery += " AND created_at >= ?";
    params.push(start_date);
  }
  if (end_date) {
    salesQuery += " AND created_at <= ?";
    params.push(end_date + " 23:59:59");
  }

  const sales = await all(salesQuery, params);
  const totalSold = sales.reduce((sum, s) => sum + toNumber(s.total || 0), 0);
  const totalItems = sales.reduce((sum, s) => {
    const items = Array.isArray(s.items) ? s.items : safeJsonParse(s.items_json, []);
    return sum + items.reduce((is, item) => is + Number(item.quantity || item.quantidade || 0), 0);
  }, 0);

  const sellersInStore = await all(
    "SELECT COUNT(*) AS total FROM sellers WHERE store = ? AND status = 'ativo'",
    [storeId]
  );

  return {
    store_id: storeId,
    total_sales: sales.length,
    total_sold: roundMoney(totalSold),
    total_items: totalItems,
    average_ticket: sales.length ? roundMoney(totalSold / sales.length) : 0,
    active_sellers: sellersInStore[0]?.total || 0,
    sales: sales.slice(0, 20).map((s) => ({
      id: s.id || s.sale_id,
      date: s.created_at,
      seller_name: s.seller_name || "",
      total: toNumber(s.total || 0),
      status: s.operational_status
    }))
  };
}

// ── CRUD de Campanhas ────────────────────────────────────────────────

async function listCampaigns(options = {}) {
  const { store_id, status } = options;
  let query = "SELECT * FROM campaign_challenges WHERE 1=1";
  const params = [];
  if (store_id) {
    query += " AND (store_id = ? OR store_id = '')";
    params.push(store_id);
  }
  if (status) {
    query += " AND status = ?";
    params.push(status);
  }
  query += " ORDER BY created_at DESC";
  const rows = await all(query, params);
  return rows.map(normalizeChallenge).filter(Boolean);
}

async function getCampaignById(id) {
  const row = await get("SELECT * FROM campaign_challenges WHERE id = ?", [id]);
  return normalizeChallenge(row);
}

async function createCampaign(data = {}, user = {}) {
  const now = getToday();
  const prize = typeof data.prize === "object" ? data.prize : { type: "fixed", value: 0 };
  const result = await run(
    `INSERT INTO campaign_challenges
     (name, description, store_id, start_date, end_date, status, rule_type, rules_json,
      target_skus_json, target_categories_json, prize_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name || "",
      data.description || "",
      data.store_id || "",
      data.start_date || now,
      data.end_date || now,
      "draft",
      data.rule_type || "quantity_target",
      JSON.stringify(data.rules || {}),
      JSON.stringify(data.target_skus || []),
      JSON.stringify(data.target_categories || []),
      JSON.stringify(prize),
      user.id ? Number(user.id) : null,
      now,
      now
    ]
  );
  return getCampaignById(result.lastID);
}

async function updateCampaign(id, data = {}) {
  const now = getToday();
  await run(
    `UPDATE campaign_challenges SET
     name = COALESCE(?, name),
     description = COALESCE(?, description),
     store_id = COALESCE(?, store_id),
     start_date = COALESCE(?, start_date),
     end_date = COALESCE(?, end_date),
     rule_type = COALESCE(?, rule_type),
     rules_json = COALESCE(?, rules_json),
     target_skus_json = COALESCE(?, target_skus_json),
     target_categories_json = COALESCE(?, target_categories_json),
     prize_json = COALESCE(?, prize_json),
     updated_at = ?
     WHERE id = ?`,
    [
      data.name,
      data.description,
      data.store_id,
      data.start_date,
      data.end_date,
      data.rule_type,
      data.rules ? JSON.stringify(data.rules) : null,
      data.target_skus ? JSON.stringify(data.target_skus) : null,
      data.target_categories ? JSON.stringify(data.target_categories) : null,
      data.prize ? JSON.stringify(data.prize) : null,
      now,
      id
    ]
  );
  return getCampaignById(id);
}

async function deleteCampaign(id) {
  await run("DELETE FROM campaign_results WHERE challenge_id = ?", [id]);
  await run("DELETE FROM campaign_participants WHERE challenge_id = ?", [id]);
  await run("DELETE FROM campaign_challenges WHERE id = ?", [id]);
}

// ── Status da Campanha ───────────────────────────────────────────────

async function activateCampaign(id) {
  await run("UPDATE campaign_challenges SET status = 'active', updated_at = ? WHERE id = ? AND status = 'draft'", [getToday(), id]);
  const challenge = await getCampaignById(id);
  if (!challenge) throw new Error("Campanha nao encontrada.");
  if (challenge.status !== "active") throw new Error("Campanha nao pode ser ativada.");

  const sellers = await all("SELECT * FROM sellers WHERE status = 'ativo'");
  for (const seller of sellers) {
    const existing = await get("SELECT id FROM campaign_participants WHERE challenge_id = ? AND seller_id = ?", [id, seller.id]);
    if (!existing) {
      await run(
        "INSERT INTO campaign_participants (challenge_id, seller_id, seller_name, status, joined_at) VALUES (?, ?, ?, 'active', ?)",
        [id, seller.id, seller.name || "", getToday()]
      );
    }
  }
  return challenge;
}

async function cancelCampaign(id) {
  await run("UPDATE campaign_challenges SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('draft','active')", [getToday(), id]);
  return getCampaignById(id);
}

// ── Live Ranking ─────────────────────────────────────────────────────

async function getLiveStatus(challengeId, options = {}) {
  const challenge = await getCampaignById(challengeId);
  if (!challenge) throw new Error("Campanha nao encontrada.");

  const participants = await all(
    "SELECT * FROM campaign_participants WHERE challenge_id = ?",
    [challengeId]
  );

  const config = buildRuleConfig(challenge.rule_type, challenge.rules);

  const today = getToday();
  let salesQuery = "SELECT * FROM pdv_sales WHERE operational_status != 'cancelled'";
  const params = [];
  salesQuery += " AND created_at >= ? AND created_at <= ?";
  params.push(challenge.start_date, challenge.end_date + " 23:59:59");

  const sales = await all(salesQuery, params);
  const results = [];

  for (const participant of participants) {
    const sellerSales = sales.filter((s) => Number(s.seller_id) === Number(participant.seller_id));
    let currentValue = 0;
    let eligibleSalesCount = 0;
    let eligibleItemsCount = 0;

    for (const sale of sellerSales) {
      const saleItems = Array.isArray(sale.items) ? sale.items : safeJsonParse(sale.items_json, []);
      const saleObj = { ...sale, items: saleItems };
      if (isSaleEligible(saleObj, challenge.rule_type, config)) {
        eligibleSalesCount++;
        const itemCount = saleItems.reduce((sum, item) => sum + Number(item.quantity || item.quantidade || 0), 0);
        eligibleItemsCount += itemCount;

        if (challenge.rule_type === "quantity_target") {
          currentValue = eligibleItemsCount;
        } else if (challenge.rule_type === "ticket_threshold_count") {
          currentValue = eligibleSalesCount;
        } else if (challenge.rule_type === "highest_quantity") {
          currentValue = Math.max(currentValue, eligibleItemsCount);
        }
      }
    }

    results.push({
      seller_id: Number(participant.seller_id),
      seller_name: participant.seller_name || "",
      current_value: currentValue,
      eligible_sales_count: eligibleSalesCount,
      eligible_items_count: eligibleItemsCount
    });
  }

  results.sort((a, b) => b.current_value - a.current_value);
  results.forEach((item, idx) => {
    item.rank = idx + 1;
    item.is_winner = idx === 0 && item.current_value > 0;
  });

  return {
    challenge: {
      id: challenge.id,
      name: challenge.name,
      status: challenge.status,
      rule_type: challenge.rule_type,
      start_date: challenge.start_date,
      end_date: challenge.end_date
    },
    ranking: results,
    config
  };
}

// ── Settle / Apuração ────────────────────────────────────────────────

async function settleCampaign(challengeId, user = {}) {
  const challenge = await getCampaignById(challengeId);
  if (!challenge) throw new Error("Campanha nao encontrada.");
  if (challenge.status !== "active") throw new Error("Apenas campanhas ativas podem ser apuradas.");

  const liveData = await getLiveStatus(challengeId);
  const { ranking, config } = liveData;
  const now = getToday();
  const userId = user.id ? Number(user.id) : null;

  for (const entry of ranking) {
    const existing = await get("SELECT id FROM campaign_results WHERE challenge_id = ? AND seller_id = ?", [challengeId, entry.seller_id]);
    const prizeEarned = computePrize(entry, config, challenge.prize);

    if (existing) {
      await run(
        `UPDATE campaign_results SET
         current_value = ?, eligible_sales_count = ?, eligible_items_count = ?,
         rank_position = ?, prize_earned = ?, settled = 1, settled_at = ?, settled_by = ?, updated_at = ?
         WHERE id = ?`,
        [entry.current_value, entry.eligible_sales_count, entry.eligible_items_count,
         entry.rank, prizeEarned, now, userId, now, existing.id]
      );
    } else {
      await run(
        `INSERT INTO campaign_results
         (challenge_id, seller_id, seller_name, current_value, eligible_sales_count, eligible_items_count,
          rank_position, prize_earned, settled, settled_at, settled_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [challengeId, entry.seller_id, entry.seller_name, entry.current_value,
         entry.eligible_sales_count, entry.eligible_items_count, entry.rank, prizeEarned, now, userId, now]
      );
    }
  }

  await run("UPDATE campaign_challenges SET status = 'settled', updated_at = ? WHERE id = ?", [now, challengeId]);

  return getCampaignResults(challengeId);
}

function computePrize(entry = {}, config = {}, prize = {}) {
  if (!entry.current_value || entry.current_value === 0) return 0;
  const prizeType = prize.type || "fixed";
  if (prizeType === "fixed") {
    return toNumber(prize.value || 0);
  }
  if (prizeType === "per_item") {
    return toNumber(prize.value || 0) * entry.current_value;
  }
  if (prizeType === "per_win") {
    return entry.rank === 1 ? toNumber(prize.value || 0) : 0;
  }
  return 0;
}

// ── Resultados ───────────────────────────────────────────────────────

async function getCampaignResults(challengeId) {
  const challenge = await getCampaignById(challengeId);
  if (!challenge) throw new Error("Campanha nao encontrada.");

  const rows = await all(
    "SELECT * FROM campaign_results WHERE challenge_id = ? ORDER BY rank_position ASC",
    [challengeId]
  );
  return {
    challenge: {
      id: challenge.id,
      name: challenge.name,
      status: challenge.status,
      rule_type: challenge.rule_type,
      prize: challenge.prize,
      start_date: challenge.start_date,
      end_date: challenge.end_date
    },
    results: rows.map(normalizeResult).filter(Boolean)
  };
}

async function markRewardPaid(resultId, user = {}) {
  const result = await get("SELECT * FROM campaign_results WHERE id = ?", [resultId]);
  if (!result) throw new Error("Resultado nao encontrado.");
  if (!result.settled) throw new Error("Resultado ainda nao foi apurado.");

  const now = getToday();
  const userId = user.id ? Number(user.id) : null;
  await run(
    "UPDATE campaign_results SET paid = 1, paid_at = ?, paid_by = ?, updated_at = ? WHERE id = ?",
    [now, userId, now, resultId]
  );
  return normalizeResult(await get("SELECT * FROM campaign_results WHERE id = ?", [resultId]));
}

module.exports = {
  // Performance
  getSellerPerformance,
  getPerformanceRanking,
  getStorePerformance,
  // Campaigns
  listCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  activateCampaign,
  cancelCampaign,
  getLiveStatus,
  settleCampaign,
  getCampaignResults,
  markRewardPaid,
  // Utilities
  buildRuleConfig,
  isSaleEligible
};