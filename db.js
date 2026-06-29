const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();

const configuredDatabasePath = String(process.env.DATABASE_PATH || "").trim();
const dbPath = configuredDatabasePath
  ? path.resolve(configuredDatabasePath)
  : path.join(__dirname, "data", "aerostore-crm.sqlite");
const dataDir = path.dirname(dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.join(", ");
  }

  return String(tags || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

function hashPassword(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function buildRolePermissions(role = "seller") {
  const normalized = String(role || "").trim().toLowerCase();
  const base = {
    can_sell: false,
    can_finalize_sale: false,
    can_cancel_sale: false,
    can_view_products: false,
    can_manage_products: false,
    can_view_customers: false,
    can_create_customers: false,
    can_edit_customers: false,
    can_open_close_register: false,
    can_view_cash_register: false,
    can_register_cash_movement: false,
    can_close_register: false,
    can_apply_discount: false,
    can_request_discount_authorization: true,
    can_approve_discount_authorization: false,
    can_view_cashback: false,
    can_manage_cashback: false,
    can_launch_cashback: false,
    can_use_whatsapp: false,
    can_view_whatsapp_status: false,
    can_reconnect_whatsapp: false,
    can_disconnect_whatsapp: false,
    can_reset_whatsapp_session: false,
    can_view_whatsapp_logs: false,
    can_send_whatsapp_test: false,
    can_view_reports: false,
    can_view_store_reports: false,
    can_view_global_reports: false,
    can_view_consolidation: false,
    can_view_audit: false,
    can_manage_users: false,
    can_manage_store_settings: false,
    can_manage_global_settings: false,
    can_view_all_stores: false,
    can_view_aerointel: false,
    can_view_campaigns: false,
    can_manage_campaigns: false,
    can_view_store_settings: false,
    can_view_orders: false,
    can_release_orders: false,
    can_view_exchanges: false,
    can_generate_exchange_credit: false,
    can_create_manual_exchange_credit: false,
    can_cancel_manual_exchange_credit: false,
    can_view_stock: false,
    can_adjust_inventory: false,
    can_adjust_product_price: false,
    can_move_stock: false,
    can_export_data: false,
    can_view_commercial_management: false,
    can_manage_commercial_goals: false,
    can_view_campaign_rankings: false,
    can_settle_campaign_rewards: false,
    can_manage_campaign_challenges: false
  };

  if (["admin", "administrator", "administrador", "master"].includes(normalized)) {
    return Object.keys(base).reduce((acc, key) => {
      acc[key] = true;
      return acc;
    }, {});
  }

  if (["manager", "gerente", "gestor"].includes(normalized)) {
    return {
      ...base,
      can_sell: true,
      can_finalize_sale: true,
      can_cancel_sale: true,
      can_view_products: true,
      can_manage_products: true,
      can_view_customers: true,
      can_create_customers: true,
      can_edit_customers: true,
      can_open_close_register: true,
      can_view_cash_register: true,
      can_register_cash_movement: true,
      can_close_register: true,
      can_apply_discount: true,
      can_approve_discount_authorization: true,
      can_view_cashback: true,
      can_manage_cashback: true,
      can_launch_cashback: true,
      can_use_whatsapp: true,
      can_view_whatsapp_status: true,
      can_reconnect_whatsapp: true,
      can_disconnect_whatsapp: true,
      can_view_whatsapp_logs: true,
      can_send_whatsapp_test: true,
      can_view_reports: true,
      can_view_store_reports: true,
      can_view_consolidation: true,
      can_view_campaigns: true,
      can_manage_campaigns: true,
      can_manage_store_settings: true,
      can_view_store_settings: true,
      can_view_orders: true,
      can_release_orders: true,
      can_view_exchanges: true,
      can_generate_exchange_credit: true,
      can_view_stock: true,
      can_adjust_inventory: true,
      can_adjust_product_price: true,
      can_move_stock: true,
      can_export_data: true
    };
  }

  if (["cashier", "caixa"].includes(normalized)) {
    return {
      ...base,
      can_view_products: true,
      can_view_customers: true,
      can_view_cash_register: true,
      can_open_close_register: true,
      can_register_cash_movement: true,
      can_close_register: true,
      can_view_orders: true,
      can_release_orders: true,
      can_view_cashback: true,
      can_view_whatsapp_status: true
    };
  }

  if (["consult", "consulta", "readonly", "operacional"].includes(normalized)) {
    return {
      ...base,
      can_view_products: true,
      can_view_customers: true,
      can_view_cashback: true,
      can_view_orders: true,
      can_view_whatsapp_status: true
    };
  }

  return {
    ...base,
    can_sell: true,
    can_finalize_sale: true,
    can_view_products: true,
    can_view_customers: true,
    can_create_customers: true,
    can_use_whatsapp: true,
    can_view_whatsapp_status: true,
    can_request_discount_authorization: true,
    can_view_orders: true,
    can_view_exchanges: true,
    can_view_commercial_management: true
  };
}

function ensureArrayJson(value = []) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function ensureObjectJson(value = {}) {
  return JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

async function ensureUserAccount({
  email,
  password = "123456",
  roleLegacy = "vendedor",
  roleKey = "seller",
  name = "",
  username = "",
  phone = "",
  store = "",
  storeId = "",
  allowedStores = [],
  sellerId = null,
  status = "ativo"
} = {}) {
  if (!email) {
    return;
  }

  const existing = await get("SELECT id FROM users WHERE email = ? LIMIT 1", [String(email || "").trim().toLowerCase()]);
  const payload = {
    email: String(email || "").trim().toLowerCase(),
    password_hash: hashPassword(password),
    role: roleLegacy,
    store: String(store || "").trim(),
    store_id: String(storeId || "").trim(),
    seller_id: sellerId ? Number(sellerId) : null,
    status: String(status || "ativo").trim(),
    name: String(name || "").trim(),
    username: String(username || "").trim(),
    phone: String(phone || "").trim(),
    allowed_stores_json: ensureArrayJson(allowedStores),
    permissions_json: ensureObjectJson(buildRolePermissions(roleKey))
  };

  if (existing?.id) {
    await run(
      `UPDATE users SET
        password_hash = COALESCE(NULLIF(password_hash, ''), ?),
        role = COALESCE(NULLIF(role, ''), ?),
        store = COALESCE(NULLIF(store, ''), ?),
        store_id = COALESCE(NULLIF(store_id, ''), ?),
        seller_id = COALESCE(seller_id, ?),
        status = COALESCE(NULLIF(status, ''), ?),
        name = COALESCE(NULLIF(name, ''), ?),
        username = COALESCE(NULLIF(username, ''), ?),
        phone = COALESCE(NULLIF(phone, ''), ?),
        allowed_stores_json = COALESCE(NULLIF(allowed_stores_json, ''), ?),
        permissions_json = COALESCE(NULLIF(permissions_json, ''), ?),
        updated_at = datetime('now')
       WHERE id = ?`,
      [
        payload.password_hash,
        payload.role,
        payload.store,
        payload.store_id,
        payload.seller_id,
        payload.status,
        payload.name,
        payload.username,
        payload.phone,
        payload.allowed_stores_json,
        payload.permissions_json,
        existing.id
      ]
    );
    return;
  }

  await run(
    `INSERT INTO users
    (email, password_hash, role, store, store_id, seller_id, status, name, username, phone, allowed_stores_json, permissions_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      payload.email,
      payload.password_hash,
      payload.role,
      payload.store,
      payload.store_id,
      payload.seller_id,
      payload.status,
      payload.name,
      payload.username,
      payload.phone,
      payload.allowed_stores_json,
      payload.permissions_json
    ]
  );
}

const LEGACY_TEXT_REPLACEMENTS = [
  ["ÃƒÂ§", "ç"],
  ["ÃƒÂ£", "ã"],
  ["ÃƒÂ¡", "á"],
  ["ÃƒÂ¢", "â"],
  ["ÃƒÂª", "ê"],
  ["ÃƒÂ©", "é"],
  ["ÃƒÂ­", "í"],
  ["ÃƒÂ³", "ó"],
  ["ÃƒÂ´", "ô"],
  ["ÃƒÂº", "ú"],
  ["Ãƒâ€°", "É"],
  ["Ãƒâ€œ", "Ó"],
  ["ÃƒÅ¡", "Ú"],
  ["Ãƒâ‚¬", "À"],
  ["Ãƒ", "à"],
  ["Ã", "à"],
  ["Ã§", "ç"],
  ["Ã£", "ã"],
  ["Ã¡", "á"],
  ["Ã¢", "â"],
  ["Ãª", "ê"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ã´", "ô"],
  ["Ãº", "ú"],
  ["Ã‰", "É"],
  ["Ã“", "Ó"],
  ["ÃŠ", "Ú"],
  ["Ã€", "À"],
  ["â€¢", "•"],
  ["b?nus", "bônus"],
  ["B?nus", "Bônus"],
  ["Bonus", "Bônus"],
  ["bonus", "bônus"],
  ["Cashback dispon?vel", "Cashback disponível"],
  ["dispon?vel", "disponível"],
  ["Relat?rios", "Relatórios"],
  ["Relat?rio", "Relatório"],
  ["G?nero", "Gênero"],
  ["Execu??o", "Execução"],
  ["Configura??es", "Configurações"],
  ["confirma??o", "confirmação"],
  ["Confirma??o", "Confirmação"],
  ["validacao", "validação"],
  ["valida??o", "validação"],
  ["Altera??o", "Alteração"],
  ["Observa??es", "Observações"],
  ["opera??o", "operação"],
  ["Finaliza??o", "Finalização"],
  ["?ltimos 4 n?meros", "últimos 4 números"],
  ["pr?ximo", "próximo"],
  ["n?o", "não"],
  ["r?pido", "rápido"],
  ["lan?amento", "lançamento"],
  ["Bot?nico", "Botânico"],
  ["V?lido", "Válido"],
  ["Ser? usado", "Será usado"],
  ["N?o recebimento do PIN", "Não recebimento do PIN"],
  ["S? ? poss?vel", "Só é possível"],
  ["c?digo", "código"],
  ["at?", "até"],
  [" j? ", " já "],
  ["voc?", "você"],
  ["Voc?", "Você"],
  ["excluido", "excluído"],
  ["Excluido", "Excluído"],
  ["reativacao", "reativação"],
  ["aniversario", "aniversário"],
  ["manha", "manhã"],
  ["Campanhá", "Campanha"],
  ["Sumido ha ", "Sumido há "]
];

function normalizeLegacyText(value) {
  if (value === null || value === undefined) {
    return value;
  }
  let output = String(value);
  for (const [from, to] of LEGACY_TEXT_REPLACEMENTS) {
    output = output.split(from).join(to);
  }
  return output;
}

async function repairLegacyTableTexts(tableName, columns) {
  const rows = await all(`SELECT rowid AS rid, ${columns.join(", ")} FROM ${tableName}`);
  for (const row of rows) {
    const updates = [];
    const params = [];
    for (const column of columns) {
      const currentValue = row[column];
      if (typeof currentValue !== "string") {
        continue;
      }
      const normalizedValue = normalizeLegacyText(currentValue);
      if (normalizedValue !== currentValue) {
        updates.push(`${column} = ?`);
        params.push(normalizedValue);
      }
    }
    if (updates.length) {
      params.push(row.rid);
      await run(`UPDATE ${tableName} SET ${updates.join(", ")} WHERE rowid = ?`, params);
    }
  }
}

async function repairLegacyStoredTexts() {
  await repairLegacyTableTexts("contacts", ["name", "gender", "store", "seller_name", "status", "notes", "tags"]);
  await repairLegacyTableTexts("campaigns", ["name", "seller", "seller_name", "store", "template", "status"]);
  await repairLegacyTableTexts("cashbacks", [
    "customer_name",
    "customer_gender",
    "store",
    "seller",
    "seller_name",
    "status",
    "origin",
    "cancel_reason",
    "created_by",
    "pin_sent_by",
    "pin_validated_by"
  ]);
  await repairLegacyTableTexts("cashback_events", ["event_type", "store", "seller", "reason", "campaign", "notes", "pin"]);
  await repairLegacyTableTexts("cashback_pin_tokens", [
    "customer_name",
    "customer_gender",
    "store",
    "seller_name",
    "status",
    "created_by",
    "pin_sent_by",
    "pin_validated_by"
  ]);
  await repairLegacyTableTexts("sellers", ["name", "store", "status"]);
  await repairLegacyTableTexts("users", ["email", "role", "store", "status"]);
}

async function ensureColumn(tableName, columnName, definition) {
  const columns = await all(`PRAGMA table_info(${tableName})`);
  if (!columns.some((column) => column.name === columnName)) {
    await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function ensureCashbackSettingsSeed() {
  const settings = await get("SELECT COUNT(*) AS total FROM cashback_settings");
  if (!settings || settings.total === 0) {
    await run(
      `INSERT INTO cashback_settings
      (percentages_json, default_validity_days, default_minimum_purchase, reactivation_limit_per_store, reactivated_validity_days, anticipated_validity_days, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [JSON.stringify([5, 10, 15, 20]), 30, 0, 10, 1, 7]
    );
    return;
  }

  await run(
    `UPDATE cashback_settings SET
    percentages_json = COALESCE(NULLIF(percentages_json, ''), ?),
    default_validity_days = COALESCE(default_validity_days, 30),
    default_minimum_purchase = COALESCE(default_minimum_purchase, 0),
    reactivation_limit_per_store = COALESCE(reactivation_limit_per_store, 10),
    reactivated_validity_days = COALESCE(reactivated_validity_days, 1),
    anticipated_validity_days = COALESCE(anticipated_validity_days, 7),
    updated_at = COALESCE(updated_at, datetime('now'))
    WHERE id = (SELECT id FROM cashback_settings ORDER BY id ASC LIMIT 1)`,
    [JSON.stringify([5, 10, 15, 20])]
  );
}

// ─── FASE 1: Seed para desconto em folha e funcionários ───
async function ensureDescontoFolhaSeed() {
  // 1. Seed de configuração — só insere se não existir
  const configCount = await get("SELECT COUNT(*) AS total FROM desconto_folha_config");
  if (!configCount || configCount.total === 0) {
    const configs = [
      ["carencia_dias", "90", "sistema", "2026-06-21T00:00:00.000Z"],
      ["limite_parcela", "500.00", "sistema", "2026-06-21T00:00:00.000Z"],
      ["max_parcelas", "3", "sistema", "2026-06-21T00:00:00.000Z"],
      ["email_contabilidade", "", "sistema", "2026-06-21T00:00:00.000Z"],
      ["promissoria_obrigatoria", "true", "sistema", "2026-06-21T00:00:00.000Z"],
      ["baixa_automatica", "false", "sistema", "2026-06-21T00:00:00.000Z"]
    ];
    for (const cfg of configs) {
      await run(
        `INSERT INTO desconto_folha_config (parametro, valor, atualizado_por, updated_at) VALUES (?, ?, ?, ?)`,
        cfg
      );
    }
  }

  // 2. Seed de funcionários — só insere se a tabela estiver vazia
  const funcCount = await get("SELECT COUNT(*) AS total FROM funcionarios");
  if (!funcCount || funcCount.total === 0) {
    const now = new Date().toISOString();
    const funcs = [
      ["Fabi", "", "", "ativo", "", "", null, null, "", "", "Exceção autorizada — início do sistema", now, now],
      ["Milene", "", "", "ativo", "", "", null, null, "", "", "Exceção autorizada — início do sistema", now, now]
    ];
    for (const f of funcs) {
      await run(
        `INSERT INTO funcionarios (nome, documento, data_admissao, status, funcao, loja, user_id, seller_id, telefone, email, observacoes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        f
      );
    }
  }

  // 3. Seed de exceções — só insere se não existir para Fabi ou Milene
  const excecoesCount = await get("SELECT COUNT(*) AS total FROM funcionarios_excecoes");
  if (!excecoesCount || excecoesCount.total === 0) {
    const now = new Date().toISOString();
    const fabi = await get("SELECT id FROM funcionarios WHERE nome = 'Fabi' ORDER BY id ASC LIMIT 1");
    const milene = await get("SELECT id FROM funcionarios WHERE nome = 'Milene' ORDER BY id ASC LIMIT 1");
    if (fabi?.id) {
      await run(
        `INSERT INTO funcionarios_excecoes (funcionario_id, tipo, motivo, autorizado_por, autorizado_em, ativo, created_at)
         VALUES (?, 'carencia_ignorada', 'Exceção autorizada — início do sistema', 'admin', ?, 1, ?)`,
        [fabi.id, now, now]
      );
    }
    if (milene?.id) {
      await run(
        `INSERT INTO funcionarios_excecoes (funcionario_id, tipo, motivo, autorizado_por, autorizado_em, ativo, created_at)
         VALUES (?, 'carencia_ignorada', 'Exceção autorizada — início do sistema', 'admin', ?, 1, ?)`,
        [milene.id, now, now]
      );
    }
  }
}

async function ensureSeedData() {
  const sellerCount = await get("SELECT COUNT(*) AS total FROM sellers");
  if (!sellerCount || sellerCount.total === 0) {
    const sellers = [
      ["Equipe Vila Masc.", "Vila Masc.", "ativo"],
      ["Equipe Vila Fem.", "Vila Fem/Infant.", "ativo"],
      ["Equipe Botânico", "Botânico", "ativo"]
    ];

    for (const seller of sellers) {
      await run(
        `INSERT INTO sellers
        (name, store, status, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        seller
      );
    }
  }

  const contactCount = await get("SELECT COUNT(*) AS total FROM contacts");
  if (!contactCount || contactCount.total === 0) {
    const contacts = [
      ["Marina Costa", "5511999991111", "Feminino", "Vila Fem/Infant.", "vip, cashback", 120, "2026-06-30", "ativo", "Cliente frequente e responde rapido."],
      ["Bruno Lima", "5511988882222", "Masculino", "Vila Masc.", "liquidação, reativacao", 80, "2026-05-20", "inativo", "Sumido há 4 meses."],
      ["Camila Rocha", "5511977773333", "Feminino", "Botânico", "aniversario, vip", 150, "2026-07-15", "ativo", "Prefere atendimento pela manhã."],
      ["Diego Alves", "5511966664444", "Masculino", "Vila Masc.", "novidades", 40, "2026-05-10", "pendente", "Interessado em lancamentos esportivos."]
    ];

    for (const contact of contacts) {
      await run(
        `INSERT INTO contacts
        (name, phone, gender, store, tags, cashback, validity, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        contact
      );
    }
  }

  const campaignCount = await get("SELECT COUNT(*) AS total FROM campaigns");
  if (!campaignCount || campaignCount.total === 0) {
    await run(
      `INSERT INTO campaigns
      (name, seller, store, template, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
      [
        "Cashback Premium",
        "Equipe AEROSTORE",
        "Vila Fem/Infant.",
        "Oi, {{nome}}! Aqui e {{vendedor}} da {{loja}}. Seu cashback de R$ {{cashback}} esta disponivel at? {{validade}}. Posso separar suas novidades favoritas?"
      ]
    );

    await run(
      `INSERT INTO campaigns
      (name, seller, store, template, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
      [
        "Reativacao Elegance",
        "Consultoria AEROSTORE",
        "Vila Masc.",
        "Ol?, {{nome}}! Sentimos sua falta aqui na {{loja}}. Preparei uma condicao especial com cashback de R$ {{cashback}} valido at? {{validade}}. Quer que eu te mostre as pecas novas?"
      ]
    );
  }

  const metricCount = await get("SELECT COUNT(*) AS total FROM metrics");
  if (!metricCount || metricCount.total === 0) {
    const metrics = [
      ["messages_prepared", 0],
      ["sent", 0],
      ["responses", 0],
      ["conversions", 0],
      ["reactivated", 0]
    ];

    for (const [key, value] of metrics) {
      await run("INSERT INTO metrics (key, value) VALUES (?, ?)", [key, value]);
    }
  }

  await ensureCashbackSettingsSeed();

  const userCount = await get("SELECT COUNT(*) AS total FROM users");
  if (!userCount || userCount.total === 0) {
    const firstSeller = await get("SELECT id, store FROM sellers WHERE status = 'ativo' ORDER BY id ASC LIMIT 1");
    await ensureUserAccount({
      email: "admin@aerostore.local",
      password: "123456",
      roleLegacy: "admin",
      roleKey: "admin",
      name: "Admin AEROSTORE",
      username: "admin",
      allowedStores: ["vila", "botanico", "sul"]
    });
    await ensureUserAccount({
      email: "gerente@aerostore.local",
      password: "123456",
      roleLegacy: "gerente",
      roleKey: "manager",
      name: "Gerente AEROSTORE",
      username: "gerente",
      store: "Vila",
      storeId: "vila",
      allowedStores: ["vila"]
    });
    await ensureUserAccount({
      email: "vendedor@aerostore.local",
      password: "123456",
      roleLegacy: "vendedor",
      roleKey: "seller",
      name: "Vendedor AEROSTORE",
      username: "vendedor",
      store: "Vila",
      storeId: "vila",
      allowedStores: ["vila"],
      sellerId: firstSeller?.id || null
    });
  }

  const firstSeller = await get("SELECT id, store FROM sellers WHERE status = 'ativo' ORDER BY id ASC LIMIT 1");
  await ensureUserAccount({
    email: "admin@aerostore.local",
    password: "123456",
    roleLegacy: "admin",
    roleKey: "admin",
    name: "Admin AEROSTORE",
    username: "admin",
    allowedStores: ["vila", "botanico", "sul"]
  });
  await ensureUserAccount({
    email: "gestor.vila@aerostore.local",
    password: "123456",
    roleLegacy: "gerente",
    roleKey: "manager",
    name: "Gestor Vila",
    username: "gestor.vila",
    store: "Vila",
    storeId: "vila",
    allowedStores: ["vila"]
  });
  await ensureUserAccount({
    email: "gestor.botanico@aerostore.local",
    password: "123456",
    roleLegacy: "gerente",
    roleKey: "manager",
    name: "Gestor Botanico",
    username: "gestor.botanico",
    store: "Botanico",
    storeId: "botanico",
    allowedStores: ["botanico"]
  });
  await ensureUserAccount({
    email: "vendedor.vila@aerostore.local",
    password: "123456",
    roleLegacy: "vendedor",
    roleKey: "seller",
    name: "Vendedor Vila",
    username: "vendedor.vila",
    store: "Vila",
    storeId: "vila",
    allowedStores: ["vila"],
    sellerId: firstSeller?.id || null
  });
  await ensureUserAccount({
    email: "caixa@aerostore.local",
    password: "123456",
    roleLegacy: "caixa",
    roleKey: "cashier",
    name: "Caixa AEROSTORE",
    username: "caixa",
    store: "Vila",
    storeId: "vila",
    allowedStores: ["vila"]
  });
  await ensureUserAccount({
    email: "consulta@aerostore.local",
    password: "123456",
    roleLegacy: "consulta",
    roleKey: "consult",
    name: "Consulta AEROSTORE",
    username: "consulta",
    store: "Vila",
    storeId: "vila",
    allowedStores: ["vila"]
  });
}

async function ensureAiCatalogSeed() {
  const seedRows = async (tableName, rows, columns) => {
    const countRow = await get(`SELECT COUNT(*) AS total FROM ${tableName}`);
    if (Number(countRow?.total || 0) > 0) {
      return;
    }
    for (const row of rows) {
      const placeholders = columns.map(() => "?").join(", ");
      await run(
        `INSERT INTO ${tableName} (${columns.join(", ")}, created_at, updated_at) VALUES (${placeholders}, datetime('now'), datetime('now'))`,
        row
      );
    }
  };

  await seedRows(
    "ai_product_categories",
    [
      ["Camiseta", "camiseta", "ativo", 1, 1, 1],
      ["Calça", "calca", "ativo", 2, 0, 1],
      ["Perfume", "perfume", "ativo", 3, 0, 1],
      ["Acessório", "acessorio", "ativo", 4, 0, 0],
      ["Boné", "bone", "ativo", 5, 0, 0]
    ],
    ["name", "slug", "status", "sort_order", "is_default", "use_gender_filter"]
  );

  await seedRows(
    "ai_product_genders",
    [
      ["Masculino", "masculino", "ativo", 1],
      ["Feminino", "feminino", "ativo", 2],
      ["Infantil", "infantil", "ativo", 3],
      ["Unissex", "unissex", "ativo", 4]
    ],
    ["name", "slug", "status", "sort_order"]
  );

  await seedRows(
    "ai_product_colors",
    [
      ["Preto", "preto", "#111111", "ativo", 1],
      ["Branco", "branco", "#F5F5F5", "ativo", 2],
      ["Amarelo", "amarelo", "#F4D03F", "ativo", 3],
      ["Amarelo Canário", "amarelo-canario", "#F1C40F", "ativo", 4],
      ["Azul", "azul", "#1F4E79", "ativo", 5],
      ["Verde", "verde", "#2E8B57", "ativo", 6],
      ["Rosa", "rosa", "#E91E63", "ativo", 7],
      ["Off White", "off-white", "#F1EDE2", "ativo", 8],
      ["Bege", "bege", "#D8C3A5", "ativo", 9]
    ],
    ["name", "slug", "hex_color", "status", "sort_order"]
  );

  await seedRows(
    "ai_product_sizes",
    [
      ["PP", "pp", "roupas", "ativo", 1],
      ["P", "p", "roupas", "ativo", 2],
      ["M", "m", "roupas", "ativo", 3],
      ["G", "g", "roupas", "ativo", 4],
      ["GG", "gg", "roupas", "ativo", 5],
      ["XG", "xg", "roupas", "ativo", 6],
      ["XGG", "xgg", "roupas", "ativo", 7],
      ["36", "36", "calcados", "ativo", 20],
      ["37", "37", "calcados", "ativo", 21],
      ["38", "38", "calcados", "ativo", 22],
      ["39", "39", "calcados", "ativo", 23],
      ["40", "40", "calcados", "ativo", 24],
      ["41", "41", "calcados", "ativo", 25],
      ["42", "42", "calcados", "ativo", 26],
      ["43", "43", "calcados", "ativo", 27],
      ["44", "44", "calcados", "ativo", 28]
    ],
    ["name", "slug", "group_name", "status", "sort_order"]
  );
}

async function migrateLegacyCashbacks() {
  const legacyTable = await get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cashback_records'`
  );
  const currentCount = await get("SELECT COUNT(*) AS total FROM cashbacks");

  if (!legacyTable || currentCount.total > 0) {
    return;
  }

  const legacyRows = await all("SELECT * FROM cashback_records ORDER BY id ASC");
  for (const row of legacyRows) {
    const statusMap = {
      ativo: "disponivel",
      expirado: "vencido",
      usado: "usado",
      cancelado: "cancelado"
    };
    await run(
      `INSERT INTO cashbacks
      (contact_id, customer_name, customer_phone, store, seller_id, seller_name, seller, purchase_value, percentage, generated_value, available_balance, used_value, lost_value, minimum_purchase, status, origin, valid_from, expires_at, created_at, updated_at, used_at, canceled_at, cancel_reason, reactivated_at, anticipated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.contact_id,
        row.name,
        row.phone,
        row.store_origin || "",
        null,
        row.seller || "",
        row.seller || "",
        Number(row.purchase_value || 0),
        Number(row.cashback_percentage || 0),
        Number(row.cashback_generated || 0),
        Number(row.available_balance || 0),
        Number(row.used_balance || 0),
        Number(row.lost_balance || 0),
        Number(row.minimum_purchase || 0),
        statusMap[row.status] || "disponivel",
        "migrado",
        row.created_at ? String(row.created_at).slice(0, 10) : "",
        row.validity || "",
        row.created_at || "datetime('now')",
        row.updated_at || "datetime('now')",
        null,
        null,
        "",
        null,
        null
      ]
    );
  }
}

async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      store TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ativo',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      gender TEXT DEFAULT '',
      store TEXT DEFAULT '',
      seller_id INTEGER,
      seller_name TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      cashback REAL DEFAULT 0,
      validity TEXT DEFAULT '',
      status TEXT DEFAULT 'ativo',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await ensureColumn("contacts", "seller_id", "INTEGER");
  await ensureColumn("contacts", "seller_name", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "document", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "email", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "birth_date", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "zipcode", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "city", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "state", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "neighborhood", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "first_name", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "mobile", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "mobile_normalized", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "phone_fixed", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "address", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "preferred_store", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "source", "TEXT DEFAULT 'manual'");
  await ensureColumn("contacts", "quality_flags", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "top_size", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "bottom_size", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "shoe_size", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "size_profile_json", "TEXT DEFAULT '{}'");
  await ensureColumn("contacts", "size_profile_source", "TEXT DEFAULT 'manual'");
  await ensureColumn("contacts", "size_profile_confidence", "TEXT DEFAULT 'media'");
  await ensureColumn("contacts", "size_profile_updated_at", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "preferences_json", "TEXT DEFAULT '{}'");
  await ensureColumn("contacts", "behavior_signals_json", "TEXT DEFAULT '{}'");
  await ensureColumn("contacts", "favorite_brands_json", "TEXT DEFAULT '[]'");
  await ensureColumn("contacts", "favorite_colors_json", "TEXT DEFAULT '[]'");
  await ensureColumn("contacts", "favorite_categories_json", "TEXT DEFAULT '[]'");
  await ensureColumn("contacts", "average_ticket", "REAL DEFAULT 0");
  await ensureColumn("contacts", "last_purchase_at", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "preferred_seller", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "ai_notes", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "aerointel_last_enriched_at", "TEXT DEFAULT ''");
  await ensureColumn("contacts", "aerointel_confidence_score", "REAL DEFAULT 0");
  await ensureColumn("contacts", "deleted_at", "TEXT DEFAULT ''");
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_first_name ON contacts(first_name)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_mobile_normalized ON contacts(mobile_normalized)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_document ON contacts(document)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_source ON contacts(source)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_deleted_at ON contacts(deleted_at)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_store ON contacts(store)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_preferred_store ON contacts(preferred_store)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contacts_deleted_updated ON contacts(deleted_at, updated_at DESC, id DESC)`);

  await run(`
    CREATE TABLE IF NOT EXISTS crm_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT DEFAULT '',
      external_code TEXT DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      fantasy_name TEXT DEFAULT '',
      document TEXT DEFAULT '',
      person_type TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      mobile TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      number TEXT DEFAULT '',
      complement TEXT DEFAULT '',
      neighborhood TEXT DEFAULT '',
      zipcode TEXT DEFAULT '',
      city TEXT DEFAULT '',
      state TEXT DEFAULT '',
      contact_notes TEXT DEFAULT '',
      status TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      birth_date TEXT DEFAULT '',
      seller_name TEXT DEFAULT '',
      contact_type TEXT DEFAULT '',
      credit_limit REAL DEFAULT 0,
      source_file TEXT DEFAULT '',
      source_row INTEGER DEFAULT 0,
      import_hash TEXT DEFAULT '',
      source_files_json TEXT DEFAULT '[]',
      dedupe_key TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await ensureColumn("crm_contacts", "external_id", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "external_code", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "fantasy_name", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "document", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "person_type", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "phone", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "mobile", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "email", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "address", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "number", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "complement", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "neighborhood", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "zipcode", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "city", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "state", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "contact_notes", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "status", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "gender", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "birth_date", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "seller_name", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "contact_type", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "credit_limit", "REAL DEFAULT 0");
  await ensureColumn("crm_contacts", "source_file", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "source_row", "INTEGER DEFAULT 0");
  await ensureColumn("crm_contacts", "import_hash", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "source_files_json", "TEXT DEFAULT '[]'");
  await ensureColumn("crm_contacts", "dedupe_key", "TEXT DEFAULT ''");
  await ensureColumn("crm_contacts", "created_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("crm_contacts", "updated_at", "TEXT NOT NULL DEFAULT ''");

  await run(`CREATE INDEX IF NOT EXISTS idx_crm_contacts_document ON crm_contacts(document)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_crm_contacts_mobile ON crm_contacts(mobile)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(email)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_crm_contacts_external_code ON crm_contacts(external_code)`);

  await run(`
    CREATE TABLE IF NOT EXISTS crm_contact_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filenames_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'preview',
      total_files INTEGER NOT NULL DEFAULT 0,
      total_rows INTEGER NOT NULL DEFAULT 0,
      valid_contacts INTEGER NOT NULL DEFAULT 0,
      invalid_contacts INTEGER NOT NULL DEFAULT 0,
      duplicates_detected INTEGER NOT NULL DEFAULT 0,
      new_contacts INTEGER NOT NULL DEFAULT 0,
      contacts_to_update INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_duplicates_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS crm_contact_import_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      source_file TEXT DEFAULT '',
      source_row INTEGER DEFAULT 0,
      name TEXT DEFAULT '',
      document TEXT DEFAULT '',
      mobile TEXT DEFAULT '',
      email TEXT DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES crm_contact_import_batches(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      seller TEXT NOT NULL,
      store TEXT NOT NULL,
      template TEXT NOT NULL,
      active INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await ensureColumn("campaigns", "seller_ids_json", "TEXT DEFAULT '[]'");
  await ensureColumn("campaigns", "seller_id", "INTEGER");
  await ensureColumn("campaigns", "seller_name", "TEXT DEFAULT ''");
  await ensureColumn("campaigns", "status", "TEXT DEFAULT 'rascunho'");
  await ensureColumn("campaigns", "filters_json", "TEXT DEFAULT '{}'");

  // Campos para suporte a mídia
  await ensureColumn("campaigns", "send_type", "TEXT DEFAULT 'text'");
  await ensureColumn("campaigns", "media_id", "INTEGER");
  await ensureColumn("campaigns", "caption", "TEXT DEFAULT ''");
  await ensureColumn("campaigns", "has_media", "INTEGER DEFAULT 0");

  await run(`
    CREATE TABLE IF NOT EXISTS campaign_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(campaign_id, contact_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS metrics (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS assistant_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      message_snapshot TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts(id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auto_reply_enabled INTEGER NOT NULL DEFAULT 0,
      reply_cooldown_seconds INTEGER NOT NULL DEFAULT 30,
      updated_at TEXT NOT NULL
    )
  `);

  await ensureColumn("ai_settings", "auto_reply_enabled", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("ai_settings", "reply_cooldown_seconds", "INTEGER NOT NULL DEFAULT 30");
  await ensureColumn("ai_settings", "auto_reply_test_mode", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("ai_settings", "auto_reply_allowed_numbers", "TEXT DEFAULT ''");
  await ensureColumn("ai_settings", "auto_send_product_photo_enabled", "INTEGER NOT NULL DEFAULT 0");

  const aiSettingsCount = await get("SELECT COUNT(*) AS total FROM ai_settings");
  if (!aiSettingsCount || Number(aiSettingsCount.total || 0) === 0) {
    await run(
      `INSERT INTO ai_settings (auto_reply_enabled, reply_cooldown_seconds, auto_reply_test_mode, auto_reply_allowed_numbers, auto_send_product_photo_enabled, updated_at)
      VALUES (0, 30, 0, '', 0, datetime('now'))`
    );
  }

  await run(`
    CREATE TABLE IF NOT EXISTS ai_message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER,
      phone TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'suggested',
      source TEXT NOT NULL DEFAULT 'panel',
      message_text TEXT DEFAULT '',
      intent TEXT DEFAULT 'outro',
      needs_human INTEGER NOT NULL DEFAULT 0,
      auto_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    )
  `);
  await ensureColumn("ai_message_logs", "product_id", "INTEGER");
  await ensureColumn("ai_message_logs", "media_id", "INTEGER");
  await ensureColumn("ai_message_logs", "customer_message", "TEXT DEFAULT ''");
  await ensureColumn("ai_message_logs", "status", "TEXT DEFAULT 'ok'");
  await ensureColumn("ai_message_logs", "error_message", "TEXT DEFAULT ''");
  await ensureColumn("ai_message_logs", "connected_number", "TEXT DEFAULT ''");
  await ensureColumn("ai_message_logs", "whatsapp_message_id", "TEXT DEFAULT ''");
  await ensureColumn("ai_message_logs", "inbound_chat_id", "TEXT DEFAULT ''");
  await ensureColumn("ai_message_logs", "phone_original", "TEXT DEFAULT ''");
  await ensureColumn("ai_message_logs", "sender_user_id", "TEXT DEFAULT ''");
  await ensureColumn("ai_message_logs", "debug_context", "TEXT DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS ai_conversation_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      contact_id INTEGER,
      customer_name TEXT DEFAULT '',
      stage TEXT DEFAULT 'idle',
      last_intent TEXT DEFAULT 'outro',
      desired_product TEXT DEFAULT '',
      desired_category TEXT DEFAULT '',
      desired_color TEXT DEFAULT '',
      desired_size TEXT DEFAULT '',
      desired_gender TEXT DEFAULT '',
      last_question TEXT DEFAULT '',
      suggested_product_id INTEGER,
      waiting_for TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts(id),
      FOREIGN KEY (suggested_product_id) REFERENCES ai_products(id)
    )
  `);
  await ensureColumn("ai_conversation_state", "phone", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "contact_id", "INTEGER");
  await ensureColumn("ai_conversation_state", "customer_name", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "stage", "TEXT DEFAULT 'idle'");
  await ensureColumn("ai_conversation_state", "last_intent", "TEXT DEFAULT 'outro'");
  await ensureColumn("ai_conversation_state", "desired_product", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "desired_category", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "desired_color", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "desired_size", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "desired_gender", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "desired_style", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "last_question", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "suggested_product_id", "INTEGER");
  await ensureColumn("ai_conversation_state", "suggested_product_ids", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "photos_sent_count", "INTEGER DEFAULT 0");
  await ensureColumn("ai_conversation_state", "waiting_for", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "last_customer_message", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "last_ai_response", "TEXT DEFAULT ''");
  await ensureColumn("ai_conversation_state", "created_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("ai_conversation_state", "updated_at", "TEXT NOT NULL DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS ai_product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ativo',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      use_gender_filter INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await ensureColumn("ai_product_categories", "slug", "TEXT DEFAULT ''");
  await ensureColumn("ai_product_categories", "status", "TEXT NOT NULL DEFAULT 'ativo'");
  await ensureColumn("ai_product_categories", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("ai_product_categories", "is_default", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("ai_product_categories", "use_gender_filter", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn("ai_product_categories", "created_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("ai_product_categories", "updated_at", "TEXT NOT NULL DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS ai_product_genders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ativo',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await ensureColumn("ai_product_genders", "slug", "TEXT DEFAULT ''");
  await ensureColumn("ai_product_genders", "status", "TEXT NOT NULL DEFAULT 'ativo'");
  await ensureColumn("ai_product_genders", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("ai_product_genders", "created_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("ai_product_genders", "updated_at", "TEXT NOT NULL DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS ai_product_colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT DEFAULT '',
      hex_color TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ativo',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await ensureColumn("ai_product_colors", "slug", "TEXT DEFAULT ''");
  await ensureColumn("ai_product_colors", "hex_color", "TEXT DEFAULT ''");
  await ensureColumn("ai_product_colors", "status", "TEXT NOT NULL DEFAULT 'ativo'");
  await ensureColumn("ai_product_colors", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("ai_product_colors", "created_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("ai_product_colors", "updated_at", "TEXT NOT NULL DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS ai_product_sizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT DEFAULT '',
      group_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ativo',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await ensureColumn("ai_product_sizes", "slug", "TEXT DEFAULT ''");
  await ensureColumn("ai_product_sizes", "group_name", "TEXT DEFAULT ''");
  await ensureColumn("ai_product_sizes", "status", "TEXT NOT NULL DEFAULT 'ativo'");
  await ensureColumn("ai_product_sizes", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("ai_product_sizes", "created_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("ai_product_sizes", "updated_at", "TEXT NOT NULL DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS ai_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      commercial_name TEXT DEFAULT '',
      category_id INTEGER,
      gender_id INTEGER,
      color_id INTEGER,
      size_ids TEXT DEFAULT '',
      category TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      color TEXT DEFAULT '',
      sizes TEXT DEFAULT '',
      price REAL,
      store TEXT DEFAULT '',
      short_description TEXT DEFAULT '',
      sales_argument TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'media',
      status TEXT NOT NULL DEFAULT 'ativo',
      main_media_id INTEGER,
      ai_title TEXT DEFAULT '',
      ai_short_description TEXT DEFAULT '',
      ai_sales_argument TEXT DEFAULT '',
      deleted_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (main_media_id) REFERENCES campaign_media(id),
      FOREIGN KEY (category_id) REFERENCES ai_product_categories(id),
      FOREIGN KEY (gender_id) REFERENCES ai_product_genders(id),
      FOREIGN KEY (color_id) REFERENCES ai_product_colors(id)
    )
  `);
  await ensureColumn("ai_products", "category_id", "INTEGER");
  await ensureColumn("ai_products", "gender_id", "INTEGER");
  await ensureColumn("ai_products", "color_id", "INTEGER");
  await ensureColumn("ai_products", "size_ids", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "category", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "commercial_name", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "gender", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "color", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "sizes", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "price", "REAL");
  await ensureColumn("ai_products", "store", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "short_description", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "sales_argument", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "tags", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "priority", "TEXT NOT NULL DEFAULT 'media'");
  await ensureColumn("ai_products", "status", "TEXT NOT NULL DEFAULT 'ativo'");
  await ensureColumn("ai_products", "main_media_id", "INTEGER");
  await ensureColumn("ai_products", "ai_title", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "ai_short_description", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "ai_sales_argument", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "deleted_at", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "sku", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "codigo", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "tiny_id", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "codigo_pai", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "marca", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "estoque_total", "REAL DEFAULT 0");
  await ensureColumn("ai_products", "promotional_price", "REAL");
  await ensureColumn("ai_products", "cost_price", "REAL");
  await ensureColumn("ai_products", "stock", "REAL DEFAULT 0");
  await ensureColumn("ai_products", "size_stock_json", "TEXT DEFAULT '[]'");
  await ensureColumn("ai_products", "location", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "gtin_ean", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "ncm", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "use_in_ai", "INTEGER DEFAULT 0");
  await ensureColumn("ai_products", "use_in_pos", "INTEGER DEFAULT 0");
  await ensureColumn("ai_products", "source", "TEXT DEFAULT 'manual'");
  await ensureColumn("ai_products", "notes", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "fotos_extras", "TEXT DEFAULT ''");
  await ensureColumn("ai_products", "created_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("ai_products", "updated_at", "TEXT NOT NULL DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS ai_product_code_sequence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pdv_products_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      legacy_ai_product_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      product_type TEXT NOT NULL DEFAULT 'simple'
        CHECK (product_type IN ('simple', 'variable')),
      status TEXT NOT NULL DEFAULT 'ativo'
        CHECK (status IN ('ativo', 'bloqueado_para_venda', 'inativo')),
      base_sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
      sale_price_cents INTEGER NOT NULL CHECK (sale_price_cents > 0),
      cost_price_cents INTEGER,
      source TEXT NOT NULL DEFAULT 'manual',
      created_by_user_id INTEGER,
      created_by_name TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pdv_product_variants (
      id TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
      barcode TEXT COLLATE NOCASE,
      status TEXT NOT NULL DEFAULT 'ativo'
        CHECK (status IN ('ativo', 'bloqueado_para_venda', 'inativo')),
      attributes_json TEXT NOT NULL DEFAULT '{}',
      attribute_key TEXT NOT NULL DEFAULT 'DEFAULT',
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      sale_price_cents INTEGER,
      cost_price_cents INTEGER,
      operational_inventory_id TEXT NOT NULL DEFAULT '',
      first_sold_at TEXT,
      sku_locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES pdv_products_v2(id)
    )
  `);
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pdv_product_variants_product_attribute
    ON pdv_product_variants(product_id, attribute_key)
  `);
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pdv_product_variants_barcode
    ON pdv_product_variants(barcode COLLATE NOCASE)
    WHERE barcode IS NOT NULL AND TRIM(barcode) <> ''
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pdv_inventory_balances_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id TEXT NOT NULL,
      store_id TEXT NOT NULL COLLATE NOCASE,
      available_qty REAL NOT NULL DEFAULT 0,
      reserved_qty REAL NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE (variant_id, store_id),
      FOREIGN KEY (variant_id) REFERENCES pdv_product_variants(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pdv_inventory_movements_v2 (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity_delta REAL NOT NULL,
      quantity_before REAL NOT NULL,
      quantity_after REAL NOT NULL,
      origin TEXT NOT NULL,
      reference_type TEXT NOT NULL DEFAULT '',
      reference_id TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL UNIQUE,
      actor_user_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (variant_id) REFERENCES pdv_product_variants(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pdv_product_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      variant_id TEXT,
      action_type TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES pdv_products_v2(id),
      FOREIGN KEY (variant_id) REFERENCES pdv_product_variants(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ai_product_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES ai_products(id),
      FOREIGN KEY (media_id) REFERENCES campaign_media(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ai_product_brand_meta (
      product_id INTEGER PRIMARY KEY,
      brand TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (product_id) REFERENCES ai_products(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ai_vitrine_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL DEFAULT '',
      original_filename TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'preview',
      total_rows INTEGER NOT NULL DEFAULT 0,
      valid_rows INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  await ensureColumn("ai_vitrine_imports", "import_type", "TEXT NOT NULL DEFAULT 'tiny'");
  await ensureColumn("ai_vitrine_imports", "selected_count", "INTEGER NOT NULL DEFAULT 0");

  await run(`
    CREATE TABLE IF NOT EXISTS ai_vitrine_import_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      row_number INTEGER NOT NULL DEFAULT 0,
      sku TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (import_id) REFERENCES ai_vitrine_imports(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_sales_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_key TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_document TEXT DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      sku TEXT DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      freight_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      inferred_brand TEXT DEFAULT '',
      inferred_category TEXT DEFAULT '',
      source_file TEXT NOT NULL DEFAULT '',
      source_row INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL,
      import_hash TEXT NOT NULL UNIQUE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_customer_profile (
      customer_key TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_document TEXT DEFAULT '',
      purchase_items_count INTEGER NOT NULL DEFAULT 0,
      purchase_quantity_total REAL NOT NULL DEFAULT 0,
      total_spent REAL NOT NULL DEFAULT 0,
      average_ticket REAL NOT NULL DEFAULT 0,
      max_item_total REAL NOT NULL DEFAULT 0,
      first_seen_at TEXT DEFAULT '',
      last_seen_at TEXT DEFAULT '',
      favorite_products TEXT DEFAULT '[]',
      favorite_skus TEXT DEFAULT '[]',
      favorite_brands_suggested TEXT DEFAULT '[]',
      favorite_categories_suggested TEXT DEFAULT '[]',
      price_profile TEXT DEFAULT '',
      commercial_profile TEXT DEFAULT '[]',
      last_updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_product_profile (
      sku TEXT PRIMARY KEY,
      product_name TEXT NOT NULL DEFAULT '',
      inferred_brand TEXT DEFAULT '',
      inferred_category TEXT DEFAULT '',
      total_quantity_sold REAL NOT NULL DEFAULT 0,
      total_revenue REAL NOT NULL DEFAULT 0,
      customers_count INTEGER NOT NULL DEFAULT 0,
      average_unit_price REAL NOT NULL DEFAULT 0,
      last_updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_product_catalog_link (
      sku TEXT PRIMARY KEY,
      commercial_product_name TEXT NOT NULL DEFAULT '',
      catalog_product_id INTEGER,
      catalog_product_name TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      category TEXT DEFAULT '',
      current_price REAL,
      promotional_price REAL,
      current_stock REAL,
      availability TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size TEXT DEFAULT '',
      image TEXT DEFAULT '',
      status TEXT DEFAULT '',
      allow_sale TEXT DEFAULT '',
      match_status TEXT NOT NULL DEFAULT 'not_found',
      last_synced_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_customer_abc_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_key TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_document TEXT DEFAULT '',
      abc_value REAL NOT NULL DEFAULT 0,
      abc_individual_percent REAL NOT NULL DEFAULT 0,
      abc_accumulated_percent REAL NOT NULL DEFAULT 0,
      abc_class TEXT NOT NULL DEFAULT '',
      source_file TEXT NOT NULL DEFAULT '',
      source_row INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL,
      import_hash TEXT NOT NULL UNIQUE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL DEFAULT '',
      original_filename TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'preview',
      physical_rows INTEGER NOT NULL DEFAULT 0,
      customers_detected INTEGER NOT NULL DEFAULT 0,
      sales_items_detected INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      skipped_duplicates_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      total_revenue REAL NOT NULL DEFAULT 0,
      total_quantity REAL NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_import_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      source_row INTEGER NOT NULL DEFAULT 0,
      customer_key TEXT DEFAULT '',
      sku TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (import_id) REFERENCES commercial_import_batches(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_abc_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL DEFAULT '',
      original_filename TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'preview',
      physical_rows INTEGER NOT NULL DEFAULT 0,
      customers_detected INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      skipped_duplicates_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      total_abc_value REAL NOT NULL DEFAULT 0,
      class_a_count INTEGER NOT NULL DEFAULT 0,
      class_b_count INTEGER NOT NULL DEFAULT 0,
      class_c_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  await ensureColumn("commercial_customer_profile", "abc_class", "TEXT DEFAULT ''");
  await ensureColumn("commercial_customer_profile", "abc_value", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("commercial_customer_profile", "abc_individual_percent", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("commercial_customer_profile", "abc_accumulated_percent", "REAL NOT NULL DEFAULT 0");

  await run(`
    CREATE TABLE IF NOT EXISTS campaign_execution (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      seller_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pendente',
      sent_at TEXT DEFAULT '',
      responded_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(campaign_id, contact_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    )
  `);
  await ensureColumn("campaign_execution", "seller_id", "INTEGER");
  await ensureColumn("campaign_execution", "status", "TEXT NOT NULL DEFAULT 'pendente'");
  await ensureColumn("campaign_execution", "sent_at", "TEXT DEFAULT ''");
  await ensureColumn("campaign_execution", "responded_at", "TEXT DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS cashback_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      percentages_json TEXT,
      default_validity_days INTEGER DEFAULT 30,
      default_minimum_purchase REAL DEFAULT 0,
      reactivation_limit_per_store INTEGER DEFAULT 10,
      reactivated_validity_days INTEGER DEFAULT 1,
      anticipated_validity_days INTEGER DEFAULT 7,
      updated_at TEXT NOT NULL
    )
  `);

  await ensureColumn("cashback_settings", "percentages_json", "TEXT");
  await ensureColumn("cashback_settings", "default_validity_days", "INTEGER DEFAULT 30");
  await ensureColumn("cashback_settings", "default_minimum_purchase", "REAL DEFAULT 0");
  await ensureColumn("cashback_settings", "reactivation_limit_per_store", "INTEGER DEFAULT 10");
  await ensureColumn("cashback_settings", "reactivated_validity_days", "INTEGER DEFAULT 1");
  await ensureColumn("cashback_settings", "anticipated_validity_days", "INTEGER DEFAULT 7");

  await run(`
    CREATE TABLE IF NOT EXISTS customer_cashback_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      contact_id INTEGER,
      source_system TEXT NOT NULL DEFAULT '',
      source_import_id TEXT DEFAULT '',
      source_file TEXT NOT NULL DEFAULT '',
      source_row_number INTEGER NOT NULL DEFAULT 0,
      external_event_id TEXT DEFAULT '',
      external_customer_key TEXT DEFAULT '',
      customer_name_snapshot TEXT DEFAULT '',
      customer_phone_snapshot TEXT DEFAULT '',
      customer_document_snapshot TEXT DEFAULT '',
      customer_email_snapshot TEXT DEFAULT '',
      ledger_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT '',
      store TEXT DEFAULT '',
      seller TEXT DEFAULT '',
      purchase_date TEXT DEFAULT '',
      purchase_amount REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      balance_amount REAL NOT NULL DEFAULT 0,
      used_amount REAL NOT NULL DEFAULT 0,
      valid_from TEXT DEFAULT '',
      valid_until TEXT DEFAULT '',
      used_at TEXT DEFAULT '',
      expired_at TEXT DEFAULT '',
      cancelled_at TEXT DEFAULT '',
      reactivated_at TEXT DEFAULT '',
      match_method TEXT DEFAULT '',
      match_confidence TEXT DEFAULT '',
      import_ready INTEGER NOT NULL DEFAULT 0,
      import_batch_id INTEGER,
      reactivation_potential TEXT DEFAULT '',
      campaign_segment TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT DEFAULT '',
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    )
  `);
  await ensureColumn("customer_cashback_ledger", "customer_id", "INTEGER");
  await ensureColumn("customer_cashback_ledger", "contact_id", "INTEGER");
  await ensureColumn("customer_cashback_ledger", "source_system", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "source_import_id", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "source_file", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "source_row_number", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("customer_cashback_ledger", "external_event_id", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "external_customer_key", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "customer_name_snapshot", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "customer_phone_snapshot", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "customer_document_snapshot", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "customer_email_snapshot", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "ledger_type", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "status", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "origin", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "store", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "seller", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "purchase_date", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "purchase_amount", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("customer_cashback_ledger", "amount", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("customer_cashback_ledger", "balance_amount", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("customer_cashback_ledger", "used_amount", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("customer_cashback_ledger", "valid_from", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "valid_until", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "used_at", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "expired_at", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "cancelled_at", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "reactivated_at", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "match_method", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "match_confidence", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "import_ready", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("customer_cashback_ledger", "import_batch_id", "INTEGER");
  await ensureColumn("customer_cashback_ledger", "reactivation_potential", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "campaign_segment", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "notes", "TEXT DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "raw_json", "TEXT NOT NULL DEFAULT '{}'");
  await ensureColumn("customer_cashback_ledger", "created_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "updated_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("customer_cashback_ledger", "deleted_at", "TEXT DEFAULT ''");
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_cashback_ledger_source_row ON customer_cashback_ledger(source_system, source_file, source_row_number)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_customer_cashback_ledger_customer_id ON customer_cashback_ledger(customer_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_customer_cashback_ledger_contact_id ON customer_cashback_ledger(contact_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_customer_cashback_ledger_status ON customer_cashback_ledger(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_customer_cashback_ledger_origin ON customer_cashback_ledger(origin)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_customer_cashback_ledger_external_event_id ON customer_cashback_ledger(external_event_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_customer_cashback_ledger_segment_lookup ON customer_cashback_ledger(source_system, status, deleted_at, contact_id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS cashback_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_system TEXT NOT NULL DEFAULT '',
      import_type TEXT NOT NULL DEFAULT '',
      source_folder TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      total_rows INTEGER NOT NULL DEFAULT 0,
      import_ready_rows INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      blocked_count INTEGER NOT NULL DEFAULT 0,
      total_amount_imported REAL NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT DEFAULT '',
      created_by TEXT DEFAULT ''
    )
  `);
  await ensureColumn("cashback_import_batches", "source_system", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("cashback_import_batches", "import_type", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("cashback_import_batches", "source_folder", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("cashback_import_batches", "status", "TEXT NOT NULL DEFAULT 'running'");
  await ensureColumn("cashback_import_batches", "total_rows", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("cashback_import_batches", "import_ready_rows", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("cashback_import_batches", "imported_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("cashback_import_batches", "skipped_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("cashback_import_batches", "error_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("cashback_import_batches", "blocked_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("cashback_import_batches", "total_amount_imported", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("cashback_import_batches", "summary_json", "TEXT NOT NULL DEFAULT '{}'");
  await ensureColumn("cashback_import_batches", "started_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("cashback_import_batches", "finished_at", "TEXT DEFAULT ''");
  await ensureColumn("cashback_import_batches", "created_by", "TEXT DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS cashbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      store TEXT DEFAULT '',
      seller_id INTEGER,
      seller_name TEXT DEFAULT '',
      seller TEXT DEFAULT '',
      purchase_value REAL NOT NULL DEFAULT 0,
      percentage REAL NOT NULL DEFAULT 0,
      generated_value REAL NOT NULL DEFAULT 0,
      available_balance REAL NOT NULL DEFAULT 0,
      used_value REAL NOT NULL DEFAULT 0,
      lost_value REAL NOT NULL DEFAULT 0,
      minimum_purchase REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'disponivel',
      origin TEXT DEFAULT 'compra',
      valid_from TEXT DEFAULT '',
      expires_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      used_at TEXT DEFAULT '',
      canceled_at TEXT DEFAULT '',
      cancel_reason TEXT DEFAULT '',
      reactivated_at TEXT DEFAULT '',
      anticipated_at TEXT DEFAULT '',
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    )
  `);

  await ensureColumn("cashbacks", "seller_id", "INTEGER");
  await ensureColumn("cashbacks", "seller_name", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "customer_gender", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "created_by", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "pin_sent_by", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "pin_validated_by", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "pin_code", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "pin_expires_at", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "pin_validated_at", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "sale_id", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "source_type", "TEXT DEFAULT ''");
  await ensureColumn("cashbacks", "source_reference", "TEXT DEFAULT ''");
  await run("CREATE INDEX IF NOT EXISTS idx_cashbacks_sale_id ON cashbacks(sale_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_cashbacks_source_reference ON cashbacks(source_type, source_reference)");
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cashbacks_pdv_sale_once
    ON cashbacks(sale_id, contact_id)
    WHERE sale_id <> ''
      AND contact_id IS NOT NULL
      AND origin = 'pdv_sale'
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS cashback_pin_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER,
      customer_name TEXT DEFAULT '',
      customer_phone TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      customer_gender TEXT DEFAULT '',
      store TEXT DEFAULT '',
      seller_id INTEGER,
      seller_name TEXT DEFAULT '',
      cashback_id INTEGER,
      purchase_value REAL NOT NULL DEFAULT 0,
      percentage REAL NOT NULL DEFAULT 0,
      generated_value REAL NOT NULL DEFAULT 0,
      available_cashback REAL NOT NULL DEFAULT 0,
      cashback_used REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      valid_from TEXT DEFAULT '',
      expires_at TEXT DEFAULT '',
      pin_code TEXT NOT NULL,
      pin_hash TEXT DEFAULT '',
      pin_expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      attempts INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT DEFAULT '',
      cancelled_at TEXT DEFAULT '',
      sent_by_whatsapp INTEGER NOT NULL DEFAULT 0,
      whatsapp_message_id TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      pin_sent_by TEXT DEFAULT '',
      pin_validated_by TEXT DEFAULT '',
      validated_at TEXT DEFAULT '',
      used_at TEXT DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  await ensureColumn("cashback_pin_tokens", "available_cashback", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("cashback_pin_tokens", "cashback_used", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("cashback_pin_tokens", "amount_paid", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("cashback_pin_tokens", "status", "TEXT NOT NULL DEFAULT 'pendente'");
  await ensureColumn("cashback_pin_tokens", "phone", "TEXT DEFAULT ''");
  await ensureColumn("cashback_pin_tokens", "cashback_id", "INTEGER");
  await ensureColumn("cashback_pin_tokens", "pin_hash", "TEXT DEFAULT ''");
  await ensureColumn("cashback_pin_tokens", "attempts", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("cashback_pin_tokens", "sent_at", "TEXT DEFAULT ''");
  await ensureColumn("cashback_pin_tokens", "cancelled_at", "TEXT DEFAULT ''");
  await ensureColumn("cashback_pin_tokens", "sent_by_whatsapp", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("cashback_pin_tokens", "whatsapp_message_id", "TEXT DEFAULT ''");
  await ensureColumn("cashback_pin_tokens", "last_error", "TEXT DEFAULT ''");
  await ensureColumn("cashback_pin_tokens", "created_by", "TEXT DEFAULT ''");
  await ensureColumn("cashback_pin_tokens", "pin_sent_by", "TEXT DEFAULT ''");
  await ensureColumn("cashback_pin_tokens", "pin_validated_by", "TEXT DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'vendedor',
      store TEXT DEFAULT '',
      seller_id INTEGER,
      status TEXT NOT NULL DEFAULT 'ativo',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await ensureColumn("users", "name", "TEXT DEFAULT ''");
  await ensureColumn("users", "username", "TEXT DEFAULT ''");
  await ensureColumn("users", "phone", "TEXT DEFAULT ''");
  await ensureColumn("users", "store_id", "TEXT DEFAULT ''");
  await ensureColumn("users", "allowed_stores_json", "TEXT DEFAULT '[]'");
  await ensureColumn("users", "permissions_json", "TEXT DEFAULT '{}'");
  await ensureColumn("users", "last_access_at", "TEXT DEFAULT ''");
  await ensureColumn("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");

  await run(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await ensureColumn("user_sessions", "active_store_id", "TEXT DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      user_id INTEGER,
      user_name TEXT DEFAULT '',
      user_email TEXT DEFAULT '',
      user_role TEXT DEFAULT '',
      store_id TEXT DEFAULT '',
      store_name TEXT DEFAULT '',
      module TEXT DEFAULT '',
      action TEXT DEFAULT '',
      entity_type TEXT DEFAULT '',
      entity_id TEXT DEFAULT '',
      entity_label TEXT DEFAULT '',
      sale_id TEXT DEFAULT '',
      customer_id TEXT DEFAULT '',
      product_id TEXT DEFAULT '',
      amount REAL,
      previous_amount REAL,
      new_amount REAL,
      before_json TEXT,
      after_json TEXT,
      metadata_json TEXT,
      reason TEXT DEFAULT '',
      authorized_by TEXT DEFAULT '',
      result TEXT DEFAULT '',
      message TEXT DEFAULT '',
      source TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT ''
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_email)");
  await run("CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(module, action)");
  await run("CREATE INDEX IF NOT EXISTS idx_audit_logs_sale ON audit_logs(sale_id)");

  await run(`
    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_register_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT DEFAULT '',
      user_id INTEGER,
      user_email TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_cash_movements_register ON cash_movements(cash_register_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_cash_movements_store ON cash_movements(store_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_cash_movements_type ON cash_movements(type)");
  await run("CREATE INDEX IF NOT EXISTS idx_cash_movements_created_at ON cash_movements(created_at)");

  await run(`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT '',
      template_name TEXT DEFAULT '',
      phone_masked TEXT DEFAULT '',
      phone_hash TEXT DEFAULT '',
      cashback_id TEXT DEFAULT '',
      customer_id TEXT DEFAULT '',
      reminder_type TEXT DEFAULT '',
      event_type TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      meta_message_id TEXT DEFAULT '',
      error_code TEXT DEFAULT '',
      error_message TEXT DEFAULT '',
      dry_run INTEGER NOT NULL DEFAULT 0,
      payload_summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      sent_at TEXT DEFAULT '',
      delivered_at TEXT DEFAULT '',
      read_at TEXT DEFAULT '',
      failed_at TEXT DEFAULT ''
    )
  `);
  await ensureColumn("notification_logs", "event_type", "TEXT DEFAULT ''");
  await run("CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs(status)");
  await run("CREATE INDEX IF NOT EXISTS idx_notification_logs_meta_message ON notification_logs(meta_message_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_notification_logs_cashback ON notification_logs(cashback_id, reminder_type, template_name)");
  await run("CREATE INDEX IF NOT EXISTS idx_notification_logs_event ON notification_logs(cashback_id, customer_id, event_type, template_name)");
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_logs_cashback_once
    ON notification_logs(cashback_id, reminder_type, template_name)
    WHERE dry_run = 0
      AND cashback_id <> ''
      AND reminder_type <> ''
      AND template_name <> ''
      AND status IN ('sent', 'delivered', 'read')
  `);
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_logs_cashback_event_once
    ON notification_logs(cashback_id, customer_id, event_type, template_name)
    WHERE cashback_id <> ''
      AND event_type <> ''
      AND template_name <> ''
      AND status IN ('dry_run', 'sent', 'delivered', 'read')
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS cashback_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashback_id INTEGER,
      contact_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 0,
      store TEXT DEFAULT '',
      seller TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      pin TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      notes TEXT DEFAULT '',
      FOREIGN KEY (cashback_id) REFERENCES cashbacks(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    )
  `);

  await ensureColumn("cashback_events", "event_date", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "campaign", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "status", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "lost_value", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("cashback_events", "expired_at", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "lost_at", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "origin", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "ticket", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "nf", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "reason", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "pin", "TEXT DEFAULT ''");
  await ensureColumn("cashback_events", "notes", "TEXT DEFAULT ''");

  await run(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      source TEXT DEFAULT '',
      imported_by TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      total_rows INTEGER NOT NULL DEFAULT 0,
      ready_rows INTEGER NOT NULL DEFAULT 0,
      ignored_rows INTEGER NOT NULL DEFAULT 0,
      duplicate_rows INTEGER NOT NULL DEFAULT 0,
      contacts_created INTEGER NOT NULL DEFAULT 0,
      contacts_updated INTEGER NOT NULL DEFAULT 0,
      events_created INTEGER NOT NULL DEFAULT 0,
      total_sales_value REAL NOT NULL DEFAULT 0,
      total_cashback_value REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'concluido'
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS import_batch_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      contact_id INTEGER,
      cashback_id INTEGER,
      customer_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      sale_date TEXT DEFAULT '',
      sale_value REAL NOT NULL DEFAULT 0,
      cashback_value REAL NOT NULL DEFAULT 0,
      seller_name TEXT DEFAULT '',
      ticket TEXT DEFAULT '',
      nf TEXT DEFAULT '',
      row_number INTEGER NOT NULL DEFAULT 0,
      action TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'importado',
      error_message TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES import_batches(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id),
      FOREIGN KEY (cashback_id) REFERENCES cashbacks(id)
    )
  `);

  await ensureColumn("import_batch_items", "contact_id", "INTEGER");
  await ensureColumn("import_batch_items", "cashback_id", "INTEGER");

  await run(`
    CREATE TABLE IF NOT EXISTS saved_audiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      definition_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS campaign_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      media_type TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS campaign_message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      contact_id INTEGER,
      phone TEXT DEFAULT '',
      send_type TEXT DEFAULT 'text',
      media_id INTEGER,
      caption_final TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'enviado',
      error_message TEXT DEFAULT '',
      sent_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id),
      FOREIGN KEY (media_id) REFERENCES campaign_media(id)
    )
  `);

  // ─── FASE 1: Novas formas de pagamento ───
  await run(`
    CREATE TABLE IF NOT EXISTS funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      documento TEXT DEFAULT '',
      data_admissao TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ativo',
      funcao TEXT DEFAULT '',
      loja TEXT DEFAULT '',
      user_id INTEGER,
      seller_id INTEGER,
      telefone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      observacoes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_funcionarios_documento ON funcionarios(documento)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_funcionarios_status ON funcionarios(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_funcionarios_user_id ON funcionarios(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_funcionarios_seller_id ON funcionarios(seller_id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS funcionarios_excecoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funcionario_id INTEGER NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'carencia_ignorada',
      motivo TEXT NOT NULL,
      autorizado_por TEXT NOT NULL,
      autorizado_em TEXT NOT NULL,
      expires_at TEXT DEFAULT '',
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_funcionarios_excecoes_func_id ON funcionarios_excecoes(funcionario_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_funcionarios_excecoes_ativo ON funcionarios_excecoes(ativo)`);

  await run(`
    CREATE TABLE IF NOT EXISTS desconto_folha_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parametro TEXT NOT NULL UNIQUE,
      valor TEXT NOT NULL,
      atualizado_por TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS desconto_folha_parcelas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id TEXT NOT NULL,
      funcionario_id INTEGER NOT NULL,
      parcela_n INTEGER NOT NULL,
      valor REAL NOT NULL,
      mes_referencia INTEGER NOT NULL,
      ano INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      email_status TEXT DEFAULT 'nao_enviado',
      email_enviado_em TEXT DEFAULT '',
      email_error TEXT DEFAULT '',
      email_retry_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_df_parcelas_venda ON desconto_folha_parcelas(venda_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_df_parcelas_func ON desconto_folha_parcelas(funcionario_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_df_parcelas_mes ON desconto_folha_parcelas(mes_referencia, ano)`);

  await run(`
    CREATE TABLE IF NOT EXISTS cheque_pagamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id TEXT NOT NULL,
      cliente_id TEXT DEFAULT '',
      banco TEXT NOT NULL,
      numero_cheque TEXT NOT NULL,
      data_cheque TEXT DEFAULT '',
      valor REAL NOT NULL,
      observacao TEXT DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_cheque_pagamentos_venda ON cheque_pagamentos(venda_id)`);

  // ── Campaign Challenges (Corridinhas) ──────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS campaign_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      store_id TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      rule_type TEXT NOT NULL,
      rules_json TEXT DEFAULT '{}',
      target_skus_json TEXT DEFAULT '[]',
      target_categories_json TEXT DEFAULT '[]',
      prize_json TEXT DEFAULT '{}',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_challenge_store ON campaign_challenges(store_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_challenge_status ON campaign_challenges(status)`);

  // ── Campaign Participants ──────────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS campaign_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      seller_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TEXT NOT NULL,
      FOREIGN KEY (challenge_id) REFERENCES campaign_challenges(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_participant_challenge ON campaign_participants(challenge_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_participant_seller ON campaign_participants(seller_id)`);

  // ── Campaign Results ───────────────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS campaign_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      seller_name TEXT NOT NULL,
      current_value REAL DEFAULT 0,
      eligible_sales_count INTEGER DEFAULT 0,
      eligible_items_count INTEGER DEFAULT 0,
      rank_position INTEGER,
      prize_earned REAL DEFAULT 0,
      settled INTEGER DEFAULT 0,
      settled_at TEXT DEFAULT '',
      settled_by INTEGER,
      paid INTEGER DEFAULT 0,
      paid_at TEXT DEFAULT '',
      paid_by INTEGER,
      evidence_json TEXT DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (challenge_id) REFERENCES campaign_challenges(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_result_challenge ON campaign_results(challenge_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_result_seller ON campaign_results(seller_id)`);

  // ── Commercial Goals (Motor de Metas Comerciais) ─────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS commercial_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      store_ids_json TEXT NOT NULL DEFAULT '[]',
      seller_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_commercial_goals_status ON commercial_goals(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_commercial_goals_period ON commercial_goals(period_start, period_end)`);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_goal_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL DEFAULT '',
      metric TEXT NOT NULL,
      target_value REAL NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES commercial_goals(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_commercial_goal_targets_goal ON commercial_goal_targets(goal_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_commercial_goal_targets_metric ON commercial_goal_targets(metric)`);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_goal_progress_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      target_id INTEGER,
      metric TEXT NOT NULL,
      current_value REAL NOT NULL DEFAULT 0,
      target_value REAL NOT NULL DEFAULT 0,
      progress_percent REAL NOT NULL DEFAULT 0,
      projection_value REAL,
      snapshot_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES commercial_goals(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_commercial_goal_snapshot_goal ON commercial_goal_progress_snapshot(goal_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_commercial_goal_snapshot_date ON commercial_goal_progress_snapshot(snapshot_date)`);

  await ensureSeedData();
  await ensureAiCatalogSeed();
  await migrateLegacyCashbacks();
  await repairLegacyStoredTexts();
  await ensureDescontoFolhaSeed();
}

module.exports = {
  db,
  run,
  get,
  all,
  dbPath,
  normalizeTags,
  initializeDatabase
};
