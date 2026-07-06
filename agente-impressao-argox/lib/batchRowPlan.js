"use strict";

const BATCH_ROW_LAYOUT = Object.freeze({
  ROW_WIDTH_PX: 640,
  ROW_HEIGHT_PX: 480,
  CELL_WIDTH_PX: 320,
  CELL_HEIGHT_PX: 480,
  ROW_WIDTH_MM: 80,
  ROW_HEIGHT_MM: 60,
  LABEL_WIDTH_MM: 40,
  LABEL_HEIGHT_MM: 60,
  DPI: 203
});

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveDriverColumns(config = {}) {
  const raw = config.driver_columns ?? config.driverColumns ?? process.env.ARGOX_DRIVER_COLUMNS ?? "2";
  const parsed = Math.floor(normalizeNumber(raw, 2));
  return parsed === 1 ? 1 : 2;
}

function chunkLabelsIntoRows(items = [], columns = 2) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const cols = columns <= 1 ? 1 : 2;
  if (cols <= 1) {
    return list.map((item) => [item]);
  }
  const rows = [];
  for (let index = 0; index < list.length; index += cols) {
    rows.push(list.slice(index, index + cols));
  }
  return rows;
}

function resolveDriverPrintJobs(totalRows = 0, driverColumns = 2, options = {}) {
  const rows = Math.max(0, Number(totalRows || 0));
  const columns = Number(driverColumns || 2) <= 1 ? 1 : 2;
  const multipage = options.multipage !== false;
  if (columns <= 1) {
    return rows;
  }
  if (rows <= 1) {
    return 1;
  }
  return multipage ? 1 : rows;
}

function buildBatchPrintPlan(items = [], columns = 2) {
  const driverColumns = columns <= 1 ? 1 : 2;
  const rows = chunkLabelsIntoRows(items, driverColumns);
  const totalRows = rows.length;
  return {
    driver_columns: driverColumns,
    labels_per_row: driverColumns,
    total_labels: items.length,
    total_rows: totalRows,
    print_jobs: resolveDriverPrintJobs(totalRows, driverColumns, { multipage: true }),
    pages_printed: totalRows,
    rows,
    layout_mode: driverColumns >= 2 ? "batch_row_2x1" : "single_column"
  };
}

module.exports = {
  BATCH_ROW_LAYOUT,
  resolveDriverColumns,
  chunkLabelsIntoRows,
  resolveDriverPrintJobs,
  buildBatchPrintPlan
};
