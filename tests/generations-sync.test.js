const assert = require("assert");
const { SyncEngine } = require("../dist/sync/engine");

function createMemoryStore(initialValue) {
  let current = initialValue;
  return {
    async load() {
      return current;
    },
    async save(nextValue) {
      current = nextValue;
      return current;
    }
  };
}

module.exports = (async function() {
  const snapshotCalls = [];
  const engine = new SyncEngine({
    deviceId: "device-a",
    backend: {
      async uploadBlob() {},
      async appendOperation() { return {}; },
      async commitManifest() {},
      async getRemoteHeads() { return {}; },
      async getPendingRemoteOperations() { return []; },
      async writeCursor() {},
      async readSnapshotMeta() {
        return {
          generationId: "gen-001",
          snapshotSeqs: { "device-a": 1 }
        };
      },
      async publishSnapshot(input) {
        snapshotCalls.push(input);
      }
    },
    settingsStore: createMemoryStore({
      snapshotPublishMode: "generations",
      generationRetentionCount: 3,
      remoteApplyCooldownMs: 2000,
      ignorePatterns: []
    }),
    stateStore: createMemoryStore(undefined),
    runtimeStateStore: {
      beginRemoteApply() {},
      completeRemoteApply() {}
    },
    now: function() {
      return 1000;
    }
  });

  await engine.trackLocalChange({
    path: "notes/a.md",
    op: "create",
    content: "hello"
  });
  await engine.syncNow();

  assert.strictEqual(snapshotCalls.length, 1, "sync should publish exactly one snapshot");
  assert.strictEqual(
    snapshotCalls[0].previousGenerationId,
    "gen-001",
    "generations mode should pass the currently published generation id into the publisher"
  );
})();
