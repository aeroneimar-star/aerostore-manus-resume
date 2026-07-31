"use strict";

const path = require("node:path");
const {
  createReadOnlyDatabase,
  captureSnapshot,
  readIntegrity
} = require("../modules/customers/master/calibration/customerMasterReadOnlyCalibration");
const {
  stableStringify
} = require("../modules/customers/master/backfill/customerMasterSourceModel");
const {
  PROFILE_VERSION,
  buildCustomerMasterConflictProfile
} = require("../modules/customers/master/analysis/customerMasterConflictProfile");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--read-only") values.readOnly = true;
    else if (["--database", "--allowed-root", "--label"].includes(token)) {
      values[token.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error("CUSTOMER_MASTER_PROFILE_ARGUMENT_INVALID");
    }
  }
  return values;
}

function assertSanitizedOutput(profile) {
  const serialized = stableStringify(profile);
  const findings = [];
  if (/[a-f0-9]{64}/i.test(serialized)) findings.push("SHA256_LIKE_TOKEN");
  if (/\b(cmr|cms|cmi|cic|cip|cmj|cmk):/i.test(serialized)) findings.push("MASTER_ID_PREFIX");
  if (/\b\d{11}\b/.test(serialized)) findings.push("CPF_LIKE_NUMBER");
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+/i.test(serialized)) findings.push("EMAIL_LIKE_TOKEN");
  return { sanitized: findings.length === 0, findings };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const label = String(args.label || "authorized-local-database");
    const database = await createReadOnlyDatabase({
      databasePath: args.database,
      allowedRoots: args["allowed-root"] ? [path.resolve(args["allowed-root"])] : [],
      readOnly: args.readOnly === true
    });
    const startedAt = Date.now();
    try {
      const before = await captureSnapshot(database, database.databasePath);
      const integrity = await readIntegrity(database);
      if (integrity.status !== "ok") {
        process.stdout.write(`${JSON.stringify({ status: "BLOQUEADO_INTEGRIDADE_BANCO", database: label, integrity }, null, 2)}\n`);
        process.exitCode = 3;
        return;
      }

      const conflicts = await database.all(
        "SELECT id, conflict_type, severity, status, rule_version, evidence_json FROM customer_identity_conflicts"
      );
      const participants = await database.all(
        "SELECT conflict_id, participant_type, participant_id FROM customer_identity_conflict_participants"
      );
      const sourceLinks = await database.all(
        "SELECT id, master_id, source_type, status FROM customer_master_sources"
      );

      const profile = buildCustomerMasterConflictProfile({ conflicts, participants, sourceLinks });

      const after = await captureSnapshot(database, database.databasePath);
      const invariantsUnchanged = stableStringify(before) === stableStringify(after);
      const sanitization = assertSanitizedOutput(profile);

      const output = {
        status: invariantsUnchanged && sanitization.sanitized
          ? "PROFILE_OK"
          : !invariantsUnchanged ? "BLOQUEADO_CONCORRENCIA_OU_INSTABILIDADE" : "BLOQUEADO_PII",
        profileVersion: PROFILE_VERSION,
        database: label,
        openMode: database.openMode,
        integrity,
        invariantsUnchanged,
        sanitization,
        profile,
        performance: { durationMs: Date.now() - startedAt },
        sqlCategories: { ...database.sqlCategories }
      };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      process.exitCode = output.status === "PROFILE_OK" ? 0 : 4;
    } finally {
      await database.close();
    }
  } catch (error) {
    const code = /^CUSTOMER_MASTER_[A-Z_]+$/.test(String(error?.message || ""))
      ? error.message
      : "CUSTOMER_MASTER_PROFILE_FAILED_SAFELY";
    process.stderr.write(`${JSON.stringify({ status: "BLOCKED", error: code }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  assertSanitizedOutput,
  main
};
