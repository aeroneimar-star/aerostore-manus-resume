"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const STATIC_INCLUDES = [
  "agente-impressao-argox/.env.example",
  "agente-impressao-argox/package.json",
  "agente-impressao-argox/output/.gitkeep",
  "agente-impressao-argox/layouts",
  "agente-impressao-argox/scripts"
];

const ENTRY_FILES = [
  "agente-impressao-argox/server.js",
  ...listJsFiles(path.join(REPO_ROOT, "agente-impressao-argox", "lib"))
];

function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.relative(REPO_ROOT, path.join(dir, entry.name)).replace(/\\/g, "/"));
}

function readFileSafe(relativePath) {
  const absolute = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Arquivo nao encontrado para trace: ${relativePath}`);
  }
  return fs.readFileSync(absolute, "utf8");
}

function resolveRelativeRequire(fromRelative, request) {
  if (!request.startsWith(".")) return null;
  const base = path.resolve(REPO_ROOT, path.dirname(fromRelative), request);
  const candidates = [
    base,
    `${base}.js`,
    path.join(base, "index.js")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(REPO_ROOT, candidate).replace(/\\/g, "/");
    }
  }
  return null;
}

function normalizeRepoRelative(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!normalized.endsWith(".js") && !normalized.includes(".")) {
    const withJs = `${normalized}.js`;
    if (fs.existsSync(path.join(REPO_ROOT, withJs))) {
      return withJs;
    }
  }
  return normalized;
}

function extractPathJoinRequires(source, fromRelative) {
  const results = [];
  const pattern = /path\.join\(\s*__dirname\s*,([^)]+)\)/g;
  let match = pattern.exec(source);
  while (match) {
    const segments = [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
    if (segments.length) {
      const absolute = path.resolve(REPO_ROOT, path.dirname(fromRelative), ...segments);
      let relative = path.relative(REPO_ROOT, absolute).replace(/\\/g, "/");
      relative = normalizeRepoRelative(relative);
      results.push(relative);
    }
    match = pattern.exec(source);
  }
  return results;
}

function extractRequires(source, fromRelative) {
  const results = [];
  const patterns = [
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /require\.resolve\(\s*["']([^"']+)["']\s*\)/g
  ];
  patterns.forEach((pattern) => {
    let match = pattern.exec(source);
    while (match) {
      results.push(match[1]);
      match = pattern.exec(source);
    }
  });
  results.push(...extractPathJoinRequires(source, fromRelative));
  return results;
}

function collectDependencyFiles() {
  const queue = [...ENTRY_FILES];
  const seen = new Set();
  const files = new Set();

  while (queue.length) {
    const relativePath = queue.shift();
    if (!relativePath || seen.has(relativePath)) continue;
    seen.add(relativePath);
    files.add(relativePath);

    const source = readFileSafe(relativePath);
    extractRequires(source, relativePath).forEach((request) => {
      if (request.startsWith("modules/") || request === "db.js") {
        const resolved = normalizeRepoRelative(request);
        if (resolved && !seen.has(resolved)) {
          queue.push(resolved);
        }
        return;
      }
      if (!request.startsWith(".")) {
        return;
      }
      let resolved = resolveRelativeRequire(relativePath, request);
      if (!resolved && request.startsWith("./modules/")) {
        resolved = normalizeRepoRelative(request.replace(/^\.\//, ""));
      }
      if (resolved && !seen.has(resolved)) {
        queue.push(resolved);
      }
    });
  }

  return [...files].sort();
}

function collectStaticFiles() {
  const files = new Set();
  STATIC_INCLUDES.forEach((item) => {
    const absolute = path.join(REPO_ROOT, item);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Include estatico ausente: ${item}`);
    }
    if (fs.statSync(absolute).isDirectory()) {
      walkDir(absolute).forEach((file) => {
        files.add(path.relative(REPO_ROOT, file).replace(/\\/g, "/"));
      });
      return;
    }
    files.add(item.replace(/\\/g, "/"));
  });
  return [...files].sort();
}

function walkDir(dir) {
  const output = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkDir(absolute));
      return;
    }
    output.push(absolute);
  });
  return output;
}

function main() {
  const dependencyFiles = collectDependencyFiles();
  const staticFiles = collectStaticFiles();
  const merged = [...new Set([...dependencyFiles, ...staticFiles])].sort();
  const payload = {
    generated_at: new Date().toISOString(),
    repo_root: REPO_ROOT,
    dependency_files: dependencyFiles,
    static_files: staticFiles,
    files: merged
  };

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  merged.forEach((file) => process.stdout.write(`${file}\n`));
}

main();
