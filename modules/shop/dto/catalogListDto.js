"use strict";

const COLOR_SWATCH_MAP = {
  preto: "#141416",
  branco: "#f2efe8",
  marinho: "#1e3348",
  petroleo: "#2a4555",
  areia: "#b8a990",
  cognac: "#8b5a3c",
  azul: "#2c4a62",
  marrom: "#6b4e3d",
  verde: "#2f4a3a",
  grafite: "#4a4f57",
  caramelo: "#a67c52",
  indigo: "#1a2438",
  jeans: "#2c3548",
};

function uniqueValues(values = []) {
  return Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean)));
}

function summarizeVariants(variants = []) {
  const list = Array.isArray(variants) ? variants : [];
  return {
    colors: uniqueValues(list.map((item) => item.color)),
    sizes: uniqueValues(list.map((item) => item.size)),
    colorSlugs: uniqueValues(list.map((item) => item.color_slug))
  };
}

function resolveActionLabel(availability = "") {
  const value = String(availability || "").toLowerCase();
  if (value === "out_of_stock") {
    return "Consultar disponibilidade";
  }
  return "Ver produto";
}

function resolveStatusCopy(availability = "") {
  const value = String(availability || "").toLowerCase();
  if (value === "out_of_stock") {
    return "Consultar disponibilidade na loja";
  }
  if (value === "low_stock") {
    return "Últimas unidades — consulte na loja";
  }
  return "Disponível para consulta";
}

module.exports = {
  COLOR_SWATCH_MAP,
  summarizeVariants,
  resolveActionLabel,
  resolveStatusCopy
};
