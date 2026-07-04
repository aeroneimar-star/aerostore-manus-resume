"use strict";

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
    marca: product.brand || "AEROSTORE",
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
    marca: item.marca || "AEROSTORE",
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
    }
    const saleLabel = input.preco_venda || "R$ 0,00";
    lines.push(buildArgoxPplbText(x, layout.y.por, `POR: ${saleLabel}`, 4, 1, 1));
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
    marca: input.marca,
    cor: product.color || "",
    tamanho: product.size || "",
    sku_variacao: product.sku || product.codigo || "",
    codigo_barras: product.barcode || product.sku || "",
    preco_venda: fmtPreco(saleRaw),
    preco_original: input.show_compare_price ? fmtPreco(originalRaw) : "",
    show_compare_price: input.show_compare_price,
    show_brand: request.show_brand !== false,
    show_name: request.show_name !== false,
    show_size_color: request.show_size_color !== false,
    show_sku: request.show_sku !== false,
    show_barcode: request.show_barcode !== false,
    show_price: request.show_price !== false,
    colunas: columns
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
  mapProductToPplbInput,
  mapAgentItemToPplbInput
};
