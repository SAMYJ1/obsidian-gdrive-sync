const assert = require("assert");
const {
  DEFAULT_SETTINGS,
  normalizeSettings
} = require("../dist/settings");

assert.strictEqual(
  DEFAULT_SETTINGS.snapshotPublishMode,
  "inplace",
  "snapshotPublishMode should default to inplace"
);

assert.strictEqual(
  DEFAULT_SETTINGS.remoteApplyCooldownMs,
  2000,
  "remoteApplyCooldownMs should default to 2000ms"
);

assert.strictEqual(
  DEFAULT_SETTINGS.generationRetentionCount,
  3,
  "generationRetentionCount should default to 3"
);

assert.strictEqual(
  DEFAULT_SETTINGS.pushDebounceMs,
  5000,
  "pushDebounceMs should default to 5000ms"
);

assert.strictEqual(
  DEFAULT_SETTINGS.pollIntervalSeconds,
  30,
  "pollIntervalSeconds should default to 30 seconds"
);

assert.strictEqual(
  DEFAULT_SETTINGS.pollMode,
  "foreground",
  "pollMode should default to foreground"
);

const normalized = normalizeSettings({
  snapshotPublishMode: "generations",
  generationRetentionCount: 5,
  pollMode: "always",
  ignorePatterns: ["drafts/**"]
});

assert.strictEqual(normalized.snapshotPublishMode, "generations");
assert.strictEqual(normalized.generationRetentionCount, 5);
assert.strictEqual(normalized.pollMode, "always");
assert.strictEqual(normalized.remoteApplyCooldownMs, 2000);
assert.deepStrictEqual(normalized.ignorePatterns, ["drafts/**"]);
