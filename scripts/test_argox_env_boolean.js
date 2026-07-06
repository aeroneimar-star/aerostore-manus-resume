"use strict";

const assert = require("assert");
const { readEnvBoolean, getEnvRaw } = require("../modules/pdv/services/argoxEnvBoolean");
const { resolveSafeTestMode } = require("../modules/pdv/services/argoxPplaEnvelope");

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

function assertSafeMode(envValue, expected) {
  withEnv("ARGOX_SAFE_TEST_MODE", envValue, () => {
    assert.strictEqual(
      resolveSafeTestMode({}, {}),
      expected,
      `resolveSafeTestMode env=${JSON.stringify(envValue)}`
    );
  });
}

assert.strictEqual(readEnvBoolean(undefined, false), false, "sem valor deve usar fallback false");
assert.strictEqual(readEnvBoolean("", false), false, "string vazia deve usar fallback false");
assert.strictEqual(readEnvBoolean("false", true), false, "string false nunca pode virar true");
assert.strictEqual(readEnvBoolean("FALSE", true), false, "FALSE maiusculo nunca pode virar true");
assert.strictEqual(readEnvBoolean("0", true), false, "zero string deve ser false");
assert.strictEqual(readEnvBoolean("off", true), false, "off deve ser false");
assert.strictEqual(readEnvBoolean("true", false), true, "true deve ser true");
assert.strictEqual(readEnvBoolean("1", false), true, "um string deve ser true");
assert.strictEqual(readEnvBoolean("on", false), true, "on deve ser true");
assert.strictEqual(readEnvBoolean(false, true), false, "boolean false deve permanecer false");
assert.strictEqual(readEnvBoolean(true, false), true, "boolean true deve permanecer true");

withEnv("ARGOX_SAFE_TEST_MODE", undefined, () => {
  assert.strictEqual(resolveSafeTestMode({}, {}), false, "sem env deve ser safe false");
});

assertSafeMode("true", true);
assertSafeMode("false", false);
assertSafeMode("1", true);
assertSafeMode("0", false);
assertSafeMode("off", false);
assertSafeMode("on", true);

withEnv("ARGOX_AGENT_DRY_RUN", "false", () => {
  assert.strictEqual(readEnvBoolean(process.env.ARGOX_AGENT_DRY_RUN, false), false);
  assert.strictEqual(getEnvRaw("ARGOX_AGENT_DRY_RUN"), "false");
});

console.log(JSON.stringify({ ok: true, cases: 17 }, null, 2));
