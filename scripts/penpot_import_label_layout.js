"use strict";

const fs = require("fs");
const path = require("path");
const {
  importFromPenpotFlatExport,
  importFromPenpotGetFileResponse
} = require("../agente-impressao-argox/lib/penpotLabelLayoutImporter");

function readArg(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return String(process.argv[index + 1] || fallback).trim();
}

function main() {
  const inputPath = path.resolve(readArg("--input"));
  const outputPath = path.resolve(
    readArg("--output", path.join(__dirname, "..", "agente-impressao-argox", "layouts", "aerostore-tag-40x60.label-layout.json"))
  );
  const mode = readArg("--mode", "auto").toLowerCase();

  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error("Informe --input com arquivo JSON exportado do Penpot.");
  }

  const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  let doc;
  if (mode === "flat" || (mode === "auto" && Array.isArray(payload.shapes))) {
    doc = importFromPenpotFlatExport(payload);
  } else if (mode === "get-file" || mode === "auto") {
    doc = importFromPenpotGetFileResponse(payload);
  } else {
    throw new Error(`Modo invalido: ${mode}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    input: inputPath,
    output: outputPath,
    source: doc.source,
    elements: doc.elements.length,
    roles: doc.elements.map((item) => item.role)
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}
