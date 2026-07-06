"use strict";

const fs = require("fs");
const path = require("path");
const bwipjs = require("bwip-js");

function readArg(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  return String(process.argv[index + 1] || fallback).trim();
}

function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    return { width_px: 0, height_px: 0 };
  }
  return {
    width_px: buffer.readUInt32BE(16),
    height_px: buffer.readUInt32BE(20)
  };
}

function resolveCode128Scale(value = "", maxWidthPx = 280) {
  const length = String(value || "").length;
  if (length <= 8) {
    return 3;
  }
  if (length <= 12) {
    return 2;
  }
  if (length <= 14) {
    return maxWidthPx >= 260 ? 2 : 1;
  }
  return 1;
}

async function main() {
  const value = readArg("--value");
  const symbology = readArg("--symbology", "code128").toLowerCase();
  const outputPath = path.resolve(readArg("--output"));
  const widthPx = Math.max(40, Number(readArg("--width", "280")) || 280);
  const heightPx = Math.max(18, Number(readArg("--height", "80")) || 80);
  const dpi = Math.max(96, Number(readArg("--dpi", "203")) || 203);

  if (!value) {
    throw new Error("Valor do barcode nao informado.");
  }
  if (!outputPath) {
    throw new Error("Caminho de saida nao informado.");
  }

  const bcid = symbology === "ean13" ? "ean13" : "code128";
  const barHeightMm = Math.max(5, Math.min(12, (heightPx / dpi) * 25.4));
  const scale = bcid === "ean13" ? 2 : resolveCode128Scale(value, widthPx);
  const png = await bwipjs.toBuffer({
    bcid,
    text: value,
    scale,
    height: barHeightMm,
    includetext: false,
    backgroundcolor: "FFFFFF",
    barcolor: "000000",
    paddingwidth: 4,
    paddingheight: 2
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, png);
  const dimensions = readPngDimensions(png);

  process.stdout.write(JSON.stringify({
    ok: true,
    output_path: outputPath,
    bytes: png.length,
    symbology: bcid,
    value,
    scale,
    width_px: dimensions.width_px,
    height_px: dimensions.height_px
  }));
}

main().catch((error) => {
  process.stderr.write(String(error.message || error));
  process.exit(1);
});
