"use strict";

const { resolveLabelHeaderText } = require("./argoxLabelStorePolicy");

const DEFAULT_TEMPLATE_ID = "aerostore_tag_40x60_2c";

const DEFAULT_LAYOUT = {
  labelWidthDots: 320,
  labelHeightDots: 480,
  labelGapDots: 24,
  baseX: 30,
  density: 10,
  speed: 2,
  y: {
    brand: 22,
    name1: 52,
    name2: 74,
    sizeColor: 98,
    sku: 122,
    barcode: 148,
    separator: 332,
    cod: 352,
    de: 378,
    por: 408
  }
};

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveArgoxLanguage(config = {}, item = {}) {
  const raw = normalizeText(
    item.language
    || item.label_language
    || config.label_language
    || config.language
    || process.env.ARGOX_LANGUAGE
    || process.env.ARGOX_LABEL_LANGUAGE
    || "PPLB"
  ).toUpperCase();
  return raw === "PPLA" ? "PPLA" : "PPLB";
}

function resolvePhysicalLanguage(config = {}, item = {}) {
  const override = normalizeText(
    item.physical_language
    || item.raw_language
    || config.physical_language
    || config.raw_language
    || process.env.ARGOX_PHYSICAL_LANGUAGE
    || process.env.ARGOX_RAW_LANGUAGE
    || ""
  ).toUpperCase();
  if (override === "PPLA" || override === "PPLB") return override;
  return resolveArgoxLanguage(config, item);
}

function buildArgoxPplbMinimalCommand(config = {}) {
  const labelWidthDots = Math.max(1, Math.floor(normalizeNumber(config.label_width_dots, 320)));
  const labelHeightDots = Math.max(1, Math.floor(normalizeNumber(config.label_height_dots, 480)));
  const x = Math.max(0, Math.floor(normalizeNumber(config.origin_x, 30)));
  const yTitle = Math.max(0, Math.floor(normalizeNumber(config.title_y, 120)));
  const yCode = Math.max(0, Math.floor(normalizeNumber(config.code_y, 170)));

  return [
    "\nN\n",
    `q${labelWidthDots}\n`,
    `Q${labelHeightDots}\n`,
    `A${x},${yTitle},0,2,1,1,N,"TESTE AEROSTORE"\n`,
    `A${x},${yCode},0,2,1,1,N,"COD 123456"\n`,
    "P1\n"
  ].join("");
}

function validatePplbMinimalCommand(command = "", options = {}) {
  const text = String(command || "");
  const errors = [];
  if (!text.includes("\nN\n") && !/^\s*N\s*$/m.test(text)) {
    errors.push("PPLB minimo deve conter comando N.");
  }
  if (!/\bq320\b/.test(text) && options.requireQ320 !== false) {
    errors.push("PPLB minimo deve conter q320.");
  }
  if (!/\bQ480\b/.test(text)) {
    errors.push("PPLB minimo deve conter Q480.");
  }
  if (!/\bP1\b/.test(text)) {
    errors.push("PPLB minimo deve conter P1.");
  }
  if (/\bP20\b/.test(text)) {
    errors.push("PPLB minimo nao pode conter P20.");
  }
  if (text.charCodeAt(0) === 0x02 || text.includes("\x02L")) {
    errors.push("PPLB minimo nao deve usar envelope PPLA (STX L).");
  }
  return { ok: errors.length === 0, errors };
}

function limparPPLB(texto = "") {
  if (!texto) return "";
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .toUpperCase();
}

function fmtPreco(valor) {
  if (valor === undefined || valor === null || valor === "") return "";
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return valor.toFixed(2).replace(".", ",");
  }
  const raw = String(valor).trim();
  const num = raw.includes(",")
    ? parseFloat(raw.replace(/\./g, "").replace(",", "."))
    : parseFloat(raw);
  if (!Number.isFinite(num)) return "";
  return num.toFixed(2).replace(".", ",");
}

function fmtPrecoLabel(valor) {
  const formatted = fmtPreco(valor);
  return formatted ? `R$ ${formatted}` : "";
}

function splitProductName(name = "", maxChars = 22, maxLines = 2) {
  const clean = limparPPLB(name);
  if (!clean) return ["PRODUTO"];
  const words = clean.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    current = word;
    while (current.length > maxChars && lines.length < maxLines) {
      lines.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  });
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines).length ? lines.slice(0, maxLines) : ["PRODUTO"];
}

function buildSizeColorLabel(input = {}) {
  const color = limparPPLB(input.cor || "");
  const size = limparPPLB(input.tamanho || "");
  if (color && size) return `${color} / TAM.: ${size}`;
  if (size) return `TAM.: ${size}`;
  if (color) return color;
  return "";
}

function normalizeBarcodeValue(input = {}) {
  const raw = normalizeText(input.codigo_barras || input.barcode || input.sku_variacao || input.sku || input.codigo || "");
  return raw.replace(/\D/g, "").slice(0, 13);
}

function buildArgoxPplbText(x, y, text, font = 1, hScale = 1, vScale = 1) {
  const safeText = limparPPLB(text);
  if (!safeText) return "";
  return `A${x},${y},0,${font},${hScale},${vScale},N,"${safeText}"`;
}

function buildArgoxPplbBarcode(x, y, value = "") {
  const bc = normalizeBarcodeValue({ codigo_barras: value });
  if (bc.length < 8) return "";
  return `B${x},${y},0,E30,2,2,50,B,"${bc}"`;
}

function resolveLayout(config = {}) {
  const dpi = normalizeNumber(config.dpi, 203);
  const widthMm = normalizeNumber(config.label_width_mm, 40);
  const heightMm = normalizeNumber(config.label_height_mm, 60);
  const gapMm = normalizeNumber(config.label_gap_mm, 3);
  const widthDots = Math.max(1, Math.round(widthMm * (dpi / 25.4)));
  const heightDots = Math.max(1, Math.round(heightMm * (dpi / 25.4)));
  const gapDots = Math.max(0, Math.round(gapMm * (dpi / 25.4)));
  return {
    ...DEFAULT_LAYOUT,
    labelWidthDots: widthDots,
    labelHeightDots: heightDots,
    labelGapDots: gapDots
  };
}

function mapProductToPplbInput(product = {}, request = {}) {
  const sku = limparPPLB(product.sku || product.codigo || "");
  const saleRaw = request.show_compare_price
    ? product.promotional_price ?? product.price
    : product.price;
  const originalRaw = request.show_compare_price ? product.normal_price ?? product.price : null;
  const saleFormatted = fmtPrecoLabel(saleRaw);
  const originalFormatted = originalRaw !== null && originalRaw !== undefined && originalRaw !== ""
    ? fmtPrecoLabel(originalRaw)
    : "";
  const hasCompare = Boolean(
    request.show_compare_price
    && originalFormatted
    && saleFormatted
    && fmtPreco(originalRaw) !== fmtPreco(saleRaw)
  );

  return {
    nome: product.name || "PRODUTO",
    marca: resolveLabelHeaderText(product.store_id),
    cor: product.color || "",
    tamanho: product.size || "",
    sku,
    codigo_barras: product.barcode || sku,
    codigo_stub: sku ? `COD. ${sku}` : "",
    preco_venda: saleFormatted,
    preco_original: hasCompare ? originalFormatted : "",
    show_compare_price: hasCompare,
    show_brand: request.show_brand !== false,
    show_name: request.show_name !== false,
    show_size_color: request.show_size_color !== false,
    show_sku: request.show_sku !== false,
    show_barcode: request.show_barcode !== false,
    show_price: request.show_price !== false
  };
}

function mapAgentItemToPplbInput(item = {}) {
  const sku = limparPPLB(item.sku_variacao || item.sku || item.codigo || "");
  const saleFormatted = fmtPrecoLabel(item.preco_venda);
  const originalFormatted = fmtPrecoLabel(item.preco_original);
  const hasCompare = Boolean(
    originalFormatted
    && saleFormatted
    && fmtPreco(item.preco_original) !== fmtPreco(item.preco_venda)
  );

  return {
    nome: item.nome || "PRODUTO",
    marca: resolveLabelHeaderText(item.loja || item.store_id || ""),
    cor: item.cor || "",
    tamanho: item.tamanho || "",
    sku,
    codigo_barras: item.codigo_barras || sku,
    codigo_stub: sku ? `COD. ${sku}` : "",
    preco_venda: saleFormatted || fmtPrecoLabel(item.preco_venda),
    preco_original: hasCompare ? originalFormatted : "",
    show_compare_price: hasCompare,
    show_brand: item.show_brand !== false,
    show_name: item.show_name !== false,
    show_size_color: item.show_size_color !== false,
    show_sku: item.show_sku !== false,
    show_barcode: item.show_barcode !== false,
    show_price: item.show_price !== false
  };
}

function buildArgoxPplbSingleLabel(input = {}, xOffset = 0, layout = DEFAULT_LAYOUT) {
  const x = layout.baseX + xOffset;
  const lines = [];

  if (input.show_brand !== false) {
    lines.push(buildArgoxPplbText(x, layout.y.brand, input.marca || "AEROSTORE", 2, 1, 1));
  }

  if (input.show_name !== false) {
    const nameLines = splitProductName(input.nome, 22, 2);
    lines.push(buildArgoxPplbText(x, layout.y.name1, nameLines[0], 2, 1, 1));
    if (nameLines[1]) {
      lines.push(buildArgoxPplbText(x, layout.y.name2, nameLines[1], 1, 1, 1));
    }
  }

  if (input.show_size_color !== false) {
    const sizeColor = buildSizeColorLabel(input);
    if (sizeColor) {
      lines.push(buildArgoxPplbText(x, layout.y.sizeColor, sizeColor, 1, 1, 1));
    }
  }

  if (input.show_sku !== false && input.sku) {
    lines.push(buildArgoxPplbText(x, layout.y.sku, input.sku, 1, 1, 1));
  }

  if (input.show_barcode !== false) {
    const barcodeCommand = buildArgoxPplbBarcode(x, layout.y.barcode, input.codigo_barras || input.sku);
    if (barcodeCommand) lines.push(barcodeCommand);
  }

  lines.push(buildArgoxPplbText(x, layout.y.separator, "-".repeat(36), 1, 1, 1));

  if (input.codigo_stub) {
    lines.push(buildArgoxPplbText(x, layout.y.cod, input.codigo_stub, 1, 1, 1));
  }

  if (input.show_price !== false) {
    if (input.show_compare_price && input.preco_original) {
      lines.push(buildArgoxPplbText(x, layout.y.de, `DE: ${input.preco_original}`, 2, 1, 1));
      const saleLabel = input.preco_venda || "R$ 0,00";
      lines.push(buildArgoxPplbText(x, layout.y.por, `POR: ${saleLabel}`, 4, 1, 1));
    } else {
      const saleLabel = input.preco_venda || "R$ 0,00";
      lines.push(buildArgoxPplbText(x, layout.y.por, saleLabel, 4, 1, 1));
    }
  }

  return lines.filter(Boolean);
}

function buildArgoxPplbBatch(inputs = [], options = {}) {
  const layout = resolveLayout(options.config || {});
  const columns = Math.max(1, Math.min(4, Math.floor(normalizeNumber(options.columns, 2))));
  const quantity = Math.max(1, inputs.length);
  const labelsPerRow = columns;
  const rows = Math.max(1, Math.ceil(quantity / labelsPerRow));
  const rowWidth = labelsPerRow * layout.labelWidthDots + Math.max(0, labelsPerRow - 1) * layout.labelGapDots;

  let cmd = "\nN\n";
  cmd += `q${rowWidth}\n`;
  cmd += `Q${layout.labelHeightDots}\n`;
  cmd += `D${layout.density}\n`;
  cmd += `S${layout.speed}\n`;

  for (let index = 0; index < quantity; index += 1) {
    const column = index % labelsPerRow;
    const xOffset = column * (layout.labelWidthDots + layout.labelGapDots);
    const input = inputs[index] || inputs[0];
    cmd += `${buildArgoxPplbSingleLabel(input, xOffset, layout).join("\n")}\n`;
  }

  cmd += `P${rows}\n`;
  return cmd;
}

function buildArgoxPplbCommand(product = {}, request = {}, config = {}) {
  const layout = resolveLayout(config);
  const columns = Math.max(1, Math.min(4, Math.floor(normalizeNumber(config.label_columns, 2))));
  const quantity = Math.max(1, Math.floor(normalizeNumber(request.quantity, 1)));
  const input = mapProductToPplbInput(product, request);
  const inputs = Array.from({ length: quantity }, () => input);
  return buildArgoxPplbBatch(inputs, { config, columns });
}

function buildArgoxPplbFromAgentItems(items = [], options = {}) {
  const normalizedItems = (Array.isArray(items) ? items : [items])
    .filter(Boolean)
    .map((item) => mapAgentItemToPplbInput(item));
  if (!normalizedItems.length) {
    throw new Error("Nenhuma etiqueta enviada.");
  }
  return buildArgoxPplbBatch(normalizedItems, {
    config: options.config || {},
    columns: options.columns || normalizedItems[0]?.colunas || 2
  });
}

function buildAgentPrintPayload(product = {}, request = {}, config = {}) {
  const input = mapProductToPplbInput(product, request);
  const quantity = Math.max(1, Math.floor(normalizeNumber(request.quantity, 1)));
  const columns = Math.max(1, Math.min(4, Math.floor(normalizeNumber(config.label_columns, 2))));
  const saleRaw = request.show_compare_price
    ? product.promotional_price ?? product.price
    : product.price;
  const originalRaw = request.show_compare_price ? product.normal_price ?? product.price : null;

  const base = {
    nome: product.name || "PRODUTO",
    marca: resolveLabelHeaderText(product.store_id),
    loja: product.store_id || "",
    store_id: product.store_id || "",
    variation_id: product.variation_id || "",
    variant_barcode: product.variant_barcode || product.barcode || "",
    cor: product.color || "",
    tamanho: product.size || "",
    sku_variacao: product.sku || product.codigo || "",
    codigo_barras: product.label_barcode_value || product.barcode || "",
    barcode_encoded_value: product.barcode_encoded_value || product.label_barcode_value || product.barcode || "",
    barcode_human_text: product.barcode_human_text || product.label_barcode_human_text || product.sku || product.codigo || "",
    label_barcode_symbology: product.label_barcode_symbology || "",
    preco_venda: fmtPreco(saleRaw),
    preco_original: input.show_compare_price ? fmtPreco(originalRaw) : "",
    show_compare_price: input.show_compare_price,
    show_brand: request.show_brand !== false,
    show_name: request.show_name !== false,
    show_size_color: request.show_size_color !== false,
    show_sku: request.show_sku !== false,
    show_barcode: request.show_barcode !== false,
    show_price: request.show_price !== false,
    price_with_cents: request.price_with_cents !== false,
    print_quantity_mode: request.print_quantity_mode || "",
    colunas: columns,
    template_id: request.template_id || DEFAULT_TEMPLATE_ID,
    language: resolveArgoxLanguage(config),
    label_language: resolveArgoxLanguage(config)
  };

  if (quantity <= 1) return base;
  return Array.from({ length: quantity }, () => ({ ...base }));
}

module.exports = {
  DEFAULT_TEMPLATE_ID,
  DEFAULT_LAYOUT,
  limparPPLB,
  fmtPreco,
  buildArgoxPplbCommand,
  buildArgoxPplbBatch,
  buildArgoxPplbFromAgentItems,
  buildAgentPrintPayload,
  buildArgoxPplbMinimalCommand,
  validatePplbMinimalCommand,
  mapProductToPplbInput,
  mapAgentItemToPplbInput,
  resolveArgoxLanguage,
  resolvePhysicalLanguage
};
