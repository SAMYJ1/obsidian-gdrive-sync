const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const {
  RuntimeStateStore
} = require("../dist/sync/runtime-state");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogds-runtime-state-"));
const statePath = path.join(tempDir, "runtime-state.json");

const store = new RuntimeStateStore({
  statePath: statePath,
  cooldownMs: 2000,
  now: function () {
    return 1000;
  }
});

store.beginRemoteApply(["20 Wiki/Topics/example.md"]);

let active = store.readState();
assert.strictEqual(active.phase, "remote_apply");
assert.deepStrictEqual(active.paths, ["20 Wiki/Topics/example.md"]);
assert.strictEqual(
  store.shouldSuppressPath("20 Wiki/Topics/example.md", 1500),
  true,
  "paths in the active remote-apply session should be suppressed"
);

store.completeRemoteApply();

let coolingDown = store.readState();
assert.strictEqual(coolingDown.phase, "idle");
assert.strictEqual(coolingDown.cooldownUntil, 3000);
assert.strictEqual(
  store.shouldSuppressPath("20 Wiki/Topics/example.md", 2500),
  true,
  "paths should still be suppressed during the cooldown window"
);
assert.strictEqual(
  store.shouldSuppressPath("20 Wiki/Topics/example.md", 3500),
  false,
  "suppression should end after cooldown"
);

const staleStore = new RuntimeStateStore({
  statePath: statePath,
  cooldownMs: 2000,
  now: function () {
    return 10000;
  }
});

staleStore.recoverIfStale();

const recovered = staleStore.readState();
assert.strictEqual(recovered.phase, "idle");
assert.deepStrictEqual(recovered.paths, []);
