"use strict";
const sqlite3 = require("sqlite3");
const { applyAppCartSchema, getAppCartSchemaStatus } = require("../modules/customers/app-cart/persistence/appCartSchema");

function parseArgs(argv) {
  const args = {};
  const values = new Set(["database", "backup-file", "backup-sha256"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--preflight", "--apply", "--verify"].includes(token)) args[token.slice(2)] = true;
    else if (token.startsWith("--") && values.has(token.slice(2)) && argv[index + 1]) args[token.slice(2)] = argv[++index];
    else throw new Error("APP_CART_ARGUMENT_INVALID");
  }
  return args;
}

function buildDb(database) {
  if (!database) throw new Error("APP_CART_DATABASE_REQUIRED");
  const sqlite = sqlite3.verbose();
  const connection = new sqlite.Database(database);
  return {
    run: (statement, parameters = []) => new Promise((resolve, reject) => {
      connection.run(statement, parameters, (error) => error ? reject(error) : resolve(this));
    }),
    get: (statement, parameters = []) => new Promise((resolve, reject) => {
      connection.get(statement, parameters, (error, row) => error ? reject(error) : resolve(row));
    }),
    all: (statement, parameters = []) => new Promise((resolve, reject) => {
      connection.all(statement, parameters, (error, rows) => error ? reject(error) : resolve(rows));
    }),
    close: () => new Promise((resolve, reject) => connection.close((error) => error ? reject(error) : resolve()))
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  const db = buildDb(args.database);
  try {
    const status = await getAppCartSchemaStatus(db);
    if (args.preflight) {
      console.log(JSON.stringify({ command: "preflight", status }, null, 2));
      return;
    }
    if (args.verify) {
      const afterVerify = await getAppCartSchemaStatus(db);
      console.log(JSON.stringify({ command: "verify", status: afterVerify }, null, 2));
      return;
    }
    if (args.apply) {
      const result = await applyAppCartSchema(db);
      console.log(JSON.stringify({ command: "apply", result }, null, 2));
      return;
    }
    throw new Error("APP_CART_COMMAND_REQUIRED");
  } finally {
    await db.close().catch(() => null);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
