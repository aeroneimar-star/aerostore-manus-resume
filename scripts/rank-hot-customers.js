const fs = require('fs');
const path = require('path');
const { blockProduction, warnLocalOnly } = require('./scriptSafety');

blockProduction('rank-hot-customers.js');
warnLocalOnly('rank-hot-customers.js');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length > 11) return digits.slice(-11);
  return digits;
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

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function daysBetween(a, b) {
  const start = new Date(a);
  const end = new Date(b);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diff = end.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(safeNumber(value));
}

function buildReasonList(parts) {
  return parts.filter(Boolean).slice(0, 5).join(' | ');
}

function scoreSpend(total) {
  if (total >= 15000) return 35;
  if (total >= 10000) return 30;
  if (total >= 7000) return 26;
  if (total >= 5000) return 22;
  if (total >= 3000) return 18;
  if (total >= 1500) return 12;
  if (total >= 700) return 8;
  if (total > 0) return 4;
  return 0;
}

function scoreFrequency(count) {
  if (count >= 10) return 18;
  if (count >= 7) return 15;
  if (count >= 5) return 12;
  if (count >= 3) return 8;
  if (count >= 2) return 5;
  if (count >= 1) return 2;
  return 0;
}

function scoreRecency(days) {
  if (days == null) return 0;
  if (days <= 15) return 20;
  if (days <= 30) return 16;
  if (days <= 60) return 12;
  if (days <= 90) return 9;
  if (days <= 180) return 5;
  if (days <= 365) return 2;
  return 0;
}

function scoreAbc(abcClass) {
  const normalized = String(abcClass || '').trim().toUpperCase();
  if (normalized === 'A') return 12;
  if (normalized === 'B') return 7;
  if (normalized === 'C') return 3;
  return 0;
}

function scoreCashback(balance) {
  if (balance >= 150) return 8;
  if (balance >= 80) return 6;
  if (balance >= 30) return 4;
  if (balance > 0) return 2;
  return 0;
}

function scorePriority(priority) {
  const normalized = String(priority || '').trim().toLowerCase();
  if (normalized === 'strategic') return 7;
  if (normalized === 'high') return 4;
  if (normalized === 'medium') return 2;
  return 0;
}

function classifyHeat(score) {
  if (score >= 70) return 'muito quente';
  if (score >= 50) return 'quente';
  if (score >= 35) return 'morno';
  return 'frio';
}

function parseInput(rawText) {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        return {
          raw_name: parts[0].trim(),
          raw_phone: parts[1].trim(),
        };
      }
      const match = line.match(/^(.*?)(\d{10,})$/);
      if (match) {
        return {
          raw_name: match[1].trim(),
          raw_phone: match[2].trim(),
        };
      }
      return null;
    })
    .filter(Boolean);
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    throw new Error('Uso: node scripts/rank-hot-customers.js <input.txt> <output.txt>');
  }

  const rootDir = path.resolve(__dirname, '..');
  const today = '2026-05-16';
  const rawText = fs.readFileSync(inputPath, 'utf8');
  const providedCustomers = parseInput(rawText);

  const masterCustomers = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'imports', 'pdv', 'consolidation', 'master-customers.json'), 'utf8')
  );
  const sales = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'pdv', 'sales', 'sales.json'), 'utf8')
  );
  const cashbackLedger = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'pdv', 'sales', 'cashback-ledger.json'), 'utf8')
  );

  const masterByPhone = new Map();
  const masterByName = new Map();
  for (const customer of safeArray(masterCustomers)) {
    const phones = safeArray(customer.phones).concat(customer.phone || []);
    for (const phone of phones) {
      const key = normalizePhone(phone);
      if (key && !masterByPhone.has(key)) {
        masterByPhone.set(key, customer);
      }
    }
    const nameKey = normalizeName(customer.name);
    if (nameKey && !masterByName.has(nameKey)) {
      masterByName.set(nameKey, customer);
    }
  }

  const salesByPhone = new Map();
  for (const sale of safeArray(sales)) {
    const phone = normalizePhone(sale?.customer_snapshot?.phone || sale?.customer?.phone || sale?.customer_phone || '');
    if (!phone) continue;
    const bucket = salesByPhone.get(phone) || {
      sales_count: 0,
      total_amount: 0,
      last_sale_at: '',
      cashback_generated: 0,
      cashback_used: 0,
    };
    bucket.sales_count += 1;
    bucket.total_amount += safeNumber(sale?.totals?.grand_total || sale?.totals?.total || sale?.summary?.grand_total || sale?.total_amount);
    bucket.cashback_generated += safeNumber(sale?.cashback_generated?.amount || sale?.summary?.cashback_generated);
    bucket.cashback_used += safeNumber(sale?.cashback_application?.amount || sale?.summary?.cashback_used || sale?.cashback_used_amount);
    const saleDate = sale?.completed_at || sale?.updated_at || sale?.created_at || sale?.sale_date || '';
    if (saleDate && (!bucket.last_sale_at || saleDate > bucket.last_sale_at)) {
      bucket.last_sale_at = saleDate;
    }
    salesByPhone.set(phone, bucket);
  }

  const cashbackByPhone = new Map();
  for (const entry of safeArray(cashbackLedger)) {
    const phone = normalizePhone(entry.customer_phone || entry.phone || '');
    if (!phone) continue;
    const bucket = cashbackByPhone.get(phone) || {
      available: 0,
      pending: 0,
      used: 0,
    };
    const status = String(entry.status || '').toUpperCase();
    const remaining = safeNumber(entry.remaining_amount ?? entry.balance_amount ?? entry.amount);
    if (status === 'AVAILABLE') bucket.available += remaining;
    if (status === 'PENDING') bucket.pending += remaining;
    bucket.used += safeNumber(entry.used_amount);
    cashbackByPhone.set(phone, bucket);
  }

  const ranked = providedCustomers.map((candidate) => {
    const phoneKey = normalizePhone(candidate.raw_phone);
    const nameKey = normalizeName(candidate.raw_name);
    const master = masterByPhone.get(phoneKey) || masterByName.get(nameKey) || null;
    const saleStats = salesByPhone.get(phoneKey) || null;
    const cashback = cashbackByPhone.get(phoneKey) || null;

    const totalSpent = safeNumber(master?.total_comprado) || safeNumber(saleStats?.total_amount);
    const purchaseCount = safeNumber(master?.quantidade_compras) || safeNumber(saleStats?.sales_count);
    const averageTicket = safeNumber(master?.ticket_medio) || (purchaseCount ? totalSpent / purchaseCount : 0);
    const lastPurchaseAt = master?.ultima_compra || saleStats?.last_sale_at || '';
    const daysSinceLastPurchase =
      safeNumber(master?.dias_desde_ultima_compra) || daysBetween(lastPurchaseAt, today);
    const abcClass = master?.classe_abc || '';
    const cashbackAvailable = safeNumber(master?.saldo_cashback) + safeNumber(cashback?.available);
    const cashbackPending = safeNumber(cashback?.pending);
    const score =
      scoreSpend(totalSpent) +
      scoreFrequency(purchaseCount) +
      scoreRecency(daysSinceLastPurchase) +
      scoreAbc(abcClass) +
      scoreCashback(cashbackAvailable) +
      scorePriority(master?.customer_priority);

    const reasons = buildReasonList([
      totalSpent ? `${formatMoney(totalSpent)} comprado` : '',
      purchaseCount ? `${purchaseCount} compras` : '',
      averageTicket ? `ticket ${formatMoney(averageTicket)}` : '',
      daysSinceLastPurchase != null && Number.isFinite(daysSinceLastPurchase)
        ? `ultima compra ha ${daysSinceLastPurchase} dias`
        : '',
      abcClass ? `ABC ${abcClass}` : '',
      cashbackAvailable ? `cashback ${formatMoney(cashbackAvailable)}` : '',
      cashbackPending ? `pendente ${formatMoney(cashbackPending)}` : '',
      master?.loja_favorita ? `loja ${master.loja_favorita}` : '',
    ]);

    return {
      name: candidate.raw_name,
      phone: candidate.raw_phone,
      phoneKey,
      score,
      heat: classifyHeat(score),
      reasons,
      totalSpent,
      purchaseCount,
      averageTicket,
      lastPurchaseAt,
      abcClass,
      cashbackAvailable,
      matched: Boolean(master || saleStats || cashback),
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.totalSpent !== a.totalSpent) return b.totalSpent - a.totalSpent;
    if (b.purchaseCount !== a.purchaseCount) return b.purchaseCount - a.purchaseCount;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  const selected = ranked.slice(0, 300);
  const lines = [];
  lines.push('AEROSTORE - TOP 300 CLIENTES QUENTES');
  lines.push('Data da analise: 2026-05-16');
  lines.push('Base usada: consolidacao PDV + vendas PDV + cashback operacional');
  lines.push('Criterios: recencia, volume comprado, frequencia, ABC, ticket medio e saldo de cashback');
  lines.push('');

  selected.forEach((customer, index) => {
    lines.push(
      `${String(index + 1).padStart(3, '0')}. ${customer.name} | ${customer.phone} | score ${customer.score} | ${customer.heat} | ${customer.reasons || 'sem sinal forte local'}`
    );
  });

  lines.push('');
  lines.push(`Cobertura com algum dado local: ${ranked.filter((item) => item.matched).length} de ${ranked.length}`);
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

main();
