"use strict";

const fs = require("fs");
const path = require("path");
const { buildMinimalImageSpec } = require("../agente-impressao-argox/lib/labelImageSpec");
const { renderAndPrintLabel } = require("../agente-impressao-argox/lib/windowsDriverPrint");

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

function main() {
  const spec = buildMinimalImageSpec();
  const result = renderAndPrintLabel("", spec, {
    outputDir: OUTPUT_DIR,
    prefix: "minimal-driver-dry-run",
    saveOnly: true
  });

  if (!result.imagem_path || !fs.existsSync(result.imagem_path)) {
    console.error("Falha ao gerar imagem da etiqueta minima.");
    process.exit(1);
  }

  console.log("Argox WINDOWS_DRIVER minimal dry-run passed.");
  console.log(JSON.stringify({
    metodo: result.metodo,
    imagem: result.imagem || path.basename(result.imagem_path),
    imagem_path: result.imagem_path,
    bytes: result.bytes,
    width_px: result.width_px,
    height_px: result.height_px
  }, null, 2));
}

main();
