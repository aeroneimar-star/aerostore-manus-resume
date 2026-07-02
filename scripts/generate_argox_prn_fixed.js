const fs = require("fs");
const path = require("path");

// ============================================================
// Gerador de PRNs corrigidos para Argox OS-214 Plus PPLA
//
// Correcoes aplicadas vs. versao anterior:
// 1. CRLF (\r\n) como terminador de linha — a OS-214+ exige
// 2. Form Feed (0x0C) ao final — ejeita a etiqueta do rolo
// 3. CODE39 (tipo 0) para barcode alfanumerico — CODE128 com
//    hifens/hashes causa erro silencioso na OS-214+
// 4. SKU sem truncamento — 40 chars em vez de 26
// 5. Escrita em Buffer/binary — preserva STX 0x02 byte-a-byte
// ============================================================

const CRLF = "\r\n";
const labelsDir = path.join(__dirname, "..", "tmp", "labels");
fs.mkdirSync(labelsDir, { recursive: true });

// Helper para montar comando PPLA com CRLF
function ppla(lines) {
  return lines.join("") + "\x0C";
}

function text(x, y, val, w = 32, wx = 1, wy = 1) {
  return `A${x},${y},0,2,${wx},${wy},N,"${val}"` + CRLF;
}

// ============================================================
// PRN MINIMO DIAGNOSTICO — texto puro, 2 colunas
// Proposito: verificar se impressora aceita o formato PPLA
// ============================================================
function buildMinimalDiagnostic() {
  // 40mm @ 203 DPI = 320 dots; 60mm @ 203 DPI = 480 dots
  // gap = 3mm = 24 dots; 2 colunas = 320+24+320 = 664 dots total
  const cols = [
    { x: 14, label: "COLUNA 1" },
    { x: 358, label: "COLUNA 2" }
  ];

  const lines = [
    "\x02L",        // STX + comando Label
    "D" + CRLF,    // Limpa buffer (sem D11 para ser mais simples)
    "H24" + CRLF,  // Gap offset 24 dots (~3mm)
    "Q480" + CRLF, // Altura etiqueta 480 dots (60mm)
    "q664" + CRLF, // Largura total 664 dots (2 colunas)
  ];

  for (const col of cols) {
    lines.push(text(col.x, 22, "AEROSTORE", 24, 1, 1));
    lines.push(text(col.x, 58, "DIAGNOSTICO PPLA", 28, 1, 1));
    lines.push(text(col.x, 102, "SEM BARCODE", 24, 1, 1));
    lines.push(text(col.x, 140, "TESTE 2026-07-01", 26, 1, 1));
    lines.push(text(col.x, 190, "LINHA EXTRA", 24, 1, 1));
  }

  lines.push("P1" + CRLF);  // 1 etiqueta
  lines.push("E");           // Fim do label
  return ppla(lines);
}

// ============================================================
// PRN REAL — produto real com grade
// Dados do banco: produto 3844, variacao GG/PRETO
// ============================================================
function buildRealTag() {
  // Dados reais do banco (ai_products.id=3844, pdv_product_variants)
  const product = {
    brand: "AEROSTORE",
    name: "CAMISETA BRASIL AEROSTORE WO",
    color: "AMARELA",
    size: "G",
    sku: "AERO-000058-AMARELA-G",
    barcode: "178080828613404",
    price_label: "R$ 139,90"
  };

  const cols = [
    {
      x: 14,
      data: { ...product }
    },
    {
      x: 358,
      // Segunda etiqueta — mesma variacao para demo de 2 colunas
      data: { ...product }
    }
  ];

  const lines = [
    "\x02L",
    "D" + CRLF,
    "H24" + CRLF,
    "Q480" + CRLF,
    "q664" + CRLF,
  ];

  for (const col of cols) {
    const { x, data: p } = col;
    const sizeColor = `${p.color} / ${p.size}`;

    lines.push(text(x, 22, p.brand, 24, 1, 1));
    lines.push(text(x, 58, p.name, 28, 1, 1));
    lines.push(text(x, 102, sizeColor, 24, 1, 1));
    // SKU completo — 40 chars, nao trunca
    lines.push(text(x, 140, `SKU ${p.sku}`, 40, 1, 1));
    // CODE39 (tipo 0) para alfanumerico com hifens
    lines.push(`B${x + 10},210,0,0,2,8,N,"${p.barcode}"` + CRLF);
    lines.push(text(x, 310, p.barcode, 28, 1, 1));
    // Preco no canhoto — fonte 2x2 para destaque
    lines.push(text(x, 414, p.price_label, 24, 2, 2));
  }

  lines.push("P1" + CRLF);
  lines.push("E");
  return ppla(lines);
}

// ============================================================
// Escrever e verificar os arquivos
// ============================================================
function writeAndVerify(filename, content) {
  const filePath = path.join(labelsDir, filename);
  const buffer = Buffer.from(content, "ascii");
  fs.writeFileSync(filePath, buffer);

  // Verificacao
  const buf = fs.readFileSync(filePath);
  const cr = buf.filter(b => b === 0x0D).length;
  const lf = buf.filter(b => b === 0x0A).length;
  const ff = buf.filter(b => b === 0x0C).length;
  console.log(`\n=== ${filename} ===`);
  console.log(`Tamanho: ${buf.length} bytes`);
  console.log(`Bytes iniciais: ${buf.slice(0, 4).toString("hex").toUpperCase()}`);
  console.log(`  Byte 0 = 0x${buf[0].toString(16).toUpperCase().padStart(2,"0")} (deve ser 0x02) ${buf[0] === 0x02 ? "✅" : "❌"}`);
  console.log(`  Byte 1 = 0x${buf[1].toString(16).toUpperCase().padStart(2,"0")} (deve ser 0x4C) ${buf[1] === 0x4C ? "✅" : "❌"}`);
  console.log(`CR (0x0D): ${cr} ${cr > 0 ? "✅" : "❌ precisa CRLF"}`);
  console.log(`LF (0x0A): ${lf}`);
  console.log(`FF (0x0C): ${ff} ${ff > 0 ? "✅ form feed" : "❌ sem form feed"}`);
  console.log(`Path: ${filePath}`);
  console.log(`Download URL: /api/pdv/labels/files/${encodeURIComponent(filename)}`);

  // Dump do conteudo
  console.log("\n--- COMANDO PPLA ---");
  // Mostrar como texto legivel (substitui CRLF por \r\n e FF por [FF])
  const readable = buf.toString("ascii")
    .replace(/\r/g, "[CR]")
    .replace(/\n/g, "[LF]\n")
    .replace(/\x0C/g, "[FF]");
  console.log(readable);

  return { filename, path: filePath, size: buf.length, cr, lf, ff };
}

// Gerar
console.log("=== PRNs Corrigidos para Argox OS-214 Plus ===");
const r1 = writeAndVerify("argox-diagnostic-min.prn", buildMinimalDiagnostic());
const r2 = writeAndVerify("argox-real-tag-fixed.prn", buildRealTag());

console.log("\n=== RESUMO ===");
console.log("Arquivo 1 (diagnostico):", r1.filename, r1.size, "bytes");
console.log("Arquivo 2 (real):", r2.filename, r2.size, "bytes");
console.log("\nCOMANDO PARA TESTAR (copie no CMD do Windows):");
console.log(`copy /b "${r1.path}" "\\\\localhost\\ArgoxRaw2"`);
console.log(`copy /b "${r2.path}" "\\\\localhost\\ArgoxRaw2"`);
