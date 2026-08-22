#!/usr/bin/env node
/**
 * Checagem de sintaxe recursiva de todos os arquivos .js do projeto.
 * Garante que nenhum arquivo quebrado entre na main.
 * Uso: npm run check
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const IGNORE_DIRS = new Set(["node_modules", ".git", "data", "tmp", "logs"]);

function collectJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const root = path.join(__dirname, "..");
const files = collectJsFiles(root);
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failures.push({
      file: path.relative(root, file),
      error: String(err.stderr || err.message).split("\n").slice(0, 3).join("\n")
    });
  }
}

if (failures.length) {
  console.error(`\nFALHA: ${failures.length} arquivo(s) com erro de sintaxe:\n`);
  for (const f of failures) console.error(`- ${f.file}\n  ${f.error}\n`);
  process.exit(1);
}

console.log(`OK: ${files.length} arquivos .js com sintaxe valida.`);
