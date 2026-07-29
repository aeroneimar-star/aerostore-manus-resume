"use strict";

const path = require("node:path");
const {
  runRealReadOnlyCalibration
} = require("../modules/customers/master/calibration/customerMasterReadOnlyCalibration");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--read-only") values.readOnly = true;
    else if ([
      "--database",
      "--allowed-root",
      "--label",
      "--code-version",
      "--limit-profile"
    ].includes(token)) {
      values[token.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error("CUSTOMER_MASTER_CALIBRATION_ARGUMENT_INVALID");
    }
  }
  return values;
}

function sanitizeError(error) {
  const code = String(error?.message || "");
  return /^CUSTOMER_MASTER_CALIBRATION_[A-Z_]+$/.test(code)
    ? code
    : "CUSTOMER_MASTER_CALIBRATION_FAILED_SAFELY";
}

function exitCodeForStatus(status) {
  if (status === "COMPLETE") return 0;
  if (status === "CALIBRATION_LIMIT_EXCEEDED") return 3;
  return 2;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runRealReadOnlyCalibration({
      databasePath: args.database,
      allowedRoots: args["allowed-root"] ? [path.resolve(args["allowed-root"])] : [],
      databaseLabel: String(args.label || "authorized-local-database"),
      codeVersion: String(args["code-version"] || "LOCAL_UNCOMMITTED"),
      limitProfile: args["limit-profile"],
      readOnly: args.readOnly === true
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = exitCodeForStatus(result.status);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "BLOCKED", error: sanitizeError(error) })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  sanitizeError,
  exitCodeForStatus,
  main
};
