#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE = path.join('_tiny_exports', '2026-05-15-pre-stage-tests', 'staging-output');
const DEFAULT_TOP = 300;

const CATEGORY_BUCKETS = [
  { file: 'camisetas.csv', patterns: [/camiseta/i, /\btee\b/i, /t-shirt/i, /blusa basica/i] },
  { file: 'calcas.csv', patterns: [/calca/i, /jeans/i, /bermuda/i, /short/i, /saia/i] },
  { file: 'perfumes.csv', patterns: [/perfume/i, /fragrancia/i, /deo col/i, /colonia/i] },
  { file: 'calcados.csv', patterns: [/tenis/i, /sapato/i, /chinelo/i, /sandalia/i, /bota/i] },
  { file: 'acessorios.csv', patterns: [/bolsa/i, /bone/i, /carteira/i, /oculos/i, /cinto/i, /acessorio/i] }
];

function parseArgs(argv) {
  const options = { base: DEFAULT_BASE, top: DEFAULT_TOP };
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--base' && argv[index + 1]) {
      options.base = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === '--top' && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.top = Math.floor(parsed);
      }
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

function normalizeKey(value) {
  return stripAccents(String(value || ''))
    .replace(/[^\w%/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function parseCsv(filePath) {
  const buffer = fs.readFileSync(filePath);
  const encoding = chooseCsvEncoding(buffer);
  const content = buffer.toString(encoding).replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return [];
  const separator = lines[0].includes(';') ? ';' : ',';
  const headers = parseDelimitedLine(lines[0], separator).map(normalizeKey);
  return lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, separator);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] == null ? '' : String(values[index]).trim();
    });
    return row;
  });
}

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo obrigatorio nao encontrado: ${filePath}`);
  }
}

function getValue(row, header) {
  return row[normalizeKey(header)] || '';
}

function toNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let cleaned = raw
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '');
  if (cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberString(value) {
  if (value == null || !Number.isFinite(value)) return '';
  return value.toFixed(2);
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeDisplayText(value) {
  let text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  text = text.replace(/\b([A-Z]{2,})(\d{2,})\b/g, '$1 $2');
  const withoutNoise = text
    .replace(/\b(COD|SKU|REF|ITEM)\b[:\-]?\s*\w+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return titleCase(withoutNoise || text);
}

function detectGender(...values) {
  const haystack = stripAccents(values.filter(Boolean).join(' ')).toUpperCase();
  if (haystack.includes('UNISSEX')) return 'unissex';
  if (haystack.includes('FEMIN')) return 'feminino';
  if (haystack.includes('MASCUL')) return 'masculino';
  if (haystack.includes('INFANT')) return 'infantil';
  return 'indefinido';
}

function detectColor(...values) {
  const source = stripAccents(values.filter(Boolean).join(' ')).toUpperCase();
  const colors = [
    'OFF WHITE', 'PRETO', 'BRANCO', 'AMARELO', 'AZUL', 'VERDE', 'VERMELHO', 'ROSA',
    'BEGE', 'CINZA', 'MARROM', 'NUDE', 'LARANJA', 'ROXO', 'LILAS', 'CANARIO', 'MILITAR',
    'DOURADO', 'PRATA', 'VINHO', 'GRAFITE'
  ];
  return colors.find((color) => source.includes(color)) || '';
}

function detectSize(...values) {
  const source = values.filter(Boolean).join(' ');
  const patterns = [
    /\b(PP|P|M|G|GG|XG|XGG|EXG)\b/i,
    /\b(10A|12A|14A|16A|18A)\b/i,
    /\b(34|35|36|37|38|39|40|41|42|43|44|45|46)\b/,
    /Tamanho:([^|]+)/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return String(match[1] || match[0]).trim().toUpperCase();
    }
  }
  return '';
}

function inferCategoryBucket(category, name) {
  const haystack = `${category} ${name}`;
  for (const bucket of CATEGORY_BUCKETS) {
    if (bucket.patterns.some((pattern) => pattern.test(haystack))) {
      return bucket.file;
    }
  }
  return '';
}

function summarizeFlags(flags) {
  return [...new Set(flags.filter(Boolean))].join('|');
}

function parseFlags(value) {
  return String(value || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isCriticalFlag(flag) {
  return ['missing_sku', 'missing_price', 'invalid_price', 'invalid_stock', 'missing_name'].includes(flag);
}

function buildCommercialName(row) {
  const source = row.nome_produto || row.nome_normalizado || '';
  const normalized = normalizeDisplayText(source);
  return normalized || normalizeDisplayText(source);
}

function buildTags(candidate) {
  const tags = [];
  const add = (value) => {
    if (!value) return;
    const clean = stripAccents(String(value).toLowerCase()).replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
    if (clean) tags.push(clean);
  };

  add(candidate.categoria.split('>').pop());
  add(candidate.genero_inferido !== 'indefinido' ? candidate.genero_inferido : '');
  add(candidate.cor_detectada);
  add(candidate.tamanho_detectado);
  add(candidate.marca);
  if (candidate.abc_classificacao) add(`abc-${candidate.abc_classificacao.toLowerCase()}`);
  if (Number(candidate.total_vendido_quantidade || 0) > 0) add('mais-vendido');
  if (Number(candidate.estoque || 0) > 0) add('estoque-disponivel');
  return [...new Set(tags)].join(', ');
}

function buildShortDescription(candidate) {
  const baseCategory = candidate.categoria
    ? titleCase(String(candidate.categoria).split('>').pop().trim())
    : 'Produto';
  const colorPart = candidate.cor_detectada ? ` ${candidate.cor_detectada.toLowerCase()}` : '';
  const brandPart = candidate.marca ? ` da ${titleCase(candidate.marca)}` : '';
  return `${baseCategory}${colorPart} com proposta ${candidate.genero_inferido === 'feminino' ? 'elegante' : 'casual'}${brandPart}.`;
}

function buildSalesArgument(candidate) {
  if (candidate.abc_classificacao === 'A') {
    return 'Item com bom giro comercial e forte potencial para vitrine orientada por IA.';
  }
  if (Number(candidate.total_vendido_quantidade || 0) > 2) {
    return 'Boa opcao para destacar um produto que ja demonstrou interesse comercial na base historica.';
  }
  return 'Opcao promissora para vitrine, com base suficiente para revisao comercial antes da carga.';
}

function computeCandidate(row, productLookup, duplicateSkuSet) {
  const sku = getValue(row, 'sku');
  const product = productLookup.get(sku) || null;
  const qualityFlags = [
    ...parseFlags(getValue(row, 'quality_flags')),
    ...parseFlags(product ? product.quality_flags : '')
  ];

  const estoque = toNumber(getValue(row, 'estoque'));
  const preco = toNumber(getValue(row, 'preco_venda'));
  const totalVendidoQuantidade = toNumber(getValue(row, 'total_vendido_quantidade')) || 0;
  const totalVendidoValor = toNumber(getValue(row, 'total_vendido_valor')) || 0;
  const abcClassificacao = getValue(row, 'abc_classificacao');
  const productName = getValue(row, 'nome_produto') || (product ? product.nome_normalizado : '');
  const categoria = getValue(row, 'categoria') || (product ? product.categoria : '');
  const marca = getValue(row, 'marca') || (product ? product.marca : '');
  const isActive = product ? product.is_active === 'true' : false;
  const genero = product ? product.genero_inferido || detectGender(categoria, productName) : detectGender(categoria, productName);
  const cor = product ? product.cor_detectada || detectColor(productName, categoria) : detectColor(productName, categoria);
  const tamanho = product ? product.tamanho_detectado || detectSize(productName, categoria) : detectSize(productName, categoria);

  let score = 0;
  const positives = [];
  const negatives = [];

  const addPositive = (points, reason) => {
    score += points;
    positives.push(`${points}:${reason}`);
  };
  const addNegative = (points, reason) => {
    score += points;
    negatives.push(`${points}:${reason}`);
  };

  if (abcClassificacao === 'A') addPositive(25, 'abc_a');
  if (abcClassificacao === 'B') addPositive(15, 'abc_b');
  if (getValue(row, 'aparece_em_vendas') === 'true') addPositive(10, 'appears_in_sales');
  if (totalVendidoQuantidade > 0) addPositive(10, 'sold_quantity');
  if (totalVendidoValor > 0) addPositive(10, 'sold_value');
  if ((estoque || 0) > 0) addPositive(10, 'stock_positive');
  if ((preco || 0) > 0) addPositive(10, 'valid_price');
  if (categoria) addPositive(5, 'category_present');
  if (marca) addPositive(5, 'brand_present');
  if (sku) addPositive(5, 'valid_sku');
  if (isActive) addPositive(5, 'active_product');

  if (!sku) addNegative(-30, 'missing_sku');
  if (!preco || preco <= 0) addNegative(-30, 'missing_price');
  if (!isActive) addNegative(-25, 'inactive_product');
  if (!estoque || estoque <= 0) addNegative(-20, 'zero_stock');
  if (!productName || productName.length < 5) addNegative(-20, 'bad_name');
  if (!categoria) addNegative(-15, 'missing_category');
  if (duplicateSkuSet.has(sku)) addNegative(-10, 'duplicate_sku');
  if (qualityFlags.some(isCriticalFlag)) addNegative(-10, 'critical_quality_flags');

  if (score < 0) score = 0;
  if (score > 100) score = 100;

  const needsNameReview = !buildCommercialName({ nome_produto: productName }) || /^(produto|item)$/i.test(buildCommercialName({ nome_produto: productName }));
  const needsAttributeReview = !cor || !tamanho || genero === 'indefinido';
  const needsCopyReview = !categoria || !marca;

  if (needsNameReview) qualityFlags.push('needs_name_review');
  if (needsAttributeReview) qualityFlags.push('needs_attribute_review');
  if (needsCopyReview) qualityFlags.push('needs_copy_review');

  let classificacaoVitrine = 'EXCLUDED';
  if (score >= 70 && sku && preco > 0 && isActive && productName && !qualityFlags.includes('missing_sku') && !qualityFlags.includes('missing_price')) {
    classificacaoVitrine = 'TOP_CANDIDATE';
  } else if (score >= 40) {
    classificacaoVitrine = 'REVIEW_NEEDED';
  }

  let prioridade = 'baixa';
  if (abcClassificacao === 'A' || score >= 80 || (totalVendidoValor > 0 && estoque > 0 && preco > 0)) {
    prioridade = 'alta';
  } else if ((score >= 60 && score <= 79) || abcClassificacao === 'B') {
    prioridade = 'media';
  }

  let status = 'excluido_importacao';
  if (classificacaoVitrine === 'TOP_CANDIDATE' && preco > 0 && isActive && !qualityFlags.some(isCriticalFlag)) {
    status = 'ativo';
  } else if (classificacaoVitrine === 'REVIEW_NEEDED') {
    status = 'inativo';
  }

  const candidate = {
    sku,
    nome_produto: productName,
    nome_comercial_sugerido: buildCommercialName({ nome_produto: productName }),
    categoria,
    genero_inferido: genero,
    cor_detectada: cor,
    tamanho_detectado: tamanho,
    marca,
    estoque: numberString(estoque),
    preco_venda: numberString(preco),
    total_vendido_quantidade: numberString(totalVendidoQuantidade),
    total_vendido_valor: numberString(totalVendidoValor),
    abc_classificacao: abcClassificacao,
    abc_valor: getValue(row, 'abc_valor'),
    abc_quantidade: getValue(row, 'abc_quantidade'),
    score_total: String(score),
    score_reasons_positive: positives.join(', '),
    score_reasons_negative: negatives.join(', '),
    classificacao_vitrine: classificacaoVitrine,
    prioridade_sugerida: prioridade,
    status_sugerido: status,
    tags_sugeridas: '',
    descricao_curta_sugerida: '',
    argumento_venda_sugerido: '',
    motivo_recomendacao: getValue(row, 'motivo_recomendacao'),
    quality_flags: summarizeFlags(qualityFlags),
    source_file: product ? product.source_file : '',
    bucket_file: inferCategoryBucket(categoria, productName)
  };

  candidate.tags_sugeridas = buildTags(candidate);
  candidate.descricao_curta_sugerida = buildShortDescription(candidate);
  candidate.argumento_venda_sugerido = buildSalesArgument(candidate);

  return candidate;
}

function sortCandidates(left, right) {
  const classRank = { TOP_CANDIDATE: 0, REVIEW_NEEDED: 1, EXCLUDED: 2 };
  const abcRank = { A: 0, B: 1, C: 2, '': 3 };
  return (
    (classRank[left.classificacao_vitrine] || 99) - (classRank[right.classificacao_vitrine] || 99) ||
    Number(right.score_total) - Number(left.score_total) ||
    (abcRank[left.abc_classificacao] || 99) - (abcRank[right.abc_classificacao] || 99) ||
    Number(right.total_vendido_valor || 0) - Number(left.total_vendido_valor || 0) ||
    Number(right.estoque || 0) - Number(left.estoque || 0) ||
    Number(right.preco_venda || 0) - Number(left.preco_venda || 0) ||
    String(left.nome_comercial_sugerido || '').localeCompare(String(right.nome_comercial_sugerido || ''))
  );
}

function countBy(list, getter) {
  return list.reduce((accumulator, item) => {
    const key = getter(item) || 'indefinido';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function topEntries(object, limit = 10) {
  return Object.entries(object)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, value]) => ({ key, value }));
}

function buildMarkdownReport(summary, top20, exclusionReasons, reviewReasons) {
  const top20Lines = top20.map((item, index) => `${index + 1}. ${item.nome_comercial_sugerido} | SKU ${item.sku} | score ${item.score_total} | ${item.categoria || '-'} | ${item.marca || '-'}`);
  const exclusionLines = exclusionReasons.map((item) => `- ${item.key}: ${item.value}`);
  const reviewLines = reviewReasons.map((item) => `- ${item.key}: ${item.value}`);
  const topCategories = topEntries(summary.category_distribution, 10).map((item) => `- ${item.key}: ${item.value}`);
  const topBrands = topEntries(summary.brand_distribution, 10).map((item) => `- ${item.key}: ${item.value}`);

  return [
    '# Vitrine IA selection report',
    '',
    'Nenhum produto foi importado no banco nesta etapa.',
    '',
    '## Resumo executivo',
    '',
    `- Total analisado: ${summary.total_analyzed}`,
    `- TOP_CANDIDATE: ${summary.top_candidates}`,
    `- REVIEW_NEEDED: ${summary.review_needed}`,
    `- EXCLUDED: ${summary.excluded}`,
    `- Top 100 gerado: ${summary.top_100_count}`,
    `- Top 300 gerado: ${summary.top_300_count}`,
    '',
    '## Top categorias',
    '',
    ...topCategories,
    '',
    '## Top marcas',
    '',
    ...topBrands,
    '',
    '## Distribuicao por ABC',
    '',
    ...topEntries(summary.abc_distribution, 10).map((item) => `- ${item.key}: ${item.value}`),
    '',
    '## Distribuicao por score',
    '',
    ...topEntries(summary.score_distribution, 10).map((item) => `- ${item.key}: ${item.value}`),
    '',
    '## Principais motivos de exclusao',
    '',
    ...exclusionLines,
    '',
    '## Principais motivos de revisao',
    '',
    ...reviewLines,
    '',
    '## Top 20 recomendados',
    '',
    ...top20Lines,
    '',
    '## Riscos antes da importacao',
    '',
    '- Produtos vendidos fora do cadastro ainda precisam conciliacao manual.',
    '- Itens sem categoria ou com atributos incompletos pedem revisao comercial.',
    '- Produtos com estoque zerado nao devem entrar em carga automatica sem politica clara.',
    '',
    '## Proxima etapa recomendada',
    '',
    '- Revisar primeiro o Top 100 e o arquivo de review.',
    '- So depois planejar uma importacao pequena e reversivel para a Vitrine IA.',
    ''
  ].join('\n');
}

function buildReadme(summary) {
  return [
    '# Vitrine selection',
    '',
    'Esta pasta contem a curadoria automatica dos candidatos para Vitrine IA a partir do staging Tiny/Olist.',
    '',
    '## Garantias desta etapa',
    '',
    '- Nao gravou no banco',
    '- Nao importou produtos',
    '- Nao alterou CRM/PDV',
    '- Nao alterou Tiny/Olist',
    '- Nao chamou endpoint de commit/importacao',
    '',
    '## Resumo',
    '',
    `- Total analisado: ${summary.total_analyzed}`,
    `- Top candidates: ${summary.top_candidates}`,
    `- Review needed: ${summary.review_needed}`,
    `- Excluded: ${summary.excluded}`,
    ''
  ].join('\n');
}

function main() {
  const options = parseArgs(process.argv);
  const basePath = path.resolve(options.base);
  const normalizedPath = path.join(basePath, 'normalized');
  const outputPath = path.join(basePath, 'vitrine-selection');
  const byCategoryPath = path.join(outputPath, 'vitrine_ia_by_category');

  const crosscheckFile = path.join(normalizedPath, 'product_sales_abc_crosscheck.csv');
  const productsFile = path.join(normalizedPath, 'products_normalized.csv');
  const abcFile = path.join(normalizedPath, 'abc_normalized.csv');
  const salesFile = path.join(normalizedPath, 'sales_items_normalized.csv');

  [crosscheckFile, productsFile, abcFile, salesFile].forEach(requireFile);

  ensureDir(outputPath);
  ensureDir(byCategoryPath);

  const crosscheckRows = parseCsv(crosscheckFile);
  const productRows = parseCsv(productsFile);
  const abcRows = parseCsv(abcFile);
  const salesRows = parseCsv(salesFile);

  const duplicateSkuCounts = countBy(productRows.filter((row) => getValue(row, 'sku')), (row) => getValue(row, 'sku'));
  const duplicateSkuSet = new Set(Object.entries(duplicateSkuCounts).filter(([, count]) => count > 1).map(([sku]) => sku));
  const productLookup = new Map();
  productRows.forEach((row) => {
    const sku = getValue(row, 'sku');
    if (sku && !productLookup.has(sku)) {
      productLookup.set(sku, row);
    }
  });

  const candidates = crosscheckRows.map((row) => computeCandidate(row, productLookup, duplicateSkuSet)).sort(sortCandidates);
  const topCandidates = candidates.filter((item) => item.classificacao_vitrine === 'TOP_CANDIDATE');
  const reviewNeeded = candidates.filter((item) => item.classificacao_vitrine === 'REVIEW_NEEDED');
  const excluded = candidates.filter((item) => item.classificacao_vitrine === 'EXCLUDED');

  const top100 = topCandidates.slice(0, 100);
  const top300 = topCandidates.slice(0, Math.min(options.top, 300));

  const columns = [
    'sku',
    'nome_produto',
    'nome_comercial_sugerido',
    'categoria',
    'genero_inferido',
    'cor_detectada',
    'tamanho_detectado',
    'marca',
    'estoque',
    'preco_venda',
    'total_vendido_quantidade',
    'total_vendido_valor',
    'abc_classificacao',
    'abc_valor',
    'abc_quantidade',
    'score_total',
    'score_reasons_positive',
    'score_reasons_negative',
    'classificacao_vitrine',
    'prioridade_sugerida',
    'status_sugerido',
    'tags_sugeridas',
    'descricao_curta_sugerida',
    'argumento_venda_sugerido',
    'motivo_recomendacao',
    'quality_flags',
    'source_file'
  ];

  writeCsv(path.join(outputPath, 'vitrine_ia_top_100.csv'), columns, top100);
  writeCsv(path.join(outputPath, 'vitrine_ia_top_300.csv'), columns, top300);
  writeCsv(path.join(outputPath, 'vitrine_ia_candidates_review.csv'), columns, reviewNeeded);
  writeCsv(path.join(outputPath, 'vitrine_ia_excluded.csv'), columns, excluded);

  CATEGORY_BUCKETS.forEach((bucket) => {
    const rows = candidates.filter((item) => item.bucket_file === bucket.file);
    if (rows.length) {
      writeCsv(path.join(byCategoryPath, bucket.file), columns, rows);
    }
  });

  const scoreDistribution = countBy(candidates, (item) => {
    const score = Number(item.score_total);
    if (score >= 80) return '80-100';
    if (score >= 60) return '60-79';
    if (score >= 40) return '40-59';
    return '0-39';
  });

  const abcDistribution = countBy(candidates, (item) => item.abc_classificacao || 'sem_abc');
  const categoryDistribution = countBy(candidates.filter((item) => item.classificacao_vitrine !== 'EXCLUDED'), (item) => item.categoria || 'sem_categoria');
  const brandDistribution = countBy(candidates.filter((item) => item.classificacao_vitrine !== 'EXCLUDED'), (item) => item.marca || 'sem_marca');
  const exclusionReasons = countBy(excluded, (item) => {
    const first = item.score_reasons_negative.split(',')[0] || item.quality_flags || 'score_baixo';
    return first.trim();
  });
  const reviewReasons = countBy(reviewNeeded, (item) => {
    if (item.quality_flags.includes('needs_attribute_review')) return 'needs_attribute_review';
    if (item.quality_flags.includes('needs_copy_review')) return 'needs_copy_review';
    if (item.score_reasons_negative) return item.score_reasons_negative.split(',')[0].trim();
    return 'review_manual';
  });

  const summary = {
    generated_at: new Date().toISOString(),
    total_analyzed: candidates.length,
    top_candidates: topCandidates.length,
    review_needed: reviewNeeded.length,
    excluded: excluded.length,
    top_100_file: path.join(outputPath, 'vitrine_ia_top_100.csv'),
    top_300_file: path.join(outputPath, 'vitrine_ia_top_300.csv'),
    top_100_count: top100.length,
    top_300_count: top300.length,
    score_distribution: scoreDistribution,
    abc_distribution: abcDistribution,
    category_distribution: categoryDistribution,
    brand_distribution: brandDistribution,
    top_exclusion_reasons: topEntries(exclusionReasons, 10),
    top_review_reasons: topEntries(reviewReasons, 10),
    top_20: topCandidates.slice(0, 20).map((item) => ({
      sku: item.sku,
      nome_comercial_sugerido: item.nome_comercial_sugerido,
      categoria: item.categoria,
      marca: item.marca,
      score_total: Number(item.score_total),
      abc_classificacao: item.abc_classificacao,
      total_vendido_valor: Number(item.total_vendido_valor || 0)
    })),
    source_counts: {
      crosscheck_rows: crosscheckRows.length,
      product_rows: productRows.length,
      abc_rows: abcRows.length,
      sales_rows: salesRows.length
    }
  };

  writeJson(path.join(outputPath, 'vitrine_ia_selection_report.json'), summary);
  writeText(
    path.join(outputPath, 'vitrine_ia_selection_report.md'),
    buildMarkdownReport(summary, topCandidates.slice(0, 20), topEntries(exclusionReasons, 10), topEntries(reviewReasons, 10))
  );
  writeText(path.join(outputPath, 'README.md'), buildReadme(summary));

  console.log(JSON.stringify({
    outputPath,
    totalAnalyzed: summary.total_analyzed,
    topCandidates: summary.top_candidates,
    reviewNeeded: summary.review_needed,
    excluded: summary.excluded,
    top100: summary.top_100_count,
    top300: summary.top_300_count
  }, null, 2));
}

main();
