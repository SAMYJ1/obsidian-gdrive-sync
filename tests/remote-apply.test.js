const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { SyncEngine } = require("../dist/sync/engine");
const { RuntimeStateStore } = require("../dist/sync/runtime-state");

module.exports = (async function () {
  const writes = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogds-remote-apply-"));
  const runtimeStateStore = new RuntimeStateStore({
    statePath: path.join(tempDir, "runtime-state.json"),
    cooldownMs: 2000,
    now: function () {
      return 1000;
    }
  });

  const engine = new SyncEngine({
    deviceId: "device-a",
    backend: {
      async getRemoteHeads() { return {}; },
      async getPendingRemoteOperations() { return []; },
      async writeCursor() {},
      async uploadBlob() {},
      async appendOperation() { return {}; },
      async commitManifest() { return {}; }
    },
    settingsStore: {
      async load() {
        return {
          snapshotPublishMode: "inplace",
          generationRetentionCount: 3,
          remoteApplyCooldownMs: 2000,
          ignorePatterns: []
        };
      }
    },
    stateStore: {
      async load() { return undefined; },
      async save() {}
    },
    runtimeStateStore,
    vaultAdapter: {
      async applyRemoteOperation(entry) {
        writes.push(entry.path);
      }
    }
  });

  await engine.applyRemoteOperations([
    {
      path: "20 Wiki/Topics/example.md",
      op: "modify",
      blobHash: "sha256-1"
    }
  ]);

  assert.deepStrictEqual(writes, ["20 Wiki/Topics/example.md"]);
  assert.strictEqual(
    runtimeStateStore.shouldSuppressPath("20 Wiki/Topics/example.md", 1500),
    true,
    "remote apply should keep suppression active during the cooldown window"
  );
})();
