"use strict";

const {
  runSyntheticCalibration
} = require("../modules/customers/master/calibration/customerMasterSynthetic59143");
const {
  SYNTHETIC_59143_LIMITS
} = require("../modules/customers/master/calibration/customerMasterCalibrationLimits");

function parseArgs(argv) {
  if (argv.length > 1 || (argv[0] && !["representative", "stress"].includes(argv[0]))) {
    throw new Error("CUSTOMER_MASTER_SYNTHETIC_CALIBRATION_ARGUMENT_INVALID");
  }
  return { scenario: argv[0] || "representative" };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runSyntheticCalibration({
      scenario: args.scenario,
      limits: SYNTHETIC_59143_LIMITS,
      collectGarbage: true
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "COMPLETE"
      || result.errorCode === "CLUSTER_SIZE_LIMIT_EXCEEDED"
      ? 0
      : 2;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "BLOCKED",
      error: /^CUSTOMER_MASTER_SYNTHETIC_CALIBRATION_[A-Z_]+$/.test(error?.message)
        ? error.message
        : "CUSTOMER_MASTER_SYNTHETIC_CALIBRATION_FAILED_SAFELY"
    })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  main
};
