const fs = require('fs');
const path = require('path');
const { all } = require('../db');
const { blockProduction, warnLocalOnly } = require('./scriptSafety');

blockProduction('export-hot-customers-all-contacts.js');
warnLocalOnly('export-hot-customers-all-contacts.js');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  return digits.length > 11 ? digits.slice(-11) : digits;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(toNumber(value));
}

function daysSince(dateValue) {
  const value = String(dateValue || '').trim();
  if (!value) return null;
  const date = new Date(value);
  const end = new Date('2026-05-16T12:00:00-03:00');
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((end.getTime() - date.getTime()) / 86400000);
}

function scoreSpend(total) {
  if (total >= 20000) return 38;
  if (total >= 12000) return 32;
  if (total >= 8000) return 28;
  if (total >= 5000) return 22;
  if (total >= 3000) return 16;
  if (total >= 1500) return 10;
  if (total > 0) return 5;
  return 0;
}

function scoreTicket(ticket) {
  if (ticket >= 2500) return 12;
  if (ticket >= 1500) return 9;
  if (ticket >= 900) return 6;
  if (ticket >= 400) return 3;
  return 0;
}

function scoreFrequency(itemsCount) {
  if (itemsCount >= 12) return 16;
  if (itemsCount >= 8) return 13;
  if (itemsCount >= 5) return 9;
  if (itemsCount >= 3) return 6;
  if (itemsCount >= 1) return 2;
  return 0;
}

function scoreRecency(days) {
  if (days == null) return 0;
  if (days <= 15) return 20;
  if (days <= 30) return 16;
  if (days <= 60) return 12;
  if (days <= 90) return 8;
  if (days <= 180) return 4;
  return 0;
}

function scoreAbc(abc) {
  const value = String(abc || '').toUpperCase();
  if (value === 'A') return 10;
  if (value === 'B') return 6;
  if (value === 'C') return 2;
  return 0;
}

function scoreCashback(value) {
  if (value >= 800) return 40;
  if (value >= 500) return 34;
  if (value >= 300) return 28;
  if (value >= 150) return 20;
  if (value >= 80) return 14;
  if (value >= 30) return 8;
  if (value > 0) return 4;
  return 0;
}

function scoreStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'ativo') return 4;
  return 0;
}

function labelHeat(score) {
  if (score >= 70) return 'muito quente';
  if (score >= 52) return 'quente';
  if (score >= 36) return 'morno';
  return 'frio';
}

function isGenericName(name) {
  const value = normalizeName(name);
  return (
    !value ||
    value === 'CLIENTE' ||
    value === 'CONSUMIDOR FINAL' ||
    value === 'N A' ||
    value === 'WHATSAPP' ||
    /^\d+$/.test(value)
  );
}

function nameQualityScore(name) {
  const value = normalizeName(name);
  if (!value) return -10;
  let score = 0;
  if (value.includes(' CLIENTE')) score -= 3;
  if (value.includes('CURRICULO')) score -= 3;
  if (value.includes('TELEGRAM')) score -= 2;
  if (value.includes('WHATSAPP')) score -= 2;
  if (value.includes('ANIVERSARIANTE')) score -= 1;
  if (value.includes('LOJA')) score -= 1;
  if (value.length >= 8) score += 1;
  return score;
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    throw new Error('Uso: node scripts/export-hot-customers-all-contacts.js <saida.txt>');
  }

  const [contacts, profiles, ledger] = await Promise.all([
    all(`
      SELECT
        id, name, phone, mobile, mobile_normalized, cashback, average_ticket, last_purchase_at,
        preferred_store, preferred_seller, status
      FROM contacts
      WHERE COALESCE(deleted_at, '') = ''
        AND LOWER(COALESCE(status, '')) <> 'deleted'
        AND COALESCE(mobile_normalized, mobile, phone, '') <> ''
    `),
    all(`
      SELECT
        customer_key, customer_name, total_spent, average_ticket, purchase_items_count, last_seen_at, abc_class
      FROM commercial_customer_profile
    `),
    all(`
      SELECT
        customer_name_snapshot, customer_phone_snapshot, status, balance_amount, amount, used_amount
      FROM customer_cashback_ledger
      WHERE COALESCE(deleted_at, '') = ''
    `),
  ]);
  const sales = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'pdv', 'sales', 'sales.json'), 'utf8')
  );

  const profileByName = new Map();
  for (const profile of profiles) {
    const key = normalizeName(profile.customer_name);
    if (!key) continue;
    const current = profileByName.get(key);
    if (!current || toNumber(profile.total_spent) > toNumber(current.total_spent)) {
      profileByName.set(key, profile);
    }
  }

  const cashbackByPhone = new Map();
  for (const entry of ledger) {
    const phone = normalizePhone(entry.customer_phone_snapshot);
    if (!phone) continue;
    const current = cashbackByPhone.get(phone) || { available: 0, pending: 0, used: 0 };
    const status = String(entry.status || '').toUpperCase();
    const balance = toNumber(entry.balance_amount || entry.amount);
    if (status === 'AVAILABLE') current.available += balance;
    if (status === 'PENDING') current.pending += balance;
    current.used += toNumber(entry.used_amount);
    cashbackByPhone.set(phone, current);
  }

  const salesByPhone = new Map();
  for (const sale of sales) {
    const phone = normalizePhone(
      sale?.customer_snapshot?.phone ||
      sale?.customer?.phone ||
      sale?.customer_phone ||
      ''
    );
    if (!phone) continue;
    const current = salesByPhone.get(phone) || {
      total: 0,
      count: 0,
      lastAt: '',
      cashbackUsed: 0,
      cashbackGenerated: 0,
    };
    current.total += toNumber(sale?.totals?.grand_total || sale?.totals?.total || sale?.summary?.grand_total || 0);
    current.count += 1;
    current.cashbackUsed += toNumber(sale?.cashback_application?.amount || sale?.summary?.cashback_used || 0);
    current.cashbackGenerated += toNumber(sale?.cashback_generated?.amount || sale?.summary?.cashback_generated || 0);
    const dateValue = sale?.completed_at || sale?.updated_at || sale?.created_at || '';
    if (dateValue && (!current.lastAt || dateValue > current.lastAt)) {
      current.lastAt = dateValue;
    }
    salesByPhone.set(phone, current);
  }

  const dedupedByPhone = new Map();
  for (const contact of contacts) {
    const phone = normalizePhone(contact.mobile_normalized || contact.mobile || contact.phone);
    if (!phone) continue;
    const scoreBase = toNumber(contact.average_ticket) + toNumber(contact.cashback);
    const current = dedupedByPhone.get(phone);
    const currentScoreBase = current ? toNumber(current.average_ticket) + toNumber(current.cashback) : -1;
    if (
      !current ||
      scoreBase > currentScoreBase ||
      toNumber(contact.cashback) > toNumber(current.cashback) ||
      nameQualityScore(contact.name) > nameQualityScore(current.name) ||
      (isGenericName(current.name) && !isGenericName(contact.name))
    ) {
      dedupedByPhone.set(phone, { ...contact, _phone: phone });
    }
  }

  const ranked = Array.from(dedupedByPhone.values())
    .filter((contact) => !isGenericName(contact.name))
    .map((contact) => {
    const profile = profileByName.get(normalizeName(contact.name)) || {};
    const cashback = cashbackByPhone.get(contact._phone) || {};
    const salesStats = salesByPhone.get(contact._phone) || {};
    const totalSpent = Math.max(toNumber(profile.total_spent), toNumber(salesStats.total));
    const averageTicket = Math.max(
      toNumber(contact.average_ticket),
      toNumber(profile.average_ticket),
      toNumber(salesStats.count) ? toNumber(salesStats.total) / toNumber(salesStats.count) : 0
    );
    const purchaseItems = Math.max(toNumber(profile.purchase_items_count), toNumber(salesStats.count));
    const lastPurchaseAt = contact.last_purchase_at || profile.last_seen_at || salesStats.lastAt || '';
    const recencyDays = daysSince(lastPurchaseAt);
    const abcClass = profile.abc_class || '';
    const cashbackAvailable = Math.max(toNumber(contact.cashback), toNumber(cashback.available));
    const cashbackPending = toNumber(cashback.pending);
    const hasStrongCommercialSignal =
      totalSpent > 0 || averageTicket > 0 || purchaseItems > 0 || recencyDays != null;
    const score =
      scoreSpend(totalSpent) +
      scoreTicket(averageTicket) +
      scoreFrequency(purchaseItems) +
      scoreRecency(recencyDays) +
      (hasStrongCommercialSignal ? scoreAbc(abcClass) : 0) +
      scoreCashback(cashbackAvailable) +
      scoreStatus(contact.status);

    const reasons = [
      totalSpent ? `${money(totalSpent)} comprado` : '',
      averageTicket ? `ticket ${money(averageTicket)}` : '',
      purchaseItems ? `${purchaseItems} itens/compras` : '',
      recencyDays != null ? `ultima compra ha ${recencyDays} dias` : '',
      abcClass ? `ABC ${abcClass}` : '',
      cashbackAvailable ? `cashback ${money(cashbackAvailable)}` : '',
      cashbackPending ? `pendente ${money(cashbackPending)}` : '',
      contact.preferred_store ? `loja ${contact.preferred_store}` : '',
    ].filter(Boolean).slice(0, 5).join(' | ');

    return {
      name: contact.name,
      phone: contact.mobile_normalized || contact.mobile || contact.phone,
      score,
      heat: labelHeat(score),
      reasons,
      totalSpent,
      averageTicket,
      purchaseItems,
      cashbackAvailable,
      recencyDays: recencyDays == null ? 9999 : recencyDays,
    };
    });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.cashbackAvailable !== a.cashbackAvailable) return b.cashbackAvailable - a.cashbackAvailable;
    if (b.totalSpent !== a.totalSpent) return b.totalSpent - a.totalSpent;
    if (a.recencyDays !== b.recencyDays) return a.recencyDays - b.recencyDays;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  const top300 = ranked.slice(0, 300);
  const lines = [
    'AEROSTORE - TOP 300 CLIENTES QUENTES',
    'Data da analise: 2026-05-16',
    'Base: contacts + commercial_customer_profile + customer_cashback_ledger',
    'Criterios: recencia, gasto acumulado, ticket medio, classe ABC, frequencia e cashback',
    '',
  ];

  top300.forEach((row, index) => {
    lines.push(
      `${String(index + 1).padStart(3, '0')}. ${row.name} | ${row.phone} | score ${row.score} | ${row.heat} | ${row.reasons}`
    );
  });

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
