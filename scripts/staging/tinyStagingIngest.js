#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DEFAULT_BASE = path.join('_tiny_exports', '2026-05-15-pre-stage-tests');

const PRODUCT_HEADERS = {
  id: 'ID',
  sku: 'Codigo (SKU)',
  descricao: 'Descricao',
  unidade: 'Unidade',
  ncm: 'Classificacao fiscal',
  origem: 'Origem',
  preco: 'Preco',
  situacao: 'Situacao',
  estoque: 'Estoque',
  custo: 'Preco de custo',
  fornecedorCodigo: 'Cod do Fornecedor',
  fornecedor: 'Fornecedor',
  localizacao: 'Localizacao',
  gtin: 'GTIN/EAN',
  categoria: 'Categoria',
  variacoes: 'Variacoes',
  marca: 'Marca',
  precoPromocional: 'Preco promocional',
  markup: 'Markup'
};

const CONTACT_HEADERS = {
  id: 'ID',
  codigo: 'Codigo',
  nome: 'Nome',
  fantasia: 'Fantasia',
  endereco: 'Endereco',
  cidade: 'Cidade',
  estado: 'Estado',
  observacoesContato: 'Observacoes do contato',
  fone: 'Fone',
  celular: 'Celular',
  email: 'E-mail',
  tipoPessoa: 'Tipo pessoa',
  documento: 'CNPJ / CPF',
  situacao: 'Situacao',
  sexo: 'Sexo',
  dataNascimento: 'Data nascimento',
  vendedor: 'Vendedor',
  limiteCredito: 'Limite de credito'
};

const SALES_HEADERS = {
  cliente: 'Cliente',
  produto: 'Produto',
  sku: 'Codigo (SKU)',
  quantidade: 'Quantidade',
  valor: 'Valor',
  frete: 'Frete',
  total: 'Total'
};

const FINANCIAL_HEADERS = {
  data: 'Data',
  numero: 'Numero',
  valorTotal: 'Valor total',
  taxas: 'Taxas',
  tarifas: 'Tarifas',
  valorLiquido: 'Valor liquido',
  formaRecebimento: 'Forma de recebimento',
  meioRecebimento: 'Meio de recebimento',
  numeroParcelas: 'Numero de parcelas',
  prazoMedio: 'Prazo medio de recebimento',
  situacao: 'Situacao'
};

const ABC_HEADERS = {
  produto: 'Produto',
  sku: 'Codigo',
  quantidade: 'Quantidade',
  valor: 'Valor',
  percentualIndividual: '% Individual',
  percentualAcumulado: '% Acumulado',
  classificacao: 'Classificacao'
};

const COLOR_KEYWORDS = [
  'PRETO', 'BRANCO', 'AZUL', 'VERMELHO', 'ROSA', 'VERDE', 'AMARELO', 'BEGE',
  'MARROM', 'LARANJA', 'ROXO', 'VINHO', 'CINZA', 'GRAFITE', 'NUDE', 'OFF',
  'CAQUI', 'AREIA', 'JEANS', 'DOURADO', 'PRATA'
];

const SIZE_PATTERNS = [
  /\b(XGG|EXG|XXG|GG|PP|P|M|G|XG)\b/i,
  /\b(34|35|36|37|38|39|40|41|42|43|44|45|46|48|50)\b/,
  /Tamanho:([^|]+)/i,
  /\b(oversized|slim)\b/i
];

function parseArgs(argv) {
  const options = { base: DEFAULT_BASE };
  for (let index = 2; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--base' && argv[index + 1]) {
      options.base = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeHeader(value) {
  const cleaned = stripAccents(value)
    .replace(/[^\w%/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

function chooseCsvEncoding(buffer) {
  const utf8 = buffer.toString('utf8');
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount > 0) {
    return 'latin1';
  }
  const suspicious = (utf8.match(/[Ã�]/g) || []).length;
  if (suspicious > 8) {
    return 'latin1';
  }
  return 'utf8';
}

function parseDelimitedLine(line, separator) {
  const values = [];
  let current = '';
  let insideQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }
    if (char === separator && !insideQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseCsvFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const encoding = chooseCsvEncoding(buffer);
  const content = buffer.toString(encoding).replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) {
    return [];
  }
  const separator = lines[0].includes(';') ? ';' : ',';
  const headers = parseDelimitedLine(lines[0], separator).map(normalizeHeader);
  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const values = parseDelimitedLine(lines[index], separator);
    const record = {};
    headers.forEach((header, headerIndex) => {
      record[header] = values[headerIndex] == null ? '' : String(values[headerIndex]).trim();
    });
    rows.push({
      rowNumber: index + 1,
      data: record
    });
  }
  return rows;
}

function parseWorkbookFile(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!matrix.length) {
    return [];
  }
  const headers = matrix[0].map(normalizeHeader);
  const rows = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const line = matrix[index];
    const hasValue = line.some((value) => String(value || '').trim() !== '');
    if (!hasValue) {
      continue;
    }
    const record = {};
    headers.forEach((header, headerIndex) => {
      record[header] = line[headerIndex] == null ? '' : String(line[headerIndex]).trim();
    });
    rows.push({
      rowNumber: index + 1,
      data: record
    });
  }
  return rows;
}

function readStructuredRows(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return parseCsvFile(filePath);
  }
  if (extension === '.xls' || extension === '.xlsx') {
    return parseWorkbookFile(filePath);
  }
  return [];
}

function getValue(row, headerName) {
  return row.data[normalizeHeader(headerName)] || '';
}

function cleanName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  const cleaned = raw
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value) {
  const parsed = parseMoney(value);
  if (parsed == null) {
    return null;
  }
  return Number(parsed);
}

function parsePercent(value) {
  const parsed = parseMoney(value);
  return parsed == null ? null : parsed;
}

function parseBrazilDate(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return '';
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function toCurrencyString(value) {
  if (value == null || !Number.isFinite(value)) {
    return '';
  }
  return value.toFixed(2);
}

function toNumberString(value) {
  if (value == null || !Number.isFinite(value)) {
    return '';
  }
  return String(value);
}

function normalizeMobile(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) {
    return '';
  }
  let normalized = digits;
  if (normalized.startsWith('0')) {
    normalized = normalized.replace(/^0+/, '');
  }
  if (normalized.startsWith('55') && (normalized.length === 12 || normalized.length === 13)) {
    return normalized;
  }
  if (normalized.length === 10 || normalized.length === 11) {
    return `55${normalized}`;
  }
  return '';
}

function isTruthyActive(value) {
  return stripAccents(String(value || '')).toUpperCase().includes('ATIVO');
}

function detectColor(...values) {
  const haystack = stripAccents(values.filter(Boolean).join(' | ')).toUpperCase();
  return COLOR_KEYWORDS.find((color) => haystack.includes(color)) || '';
}

function detectSize(...values) {
  const haystack = values.filter(Boolean).join(' | ');
  for (const pattern of SIZE_PATTERNS) {
    const match = haystack.match(pattern);
    if (match) {
      return cleanName(match[1] || match[0]);
    }
  }
  return '';
}

function inferGender(...values) {
  const haystack = stripAccents(values.filter(Boolean).join(' | ')).toUpperCase();
  if (haystack.includes('FEMIN')) return 'feminino';
  if (haystack.includes('MASCUL')) return 'masculino';
  if (haystack.includes('INFANT')) return 'infantil';
  return '';
}

function csvEscape(value) {
  const stringValue = value == null ? '' : String(value);
  if (/[;"\n\r,]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function writeCsv(filePath, columns, rows) {
  const lines = [columns.join(';')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvEscape(row[column])).join(';'));
  });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function classifyFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/downloads-produtos/') || normalized.endsWith('/tiny-produtos-lote1.xls')) {
    return 'products';
  }
  if (normalized.includes('/downloads-contatos/') || normalized.endsWith('/tiny-contatos-lote1.xlsx')) {
    return 'contacts';
  }
  if (normalized.includes('/downloads-vendas/')) {
    return 'sales';
  }
  if (normalized.includes('/downloads-financeiro/')) {
    return 'financial';
  }
  if (normalized.includes('/downloads-abc/')) {
    return 'abc';
  }
  return 'other';
}

function collectFiles(basePath) {
  const files = [];
  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    entries.forEach((entry) => {
      const resolved = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'staging-output') {
          return;
        }
        walk(resolved);
        return;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!['.csv', '.xls', '.xlsx'].includes(extension)) {
        return;
      }
      files.push(resolved);
    });
  }
  walk(basePath);
  return files;
}

function pushWarning(bucket, warning) {
  bucket.push({
    source_file: warning.source_file || '',
    row_number: warning.row_number || '',
    entity_type: warning.entity_type || '',
    reason: warning.reason || '',
    raw_data_json: JSON.stringify(warning.raw_data_json || {})
  });
}

function makeRejected(entityType, sourceFile, rowNumber, reason, rawData) {
  return {
    source_file: sourceFile,
    row_number: rowNumber,
    entity_type: entityType,
    reason,
    raw_data_json: JSON.stringify(rawData)
  };
}

function normalizeProducts(productFiles, warnings) {
  const rows = [];
  const rejected = [];
  const skuCounts = new Map();

  productFiles.forEach((filePath) => {
    const parsedRows = readStructuredRows(filePath);
    parsedRows.forEach((row) => {
      const sourceFile = path.relative(process.cwd(), filePath);
      const tinyId = getValue(row, PRODUCT_HEADERS.id);
      const sku = cleanName(getValue(row, PRODUCT_HEADERS.sku));
      const descricao = cleanName(getValue(row, PRODUCT_HEADERS.descricao));
      const categoria = cleanName(getValue(row, PRODUCT_HEADERS.categoria));
      const marca = cleanName(getValue(row, PRODUCT_HEADERS.marca));
      const unidade = cleanName(getValue(row, PRODUCT_HEADERS.unidade));
      const ncm = cleanName(getValue(row, PRODUCT_HEADERS.ncm));
      const origem = cleanName(getValue(row, PRODUCT_HEADERS.origem));
      const precoVenda = parseMoney(getValue(row, PRODUCT_HEADERS.preco));
      const precoPromocional = parseMoney(getValue(row, PRODUCT_HEADERS.precoPromocional));
      const precoCusto = parseMoney(getValue(row, PRODUCT_HEADERS.custo));
      const markup = parseMoney(getValue(row, PRODUCT_HEADERS.markup));
      const estoque = parseInteger(getValue(row, PRODUCT_HEADERS.estoque));
      const localizacao = cleanName(getValue(row, PRODUCT_HEADERS.localizacao));
      const gtin = cleanName(getValue(row, PRODUCT_HEADERS.gtin));
      const fornecedor = cleanName(getValue(row, PRODUCT_HEADERS.fornecedor));
      const situacao = cleanName(getValue(row, PRODUCT_HEADERS.situacao));
      const variacoes = cleanName(getValue(row, PRODUCT_HEADERS.variacoes));
      const color = detectColor(variacoes, descricao, categoria);
      const size = detectSize(variacoes, descricao);
      const genero = inferGender(categoria, descricao, variacoes);
      const qualityFlags = [];

      if (!descricao) qualityFlags.push('missing_name');
      if (!sku) qualityFlags.push('missing_sku');
      if (precoVenda == null) qualityFlags.push('missing_price');
      if (getValue(row, PRODUCT_HEADERS.preco) && precoVenda == null) qualityFlags.push('invalid_price');
      if (getValue(row, PRODUCT_HEADERS.estoque) && estoque == null) qualityFlags.push('invalid_stock');
      if (estoque === 0) qualityFlags.push('zero_stock');
      if (!categoria) qualityFlags.push('missing_category');
      if (variacoes) qualityFlags.push('possible_variant');

      const normalized = {
        source_file: sourceFile,
        tiny_id: tinyId,
        sku,
        descricao_original: descricao,
        nome_normalizado: descricao,
        categoria,
        marca,
        unidade,
        ncm,
        origem,
        preco_venda: toCurrencyString(precoVenda),
        preco_promocional: toCurrencyString(precoPromocional),
        preco_custo: toCurrencyString(precoCusto),
        markup: toCurrencyString(markup),
        estoque: toNumberString(estoque),
        localizacao,
        gtin_ean: gtin,
        fornecedor,
        situacao,
        variacoes_raw: variacoes,
        cor_detectada: color,
        tamanho_detectado: size,
        genero_inferido: genero,
        is_active: isTruthyActive(situacao) ? 'true' : 'false',
        has_sku: sku ? 'true' : 'false',
        has_price: precoVenda != null ? 'true' : 'false',
        has_stock: estoque != null && estoque > 0 ? 'true' : 'false',
        quality_flags: ''
      };

      rows.push({ normalized, rowNumber: row.rowNumber, rawData: row.data });
      if (sku) {
        skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
      }
      if (!descricao || !sku || qualityFlags.includes('invalid_price') || qualityFlags.includes('invalid_stock')) {
        rejected.push(makeRejected('product', sourceFile, row.rowNumber, qualityFlags.join('|') || 'review_required', row.data));
      }
    });
  });

  rows.forEach((entry) => {
    const flags = [];
    const existingFlags = entry.normalized.quality_flags ? entry.normalized.quality_flags.split('|').filter(Boolean) : [];
    flags.push(...existingFlags);
    if (!entry.normalized.sku) flags.push('missing_sku');
    if (!entry.normalized.nome_normalizado) flags.push('missing_name');
    if (!entry.normalized.categoria) flags.push('missing_category');
    if (!entry.normalized.preco_venda) flags.push('missing_price');
    if (entry.normalized.estoque === '0') flags.push('zero_stock');
    if (entry.normalized.sku && skuCounts.get(entry.normalized.sku) > 1) flags.push('duplicate_sku');
    entry.normalized.quality_flags = [...new Set(flags)].join('|');
    if (entry.normalized.quality_flags) {
      pushWarning(warnings, {
        source_file: entry.normalized.source_file,
        row_number: entry.rowNumber,
        entity_type: 'product',
        reason: entry.normalized.quality_flags,
        raw_data_json: entry.rawData
      });
    }
  });

  return {
    normalizedRows: rows.map((entry) => entry.normalized),
    rejectedRows: rejected,
    skuCounts
  };
}

function normalizeContacts(contactFiles, warnings) {
  const rows = [];
  const rejected = [];
  const mobileCounts = new Map();
  const documentCounts = new Map();

  contactFiles.forEach((filePath) => {
    const parsedRows = readStructuredRows(filePath);
    parsedRows.forEach((row) => {
      const sourceFile = path.relative(process.cwd(), filePath);
      const tinyId = cleanName(getValue(row, CONTACT_HEADERS.id));
      const codigo = cleanName(getValue(row, CONTACT_HEADERS.codigo));
      const nome = cleanName(getValue(row, CONTACT_HEADERS.nome));
      const fantasia = cleanName(getValue(row, CONTACT_HEADERS.fantasia));
      const telefone = cleanName(getValue(row, CONTACT_HEADERS.fone));
      const celular = cleanName(getValue(row, CONTACT_HEADERS.celular));
      const celularNormalizado = normalizeMobile(celular || telefone);
      const email = cleanName(getValue(row, CONTACT_HEADERS.email)).toLowerCase();
      const documento = cleanName(getValue(row, CONTACT_HEADERS.documento));
      const tipoPessoa = cleanName(getValue(row, CONTACT_HEADERS.tipoPessoa));
      const cidade = cleanName(getValue(row, CONTACT_HEADERS.cidade));
      const estado = cleanName(getValue(row, CONTACT_HEADERS.estado)).toUpperCase();
      const endereco = cleanName(getValue(row, CONTACT_HEADERS.endereco));
      const sexo = cleanName(getValue(row, CONTACT_HEADERS.sexo)).toLowerCase();
      const dataNascimento = parseBrazilDate(getValue(row, CONTACT_HEADERS.dataNascimento));
      const vendedor = cleanName(getValue(row, CONTACT_HEADERS.vendedor));
      const limiteCredito = parseMoney(getValue(row, CONTACT_HEADERS.limiteCredito));
      const situacao = cleanName(getValue(row, CONTACT_HEADERS.situacao));
      const qualityFlags = [];

      if (!nome) qualityFlags.push('missing_name');
      if (!celular && !telefone) qualityFlags.push('missing_mobile');
      if ((celular || telefone) && !celularNormalizado) qualityFlags.push('invalid_mobile');
      if (!documento) qualityFlags.push('missing_document');
      if (!isTruthyActive(situacao)) qualityFlags.push('inactive_contact');

      const normalized = {
        source_file: sourceFile,
        tiny_id: tinyId,
        codigo,
        nome,
        fantasia,
        telefone,
        celular,
        celular_normalizado: celularNormalizado,
        email,
        cpf_cnpj: documento,
        tipo_pessoa: tipoPessoa,
        cidade,
        estado,
        endereco,
        sexo,
        data_nascimento: dataNascimento,
        vendedor,
        limite_credito: toCurrencyString(limiteCredito),
        situacao,
        is_active: isTruthyActive(situacao) ? 'true' : 'false',
        has_phone: telefone || celular ? 'true' : 'false',
        has_valid_mobile: celularNormalizado ? 'true' : 'false',
        quality_flags: ''
      };

      rows.push({ normalized, rowNumber: row.rowNumber, rawData: row.data });
      if (celularNormalizado) {
        mobileCounts.set(celularNormalizado, (mobileCounts.get(celularNormalizado) || 0) + 1);
      }
      if (documento) {
        documentCounts.set(documento, (documentCounts.get(documento) || 0) + 1);
      }
      if (!nome || qualityFlags.includes('invalid_mobile')) {
        rejected.push(makeRejected('contact', sourceFile, row.rowNumber, qualityFlags.join('|') || 'review_required', row.data));
      }
    });
  });

  rows.forEach((entry) => {
    const flags = [];
    if (!entry.normalized.nome) flags.push('missing_name');
    if (!entry.normalized.telefone && !entry.normalized.celular) flags.push('missing_mobile');
    if ((entry.normalized.telefone || entry.normalized.celular) && !entry.normalized.celular_normalizado) flags.push('invalid_mobile');
    if (!entry.normalized.cpf_cnpj) flags.push('missing_document');
    if (!isTruthyActive(entry.normalized.situacao)) flags.push('inactive_contact');
    if (entry.normalized.celular_normalizado && mobileCounts.get(entry.normalized.celular_normalizado) > 1) flags.push('duplicate_mobile');
    if (entry.normalized.cpf_cnpj && documentCounts.get(entry.normalized.cpf_cnpj) > 1) flags.push('duplicate_document');
    entry.normalized.quality_flags = [...new Set(flags)].join('|');
    if (entry.normalized.quality_flags) {
      pushWarning(warnings, {
        source_file: entry.normalized.source_file,
        row_number: entry.rowNumber,
        entity_type: 'contact',
        reason: entry.normalized.quality_flags,
        raw_data_json: entry.rawData
      });
    }
  });

  return {
    normalizedRows: rows.map((entry) => entry.normalized),
    rejectedRows: rejected,
    mobileCounts,
    documentCounts
  };
}

function normalizeSales(salesFiles, warnings, productMap) {
  const rows = [];
  const rejected = [];
  let currentCustomer = '';

  salesFiles.forEach((filePath) => {
    const parsedRows = readStructuredRows(filePath);
    parsedRows.forEach((row) => {
      const sourceFile = path.relative(process.cwd(), filePath);
      const cliente = cleanName(getValue(row, SALES_HEADERS.cliente));
      const produto = cleanName(getValue(row, SALES_HEADERS.produto));
      const sku = cleanName(getValue(row, SALES_HEADERS.sku));
      const quantidade = parseInteger(getValue(row, SALES_HEADERS.quantidade));
      const valor = parseMoney(getValue(row, SALES_HEADERS.valor));
      const frete = parseMoney(getValue(row, SALES_HEADERS.frete));
      const total = parseMoney(getValue(row, SALES_HEADERS.total));

      if (cliente && !produto && !sku) {
        currentCustomer = cliente;
        return;
      }

      const effectiveCustomer = cliente || currentCustomer;
      if (!produto && !sku && quantidade == null && total == null) {
        return;
      }

      const flags = [];
      if (!effectiveCustomer) flags.push('missing_customer');
      if (!sku) flags.push('missing_sku');
      if (quantidade == null) flags.push('invalid_quantity');
      if (total == null) flags.push('invalid_total');
      if (sku && !productMap.has(sku)) flags.push('product_not_found');

      const normalized = {
        source_file: sourceFile,
        cliente: effectiveCustomer,
        produto,
        sku,
        quantidade: toNumberString(quantidade),
        valor_unitario_ou_item: toCurrencyString(valor),
        frete: toCurrencyString(frete),
        total: toCurrencyString(total),
        quality_flags: [...new Set(flags)].join('|')
      };

      rows.push({ normalized, rowNumber: row.rowNumber, rawData: row.data });
      if (flags.length) {
        pushWarning(warnings, {
          source_file: sourceFile,
          row_number: row.rowNumber,
          entity_type: 'sale',
          reason: normalized.quality_flags,
          raw_data_json: row.data
        });
        rejected.push(makeRejected('sale', sourceFile, row.rowNumber, normalized.quality_flags, row.data));
      }
    });
  });

  return {
    normalizedRows: rows.map((entry) => entry.normalized),
    rejectedRows: rejected
  };
}

function normalizeFinancial(financialFiles, warnings) {
  const rows = [];

  financialFiles.forEach((filePath) => {
    const parsedRows = readStructuredRows(filePath);
    parsedRows.forEach((row) => {
      const sourceFile = path.relative(process.cwd(), filePath);
      const data = parseBrazilDate(getValue(row, FINANCIAL_HEADERS.data));
      const numero = cleanName(getValue(row, FINANCIAL_HEADERS.numero));
      const valorTotal = parseMoney(getValue(row, FINANCIAL_HEADERS.valorTotal));
      const taxas = parseMoney(getValue(row, FINANCIAL_HEADERS.taxas));
      const tarifas = parseMoney(getValue(row, FINANCIAL_HEADERS.tarifas));
      const valorLiquido = parseMoney(getValue(row, FINANCIAL_HEADERS.valorLiquido));
      const forma = cleanName(getValue(row, FINANCIAL_HEADERS.formaRecebimento));
      const meio = cleanName(getValue(row, FINANCIAL_HEADERS.meioRecebimento));
      const parcelas = cleanName(getValue(row, FINANCIAL_HEADERS.numeroParcelas));
      const prazo = parseMoney(getValue(row, FINANCIAL_HEADERS.prazoMedio));
      const situacao = cleanName(getValue(row, FINANCIAL_HEADERS.situacao));
      const flags = [];

      if (!data) flags.push('invalid_date');
      if (valorTotal == null || taxas == null || tarifas == null || valorLiquido == null) flags.push('invalid_value');
      if (!forma && !meio) flags.push('missing_payment_method');
      if (!situacao) flags.push('missing_status');
      if (valorTotal != null && taxas != null && tarifas != null && valorLiquido != null) {
        const delta = Math.abs(valorTotal - taxas - tarifas - valorLiquido);
        if (delta > 0.05) flags.push('settlement_mismatch');
      }

      const normalized = {
        source_file: sourceFile,
        data,
        numero,
        valor_total: toCurrencyString(valorTotal),
        taxas: toCurrencyString(taxas),
        tarifas: toCurrencyString(tarifas),
        valor_liquido: toCurrencyString(valorLiquido),
        forma_recebimento: forma,
        meio_recebimento: meio,
        numero_parcelas: parcelas,
        prazo_medio_recebimento: toCurrencyString(prazo),
        situacao,
        quality_flags: [...new Set(flags)].join('|')
      };

      rows.push(normalized);
      if (normalized.quality_flags) {
        pushWarning(warnings, {
          source_file: sourceFile,
          row_number: row.rowNumber,
          entity_type: 'financial',
          reason: normalized.quality_flags,
          raw_data_json: row.data
        });
      }
    });
  });

  return { normalizedRows: rows };
}

function normalizeAbc(abcFiles, warnings, productMap) {
  const rows = [];

  abcFiles.forEach((filePath) => {
    const parsedRows = readStructuredRows(filePath);
    parsedRows.forEach((row) => {
      const sourceFile = path.relative(process.cwd(), filePath);
      const produto = cleanName(getValue(row, ABC_HEADERS.produto));
      const sku = cleanName(getValue(row, ABC_HEADERS.sku));
      const quantidade = parseInteger(getValue(row, ABC_HEADERS.quantidade));
      const valor = parseMoney(getValue(row, ABC_HEADERS.valor));
      const percentualIndividual = parsePercent(getValue(row, ABC_HEADERS.percentualIndividual));
      const percentualAcumulado = parsePercent(getValue(row, ABC_HEADERS.percentualAcumulado));
      const classificacao = cleanName(getValue(row, ABC_HEADERS.classificacao)).toUpperCase();
      const flags = [];

      if (!sku) flags.push('missing_sku');
      if (sku && !productMap.has(sku)) flags.push('product_not_found');
      if (percentualIndividual == null || percentualAcumulado == null) flags.push('invalid_percent');
      if (!['A', 'B', 'C'].includes(classificacao)) flags.push('invalid_classification');

      const normalized = {
        source_file: sourceFile,
        produto,
        sku,
        quantidade: toNumberString(quantidade),
        valor: toCurrencyString(valor),
        percentual_individual: toCurrencyString(percentualIndividual),
        percentual_acumulado: toCurrencyString(percentualAcumulado),
        classificacao,
        quality_flags: [...new Set(flags)].join('|')
      };

      rows.push(normalized);
      if (normalized.quality_flags) {
        pushWarning(warnings, {
          source_file: sourceFile,
          row_number: row.rowNumber,
          entity_type: 'abc',
          reason: normalized.quality_flags,
          raw_data_json: row.data
        });
      }
    });
  });

  return { normalizedRows: rows };
}

function buildCrosscheck(products, sales, abc) {
  const salesBySku = new Map();
  const abcBySku = new Map();
  const rows = [];

  sales.forEach((row) => {
    if (!row.sku) return;
    const current = salesBySku.get(row.sku) || { quantidade: 0, valor: 0 };
    current.quantidade += Number(row.quantidade || 0);
    current.valor += Number(row.total || 0);
    salesBySku.set(row.sku, current);
  });

  abc.forEach((row) => {
    if (!row.sku) return;
    abcBySku.set(row.sku, row);
  });

  const skuSet = new Set([
    ...products.map((row) => row.sku).filter(Boolean),
    ...sales.map((row) => row.sku).filter(Boolean),
    ...abc.map((row) => row.sku).filter(Boolean)
  ]);

  skuSet.forEach((sku) => {
    const product = products.find((row) => row.sku === sku) || null;
    const sale = salesBySku.get(sku) || { quantidade: 0, valor: 0 };
    const abcRow = abcBySku.get(sku) || null;
    const qualityFlags = [];

    if (!product) qualityFlags.push('missing_from_products');
    if (!sale.quantidade) qualityFlags.push('no_sales');
    if (!abcRow) qualityFlags.push('missing_from_abc');

    let recommendation = 'NAO';
    let reason = 'Sem dados suficientes';
    const isActive = product && product.is_active === 'true';
    const hasPrice = product && product.has_price === 'true';
    const hasSku = Boolean(product && product.has_sku === 'true');
    const hasSales = sale.quantidade > 0 || sale.valor > 0;
    const hasStock = product && Number(product.estoque || 0) > 0;
    const abcClass = abcRow ? abcRow.classificacao : '';

    if (isActive && hasPrice && hasSku && (abcClass === 'A' || abcClass === 'B' || sale.valor >= 500)) {
      recommendation = 'SIM';
      reason = abcClass ? `Classe ABC ${abcClass} com dados comerciais validos` : 'Venda relevante com cadastro ativo';
    } else if (product && isActive && hasPrice && hasSku && hasStock) {
      recommendation = 'TALVEZ';
      reason = hasSales ? 'Produto ativo com estoque e venda, mas sem forca ABC alta' : 'Produto ativo com estoque, porem ainda sem venda relevante';
    } else if (product && !isActive) {
      recommendation = 'NAO';
      reason = 'Produto inativo';
    } else if (product && !hasPrice) {
      recommendation = 'NAO';
      reason = 'Produto sem preco valido';
    } else if (product && !hasSku) {
      recommendation = 'NAO';
      reason = 'Produto sem SKU';
    } else if (!product && hasSales) {
      recommendation = 'TALVEZ';
      reason = 'Venda encontrada sem produto correspondente no catalogo normalizado';
    }

    rows.push({
      sku,
      nome_produto: product ? product.nome_normalizado : (abcRow ? abcRow.produto : ''),
      categoria: product ? product.categoria : '',
      marca: product ? product.marca : '',
      estoque: product ? product.estoque : '',
      preco_venda: product ? product.preco_venda : '',
      total_vendido_quantidade: toNumberString(sale.quantidade),
      total_vendido_valor: toCurrencyString(sale.valor),
      abc_quantidade: abcRow ? abcRow.quantidade : '',
      abc_valor: abcRow ? abcRow.valor : '',
      abc_classificacao: abcRow ? abcRow.classificacao : '',
      aparece_em_produtos: product ? 'true' : 'false',
      aparece_em_vendas: hasSales ? 'true' : 'false',
      aparece_em_abc: abcRow ? 'true' : 'false',
      recomendacao_vitrine_ia: recommendation,
      motivo_recomendacao: reason,
      quality_flags: [...new Set(qualityFlags)].join('|')
    });
  });

  return rows.sort((left, right) => left.sku.localeCompare(right.sku));
}

function buildFieldMapping() {
  return [
    '# Tiny to staging field mapping',
    '',
    '## Produtos',
    '',
    '| Tiny | Staging |',
    '| --- | --- |',
    '| ID | tiny_id |',
    '| Codigo (SKU) | sku |',
    '| Descricao | descricao_original / nome_normalizado |',
    '| Categoria | categoria |',
    '| Marca | marca |',
    '| Preco | preco_venda |',
    '| Preco promocional | preco_promocional |',
    '| Preco de custo | preco_custo |',
    '| Estoque | estoque |',
    '| Localizacao | localizacao |',
    '| GTIN/EAN | gtin_ean |',
    '| Variacoes | variacoes_raw |',
    '',
    '## Contatos',
    '',
    '| Tiny | Staging |',
    '| --- | --- |',
    '| ID | tiny_id |',
    '| Codigo | codigo |',
    '| Nome | nome |',
    '| Fantasia | fantasia |',
    '| Fone | telefone |',
    '| Celular | celular / celular_normalizado |',
    '| E-mail | email |',
    '| CNPJ / CPF | cpf_cnpj |',
    '| Tipo pessoa | tipo_pessoa |',
    '| Cidade | cidade |',
    '| Estado | estado |',
    '| Sexo | sexo |',
    '| Data nascimento | data_nascimento |',
    '| Vendedor | vendedor |',
    '',
    '## Vendas',
    '',
    '| Tiny | Staging |',
    '| --- | --- |',
    '| Cliente | cliente |',
    '| Produto | produto |',
    '| Codigo (SKU) | sku |',
    '| Quantidade | quantidade |',
    '| Valor | valor_unitario_ou_item |',
    '| Frete | frete |',
    '| Total | total |',
    '',
    '## Financeiro',
    '',
    '| Tiny | Staging |',
    '| --- | --- |',
    '| Data | data |',
    '| Numero | numero |',
    '| Valor total | valor_total |',
    '| Taxas | taxas |',
    '| Tarifas | tarifas |',
    '| Valor liquido | valor_liquido |',
    '| Forma de recebimento | forma_recebimento |',
    '| Meio de recebimento | meio_recebimento |',
    '| Numero de parcelas | numero_parcelas |',
    '| Prazo medio de recebimento | prazo_medio_recebimento |',
    '',
    '## Curva ABC',
    '',
    '| Tiny | Staging |',
    '| --- | --- |',
    '| Produto | produto |',
    '| Codigo | sku |',
    '| Quantidade | quantidade |',
    '| Valor | valor |',
    '| % Individual | percentual_individual |',
    '| % Acumulado | percentual_acumulado |',
    '| Classificacao | classificacao |',
    ''
  ].join('\n');
}

function buildImportPlan(report) {
  return [
    '# Import plan',
    '',
    'Nenhum dado foi gravado ainda. Esta stage gerou apenas artefatos de saneamento e leitura.',
    '',
    '## Importacao segura recomendada',
    '',
    '1. Revisar `products_normalized.csv` e `products_rejected.csv` antes de alimentar `ai_products` ou qualquer Vitrine IA.',
    '2. Revisar `contacts_normalized.csv`, principalmente duplicados por celular e documento, antes de qualquer merge com contatos do CRM.',
    '3. Revisar `sales_items_normalized.csv` e o crosscheck para corrigir SKUs vendidos nao encontrados no catalogo.',
    '4. Importar financeiro historico apenas para relatios estrategicos, nunca para atualizar caixa operacional automaticamente.',
    '5. Usar `abc_normalized.csv` e `product_sales_abc_crosscheck.csv` como insumo do AEROINTEL e de sugestoes de vitrine, nao como verdade definitiva sem revisao.',
    '',
    '## O que pode ser importado com mais seguranca',
    '',
    '- Produtos ativos com SKU, preco e nome validos',
    '- Curva ABC por SKU quando o produto existe no catalogo saneado',
    '- Financeiro de vendas para analise historica',
    '',
    '## O que precisa de revisao humana',
    '',
    '- Contatos com celular duplicado',
    '- Contatos sem documento ou com documento duplicado',
    '- Produtos sem SKU ou com SKU duplicado',
    '- Vendas com SKU ausente ou produto nao encontrado no catalogo',
    '',
    '## Destinos futuros sugeridos',
    '',
    '- `ai_products` / Vitrine IA: produtos normalizados e crosscheck',
    '- `contacts` / CRM: contatos normalizados e apenas apos reconciliacao',
    '- historico de vendas: vendas normalizadas e conferidas',
    '- financeiro: arquivo normalizado para dashboards estrategicos',
    '- AEROINTEL: crosscheck, ABC e historico comercial',
    '',
    '## Riscos',
    '',
    `- Duplicidade de SKU: ${report.products.duplicate_skus}`,
    `- Produtos vendidos nao encontrados no catalogo: ${report.crosscheck.products_in_sales_not_in_catalog}`,
    `- Contatos com celular duplicado: ${report.contacts.duplicate_mobile_rows}`,
    '',
    '## Ordem recomendada',
    '',
    '1. Produtos',
    '2. Crosscheck produtos x vendas x ABC',
    '3. Contatos',
    '4. Vendas historicas',
    '5. Financeiro historico',
    '',
    '## Rollback recomendado',
    '',
    '- Importar por lotes pequenos',
    '- Preservar snapshot do banco antes de qualquer gravacao futura',
    '- Guardar os arquivos de staging como camada de reaplicacao',
    '',
    '## Confirmacao',
    '',
    '- Nenhum dado foi gravado no banco nesta stage',
    '- Nenhum endpoint de importacao ou commit foi chamado',
    ''
  ].join('\n');
}

function buildQualityMarkdown(report) {
  return [
    '# Staging quality report',
    '',
    '## Resumo executivo',
    '',
    `- Arquivos lidos: ${report.files_scanned.total}`,
    `- Produtos normalizados: ${report.products.total_rows}`,
    `- Contatos normalizados: ${report.contacts.total_rows}`,
    `- Vendas normalizadas: ${report.sales.total_rows}`,
    `- Financeiro normalizado: ${report.financial.total_rows}`,
    `- Curva ABC normalizada: ${report.abc.total_rows}`,
    `- Produtos recomendados para Vitrine IA: ${report.crosscheck.recommended_for_vitrine}`,
    '',
    '## Arquivos lidos',
    '',
    `- Produtos: ${report.files_scanned.products}`,
    `- Contatos: ${report.files_scanned.contacts}`,
    `- Vendas: ${report.files_scanned.sales}`,
    `- Financeiro: ${report.files_scanned.financial}`,
    `- ABC: ${report.files_scanned.abc}`,
    '',
    '## Produtos',
    '',
    `- Total: ${report.products.total_rows}`,
    `- SKUs unicos: ${report.products.unique_skus}`,
    `- SKUs duplicados: ${report.products.duplicate_skus}`,
    `- Sem SKU: ${report.products.missing_sku}`,
    `- Sem preco: ${report.products.missing_price}`,
    `- Estoque zerado: ${report.products.zero_stock}`,
    `- Ativos: ${report.products.active}`,
    `- Inativos: ${report.products.inactive}`,
    '',
    '## Contatos',
    '',
    `- Total: ${report.contacts.total_rows}`,
    `- Celular valido: ${report.contacts.valid_mobile}`,
    `- Celular invalido: ${report.contacts.invalid_mobile}`,
    `- Linhas com celular duplicado: ${report.contacts.duplicate_mobile_rows}`,
    `- Sem documento: ${report.contacts.missing_document}`,
    '',
    '## Vendas',
    '',
    `- Total: ${report.sales.total_rows}`,
    `- Sem SKU: ${report.sales.missing_sku}`,
    `- Produtos nao encontrados: ${report.sales.products_not_found}`,
    `- Valor total: ${report.sales.total_value}`,
    '',
    '## Financeiro',
    '',
    `- Total de linhas: ${report.financial.total_rows}`,
    `- Bruto: ${report.financial.total_gross}`,
    `- Liquido: ${report.financial.total_net}`,
    `- Taxas: ${report.financial.total_fees}`,
    '',
    '## Curva ABC',
    '',
    `- Total: ${report.abc.total_rows}`,
    `- Classe A: ${report.abc.class_a}`,
    `- Classe B: ${report.abc.class_b}`,
    `- Classe C: ${report.abc.class_c}`,
    '',
    '## Cruzamento',
    '',
    `- Vendidos fora do catalogo: ${report.crosscheck.products_in_sales_not_in_catalog}`,
    `- ABC fora do catalogo: ${report.crosscheck.products_in_abc_not_in_catalog}`,
    `- Recomendados para Vitrine IA: ${report.crosscheck.recommended_for_vitrine}`,
    '',
    '## Proximos passos',
    '',
    '- Revisar arquivos em `rejected/` antes de qualquer importacao',
    '- Tratar duplicidades de SKU e celular',
    '- Nao importar ainda sem revisao humana final',
    ''
  ].join('\n');
}

function buildReadme(report) {
  return [
    '# Tiny staging output',
    '',
    'Esta pasta contem artefatos de saneamento e staging do Tiny/Olist.',
    '',
    '## Saidas geradas',
    '',
    '- `normalized/`: CSVs prontos para revisao tecnica',
    '- `reports/`: qualidade, mapeamento e plano de importacao futura',
    '- `rejected/`: linhas que pedem revisao antes de qualquer carga',
    '',
    '## Resumo',
    '',
    `- Arquivos lidos: ${report.files_scanned.total}`,
    `- Produtos normalizados: ${report.products.total_rows}`,
    `- Contatos normalizados: ${report.contacts.total_rows}`,
    `- Vendas normalizadas: ${report.sales.total_rows}`,
    '',
    '## Garantias desta stage',
    '',
    '- Nao gravou no banco',
    '- Nao chamou endpoint de importacao',
    '- Nao alterou CRM/PDV',
    '- Nao alterou Tiny/Olist',
    ''
  ].join('\n');
}

function toRawColumns(rows) {
  return rows.map((row) => ({
    source_file: row.source_file,
    row_number: row.row_number,
    entity_type: row.entity_type,
    reason: row.reason,
    raw_data_json: row.raw_data_json
  }));
}

function main() {
  const options = parseArgs(process.argv);
  const basePath = path.resolve(options.base);
  const outputPath = path.join(basePath, 'staging-output');
  const normalizedPath = path.join(outputPath, 'normalized');
  const reportsPath = path.join(outputPath, 'reports');
  const rejectedPath = path.join(outputPath, 'rejected');

  ensureDir(normalizedPath);
  ensureDir(reportsPath);
  ensureDir(rejectedPath);

  // Stage 1 Perfil Vivo and Tiny staging are read-only. Do not save back to source systems here.
  const files = collectFiles(basePath);
  const groupedFiles = {
    products: files.filter((file) => classifyFile(file) === 'products'),
    contacts: files.filter((file) => classifyFile(file) === 'contacts'),
    sales: files.filter((file) => classifyFile(file) === 'sales'),
    financial: files.filter((file) => classifyFile(file) === 'financial'),
    abc: files.filter((file) => classifyFile(file) === 'abc')
  };

  const warnings = [];
  const productsResult = normalizeProducts(groupedFiles.products, warnings);
  const productMap = new Map();
  productsResult.normalizedRows.forEach((row) => {
    if (row.sku && !productMap.has(row.sku)) {
      productMap.set(row.sku, row);
    }
  });

  const contactsResult = normalizeContacts(groupedFiles.contacts, warnings);
  const salesResult = normalizeSales(groupedFiles.sales, warnings, productMap);
  const financialResult = normalizeFinancial(groupedFiles.financial, warnings);
  const abcResult = normalizeAbc(groupedFiles.abc, warnings, productMap);
  const crosscheckRows = buildCrosscheck(productsResult.normalizedRows, salesResult.normalizedRows, abcResult.normalizedRows);

  writeCsv(
    path.join(normalizedPath, 'products_normalized.csv'),
    [
      'source_file', 'tiny_id', 'sku', 'descricao_original', 'nome_normalizado', 'categoria', 'marca', 'unidade', 'ncm',
      'origem', 'preco_venda', 'preco_promocional', 'preco_custo', 'markup', 'estoque', 'localizacao', 'gtin_ean',
      'fornecedor', 'situacao', 'variacoes_raw', 'cor_detectada', 'tamanho_detectado', 'genero_inferido', 'is_active',
      'has_sku', 'has_price', 'has_stock', 'quality_flags'
    ],
    productsResult.normalizedRows
  );

  writeCsv(
    path.join(normalizedPath, 'contacts_normalized.csv'),
    [
      'source_file', 'tiny_id', 'codigo', 'nome', 'fantasia', 'telefone', 'celular', 'celular_normalizado', 'email',
      'cpf_cnpj', 'tipo_pessoa', 'cidade', 'estado', 'endereco', 'sexo', 'data_nascimento', 'vendedor', 'limite_credito',
      'situacao', 'is_active', 'has_phone', 'has_valid_mobile', 'quality_flags'
    ],
    contactsResult.normalizedRows
  );

  writeCsv(
    path.join(normalizedPath, 'sales_items_normalized.csv'),
    ['source_file', 'cliente', 'produto', 'sku', 'quantidade', 'valor_unitario_ou_item', 'frete', 'total', 'quality_flags'],
    salesResult.normalizedRows
  );

  writeCsv(
    path.join(normalizedPath, 'financial_sales_normalized.csv'),
    [
      'source_file', 'data', 'numero', 'valor_total', 'taxas', 'tarifas', 'valor_liquido', 'forma_recebimento',
      'meio_recebimento', 'numero_parcelas', 'prazo_medio_recebimento', 'situacao', 'quality_flags'
    ],
    financialResult.normalizedRows
  );

  writeCsv(
    path.join(normalizedPath, 'abc_normalized.csv'),
    ['source_file', 'produto', 'sku', 'quantidade', 'valor', 'percentual_individual', 'percentual_acumulado', 'classificacao', 'quality_flags'],
    abcResult.normalizedRows
  );

  writeCsv(
    path.join(normalizedPath, 'product_sales_abc_crosscheck.csv'),
    [
      'sku', 'nome_produto', 'categoria', 'marca', 'estoque', 'preco_venda', 'total_vendido_quantidade', 'total_vendido_valor',
      'abc_quantidade', 'abc_valor', 'abc_classificacao', 'aparece_em_produtos', 'aparece_em_vendas', 'aparece_em_abc',
      'recomendacao_vitrine_ia', 'motivo_recomendacao', 'quality_flags'
    ],
    crosscheckRows
  );

  writeCsv(path.join(rejectedPath, 'products_rejected.csv'), ['source_file', 'row_number', 'entity_type', 'reason', 'raw_data_json'], toRawColumns(productsResult.rejectedRows));
  writeCsv(path.join(rejectedPath, 'contacts_rejected.csv'), ['source_file', 'row_number', 'entity_type', 'reason', 'raw_data_json'], toRawColumns(contactsResult.rejectedRows));
  writeCsv(path.join(rejectedPath, 'sales_rejected.csv'), ['source_file', 'row_number', 'entity_type', 'reason', 'raw_data_json'], toRawColumns(salesResult.rejectedRows));
  writeCsv(path.join(rejectedPath, 'warnings.csv'), ['source_file', 'row_number', 'entity_type', 'reason', 'raw_data_json'], warnings);

  const duplicateSkuCount = [...productsResult.skuCounts.values()].filter((count) => count > 1).length;
  const validMobileCount = contactsResult.normalizedRows.filter((row) => row.has_valid_mobile === 'true').length;
  const duplicateMobileRows = contactsResult.normalizedRows.filter((row) => row.quality_flags.includes('duplicate_mobile')).length;
  const missingDocumentCount = contactsResult.normalizedRows.filter((row) => row.quality_flags.includes('missing_document')).length;
  const invalidMobileCount = contactsResult.normalizedRows.filter((row) => row.quality_flags.includes('invalid_mobile')).length;
  const activeProducts = productsResult.normalizedRows.filter((row) => row.is_active === 'true').length;
  const inactiveProducts = productsResult.normalizedRows.length - activeProducts;
  const missingSkuCount = productsResult.normalizedRows.filter((row) => row.quality_flags.includes('missing_sku')).length;
  const missingPriceCount = productsResult.normalizedRows.filter((row) => row.quality_flags.includes('missing_price')).length;
  const zeroStockCount = productsResult.normalizedRows.filter((row) => row.quality_flags.includes('zero_stock')).length;
  const salesMissingSku = salesResult.normalizedRows.filter((row) => row.quality_flags.includes('missing_sku')).length;
  const salesNotFound = salesResult.normalizedRows.filter((row) => row.quality_flags.includes('product_not_found')).length;
  const salesTotalValue = salesResult.normalizedRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const grossTotal = financialResult.normalizedRows.reduce((sum, row) => sum + Number(row.valor_total || 0), 0);
  const netTotal = financialResult.normalizedRows.reduce((sum, row) => sum + Number(row.valor_liquido || 0), 0);
  const feeTotal = financialResult.normalizedRows.reduce((sum, row) => sum + Number(row.taxas || 0) + Number(row.tarifas || 0), 0);
  const classACount = abcResult.normalizedRows.filter((row) => row.classificacao === 'A').length;
  const classBCount = abcResult.normalizedRows.filter((row) => row.classificacao === 'B').length;
  const classCCount = abcResult.normalizedRows.filter((row) => row.classificacao === 'C').length;
  const productsInAbcNotCatalog = abcResult.normalizedRows.filter((row) => row.quality_flags.includes('product_not_found')).length;
  const recommendedCount = crosscheckRows.filter((row) => row.recomendacao_vitrine_ia === 'SIM').length;

  const report = {
    generated_at: new Date().toISOString(),
    base_path: basePath,
    files_scanned: {
      total: files.length,
      products: groupedFiles.products.length,
      contacts: groupedFiles.contacts.length,
      sales: groupedFiles.sales.length,
      financial: groupedFiles.financial.length,
      abc: groupedFiles.abc.length
    },
    products: {
      total_rows: productsResult.normalizedRows.length,
      unique_skus: new Set(productsResult.normalizedRows.map((row) => row.sku).filter(Boolean)).size,
      duplicate_skus: duplicateSkuCount,
      missing_sku: missingSkuCount,
      missing_price: missingPriceCount,
      zero_stock: zeroStockCount,
      active: activeProducts,
      inactive: inactiveProducts
    },
    contacts: {
      total_rows: contactsResult.normalizedRows.length,
      valid_mobile: validMobileCount,
      invalid_mobile: invalidMobileCount,
      duplicate_mobile_rows: duplicateMobileRows,
      missing_document: missingDocumentCount
    },
    sales: {
      total_rows: salesResult.normalizedRows.length,
      missing_sku: salesMissingSku,
      products_not_found: salesNotFound,
      total_value: Number(salesTotalValue.toFixed(2))
    },
    financial: {
      total_rows: financialResult.normalizedRows.length,
      total_gross: Number(grossTotal.toFixed(2)),
      total_net: Number(netTotal.toFixed(2)),
      total_fees: Number(feeTotal.toFixed(2))
    },
    abc: {
      total_rows: abcResult.normalizedRows.length,
      class_a: classACount,
      class_b: classBCount,
      class_c: classCCount
    },
    crosscheck: {
      products_in_sales_not_in_catalog: salesNotFound,
      products_in_abc_not_in_catalog: productsInAbcNotCatalog,
      recommended_for_vitrine: recommendedCount
    },
    warnings: warnings.slice(0, 50).map((warning) => `${warning.entity_type}:${warning.reason}`)
  };

  writeJson(path.join(reportsPath, 'staging_quality_report.json'), report);
  writeText(path.join(reportsPath, 'staging_quality_report.md'), buildQualityMarkdown(report));
  writeText(path.join(reportsPath, 'field_mapping.md'), buildFieldMapping());
  writeText(path.join(reportsPath, 'import_plan.md'), buildImportPlan(report));
  writeText(path.join(outputPath, 'README.md'), buildReadme(report));

  console.log(JSON.stringify({
    outputPath,
    filesScanned: report.files_scanned,
    normalized: {
      products: report.products.total_rows,
      contacts: report.contacts.total_rows,
      sales: report.sales.total_rows,
      financial: report.financial.total_rows,
      abc: report.abc.total_rows,
      crosscheck: crosscheckRows.length
    }
  }, null, 2));
}

main();
