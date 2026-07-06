"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { applySafeTestToItems } = require("../modules/pdv/services/argoxCommandBuilder");
const {
  buildFullLabelImageSpec,
  buildFullLabelSampleAgentItems,
  buildFullLabelNormalSampleAgentItems
} = require("../agente-impressao-argox/lib/fullLabelDriver");
const {
  buildBatchPrintPlan,
  resolveDriverColumns,
  resolveDriverPrintJobs,
  BATCH_ROW_LAYOUT
} = require("../agente-impressao-argox/lib/batchRowPlan");
const {
  isTransportAvailable,
  renderBatchRow,
  printRenderedBatchRows,
  renderSingleLabelImage,
  BATCH_ROW_LAYOUT: DRIVER_BATCH_LAYOUT
} = require("../agente-impressao-argox/lib/windowsDriverPrint");

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

function cloneItem(base = {}, overrides = {}) {
  return { ...base, ...overrides };
}

function buildDistinctItems(count = 2) {
  const templates = [
    cloneItem(buildFullLabelSampleAgentItems()[0], { sku_variacao: "BATCH-LEFT-001", nome: "ETIQUETA ESQUERDA BATCH" }),
    cloneItem(buildFullLabelNormalSampleAgentItems()[0], { sku_variacao: "BATCH-RIGHT-002", nome: "ETIQUETA DIREITA BATCH" }),
    cloneItem(buildFullLabelSampleAgentItems()[0], { sku_variacao: "BATCH-LEFT-003", nome: "ETIQUETA TERCEIRA BATCH" }),
    cloneItem(buildFullLabelNormalSampleAgentItems()[0], { sku_variacao: "BATCH-RIGHT-004", nome: "ETIQUETA QUARTA BATCH" }),
    cloneItem(buildFullLabelSampleAgentItems()[0], { sku_variacao: "BATCH-LEFT-005", nome: "ETIQUETA QUINTA BATCH" })
  ];
  return templates.slice(0, count);
}

function buildImageSpecForItem(item) {
  return buildFullLabelImageSpec({ items: [item], config: { safe_test_mode: false } }).imageSpec;
}

function assertPlanCounts(items, columns, expected) {
  const plan = buildBatchPrintPlan(items, columns);
  assert.strictEqual(plan.total_labels, expected.total_labels);
  assert.strictEqual(plan.driver_columns, expected.driver_columns);
  assert.strictEqual(plan.total_rows, expected.total_rows);
  assert.strictEqual(plan.print_jobs, expected.print_jobs);
  assert.strictEqual(plan.pages_printed, expected.pages_printed ?? expected.total_rows);
  assert.strictEqual(plan.labels_per_row, expected.labels_per_row);
  return plan;
}

function assertPngSize(filePath, width, height, label = "") {
  assert(fs.existsSync(filePath), `${label} PNG deve existir: ${filePath}`);
  const buffer = fs.readFileSync(filePath);
  assert.strictEqual(buffer[0], 0x89, `${label} deve ser PNG valido`);
  const widthBytes = buffer.readUInt32BE(16);
  const heightBytes = buffer.readUInt32BE(20);
  assert.strictEqual(widthBytes, width, `${label} width esperado ${width}, recebido ${widthBytes}`);
  assert.strictEqual(heightBytes, height, `${label} height esperado ${height}, recebido ${heightBytes}`);
}

function renderRowsForItems(items) {
  const plan = buildBatchPrintPlan(items, 2);
  return plan.rows.map((rowItems, rowIndex) => {
    const leftSpec = rowItems[0] ? buildImageSpecForItem(rowItems[0]) : null;
    const rightSpec = rowItems[1] ? buildImageSpecForItem(rowItems[1]) : null;
    return renderBatchRow(leftSpec, rightSpec, {
      outputDir: OUTPUT_DIR,
      prefix: `batch-row-plan-${items.length}-${rowIndex + 1}`
    });
  });
}

assert.strictEqual(resolveDriverColumns({ driver_columns: 2 }), 2);
assert.strictEqual(resolveDriverPrintJobs(1, 2), 1);
assert.strictEqual(resolveDriverPrintJobs(2, 2), 1);
assert.strictEqual(resolveDriverPrintJobs(3, 2), 1);
assert.strictEqual(resolveDriverPrintJobs(3, 1), 3);

assertPlanCounts(buildDistinctItems(1), 2, {
  total_labels: 1,
  driver_columns: 2,
  labels_per_row: 2,
  total_rows: 1,
  print_jobs: 1
});

assertPlanCounts(buildDistinctItems(2), 2, {
  total_labels: 2,
  driver_columns: 2,
  labels_per_row: 2,
  total_rows: 1,
  print_jobs: 1
});

assertPlanCounts(buildDistinctItems(3), 2, {
  total_labels: 3,
  driver_columns: 2,
  labels_per_row: 2,
  total_rows: 2,
  print_jobs: 1
});

assertPlanCounts(buildDistinctItems(4), 2, {
  total_labels: 4,
  driver_columns: 2,
  labels_per_row: 2,
  total_rows: 2,
  print_jobs: 1
});

assertPlanCounts(buildDistinctItems(5), 2, {
  total_labels: 5,
  driver_columns: 2,
  labels_per_row: 2,
  total_rows: 3,
  print_jobs: 1
});

const safeLimited = applySafeTestToItems(buildDistinctItems(5), { safe_test_mode: true });
assert.strictEqual(safeLimited.final, 1, "safe mode deve limitar a 1 etiqueta");
assert.strictEqual(buildBatchPrintPlan(safeLimited.items, 2).total_labels, 1);

if (!isTransportAvailable()) {
  console.log(JSON.stringify({
    ok: true,
    platform: process.platform,
    skipped_render: true,
    plan_tests: "passed"
  }, null, 2));
  process.exit(0);
}

process.env.ARGOX_DRIVER_COLUMNS = "2";
process.env.ARGOX_SAFE_TEST_MODE = "false";

const twoItems = buildDistinctItems(2);
const twoRows = renderRowsForItems(twoItems);
assert.strictEqual(twoRows.length, 1);
const twoDry = printRenderedBatchRows("", twoRows, { saveOnly: true, driver_columns: 2 });
assert.strictEqual(twoDry.print_jobs, 1);
assert.strictEqual(twoDry.pages_printed, 1);
assert.strictEqual(twoDry.multipage_used, false);
assertPngSize(twoRows[0].imagem_path, 640, 480, "2 etiquetas / 1 row");

const fourItems = buildDistinctItems(4);
const fourRows = renderRowsForItems(fourItems);
assert.strictEqual(fourRows.length, 2);
const fourDry = printRenderedBatchRows("", fourRows, { saveOnly: true, driver_columns: 2 });
assert.strictEqual(fourDry.print_jobs, 1);
assert.strictEqual(fourDry.pages_printed, 2);
assert.strictEqual(fourDry.multipage_used, true);
fourRows.forEach((row, index) => assertPngSize(row.imagem_path, 640, 480, `4 etiquetas row ${index + 1}`));

const fiveItems = buildDistinctItems(5);
const fiveRows = renderRowsForItems(fiveItems);
assert.strictEqual(fiveRows.length, 3);
const fiveDry = printRenderedBatchRows("", fiveRows, { saveOnly: true, driver_columns: 2 });
assert.strictEqual(fiveDry.print_jobs, 1);
assert.strictEqual(fiveDry.pages_printed, 3);
assert.strictEqual(fiveDry.multipage_used, true);
assert.strictEqual(fiveRows[2].left_used, true);
assert.strictEqual(fiveRows[2].right_used, false);

const singleCell = renderSingleLabelImage(buildImageSpecForItem(twoItems[0]), {
  outputDir: OUTPUT_DIR,
  prefix: "batch-test-cell",
  saveOnly: true
});
assert.strictEqual(singleCell.width_px, DRIVER_BATCH_LAYOUT.CELL_WIDTH_PX);
assert.strictEqual(singleCell.height_px, DRIVER_BATCH_LAYOUT.CELL_HEIGHT_PX);
assertPngSize(singleCell.imagem_path, 320, 480, "celula individual");

console.log(JSON.stringify({
  ok: true,
  two_labels: { rows: twoRows.length, print_jobs: twoDry.print_jobs, pages_printed: twoDry.pages_printed },
  four_labels: { rows: fourRows.length, print_jobs: fourDry.print_jobs, pages_printed: fourDry.pages_printed },
  five_labels: { rows: fiveRows.length, print_jobs: fiveDry.print_jobs, pages_printed: fiveDry.pages_printed },
  single_cell: `${singleCell.width_px}x${singleCell.height_px}`
}, null, 2));
