"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { appendEvent } = require("./pdvOperationalService");
const { toPublicUrl } = require("../utils/pdvPublicUrl");
const { getStorePublicContext } = require("../../../services/storeSettingsService");

const experienceRootDir = path.join(process.cwd(), "data", "pdv", "experience");
const couponDocumentsDir = path.join(experienceRootDir, "coupons");
const experienceFiles = {
  coupons: path.join(experienceRootDir, "coupons.json"),
  messageQueue: path.join(experienceRootDir, "message-queue.json"),
  welcomeBonuses: path.join(experienceRootDir, "welcome-bonuses.json")
};
const salesFile = path.join(process.cwd(), "data", "pdv", "sales", "sales.json");

const MESSAGE_TEMPLATE_KEYS = [
  "SALE_COMPLETED",
  "CASHBACK_GRANTED",
  "GIFT_SALE",
  "GIFT_SENT",
  "RETURN_CAMPAIGN",
  "BIRTHDAY",
  "RESERVATION_CREATED",
  "QUOTE_CREATED"
];

const MESSAGE_QUEUE_STATUSES = ["PENDING", "SCHEDULED", "SENT", "FAILED", "CANCELLED"];
const GIFT_SEND_STATUSES = ["PENDING", "SCHEDULED", "SENT", "CANCELLED"];

function ensureExperienceDirs() {
  fs.mkdirSync(experienceRootDir, { recursive: true });
  fs.mkdirSync(couponDocumentsDir, { recursive: true });
  Object.values(experienceFiles).forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]", "utf8");
    }
  });
}

function readJson(filePath, fallback = []) {
  ensureExperienceDirs();
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureExperienceDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function loadSales() {
  return readJson(salesFile, []);
}

function saveSales(rows) {
  writeJson(salesFile, rows);
}

function loadCoupons() {
  return readJson(experienceFiles.coupons, []);
}

function saveCoupons(rows) {
  writeJson(experienceFiles.coupons, rows);
}

function loadMessageQueue() {
  return readJson(experienceFiles.messageQueue, []);
}

function saveMessageQueue(rows) {
  writeJson(experienceFiles.messageQueue, rows);
}

function loadWelcomeBonuses() {
  return readJson(experienceFiles.welcomeBonuses, []);
}

function saveWelcomeBonuses(rows) {
  writeJson(experienceFiles.welcomeBonuses, rows);
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

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function nowIso() {
  return new Date().toISOString();
}

function buildId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(toNumber(value));
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getSaleStoreContext(sale = {}) {
  return getStorePublicContext(sale.loja || sale.store_id || sale.loja_venda || "", {
    store_id: sale.store_id || sale.loja || sale.loja_venda || "",
    display_name: sale.loja || sale.store_label || sale.loja_venda || ""
  });
}

function buildStoreAddressSummary(storeContext = {}) {
  const address = storeContext?.address || {};
  const streetLine = [address.street, address.number].map((item) => normalizeText(item || "")).filter(Boolean).join(", ");
  const district = normalizeText(address.district || "");
  const cityState = [normalizeText(address.city || ""), normalizeText(address.state || "")]
    .filter(Boolean)
    .join("/");
  return [streetLine, district, cityState].filter(Boolean).join(" • ");
}

function buildStoreContactSummary(storeContext = {}) {
  const contact = storeContext?.contact || {};
  const parts = [];
  if (normalizeText(contact.phone || "")) {
    parts.push(`Tel: ${normalizeText(contact.phone || "")}`);
  }
  if (normalizeText(contact.whatsapp || "")) {
    parts.push(`WhatsApp: ${normalizeText(contact.whatsapp || "")}`);
  }
  return parts.join(" • ");
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapePdfText(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildSimplePdfBuffer(lines = []) {
  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const fontObjectId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contentLines = ["BT", "/F1 11 Tf", "48 800 Td"];
  lines.slice(0, 38).forEach((line, index) => {
    if (index > 0) {
      contentLines.push("0 -17 Td");
    }
    contentLines.push(`(${escapePdfText(line)}) Tj`);
  });
  contentLines.push("ET");
  const contentStream = contentLines.join("\n");
  const contentObjectId = addObject(`<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream`);
  const pageObjectId = addObject(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
  const pagesObjectId = addObject(`<< /Type /Pages /Kids [${pageObjectId} 0 R] /Count 1 >>`);
  const catalogObjectId = addObject(`<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((objectContent, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objectContent}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function getSaleById(saleId = "") {
  return loadSales().find((item) => item.sale_id === String(saleId || "").trim()) || null;
}

function getCouponBySaleId(saleId = "", { mode = "" } = {}) {
  const normalizedMode = normalizeText(mode || "").toLowerCase();
  return loadCoupons().find((item) => item.sale_id === String(saleId || "").trim() && (!normalizedMode || item.mode === normalizedMode)) || null;
}

function getMessageTemplates() {
  return {
    SALE_COMPLETED: ({ customerName = "cliente", totalFinal = 0, cashbackAmount = 0, couponLink = "" }) => `Olá, ${customerName}. Sua compra na AEROSTORE foi concluída com sucesso. Total: ${formatCurrency(totalFinal)}.${cashbackAmount > 0 ? ` Você ganhou ${formatCurrency(cashbackAmount)} de cashback, disponível amanhã.` : ""}${couponLink ? ` Cupom digital: ${couponLink}` : ""}`,
    CASHBACK_GRANTED: ({ customerName = "cliente", cashbackAmount = 0, validUntil = "" }) => `Olá, ${customerName}. Seu cashback de ${formatCurrency(cashbackAmount)} já foi registrado na AEROSTORE. Ele ficará disponível amanhã e poderá ser usado até ${validUntil || "-"}.`,
    GIFT_SALE: ({ giftedTo = "você", senderName = "alguém especial", message = "", couponLink = "" }) => `Olá, ${giftedTo}. Você recebeu um presente da AEROSTORE enviado por ${senderName}.${message ? ` Mensagem: ${message}.` : ""}${couponLink ? ` Seu cupom presente: ${couponLink}` : ""}`,
    GIFT_SENT: ({ giftedTo = "cliente", couponLink = "" }) => `Olá, ${giftedTo}. Seu presente da AEROSTORE está pronto.${couponLink ? ` Acesse seu cupom digital aqui: ${couponLink}` : ""}`,
    RETURN_CAMPAIGN: ({ customerName = "cliente" }) => `Olá, ${customerName}. Selecionamos novidades da AEROSTORE que combinam com o seu estilo. Quando quiser, separamos opções especiais para o seu retorno.`,
    BIRTHDAY: ({ customerName = "cliente" }) => `Feliz aniversário, ${customerName}. A AEROSTORE separou um atendimento especial para celebrar com você.`,
    RESERVATION_CREATED: ({ customerName = "cliente", reservationId = "" }) => `Olá, ${customerName}. Sua reserva ${reservationId || ""} foi criada na AEROSTORE e está aguardando seu retorno.`,
    QUOTE_CREATED: ({ customerName = "cliente", quoteId = "" }) => `Olá, ${customerName}. Seu orçamento ${quoteId || ""} foi preparado pela AEROSTORE e está disponível para você consultar quando quiser.`
  };
}

function buildCouponLines(sale, mode = "normal", storeContext = getSaleStoreContext(sale)) {
  const storeDisplayName = normalizeText(
    storeContext?.company?.trade_name
    || storeContext?.display_name
    || sale.loja
    || ""
  ) || "AEROSTORE";
  const addressSummary = buildStoreAddressSummary(storeContext);
  const contactSummary = buildStoreContactSummary(storeContext);
  const receiptFooter = normalizeText(storeContext?.terminal?.receipt_footer || "");
  const lines = [
    storeDisplayName,
    `Venda ${sale.sale_id}`,
    `Loja: ${storeContext?.display_name || sale.loja || "-"}`,
    `Data: ${formatDate(sale.data_hora)}`,
    `Vendedor: ${sale.vendedor || "-"}`,
    "Itens:"
  ];
  if (normalizeText(storeContext?.company?.legal_name || "")) {
    lines.splice(1, 0, normalizeText(storeContext.company.legal_name || ""));
  }
  if (normalizeText(storeContext?.company?.cnpj || "")) {
    lines.splice(2, 0, `CNPJ: ${normalizeText(storeContext.company.cnpj || "")}`);
  }
  if (addressSummary) {
    lines.splice(3, 0, addressSummary);
  }
  if (contactSummary) {
    lines.splice(4, 0, contactSummary);
  }
  (sale.items || []).forEach((item) => {
    lines.push(`- ${item.nome || "Produto"} | ${item.cor || "-"} | ${item.tamanho || "-"} | Qtd ${item.quantidade || 1}${mode === "normal" ? ` | ${formatCurrency(item.preco_referencia || 0)}` : ""}`);
  });
  if (mode === "normal") {
    lines.push(`Subtotal: ${formatCurrency(sale.subtotal || 0)}`);
    lines.push(`Desconto extra: ${formatCurrency(sale.desconto_extra || 0)}`);
    lines.push(`Cashback usado: ${formatCurrency(sale.cashback_usado || 0)}`);
    lines.push(`Cashback ganho: ${formatCurrency(sale.cashback_generated?.amount || 0)}`);
    lines.push(`Total final: ${formatCurrency(sale.total_final || 0)}`);
    lines.push(`Pagamentos: ${(sale.pagamentos || []).map((item) => `${item.method} ${formatCurrency(item.amount || 0)}`).join(" | ") || "-"}`);
  } else {
    lines.push(`Presenteado: ${sale.gift_sale?.gifted_to || "-"}`);
    lines.push(`Mensagem: ${sale.gift_sale?.message || "Com carinho, AEROSTORE."}`);
  }
  lines.push(receiptFooter || "Política de troca conforme regras internas da AEROSTORE.");
  lines.push(`QR venda: PDV-AEROSTORE:${sale.sale_id}`);
  return lines;
}

function buildCouponHtml({ sale, mode, qrDataUrl, documentUrl, pdfUrl, storeContext = getSaleStoreContext(sale) }) {
  const normalMode = mode !== "present";
  const brandTitle = normalizeText(
    storeContext?.company?.trade_name
    || storeContext?.display_name
    || sale.loja
    || "AEROSTORE"
  );
  const legalName = normalizeText(storeContext?.company?.legal_name || "");
  const cnpj = normalizeText(storeContext?.company?.cnpj || "");
  const addressSummary = buildStoreAddressSummary(storeContext);
  const contactSummary = buildStoreContactSummary(storeContext);
  const receiptFooter = normalizeText(storeContext?.terminal?.receipt_footer || "");
  const paymentRows = normalMode
    ? (sale.pagamentos || []).map((item) => `<li><strong>${escapeHtml(item.method || "-")}</strong><span>${escapeHtml(formatCurrency(item.amount || 0))}${item.installments > 1 ? ` • ${item.installments}x` : ""}</span></li>`).join("")
    : "";
  const cashbackMessage = sale.cashback_generated?.amount > 0
    ? `<div class="notice">Você ganhou <strong>${escapeHtml(formatCurrency(sale.cashback_generated.amount || 0))}</strong>. Disponível amanhã e válido até ${escapeHtml(formatDate(sale.cashback_generated.expires_at || ""))}.</div>`
    : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Cupom ${escapeHtml(brandTitle || "AEROSTORE")} ${escapeHtml(sale.sale_id || "")}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #f3efe8; font-family: Georgia, "Times New Roman", serif; color: #1e1a17; }
    .sheet { max-width: 780px; margin: 24px auto; background: #fffdf8; border: 1px solid rgba(44,34,27,0.08); box-shadow: 0 30px 60px rgba(36,28,22,0.12); }
    .hero { padding: 28px 32px 20px; background: linear-gradient(135deg, #f5f0e7 0%, #fbf8f2 100%); border-bottom: 1px solid rgba(44,34,27,0.08); }
    .brand { font-size: 2rem; letter-spacing: 0.18em; text-transform: uppercase; margin: 0 0 6px; }
    .subtitle { margin: 0; color: #5d554f; font-size: 0.96rem; }
    .content { padding: 26px 32px 34px; display: grid; gap: 22px; }
    .meta, .totals, .payments, .items, .footer { display: grid; gap: 10px; }
    .meta-grid, .totals-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .card { background: #faf6ef; border: 1px solid rgba(44,34,27,0.08); border-radius: 16px; padding: 14px 16px; display: grid; gap: 4px; }
    .card span { color: #6f665f; font-size: 0.88rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .card strong { font-size: 1rem; }
    .items-table { width: 100%; border-collapse: collapse; }
    .items-table th, .items-table td { text-align: left; padding: 10px 0; border-bottom: 1px solid rgba(44,34,27,0.08); font-size: 0.96rem; }
    .payments ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
    .payments li { display: flex; justify-content: space-between; gap: 16px; }
    .footer { padding-top: 8px; border-top: 1px solid rgba(44,34,27,0.08); }
    .footer-note { color: #6f665f; font-size: 0.92rem; line-height: 1.5; }
    .qr-wrap { display: grid; justify-items: center; gap: 10px; padding: 18px; border: 1px solid rgba(44,34,27,0.08); border-radius: 18px; background: #f8f3ea; }
    .qr-wrap img { width: 164px; height: 164px; }
    .notice { padding: 14px 16px; border-radius: 14px; background: #f3ead7; color: #5c4822; border: 1px solid rgba(125, 93, 26, 0.18); }
    .links { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.9rem; }
    .links a { color: #5a3d16; text-decoration: none; border-bottom: 1px solid rgba(90, 61, 22, 0.22); }
    @media print { body { background: #fff; } .sheet { margin: 0; box-shadow: none; border: none; } }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="hero">
      <h1 class="brand">${escapeHtml(brandTitle || "AEROSTORE")}</h1>
      <p class="subtitle">${normalMode ? "Cupom digital não fiscal" : "Cupom presente AEROSTORE"}</p>
      ${legalName || cnpj || addressSummary || contactSummary ? `
        <div class="footer" style="padding-top: 14px; border-top: 0;">
          ${legalName ? `<span class="footer-note">${escapeHtml(legalName)}</span>` : ""}
          ${cnpj ? `<span class="footer-note">CNPJ: ${escapeHtml(cnpj)}</span>` : ""}
          ${addressSummary ? `<span class="footer-note">${escapeHtml(addressSummary)}</span>` : ""}
          ${contactSummary ? `<span class="footer-note">${escapeHtml(contactSummary)}</span>` : ""}
        </div>
      ` : ""}
    </header>
    <section class="content">
      <div class="meta">
        <div class="meta-grid">
          <div class="card"><span>Loja</span><strong>${escapeHtml(storeContext?.display_name || sale.loja || "-")}</strong></div>
          <div class="card"><span>Venda</span><strong>${escapeHtml(sale.sale_id || "-")}</strong></div>
          <div class="card"><span>Data</span><strong>${escapeHtml(formatDate(sale.data_hora || ""))}</strong></div>
          <div class="card"><span>Vendedor</span><strong>${escapeHtml(sale.vendedor || "-")}</strong></div>
          <div class="card"><span>Instagram</span><strong>@aerostore</strong></div>
          <div class="card"><span>${normalMode ? "Cliente" : "Presenteado"}</span><strong>${escapeHtml(normalMode ? (sale.customer?.name || "Atendimento em loja") : (sale.gift_sale?.gifted_to || "Presente especial AEROSTORE"))}</strong></div>
        </div>
      </div>

      <div class="items">
        <table class="items-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Tamanho</th>
              <th>Cor</th>
              <th>Qtd</th>
              ${normalMode ? "<th>Valor</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${(sale.items || []).map((item) => `
              <tr>
                <td>${escapeHtml(item.nome || "-")}</td>
                <td>${escapeHtml(item.tamanho || "-")}</td>
                <td>${escapeHtml(item.cor || "-")}</td>
                <td>${escapeHtml(String(item.quantidade || 1))}</td>
                ${normalMode ? `<td>${escapeHtml(formatCurrency(item.preco_referencia || 0))}</td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      ${normalMode ? `
        <div class="totals">
          <div class="totals-grid">
            <div class="card"><span>Subtotal</span><strong>${escapeHtml(formatCurrency(sale.subtotal || 0))}</strong></div>
            <div class="card"><span>Desconto extra</span><strong>${escapeHtml(formatCurrency(sale.desconto_extra || 0))}</strong></div>
            <div class="card"><span>Cashback usado</span><strong>${escapeHtml(formatCurrency(sale.cashback_usado || 0))}</strong></div>
            <div class="card"><span>Vale presente</span><strong>${escapeHtml(formatCurrency(sale.vale_presente_usado || 0))}</strong></div>
            <div class="card"><span>Total final</span><strong>${escapeHtml(formatCurrency(sale.total_final || 0))}</strong></div>
            <div class="card"><span>Cashback ganho</span><strong>${escapeHtml(formatCurrency(sale.cashback_generated?.amount || 0))}</strong></div>
          </div>
        </div>
        <div class="payments">
          <ul>${paymentRows || "<li><strong>Pagamentos</strong><span>-</span></li>"}</ul>
        </div>
        ${cashbackMessage}
      ` : `
        <div class="notice">Mensagem personalizada: ${escapeHtml(sale.gift_sale?.message || "Com carinho, AEROSTORE.")}</div>
      `}

      <div class="qr-wrap">
        <img alt="QR Code da venda ${escapeHtml(sale.sale_id || "")}" src="${qrDataUrl}" />
        <strong>QR da venda ${escapeHtml(sale.sale_id || "")}</strong>
        <span class="footer-note">Use este QR para reimpressão, troca e recuperação rápida do cupom digital.</span>
      </div>

      <div class="footer">
        <span class="footer-note">${escapeHtml(receiptFooter || "Política de troca conforme regras internas da AEROSTORE.")}</span>
        <span class="footer-note">${normalMode ? "Obrigado por comprar na AEROSTORE. Sua experiência continua com estilo, cuidado e relacionamento." : "Este presente foi preparado para criar uma experiência especial AEROSTORE."}</span>
        <div class="links">
          <a href="${documentUrl}">Cupom digital</a>
          <a href="${pdfUrl}">Versão PDF</a>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function getCouponDocumentLinks(saleId, mode) {
  return {
    documentUrl: `/api/pdv/experience/coupon/${encodeURIComponent(saleId)}/document?format=html&mode=${encodeURIComponent(mode)}`,
    pdfUrl: `/api/pdv/experience/coupon/${encodeURIComponent(saleId)}/document?format=pdf&mode=${encodeURIComponent(mode)}`
  };
}

function syncQueuedGiftMessagesWithCoupon(sale, coupon, user = {}) {
  if (!sale?.gift_sale?.enabled || !coupon || coupon.mode !== "present") {
    return 0;
  }
  const queue = loadMessageQueue();
  let updatedCount = 0;
  queue.forEach((entry) => {
    if (entry.sale_id !== sale.sale_id || entry.template !== "GIFT_SALE" || entry.status === "CANCELLED") {
      return;
    }
    entry.payload = {
      ...(entry.payload || {}),
      couponLink: toPublicUrl(coupon.document_url || ""),
      loja: sale.loja || entry.payload?.loja || ""
    };
    entry.text = buildTemplatePayload("GIFT_SALE", entry.payload);
    entry.updated_at = nowIso();
    entry.updated_by = user?.name || user?.email || "sistema";
    updatedCount += 1;
  });
  if (updatedCount > 0) {
    saveMessageQueue(queue);
  }
  return updatedCount;
}

async function generateCouponForSale(saleId, payload = {}, user = {}) {
  const sale = getSaleById(saleId);
  if (!sale) {
    throw new Error("Venda do PDV não encontrada para gerar cupom.");
  }
  const storeContext = getSaleStoreContext(sale);
  const mode = normalizeText(payload.mode || (sale.gift_sale?.enabled ? "present" : sale.coupon?.mode || "normal")).toLowerCase() === "presente"
    ? "present"
    : normalizeText(payload.mode || (sale.gift_sale?.enabled ? "present" : sale.coupon?.mode || "normal")).toLowerCase() === "present"
      ? "present"
      : "normal";
  const qrValue = `PDV-AEROSTORE:${sale.sale_id}`;
  const qrDataUrl = await QRCode.toDataURL(qrValue, {
    margin: 1,
    width: 220,
    color: {
      dark: "#1f1814",
      light: "#fffaf3"
    }
  });
  const links = getCouponDocumentLinks(sale.sale_id, mode);
  const html = buildCouponHtml({
    sale,
    mode,
    storeContext,
    qrDataUrl,
    documentUrl: links.documentUrl,
    pdfUrl: links.pdfUrl
  });
  const pdfLines = buildCouponLines(sale, mode, storeContext);
  const pdfBuffer = buildSimplePdfBuffer(pdfLines);
  const baseName = `${sale.sale_id}-${mode}`;
  const htmlPath = path.join(couponDocumentsDir, `${baseName}.html`);
  const pdfPath = path.join(couponDocumentsDir, `${baseName}.pdf`);
  fs.writeFileSync(htmlPath, html, "utf8");
  fs.writeFileSync(pdfPath, pdfBuffer);

  const coupons = loadCoupons();
  let coupon = coupons.find((item) => item.sale_id === sale.sale_id && item.mode === mode);
  if (!coupon) {
    coupon = {
      coupon_id: buildId("CPN"),
      sale_id: sale.sale_id,
      mode,
      version: 1,
      reprints: [],
      created_at: nowIso()
    };
    coupons.unshift(coupon);
  } else {
    coupon.version = Number(coupon.version || 1) + 1;
  }
  coupon.updated_at = nowIso();
  coupon.generated_by = user?.name || user?.email || "sistema";
  coupon.html_path = htmlPath;
  coupon.pdf_path = pdfPath;
  coupon.document_url = links.documentUrl;
  coupon.pdf_url = links.pdfUrl;
  coupon.qr_value = qrValue;
  coupon.qr_data_url = qrDataUrl;
  if (payload.reprint_reason) {
    coupon.reprints.unshift({
      reprint_id: buildId("RPT"),
      reason: normalizeText(payload.reprint_reason || ""),
      reprinted_by: user?.name || user?.email || "sistema",
      reprinted_at: nowIso()
    });
  }
  saveCoupons(coupons);

  const sales = loadSales();
  const saleRow = sales.find((item) => item.sale_id === sale.sale_id);
  if (saleRow) {
    saleRow.coupon_experience = {
      coupon_id: coupon.coupon_id,
      mode,
      document_url: links.documentUrl,
      pdf_url: links.pdfUrl,
      qr_value: qrValue,
      generated_at: coupon.updated_at
    };
    saveSales(sales);
  }

  syncQueuedGiftMessagesWithCoupon(sale, {
    ...coupon,
    mode,
    document_url: links.documentUrl
  }, user);

  appendEvent("COUPON_GENERATED", { sale_id: sale.sale_id, loja: sale.loja }, {
    coupon_id: coupon.coupon_id,
    mode,
    reprint: Boolean(payload.reprint_reason),
    reprint_reason: normalizeText(payload.reprint_reason || ""),
    generated_by: user?.name || user?.email || "sistema"
  }, user);

  return {
    ...coupon,
    html,
    pdf_ready: true,
    qr_data_url: qrDataUrl,
    document_url: links.documentUrl,
    pdf_url: links.pdfUrl
  };
}

function getCouponDocument(saleId, { mode = "" } = {}) {
  const normalizedMode = normalizeText(mode || "").toLowerCase();
  const coupon = loadCoupons().find((item) => item.sale_id === String(saleId || "").trim() && (!normalizedMode || item.mode === normalizedMode));
  if (!coupon) {
    return null;
  }
  return {
    ...coupon,
    html: fs.existsSync(coupon.html_path) ? fs.readFileSync(coupon.html_path, "utf8") : "",
    pdfBuffer: fs.existsSync(coupon.pdf_path) ? fs.readFileSync(coupon.pdf_path) : Buffer.from("")
  };
}

function buildTemplatePayload(templateKey, payload = {}) {
  const templates = getMessageTemplates();
  const factory = templates[templateKey];
  if (!factory) {
    throw new Error("Template de mensagem do PDV inválido.");
  }
  return factory(payload);
}

function queueMessage(payload = {}, user = {}) {
  const templateKey = normalizeText(payload.template || "").toUpperCase();
  if (!MESSAGE_TEMPLATE_KEYS.includes(templateKey)) {
    throw new Error("Template de mensagem do PDV inválido.");
  }
  const phone = normalizePhone(payload.phone || payload.telefone || "");
  if (!phone) {
    throw new Error("Informe um telefone válido para a fila de mensagens do PDV.");
  }
  const scheduledFor = normalizeText(payload.scheduled_for || payload.agendamento || "");
  const queue = loadMessageQueue();
  const status = scheduledFor ? "SCHEDULED" : "PENDING";
  const entry = {
    message_id: buildId("MSG"),
    type: normalizeText(payload.type || "manual").toUpperCase(),
    customer_name: normalizeText(payload.customer_name || payload.cliente || ""),
    phone,
    template: templateKey,
    status,
    scheduled_for: scheduledFor,
    payload: payload.payload || {},
    created_at: nowIso(),
    sent_at: "",
    created_by: user?.name || user?.email || "sistema",
    sale_id: normalizeText(payload.sale_id || ""),
    text: buildTemplatePayload(templateKey, payload.payload || {})
  };
  queue.unshift(entry);
  saveMessageQueue(queue);
  appendEvent("MESSAGE_SCHEDULED", { sale_id: entry.sale_id, loja: payload.loja || "" }, {
    message_id: entry.message_id,
    template: entry.template,
    status: entry.status,
    phone: entry.phone
  }, user);
  return entry;
}

function updateMessageStatus(messageId, status, user = {}) {
  const normalizedStatus = normalizeText(status || "").toUpperCase();
  if (!MESSAGE_QUEUE_STATUSES.includes(normalizedStatus)) {
    throw new Error("Status da fila de mensagens do PDV inválido.");
  }
  const queue = loadMessageQueue();
  const entry = queue.find((item) => item.message_id === String(messageId || "").trim());
  if (!entry) {
    throw new Error("Mensagem do PDV não encontrada na fila.");
  }
  entry.status = normalizedStatus;
  entry.updated_at = nowIso();
  entry.updated_by = user?.name || user?.email || "sistema";
  if (normalizedStatus === "SENT") {
    entry.sent_at = nowIso();
    appendEvent("MESSAGE_SENT", { sale_id: entry.sale_id, loja: entry.payload?.loja || "" }, {
      message_id: entry.message_id,
      template: entry.template,
      phone: entry.phone
    }, user);
    if (entry.template === "GIFT_SALE") {
      appendEvent("GIFT_SENT", { sale_id: entry.sale_id, loja: entry.payload?.loja || "" }, {
        message_id: entry.message_id,
        phone: entry.phone
      }, user);
    }
    if (entry.template === "SALE_COMPLETED") {
      appendEvent("COUPON_SENT", { sale_id: entry.sale_id, loja: entry.payload?.loja || "" }, {
        message_id: entry.message_id
      }, user);
    }
  } else {
    entry.sent_at = "";
  }
  saveMessageQueue(queue);
  return entry;
}

function registerGiftExperienceFromSale(sale, user = {}) {
  if (!sale?.gift_sale?.enabled) {
    return null;
  }
  const giftedPhone = normalizePhone(sale.gift_sale?.gifted_phone || "");
  const bonuses = loadWelcomeBonuses();
  let welcomeBonus = bonuses.find((item) => item.origin_sale_id === sale.sale_id);
  if (!welcomeBonus) {
    welcomeBonus = {
      welcome_bonus_id: buildId("WB"),
      origin_sale_id: sale.sale_id,
      source_customer_name: normalizeText(sale.customer?.name || ""),
      source_customer_phone: normalizePhone(sale.customer?.phone || ""),
      gifted_to: normalizeText(sale.gift_sale?.gifted_to || ""),
      gifted_phone: giftedPhone,
      status: "PENDING",
      created_at: nowIso(),
      created_by: user?.name || user?.email || "sistema",
      notes: "Bônus boas-vindas preparado a partir de venda presente."
    };
    bonuses.unshift(welcomeBonus);
    saveWelcomeBonuses(bonuses);
    appendEvent("WELCOME_BONUS_GRANTED", { sale_id: sale.sale_id, loja: sale.loja }, welcomeBonus, user);
  }

  let queuedMessage = null;
  if (giftedPhone) {
    const queue = loadMessageQueue();
    queuedMessage = queue.find((item) => item.sale_id === sale.sale_id && item.template === "GIFT_SALE");
    if (!queuedMessage) {
      const presentCoupon = getCouponBySaleId(sale.sale_id, { mode: "present" });
      queuedMessage = queueMessage({
        type: "gift_sale",
        customer_name: sale.gift_sale?.gifted_to || "",
        phone: giftedPhone,
        template: "GIFT_SALE",
        scheduled_for: sale.gift_sale?.send_mode === "scheduled" ? sale.gift_sale?.scheduled_for || "" : "",
        sale_id: sale.sale_id,
        loja: sale.loja,
        payload: {
          giftedTo: sale.gift_sale?.gifted_to || "",
          senderName: sale.customer?.name || "AEROSTORE",
          message: sale.gift_sale?.message || "",
          couponLink: toPublicUrl(presentCoupon?.document_url || ""),
          loja: sale.loja
        }
      }, user);
    }
  }

  return {
    welcomeBonus,
    queuedMessage
  };
}

function getExperienceSummary() {
  const coupons = loadCoupons();
  const queue = loadMessageQueue();
  const welcomeBonuses = loadWelcomeBonuses();
  return {
    metrics: {
      coupons_generated: coupons.length,
      messages_pending: queue.filter((item) => item.status === "PENDING").length,
      messages_scheduled: queue.filter((item) => item.status === "SCHEDULED").length,
      welcome_bonuses: welcomeBonuses.length
    },
    latestCoupons: coupons.slice(0, 20),
    messageQueue: queue.slice(0, 60),
    welcomeBonuses: welcomeBonuses.slice(0, 40),
    templateKeys: MESSAGE_TEMPLATE_KEYS,
    queueStatuses: MESSAGE_QUEUE_STATUSES,
    giftStatuses: GIFT_SEND_STATUSES
  };
}

module.exports = {
  MESSAGE_TEMPLATE_KEYS,
  MESSAGE_QUEUE_STATUSES,
  GIFT_SEND_STATUSES,
  getExperienceSummary,
  getMessageTemplates,
  generateCouponForSale,
  getSaleById,
  getCouponBySaleId,
  getCouponDocument,
  queueMessage,
  updateMessageStatus,
  registerGiftExperienceFromSale,
  loadMessageQueue,
  loadWelcomeBonuses
};
