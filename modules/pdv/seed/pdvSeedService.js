"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const seedRootDir = path.join(process.cwd(), "data", "pdv", "seed");
const seedCouponsDir = path.join(seedRootDir, "coupon-docs");
const seedMetaPath = path.join(seedRootDir, "seed-meta.json");

const targetFiles = {
  productsDataset: path.join(process.cwd(), "data", "imports", "pdv", "datasets", "produtos.json"),
  masterCustomers: path.join(process.cwd(), "data", "imports", "pdv", "consolidation", "master-customers.json"),
  cashRegisters: path.join(process.cwd(), "data", "pdv", "control", "cash-registers.json"),
  authorizations: path.join(process.cwd(), "data", "pdv", "control", "authorization-pins.json"),
  auditLogs: path.join(process.cwd(), "data", "pdv", "control", "audit-logs.json"),
  inventory: path.join(process.cwd(), "data", "pdv", "inventory", "inventory.json"),
  inventoryMovements: path.join(process.cwd(), "data", "pdv", "inventory", "movements.json"),
  transfers: path.join(process.cwd(), "data", "pdv", "inventory", "transfers.json"),
  sessions: path.join(process.cwd(), "data", "pdv", "operational", "sessions.json"),
  drafts: path.join(process.cwd(), "data", "pdv", "operational", "drafts.json"),
  quotes: path.join(process.cwd(), "data", "pdv", "operational", "quotes.json"),
  reservations: path.join(process.cwd(), "data", "pdv", "operational", "reservations.json"),
  internalConsumption: path.join(process.cwd(), "data", "pdv", "operational", "internal-consumption.json"),
  operationalEvents: path.join(process.cwd(), "data", "pdv", "operational", "events.json"),
  sales: path.join(process.cwd(), "data", "pdv", "sales", "sales.json"),
  cashbackLedger: path.join(process.cwd(), "data", "pdv", "sales", "cashback-ledger.json"),
  giftCards: path.join(process.cwd(), "data", "pdv", "sales", "gift-cards.json"),
  commissions: path.join(process.cwd(), "data", "pdv", "sales", "commissions.json"),
  exchanges: path.join(process.cwd(), "data", "pdv", "sales", "exchanges.json"),
  salesCoupons: path.join(process.cwd(), "data", "pdv", "sales", "coupons.json"),
  salesLogs: path.join(process.cwd(), "data", "pdv", "sales", "logs.json"),
  experienceCoupons: path.join(process.cwd(), "data", "pdv", "experience", "coupons.json"),
  messageQueue: path.join(process.cwd(), "data", "pdv", "experience", "message-queue.json"),
  welcomeBonuses: path.join(process.cwd(), "data", "pdv", "experience", "welcome-bonuses.json")
};

const STORES = ["Vila", "Botanico", "Bonfim", "Camboriu"];
const SELLERS = [
  { name: "Milene", role: "VENDEDOR" },
  { name: "Fabiana", role: "GERENTE" },
  { name: "Andre", role: "VENDEDOR" },
  { name: "Kauan", role: "ADMIN" }
];

const FIRST_NAMES = ["Ana", "Beatriz", "Carla", "Daniela", "Eduarda", "Fernanda", "Gabriela", "Helena", "Isabela", "Juliana", "Karen", "Larissa", "Mariana", "Natalia", "Olivia", "Patricia", "Renata", "Sabrina", "Tatiane", "Viviane", "Joao", "Pedro", "Rafael", "Bruno", "Caio", "Filipe", "Gustavo", "Igor", "Leandro", "Murilo"];
const LAST_NAMES = ["Almeida", "Barbosa", "Cardoso", "Dias", "Esteves", "Ferreira", "Goncalves", "Henrique", "Ibrahim", "Jardim", "Klein", "Lopes", "Mendes", "Nogueira", "Oliveira", "Pereira", "Queiroz", "Ramos", "Silva", "Teixeira", "Urbano", "Vieira"];
const CITIES = ["Ribeirao Preto", "Curitiba", "Florianopolis", "Balneario Camboriu", "Sao Paulo", "Belo Horizonte"];
const CATEGORIES = ["Camisetas", "Polos", "Bermudas", "Calcas", "Vestidos", "Perfumes", "Acessorios", "Calcados"];
const BRANDS = ["AEROSTORE", "Osklen", "Reserva", "Colcci", "Farm", "Santa Costa", "Calvin Klein", "Lacoste"];
const COLORS = ["Preto", "Branco", "Azul", "Verde", "Off White", "Rosa", "Caqui", "Jeans"];
const SIZES = ["PP", "P", "M", "G", "GG", "36", "38", "40", "42"];
const PAYMENT_COMBOS = [
  [{ method: "pix", amountRatio: 1 }],
  [{ method: "dinheiro", amountRatio: 1 }],
  [{ method: "credito", amountRatio: 1, installments: 3 }],
  [{ method: "credito", amountRatio: 1, installments: 6 }],
  [{ method: "credito", amountRatio: 0.65, installments: 3 }, { method: "cashback", amountRatio: 0.35 }],
  [{ method: "pix", amountRatio: 0.6 }, { method: "cashback", amountRatio: 0.4 }],
  [{ method: "vale_presente", amountRatio: 0.5 }, { method: "pix", amountRatio: 0.5 }],
  [{ method: "dinheiro", amountRatio: 0.45 }, { method: "credito", amountRatio: 0.55, installments: 1 }],
  [{ method: "permuta", amountRatio: 0.4 }, { method: "pix", amountRatio: 0.6 }],
  [{ method: "link_pagamento", amountRatio: 0.75 }, { method: "cashback", amountRatio: 0.25 }],
  [{ method: "debito", amountRatio: 1 }],
  [{ method: "credito_troca", amountRatio: 0.3 }, { method: "pix", amountRatio: 0.7 }]
];
const INTERNAL_CONSUMPTION_DESTINATIONS = ["uso pessoal", "presente", "marketing", "influenciador", "ensaio", "uniforme"];
const INTERNAL_CONSUMPTION_OWNERS = ["Noah", "Stela", "Milene", "Fabiana", "Andre", "Kauan"];
const DISCOUNT_REASONS = ["QUEIMA", "CLIENTE_VIP", "PECA_PARADA", "DEFEITO", "NEGOCIACAO", "ACAO_GERENTE", "OUTRO"];

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function ensureSeedDirs() {
  fs.mkdirSync(seedRootDir, { recursive: true });
  fs.mkdirSync(seedCouponsDir, { recursive: true });
  Object.values(targetFiles).forEach(ensureDir);
}

function readJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function loadSeedMeta() {
  ensureSeedDirs();
  return readJson(seedMetaPath, {
    active_batch_id: "",
    generated_at: "",
    counts: {},
    coupon_files: []
  });
}

function saveSeedMeta(meta) {
  writeJson(seedMetaPath, meta);
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  const parsed = new Date(date);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString();
}

function buildId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value = "") {
  let digits = normalizeDigits(value);
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits;
}

function roundMoney(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(list) {
  return list[randomInt(0, list.length - 1)];
}

function maybe(probability = 0.5) {
  return Math.random() < probability;
}

function createCustomerName(index) {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${index % 3 === 0 ? pick(LAST_NAMES) : ""}`.replace(/\s+/g, " ").trim();
}

function createPhone(index) {
  return `1699${String(1000000 + index).slice(-7)}`;
}

function createProductName(category, brand, color) {
  const baseByCategory = {
    Camisetas: ["Camiseta Basic", "Camiseta Slim", "T-Shirt Premium", "T-Shirt Oversized"],
    Polos: ["Polo Piquet", "Polo Stone", "Polo Premium"],
    Bermudas: ["Bermuda Sarja", "Bermuda Moletom", "Bermuda Resort"],
    Calcas: ["Calca Jeans", "Calca Slim", "Calca Alfaiataria"],
    Vestidos: ["Vestido Midi", "Vestido Curto", "Vestido Premium"],
    Perfumes: ["Perfume Signature", "Perfume Noir", "Perfume Fresh"],
    Acessorios: ["Cinto Couro", "Bone Premium", "Carteira"],
    Calcados: ["Tenis Casual", "Tenis Knit", "Mocassim"]
  };
  return `${pick(baseByCategory[category] || ["Produto"])} ${brand} ${color}`.trim();
}

function buildCouponPdfBuffer(lines = []) {
  const content = [
    "BT",
    "/F1 10 Tf",
    "48 800 Td",
    ...lines.slice(0, 38).flatMap((line, index) => (index === 0 ? [`(${String(line).replace(/[()\\]/g, "\\$&")}) Tj`] : ["0 -16 Td", `(${String(line).replace(/[()\\]/g, "\\$&")}) Tj`])),
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Page /Parent 4 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Catalog /Pages 4 0 R >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function mergeSeedRows(filePath, rows) {
  const existing = readJson(filePath, []);
  const preserved = Array.isArray(existing) ? existing.filter((item) => !item?.is_seed_data) : [];
  writeJson(filePath, preserved.concat(rows));
}

function removeSeedRows(filePath) {
  const existing = readJson(filePath, []);
  if (!Array.isArray(existing)) {
    return 0;
  }
  const filtered = existing.filter((item) => !item?.is_seed_data);
  const removed = existing.length - filtered.length;
  writeJson(filePath, filtered);
  return removed;
}

function clearSeedData() {
  ensureSeedDirs();
  const meta = loadSeedMeta();
  const removed = {};
  Object.entries(targetFiles).forEach(([key, filePath]) => {
    removed[key] = removeSeedRows(filePath);
  });
  (meta.coupon_files || []).forEach((filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      // keep cleanup best-effort
    }
  });
  saveSeedMeta({
    active_batch_id: "",
    generated_at: "",
    counts: {},
    coupon_files: []
  });
  return {
    removed,
    cleared: true
  };
}

function generateCustomers(batchId) {
  const rows = [];
  for (let index = 0; index < 50; index += 1) {
    const name = createCustomerName(index + 1);
    const phone = createPhone(index + 1);
    const totalComprado = roundMoney(randomInt(280, 9200));
    const quantidadeCompras = randomInt(1, 12);
    const ultimaCompra = addDays(nowIso(), -randomInt(0, 120));
    const classe = index < 10 ? "A" : index < 28 ? "B" : "C";
    rows.push({
      master_customer_id: buildId("MST"),
      name,
      phone,
      cidade: pick(CITIES),
      abc_class: classe,
      total_comprado: totalComprado,
      ticket_medio: roundMoney(totalComprado / quantidadeCompras),
      quantidade_compras: quantidadeCompras,
      ultima_compra: ultimaCompra,
      dias_desde_ultima_compra: randomInt(0, 120),
      recorrencia_media: roundMoney(randomInt(18, 80)),
      saldo_cashback: roundMoney(randomInt(0, 450)),
      cashback_pendente: roundMoney(randomInt(0, 180)),
      vendedor_favorito: pick(SELLERS).name,
      loja_favorita: pick(STORES),
      categories_favoritas: [pick(CATEGORIES), pick(CATEGORIES)],
      marcas_favoritas: [pick(BRANDS), pick(BRANDS)],
      is_seed_data: true,
      batch_id: batchId,
      created_at: nowIso()
    });
  }
  return rows;
}

function generateProducts(batchId) {
  const products = [];
  for (let index = 0; index < 80; index += 1) {
    const category = CATEGORIES[index % CATEGORIES.length];
    const brand = BRANDS[index % BRANDS.length];
    const color = COLORS[index % COLORS.length];
    const size = SIZES[index % SIZES.length];
    const sku = category === "Perfumes" && index % 7 === 0 ? "" : `SKU${String(10000 + index)}`;
    const categoryValue = index === 6 ? "" : category;
    const price = roundMoney(randomInt(89, 790));
    products.push({
      product_id: buildId("PRD"),
      codigo: `COD${String(1000 + index)}`,
      sku,
      nome: createProductName(category, brand, color),
      descricao: `${category} ${brand} ${color} ${size}`,
      marca: brand,
      categoria: categoryValue,
      tipo: category,
      cor: color,
      tamanho: size,
      preco_venda: price,
      preco_custo: roundMoney(price * (0.42 + (index % 4) * 0.08)),
      estoque: randomInt(0, 14),
      status: "ACTIVE",
      cashback_blocked_for_redemption: category === "Perfumes",
      is_seed_data: true,
      batch_id: batchId,
      created_at: nowIso()
    });
  }
  return products;
}

function generateInventory(products, batchId) {
  const inventory = [];
  const movements = [];
  const transfers = [];
  const now = nowIso();

  products.forEach((product, productIndex) => {
    STORES.forEach((store, storeIndex) => {
      let available = randomInt(0, 12);
      const reserved = productIndex % 17 === storeIndex ? 2 : 0;
      const unavailable = productIndex % 29 === storeIndex ? 1 : 0;
      if (productIndex === 1 && storeIndex === 0) available = -1;
      if (productIndex === 2 && storeIndex === 1) available = 1;
      if (productIndex === 3 && storeIndex === 2) available = 0;

      inventory.push({
        inventory_id: buildId("INV"),
        product_id: product.product_id,
        sku: product.sku,
        codigo: product.codigo,
        nome: product.nome,
        marca: product.marca,
        categoria: product.categoria,
        tipo: product.tipo,
        cor: product.cor,
        tamanho: product.tamanho,
        store_id: store,
        available_qty: available,
        reserved_qty: reserved,
        unavailable_qty: unavailable,
        exchange_qty: 0,
        consumption_qty: 0,
        last_movement_at: addDays(now, -randomInt(0, 75)),
        status: available < 0 ? "NEGATIVE" : available === 0 ? "OUT" : available === 1 ? "LAST" : "ACTIVE",
        is_seed_data: true,
        batch_id: batchId
      });

      movements.push({
        movement_id: buildId("MOV"),
        type: "IMPORT_INITIAL",
        product_id: product.product_id,
        sku: product.sku,
        codigo: product.codigo,
        nome: product.nome,
        store_id: store,
        quantity: Math.max(0, available + reserved + unavailable),
        direction: "IN",
        reference_type: "SEED",
        reference_id: batchId,
        reason: "Carga operacional de homologacao do PDV.",
        created_by: "codex_seed",
        created_at: addDays(now, -60 + randomInt(0, 8)),
        notes: "Saldo inicial de teste",
        before_qty: 0,
        after_qty: available,
        before_snapshot: null,
        after_snapshot: { available_qty: available, reserved_qty: reserved, unavailable_qty: unavailable },
        is_seed_data: true,
        batch_id: batchId
      });
    });
  });

  for (let index = 0; index < 8; index += 1) {
    const product = products[index];
    transfers.push({
      transfer_id: buildId("TRF"),
      source_store: STORES[index % STORES.length],
      destination_store: STORES[(index + 1) % STORES.length],
      product_id: product.product_id,
      sku: product.sku,
      codigo: product.codigo,
      nome: product.nome,
      quantity: randomInt(1, 3),
      notes: "Transferencia simulada para homologacao",
      status: pick(["PENDING", "SENT", "RECEIVED", "CANCELLED"]),
      created_at: addDays(now, -randomInt(1, 40)),
      created_by: "codex_seed",
      is_seed_data: true,
      batch_id: batchId
    });
  }

  return { inventory, movements, transfers };
}

function buildSalePayments(totalFinal, modeIndex, allowCashback, allowPermuta, allowGiftCard, allowExchangeCredit) {
  const combo = PAYMENT_COMBOS[modeIndex % PAYMENT_COMBOS.length];
  const methods = [];
  combo.forEach((part) => {
    if ((part.method === "cashback" && !allowCashback) || (part.method === "permuta" && !allowPermuta) || (part.method === "vale_presente" && !allowGiftCard) || (part.method === "credito_troca" && !allowExchangeCredit)) {
      return;
    }
    methods.push({
      method: part.method,
      amount: roundMoney(totalFinal * part.amountRatio),
      installments: part.installments || 1,
      brand: part.method === "credito" ? pick(["Visa", "Master", "Elo"]) : "",
      nsu: part.method === "credito" || part.method === "debito" ? String(randomInt(100000, 999999)) : ""
    });
  });
  if (!methods.length) {
    methods.push({ method: "pix", amount: totalFinal, installments: 1, brand: "", nsu: "" });
  }
  const currentTotal = roundMoney(methods.reduce((sum, item) => sum + item.amount, 0));
  const difference = roundMoney(totalFinal - currentTotal);
  if (difference !== 0) {
    methods[methods.length - 1].amount = roundMoney(methods[methods.length - 1].amount + difference);
  }
  return methods;
}

function generateSales(products, customers, batchId) {
  const sales = [];
  const cashbackLedger = [];
  const commissions = [];
  const salesCoupons = [];
  const salesLogs = [];
  const experienceCoupons = [];
  const messageQueue = [];
  const welcomeBonuses = [];
  const couponFiles = [];
  const now = nowIso();

  for (let index = 0; index < 120; index += 1) {
    const customer = customers[index % customers.length];
    const store = STORES[index % STORES.length];
    const seller = SELLERS[index % SELLERS.length];
    const saleId = buildId("SAL");
    const itemCount = randomInt(1, 4);
    const cartItems = [];

    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      const product = products[(index * 3 + itemIndex) % products.length];
      const quantity = randomInt(1, 2);
      cartItems.push({
        item_id: buildId("ITM"),
        product_id: product.product_id,
        codigo: product.codigo,
        sku: product.sku,
        nome: product.nome,
        marca: product.marca,
        categoria: product.categoria,
        tipo: product.tipo,
        cor: product.cor,
        tamanho: product.tamanho,
        quantidade: quantity,
        preco_referencia: product.preco_venda,
        observacao: itemIndex === 0 && maybe(0.18) ? "Separar peca da vitrine." : ""
      });
    }

    const subtotal = roundMoney(cartItems.reduce((sum, item) => sum + (item.quantidade * item.preco_referencia), 0));
    const extraDiscount = index % 9 === 0 ? roundMoney(subtotal * 0.16) : index % 4 === 0 ? roundMoney(subtotal * 0.06) : 0;
    const isGiftSale = index % 10 === 0;
    const isCancelled = index % 18 === 0;
    const isPermuta = index % 13 === 0;
    const isExchangeMode = index % 17 === 0;
    const allowGiftCard = index % 8 === 0;
    const allowExchangeCredit = index % 14 === 0;
    const allowCashback = !cartItems.some((item) => normalizeText(item.categoria).toLowerCase().includes("perfume")) && !isPermuta;
    const rawCashbackUse = allowCashback && index % 5 === 0 ? roundMoney(Math.min(120, subtotal * 0.2)) : 0;
    const rawGiftUse = allowGiftCard ? roundMoney(Math.min(180, subtotal * 0.35)) : 0;
    const rawExchangeUse = allowExchangeCredit ? roundMoney(Math.min(90, subtotal * 0.18)) : 0;
    const rawPermuta = isPermuta ? roundMoney(Math.min(160, subtotal * 0.25)) : 0;
    const totalFinal = roundMoney(Math.max(0, subtotal - extraDiscount - rawCashbackUse - rawGiftUse - rawExchangeUse - rawPermuta));
    const paymentMethods = buildSalePayments(totalFinal, index, rawCashbackUse > 0, rawPermuta > 0, rawGiftUse > 0, rawExchangeUse > 0);

    if (rawCashbackUse > 0) paymentMethods.push({ method: "cashback", amount: rawCashbackUse, installments: 1, brand: "", nsu: "" });
    if (rawGiftUse > 0) paymentMethods.push({ method: "vale_presente", amount: rawGiftUse, installments: 1, brand: "", nsu: "" });
    if (rawExchangeUse > 0) paymentMethods.push({ method: "credito_troca", amount: rawExchangeUse, installments: 1, brand: "", nsu: "" });
    if (rawPermuta > 0) paymentMethods.push({ method: "permuta", amount: rawPermuta, installments: 1, brand: "", nsu: "" });

    const incrementalBase = roundMoney(Math.max(0, subtotal - extraDiscount - rawCashbackUse - rawGiftUse - rawExchangeUse - rawPermuta));
    const generatedCashback = !isPermuta ? roundMoney(incrementalBase * 0.12) : 0;
    const createdAt = addDays(now, -randomInt(0, 60));
    const giftSale = {
      enabled: isGiftSale,
      gifted_to: isGiftSale ? createCustomerName(index + 300) : "",
      gifted_phone: isGiftSale ? createPhone(index + 300) : "",
      message: isGiftSale ? "Com carinho, um presente escolhido na AEROSTORE." : "",
      send_mode: isGiftSale && index % 2 === 0 ? "scheduled" : "manual",
      send_status: isGiftSale ? (index % 3 === 0 ? "scheduled" : "pending") : "pending",
      scheduled_for: isGiftSale && index % 2 === 0 ? addDays(createdAt, 1) : ""
    };

    const sale = {
      sale_id: saleId,
      session_id: buildId("SES"),
      status: isCancelled ? "CANCELLED" : isExchangeMode ? "EXCHANGE" : "COMPLETED",
      customer: {
        name: customer.name,
        phone: customer.phone,
        document: "",
        classe_abc: customer.abc_class
      },
      vendedor: seller.name,
      seller: seller.name,
      loja: store,
      items: cartItems,
      cart_items: cartItems,
      subtotal,
      desconto_extra: extraDiscount,
      extra_discount: extraDiscount,
      cashback_usado: rawCashbackUse,
      cashback_used: rawCashbackUse,
      vale_presente_usado: rawGiftUse,
      gift_card_used: rawGiftUse,
      credito_troca_usado: rawExchangeUse,
      exchange_credit_used: rawExchangeUse,
      permuta_usada: rawPermuta,
      permuta_amount: rawPermuta,
      total_final: totalFinal,
      paid_amount: totalFinal,
      pagamentos: paymentMethods,
      payment_methods: paymentMethods,
      observacoes: index % 11 === 0 ? "Cliente pediu atendimento consultivo." : "",
      data_hora: createdAt,
      created_at: createdAt,
      gift_sale: giftSale,
      coupon: {
        mode: isGiftSale ? "present" : "normal",
        whatsapp_ready: true,
        qr_ready: true
      },
      created_by: seller.name,
      cashback_generated: generatedCashback > 0 ? {
        cashback_id: buildId("CBK"),
        amount: generatedCashback,
        status: pick(["PENDING", "AVAILABLE", "USED", "EXPIRED", "CANCELLED"]),
        available_at: addDays(createdAt, 1),
        expires_at: addDays(createdAt, 30)
      } : null,
      gift_card_usage: rawGiftUse > 0 ? { gift_card_code: `GFT${String(1000 + index)}`, amount: rawGiftUse } : null,
      blocked_cashback_redemption: cartItems.some((item) => normalizeText(item.categoria).toLowerCase() === "perfumes"),
      exchange_origin_sale_id: isExchangeMode && index > 2 ? `SEED_ORIGIN_${index}` : "",
      exchange_mode: isExchangeMode,
      cash_register_id: `SEED_REGISTER_${store}`,
      cash_register_store: store,
      control_validation: {
        discount_limit: 10,
        discount_percent: subtotal > 0 ? roundMoney((extraDiscount / subtotal) * 100) : 0
      },
      restored_cashback: isCancelled && rawCashbackUse > 0 ? [{ cashback_id: buildId("CBK"), amount: rawCashbackUse }] : [],
      restored_gift_card: isCancelled && rawGiftUse > 0 ? { code: `GFT${String(1000 + index)}`, amount: rawGiftUse } : null,
      inventory_movements: [],
      inventory_return_movements: isCancelled ? [buildId("MOV")] : [],
      is_seed_data: true,
      batch_id: batchId
    };

    sales.push(sale);

    commissions.push({
      commission_id: buildId("COM"),
      sale_id: saleId,
      seller: seller.name,
      vendedor: seller.name,
      gross_sale_value: subtotal,
      valor_venda: subtotal,
      discount_extra: extraDiscount,
      cashback_used: rawCashbackUse,
      commission_calculated: roundMoney(subtotal * 0.05),
      created_at: createdAt,
      is_seed_data: true,
      batch_id: batchId
    });

    salesLogs.push({
      log_id: buildId("LOG"),
      sale_id: saleId,
      action: sale.status === "CANCELLED" ? "SALE_CANCELLED" : "SALE_COMPLETED",
      created_at: createdAt,
      created_by: seller.name,
      before: null,
      after: sale,
      is_seed_data: true,
      batch_id: batchId
    });

    if (sale.cashback_generated) {
      const ledgerStatus = sale.cashback_generated.status;
      cashbackLedger.push({
        cashback_id: sale.cashback_generated.cashback_id,
        sale_id: saleId,
        customer_phone: customer.phone,
        customer_name: customer.name,
        source: "PDV_AEROSTORE",
        origin: "SALE",
        status: ledgerStatus,
        amount: generatedCashback,
        remaining_amount: ledgerStatus === "USED" || ledgerStatus === "CANCELLED" ? 0 : generatedCashback,
        used_amount: ledgerStatus === "USED" ? generatedCashback : 0,
        available_at: sale.cashback_generated.available_at,
        expires_at: sale.cashback_generated.expires_at,
        created_at: createdAt,
        created_by: seller.name,
        notes: "Cashback de homologacao operacional.",
        is_seed_data: true,
        batch_id: batchId
      });
    }

    salesCoupons.push({
      coupon_id: buildId("CPN"),
      sale_id: saleId,
      mode: sale.coupon.mode,
      document_url: `/api/pdv/experience/coupon/${saleId}/document?format=html&mode=${sale.coupon.mode}`,
      pdf_url: `/api/pdv/experience/coupon/${saleId}/document?format=pdf&mode=${sale.coupon.mode}`,
      created_at: createdAt,
      is_seed_data: true,
      batch_id: batchId
    });

    const htmlPath = path.join(seedCouponsDir, `${saleId}-${sale.coupon.mode}.html`);
    const pdfPath = path.join(seedCouponsDir, `${saleId}-${sale.coupon.mode}.pdf`);
    const qrText = `PDV-AEROSTORE:${saleId}`;
    const html = `<!doctype html><html><body><h1>AEROSTORE</h1><p>Venda ${saleId}</p><p>QR: ${qrText}</p><p>${sale.coupon.mode === "present" ? "Cupom presente" : "Cupom normal"}</p></body></html>`;
    fs.writeFileSync(htmlPath, html, "utf8");
    fs.writeFileSync(pdfPath, buildCouponPdfBuffer(["AEROSTORE", `Venda ${saleId}`, `Modo ${sale.coupon.mode}`, `QR ${qrText}`]));
    couponFiles.push(htmlPath, pdfPath);

    experienceCoupons.push({
      coupon_id: buildId("XCP"),
      sale_id: saleId,
      mode: sale.coupon.mode,
      qr_value: qrText,
      html_path: htmlPath,
      pdf_path: pdfPath,
      document_url: `/api/pdv/experience/coupon/${saleId}/document?format=html&mode=${sale.coupon.mode}`,
      pdf_url: `/api/pdv/experience/coupon/${saleId}/document?format=pdf&mode=${sale.coupon.mode}`,
      created_at: createdAt,
      reprints: maybe(0.18) ? [{
        reprinted_at: addDays(createdAt, 2),
        reprinted_by: seller.name,
        reason: "Cliente solicitou nova via."
      }] : [],
      is_seed_data: true,
      batch_id: batchId
    });

    if (isGiftSale) {
      welcomeBonuses.push({
        welcome_bonus_id: buildId("WB"),
        origin_sale_id: saleId,
        source_customer_name: customer.name,
        source_customer_phone: customer.phone,
        recipient_name: giftSale.gifted_to,
        recipient_phone: giftSale.gifted_phone,
        gifted_to: giftSale.gifted_to,
        gifted_phone: giftSale.gifted_phone,
        status: pick(["PENDING", "SCHEDULED", "SENT", "CANCELLED"]),
        created_at: createdAt,
        created_by: seller.name,
        notes: "Bonus boas-vindas de homologacao.",
        is_seed_data: true,
        batch_id: batchId
      });
    }
  }

  for (let index = 0; index < 14; index += 1) {
    const sale = sales[index];
    const template = pick(["SALE_COMPLETED", "CASHBACK_GRANTED", "GIFT_SALE", "GIFT_SENT", "RETURN_CAMPAIGN", "BIRTHDAY", "RESERVATION_CREATED", "QUOTE_CREATED"]);
    const status = pick(["PENDING", "SCHEDULED", "SENT", "FAILED", "CANCELLED"]);
    messageQueue.push({
      message_id: buildId("MSG"),
      type: "MANUAL",
      customer_name: sale.customer.name,
      phone: sale.customer.phone,
      template,
      status,
      scheduled_for: status === "SCHEDULED" ? addDays(sale.created_at, 1) : "",
      payload: {
        loja: sale.loja,
        sale_id: sale.sale_id
      },
      created_at: sale.created_at,
      sent_at: status === "SENT" ? addDays(sale.created_at, 1) : "",
      created_by: sale.vendedor,
      sale_id: sale.sale_id,
      text: `Mensagem ${template} de homologacao para ${sale.customer.name}.`,
      updated_at: status !== "PENDING" ? addDays(sale.created_at, 1) : "",
      updated_by: status !== "PENDING" ? sale.vendedor : "",
      is_seed_data: true,
      batch_id: batchId
    });
  }

  return {
    sales,
    cashbackLedger,
    commissions,
    salesCoupons,
    salesLogs,
    experienceCoupons,
    messageQueue,
    welcomeBonuses,
    couponFiles
  };
}

function generateGiftCards(batchId, customers) {
  const rows = [];
  for (let index = 0; index < 14; index += 1) {
    const customer = customers[index % customers.length];
    const originalAmount = roundMoney(randomInt(120, 800));
    const usedAmount = index % 4 === 0 ? roundMoney(originalAmount * 0.5) : index % 5 === 0 ? originalAmount : 0;
    const remaining = roundMoney(Math.max(0, originalAmount - usedAmount));
    rows.push({
      gift_card_id: buildId("GFT"),
      code: `GFT${String(5000 + index)}`,
      buyer_name: customer.name,
      buyer_phone: customer.phone,
      recipient_name: maybe(0.6) ? createCustomerName(index + 90) : "",
      recipient_phone: maybe(0.4) ? createPhone(index + 90) : "",
      original_amount: originalAmount,
      amount: originalAmount,
      used_amount: usedAmount,
      remaining_amount: remaining,
      status: remaining === 0 ? "USED" : index % 6 === 0 ? "EXPIRED" : "ACTIVE",
      created_at: addDays(nowIso(), -randomInt(0, 55)),
      expires_at: addDays(nowIso(), randomInt(-10, 50)),
      is_seed_data: true,
      batch_id: batchId
    });
  }
  return rows;
}

function generateExchanges(batchId, sales) {
  const rows = [];
  for (let index = 0; index < 8; index += 1) {
    const sale = sales[(index * 7) % sales.length];
    rows.push({
      exchange_id: buildId("EXC"),
      origin_sale_id: sale.sale_id,
      customer_name: sale.customer.name,
      customer_phone: sale.customer.phone,
      loja: sale.loja,
      origin_store: sale.loja,
      created_by: sale.vendedor,
      type: pick(["simple", "incremental", "gift"]),
      incremental_value: index % 2 === 0 ? roundMoney(randomInt(30, 180)) : 0,
      credit_value: index % 3 === 0 ? roundMoney(randomInt(20, 120)) : 0,
      cashback_generated_amount: index % 2 === 0 ? roundMoney(randomInt(5, 24)) : 0,
      notes: pick(["Troca de tamanho", "Troca de cor", "Troca de presente", "Cliente preferiu outra modelagem"]),
      created_at: addDays(nowIso(), -randomInt(0, 35)),
      inventory_in_movements: [buildId("MOV")],
      is_seed_data: true,
      batch_id: batchId
    });
  }
  return rows;
}

function generateReservationsAndQuotes(batchId, customers, products) {
  const reservations = [];
  const quotes = [];
  const sessions = [];
  const drafts = [];

  for (let index = 0; index < 12; index += 1) {
    const customer = customers[(index * 2) % customers.length];
    const seller = SELLERS[index % SELLERS.length];
    const store = STORES[index % STORES.length];
    const product = products[index % products.length];
    const sessionId = buildId("SES");
    const createdAt = addDays(nowIso(), -randomInt(0, 20));
    const sessionSnapshot = {
      session_id: sessionId,
      status: index % 2 === 0 ? "RESERVED" : "QUOTE",
      seller: seller.name,
      loja: store,
      customer: {
        name: customer.name,
        phone: customer.phone
      },
      cart_items: [{
        item_id: buildId("ITM"),
        product_id: product.product_id,
        codigo: product.codigo,
        sku: product.sku,
        nome: product.nome,
        marca: product.marca,
        categoria: product.categoria,
        quantidade: 1,
        preco_referencia: product.preco_venda
      }],
      cart_notes: "Sessao de homologacao do PDV.",
      payment_plan: { methods: [{ method: "pix", amount: product.preco_venda, installments: 1 }] },
      coupon_prep: { mode: "normal", with_price: true, whatsapp_ready: true, qr_ready: true },
      created_at: createdAt,
      updated_at: createdAt
    };

    sessions.push({
      session_id: sessionId,
      status: index % 3 === 0 ? "OPEN" : index % 2 === 0 ? "RESERVED" : "QUOTE",
      seller: seller.name,
      loja: store,
      customer: sessionSnapshot.customer,
      cart_items: sessionSnapshot.cart_items,
      cart_notes: sessionSnapshot.cart_notes,
      payment_plan: sessionSnapshot.payment_plan,
      coupon_prep: sessionSnapshot.coupon_prep,
      created_at: createdAt,
      updated_at: createdAt,
      is_seed_data: true,
      batch_id: batchId
    });

    drafts.push({
      draft_id: buildId("DRF"),
      session_id: sessionId,
      seller: seller.name,
      loja: store,
      customer_name: customer.name,
      saved_at: createdAt,
      saved_by: seller.name,
      is_seed_data: true,
      batch_id: batchId
    });

    quotes.push({
      quote_id: buildId("QTE"),
      status: "QUOTE",
      validade: addDays(createdAt, 7).slice(0, 10),
      observacoes: "Orcamento gerado para teste do PDV.",
      seller: seller.name,
      loja: store,
      session_snapshot: sessionSnapshot,
      created_at: createdAt,
      created_by: seller.name,
      is_seed_data: true,
      batch_id: batchId
    });

    reservations.push({
      reservation_id: buildId("RSV"),
      status: "RESERVED",
      validade: addDays(createdAt, index % 4 === 0 ? -2 : 3).slice(0, 10),
      observacoes: "Reserva de teste do PDV.",
      seller: seller.name,
      loja: store,
      session_snapshot: sessionSnapshot,
      created_at: createdAt,
      created_by: seller.name,
      inventory_status: index % 5 === 0 ? "RELEASED" : "HELD",
      customer_name: customer.name,
      customer_phone: customer.phone,
      is_seed_data: true,
      batch_id: batchId
    });
  }

  return { reservations, quotes, sessions, drafts };
}

function generateInternalConsumption(batchId, products) {
  const rows = [];
  for (let index = 0; index < 12; index += 1) {
    const product = products[(index * 4) % products.length];
    rows.push({
      consumption_id: buildId("CNS"),
      produto: product.nome,
      sku: product.sku,
      quantidade: randomInt(1, 2),
      destino: INTERNAL_CONSUMPTION_DESTINATIONS[index % INTERNAL_CONSUMPTION_DESTINATIONS.length],
      motivo: pick(["USO_PESSOAL", "PRESENTE", "MARKETING", "INFLUENCIADOR", "ENSAIO", "UNIFORME", "OUTRO"]),
      observacao: "Saida operacional de homologacao.",
      responsavel: INTERNAL_CONSUMPTION_OWNERS[index % INTERNAL_CONSUMPTION_OWNERS.length],
      loja: STORES[index % STORES.length],
      valor_referencia: product.preco_venda,
      preco_custo: product.preco_custo,
      created_at: addDays(nowIso(), -randomInt(0, 18)),
      created_by: "codex_seed",
      is_seed_data: true,
      batch_id: batchId
    });
  }
  return rows;
}

function generateCashRegisters(batchId, sales) {
  const registers = [];
  const auditLogs = [];
  const authorizations = [];

  STORES.forEach((store, index) => {
    const salesByStore = sales.filter((sale) => sale.loja === store);
    const movements = [];

    salesByStore.slice(0, 40).forEach((sale) => {
      movements.push({
        movement_id: buildId("MOV"),
        type: "SALE",
        value: sale.total_final,
        reason: "Venda operacional concluida",
        observation: sale.observacoes,
        responsible: sale.vendedor,
        responsible_role: SELLERS.find((item) => item.name === sale.vendedor)?.role || "VENDEDOR",
        loja: store,
        created_at: sale.created_at,
        payload: {
          sale_id: sale.sale_id,
          subtotal: sale.subtotal,
          desconto_extra: sale.extra_discount,
          money_amount: sale.payment_methods.filter((item) => item.method === "dinheiro").reduce((sum, item) => sum + item.amount, 0),
          pix_amount: sale.payment_methods.filter((item) => item.method === "pix").reduce((sum, item) => sum + item.amount, 0),
          debito_amount: sale.payment_methods.filter((item) => item.method === "debito").reduce((sum, item) => sum + item.amount, 0),
          credito_amount: sale.payment_methods.filter((item) => item.method === "credito").reduce((sum, item) => sum + item.amount, 0),
          link_pagamento_amount: sale.payment_methods.filter((item) => item.method === "link_pagamento").reduce((sum, item) => sum + item.amount, 0),
          cashback_amount: sale.cashback_used,
          vale_presente_amount: sale.gift_card_used,
          credito_troca_amount: sale.exchange_credit_used,
          permuta_amount: sale.permuta_amount
        },
        is_seed_data: true,
        batch_id: batchId
      });
    });

    movements.push({
      movement_id: buildId("MOV"),
      type: "SANGRIA",
      value: roundMoney(randomInt(80, 260)),
      reason: "ACAO_GERENTE",
      observation: "Sangria de homologacao.",
      responsible: "Fabiana",
      responsible_role: "GERENTE",
      loja: store,
      created_at: addDays(nowIso(), -randomInt(0, 10)),
      payload: {},
      is_seed_data: true,
      batch_id: batchId
    });
    movements.push({
      movement_id: buildId("MOV"),
      type: "SUPRIMENTO",
      value: roundMoney(randomInt(50, 200)),
      reason: "OUTRO",
      observation: "Troco inicial adicional.",
      responsible: "Fabiana",
      responsible_role: "GERENTE",
      loja: store,
      created_at: addDays(nowIso(), -randomInt(0, 9)),
      payload: {},
      is_seed_data: true,
      batch_id: batchId
    });
    movements.push({
      movement_id: buildId("MOV"),
      type: "DESPESA",
      value: roundMoney(randomInt(20, 90)),
      reason: "OUTRO",
      observation: "Despesa operacional simulada.",
      responsible: "Fabiana",
      responsible_role: "GERENTE",
      loja: store,
      created_at: addDays(nowIso(), -randomInt(0, 8)),
      payload: {},
      is_seed_data: true,
      batch_id: batchId
    });

    const moneyExpected = roundMoney(
      500
      + movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.money_amount, 0)
      + movements.filter((item) => item.type === "SUPRIMENTO").reduce((sum, item) => sum + item.value, 0)
      - movements.filter((item) => item.type === "SANGRIA").reduce((sum, item) => sum + item.value, 0)
      - movements.filter((item) => item.type === "DESPESA").reduce((sum, item) => sum + item.value, 0)
    );
    const closeDifference = index === 1 ? 128.4 : roundMoney((index - 1) * 8.5);
    const status = index === 0 ? "OPEN" : index === 2 ? "REOPENED" : "CLOSED";

    registers.push({
      cash_register_id: `SEED_REGISTER_${store}`,
      loja: store,
      operador: SELLERS[index % SELLERS.length].name,
      operator_role: SELLERS[index % SELLERS.length].role,
      status,
      valor_inicial: 500,
      observacao: "Caixa de homologacao do PDV.",
      criado_em: addDays(nowIso(), -randomInt(5, 20)),
      confirmado_em: "",
      reaberto_em: status === "REOPENED" ? addDays(nowIso(), -1) : "",
      fechado_em: status === "OPEN" ? "" : addDays(nowIso(), -1),
      closed_by: status === "OPEN" ? "" : "Fabiana",
      reopen_reason: status === "REOPENED" ? "Conferencia operacional" : "",
      linked_sales: salesByStore.length,
      movements,
      close_observation: status === "OPEN" ? "" : "Fechamento de homologacao.",
      close_summary: status === "OPEN" ? null : {
        dinheiro_esperado: moneyExpected,
        pix: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.pix_amount, 0)),
        debito: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.debito_amount, 0)),
        credito: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.credito_amount, 0)),
        link_pagamento: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.link_pagamento_amount, 0)),
        cashback_usado: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.cashback_amount, 0)),
        vale_presente_usado: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.vale_presente_amount, 0)),
        permuta: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.permuta_amount, 0)),
        credito_troca: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.credito_troca_amount, 0)),
        descontos: roundMoney(movements.filter((item) => item.type === "SALE").reduce((sum, item) => sum + item.payload.desconto_extra, 0)),
        sangrias: roundMoney(movements.filter((item) => item.type === "SANGRIA").reduce((sum, item) => sum + item.value, 0)),
        suprimentos: roundMoney(movements.filter((item) => item.type === "SUPRIMENTO").reduce((sum, item) => sum + item.value, 0)),
        despesas: roundMoney(movements.filter((item) => item.type === "DESPESA").reduce((sum, item) => sum + item.value, 0)),
        ajustes: 0,
        exchanges: 0,
        dinheiro_informado: roundMoney(moneyExpected + closeDifference),
        diferenca_final: closeDifference
      },
      is_seed_data: true,
      batch_id: batchId
    });
  });

  for (let index = 0; index < 12; index += 1) {
    const seller = SELLERS[index % SELLERS.length];
    authorizations.push({
      authorization_id: buildId("PIN"),
      code: String(100000 + index),
      type: pick(["DISCOUNT_OVERRIDE", "PERMUTA_APPROVAL", "SALE_CANCELLATION", "CASHBACK_ADJUSTMENT", "REOPEN_CASH_REGISTER", "REOPEN_SALE"]),
      status: pick(["ACTIVE", "USED", "EXPIRED", "CANCELLED"]),
      loja: STORES[index % STORES.length],
      reason: DISCOUNT_REASONS[index % DISCOUNT_REASONS.length],
      context: { seed: true, index },
      issued_by: "Fabiana",
      issued_role: "GERENTE",
      issued_at: addDays(nowIso(), -randomInt(0, 20)),
      expires_at: addDays(nowIso(), -randomInt(-1, 5)),
      used_at: maybe(0.5) ? addDays(nowIso(), -randomInt(0, 10)) : "",
      used_by: maybe(0.5) ? seller.name : "",
      used_context: maybe(0.4) ? { sale_id: pick(sales).sale_id } : {},
      is_seed_data: true,
      batch_id: batchId
    });
  }

  registers.forEach((register) => {
    auditLogs.push({
      audit_id: buildId("AUD"),
      action: "OPEN_CASH_REGISTER",
      created_at: register.criado_em,
      actor: register.operador,
      actor_role: register.operator_role,
      loja: register.loja,
      reason: register.observacao,
      before: null,
      after: register,
      is_seed_data: true,
      batch_id: batchId
    });
    if (register.close_summary) {
      auditLogs.push({
        audit_id: buildId("AUD"),
        action: "CLOSE_CASH_REGISTER",
        created_at: register.fechado_em,
        actor: register.closed_by,
        actor_role: "GERENTE",
        loja: register.loja,
        reason: register.close_observation,
        before: { status: "OPEN" },
        after: register.close_summary,
        is_seed_data: true,
        batch_id: batchId
      });
    }
  });

  authorizations.forEach((pin) => {
    auditLogs.push({
      audit_id: buildId("AUD"),
      action: pin.status === "USED" ? "PIN_USED" : "PIN_ISSUED",
      created_at: pin.status === "USED" ? pin.used_at || pin.issued_at : pin.issued_at,
      actor: pin.status === "USED" ? pin.used_by || "sistema" : pin.issued_by,
      actor_role: pin.status === "USED" ? "VENDEDOR" : pin.issued_role,
      loja: pin.loja,
      reason: pin.reason,
      before: pin.status === "USED" ? { status: "ACTIVE" } : null,
      after: pin,
      is_seed_data: true,
      batch_id: batchId
    });
  });

  return { registers, authorizations, auditLogs };
}

function generateOperationalEvents(batchId, sales, reservations, quotes, internalConsumption, messageQueue) {
  const rows = [];
  sales.slice(0, 60).forEach((sale) => {
    rows.push({
      event_id: buildId("EVT"),
      type: "SALE_COMPLETED",
      origem: "pdv_sales_seed",
      usuario: sale.vendedor,
      loja: sale.loja,
      data_hora: sale.created_at,
      contexto: { sale_id: sale.sale_id },
      payload: { total_final: sale.total_final, customer: sale.customer },
      is_seed_data: true,
      batch_id: batchId
    });
    if (sale.gift_sale?.enabled) {
      rows.push({
        event_id: buildId("EVT"),
        type: "GIFT_SENT",
        origem: "pdv_experience_seed",
        usuario: sale.vendedor,
        loja: sale.loja,
        data_hora: addDays(sale.created_at, 1),
        contexto: { sale_id: sale.sale_id },
        payload: sale.gift_sale,
        is_seed_data: true,
        batch_id: batchId
      });
    }
  });
  reservations.slice(0, 8).forEach((reservation) => {
    rows.push({
      event_id: buildId("EVT"),
      type: "RESERVATION_CREATED",
      origem: "pdv_operational_seed",
      usuario: reservation.seller,
      loja: reservation.loja,
      data_hora: reservation.created_at,
      contexto: { reservation_id: reservation.reservation_id },
      payload: { customer: reservation.session_snapshot?.customer || null },
      is_seed_data: true,
      batch_id: batchId
    });
  });
  quotes.slice(0, 8).forEach((quote) => {
    rows.push({
      event_id: buildId("EVT"),
      type: "QUOTE_CREATED",
      origem: "pdv_operational_seed",
      usuario: quote.seller,
      loja: quote.loja,
      data_hora: quote.created_at,
      contexto: { quote_id: quote.quote_id },
      payload: { customer: quote.session_snapshot?.customer || null },
      is_seed_data: true,
      batch_id: batchId
    });
  });
  internalConsumption.slice(0, 10).forEach((item) => {
    rows.push({
      event_id: buildId("EVT"),
      type: "INTERNAL_CONSUMPTION_CREATED",
      origem: "pdv_inventory_seed",
      usuario: item.responsavel,
      loja: item.loja,
      data_hora: item.created_at,
      contexto: { consumption_id: item.consumption_id },
      payload: item,
      is_seed_data: true,
      batch_id: batchId
    });
  });
  messageQueue.slice(0, 10).forEach((item) => {
    rows.push({
      event_id: buildId("EVT"),
      type: item.status === "SENT" ? "MESSAGE_SENT" : "MESSAGE_SCHEDULED",
      origem: "pdv_experience_seed",
      usuario: item.created_by,
      loja: item.payload?.loja || "",
      data_hora: item.created_at,
      contexto: { message_id: item.message_id },
      payload: item,
      is_seed_data: true,
      batch_id: batchId
    });
  });
  return rows;
}

function generateSeedData() {
  ensureSeedDirs();
  clearSeedData();
  const batchId = buildId("SEED");
  const generatedAt = nowIso();

  const customers = generateCustomers(batchId);
  const products = generateProducts(batchId);
  const inventoryBundle = generateInventory(products, batchId);
  const salesBundle = generateSales(products, customers, batchId);
  const giftCards = generateGiftCards(batchId, customers);
  const exchanges = generateExchanges(batchId, salesBundle.sales);
  const reservationsBundle = generateReservationsAndQuotes(batchId, customers, products);
  const internalConsumption = generateInternalConsumption(batchId, products);
  const controlBundle = generateCashRegisters(batchId, salesBundle.sales);
  const operationalEvents = generateOperationalEvents(batchId, salesBundle.sales, reservationsBundle.reservations, reservationsBundle.quotes, internalConsumption, salesBundle.messageQueue);

  mergeSeedRows(targetFiles.productsDataset, products);
  mergeSeedRows(targetFiles.masterCustomers, customers);
  mergeSeedRows(targetFiles.inventory, inventoryBundle.inventory);
  mergeSeedRows(targetFiles.inventoryMovements, inventoryBundle.movements);
  mergeSeedRows(targetFiles.transfers, inventoryBundle.transfers);
  mergeSeedRows(targetFiles.sales, salesBundle.sales);
  mergeSeedRows(targetFiles.cashbackLedger, salesBundle.cashbackLedger);
  mergeSeedRows(targetFiles.giftCards, giftCards);
  mergeSeedRows(targetFiles.commissions, salesBundle.commissions);
  mergeSeedRows(targetFiles.exchanges, exchanges);
  mergeSeedRows(targetFiles.salesCoupons, salesBundle.salesCoupons);
  mergeSeedRows(targetFiles.salesLogs, salesBundle.salesLogs);
  mergeSeedRows(targetFiles.experienceCoupons, salesBundle.experienceCoupons);
  mergeSeedRows(targetFiles.messageQueue, salesBundle.messageQueue);
  mergeSeedRows(targetFiles.welcomeBonuses, salesBundle.welcomeBonuses);
  mergeSeedRows(targetFiles.sessions, reservationsBundle.sessions);
  mergeSeedRows(targetFiles.drafts, reservationsBundle.drafts);
  mergeSeedRows(targetFiles.quotes, reservationsBundle.quotes);
  mergeSeedRows(targetFiles.reservations, reservationsBundle.reservations);
  mergeSeedRows(targetFiles.internalConsumption, internalConsumption);
  mergeSeedRows(targetFiles.cashRegisters, controlBundle.registers);
  mergeSeedRows(targetFiles.authorizations, controlBundle.authorizations);
  mergeSeedRows(targetFiles.auditLogs, controlBundle.auditLogs);
  mergeSeedRows(targetFiles.operationalEvents, operationalEvents);

  const counts = {
    stores: STORES.length,
    sellers: SELLERS.length,
    customers: customers.length,
    products: products.length,
    inventory_records: inventoryBundle.inventory.length,
    inventory_movements: inventoryBundle.movements.length,
    sales: salesBundle.sales.length,
    cashback_entries: salesBundle.cashbackLedger.length,
    gift_cards: giftCards.length,
    exchanges: exchanges.length,
    reservations: reservationsBundle.reservations.length,
    quotes: reservationsBundle.quotes.length,
    internal_consumption: internalConsumption.length,
    cash_registers: controlBundle.registers.length,
    audit_logs: controlBundle.auditLogs.length,
    coupons: salesBundle.experienceCoupons.length,
    messages: salesBundle.messageQueue.length,
    welcome_bonuses: salesBundle.welcomeBonuses.length
  };

  saveSeedMeta({
    active_batch_id: batchId,
    generated_at: generatedAt,
    counts,
    coupon_files: salesBundle.couponFiles
  });

  return {
    batch_id: batchId,
    generated_at: generatedAt,
    counts
  };
}

function getSeedStatus() {
  const meta = loadSeedMeta();
  return {
    active: Boolean(meta.active_batch_id),
    batch_id: meta.active_batch_id || "",
    generated_at: meta.generated_at || "",
    counts: meta.counts || {}
  };
}

function getSeedPreview() {
  const status = getSeedStatus();
  return {
    status,
    stores: STORES,
    sellers: SELLERS,
    sample_customers: readJson(targetFiles.masterCustomers, []).filter((item) => item?.is_seed_data).slice(0, 8),
    sample_products: readJson(targetFiles.productsDataset, []).filter((item) => item?.is_seed_data).slice(0, 8),
    sample_sales: readJson(targetFiles.sales, []).filter((item) => item?.is_seed_data).slice(0, 8),
    sample_alert_candidates: {
      inventory_negative: readJson(targetFiles.inventory, []).filter((item) => item?.is_seed_data && Number(item.available_qty || 0) < 0).slice(0, 4),
      reservations_expired: readJson(targetFiles.reservations, []).filter((item) => item?.is_seed_data && item.validade && new Date(item.validade) < new Date()).slice(0, 4),
      high_cash_difference: readJson(targetFiles.cashRegisters, []).filter((item) => item?.is_seed_data && Math.abs(Number(item?.close_summary?.diferenca_final || 0)) >= 100).slice(0, 4)
    }
  };
}

module.exports = {
  getSeedStatus,
  getSeedPreview,
  generateSeedData,
  clearSeedData
};
