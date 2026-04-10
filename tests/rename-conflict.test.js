const assert = require("assert");
const { SyncEngine } = require("../dist/sync/engine");
const { normalizeLocalState } = require("../dist/sync/state");

function createMemoryStore(initialValue) {
  let current = initialValue;
  return {
    async load() {
      return current;
    },
    async save(nextValue) {
      current = nextValue;
      return current;
    },
    snapshot() {
      return current;
    }
  };
}

module.exports = (async function() {
  const conflictCopies = [];
  const stateStore = createMemoryStore(normalizeLocalState());
  const settingsStore = createMemoryStore({
    snapshotPublishMode: "inplace",
    generationRetentionCount: 3,
    remoteApplyCooldownMs: 2000,
    ignorePatterns: []
  });
  const engine = new SyncEngine({
    deviceId: "device-a",
    backend: {
      async uploadBlob() {},
      async appendOperation() { return {}; },
      async commitManifest() {},
      async getRemoteHeads() { return {}; },
      async getPendingRemoteOperations() { return []; },
      async writeCursor() {},
      async publishSnapshot() {},
      async fetchBlob(blobHash) {
        return blobHash === "sha256:local" ? "hello" : "hello";
      }
    },
    settingsStore: settingsStore,
    stateStore: stateStore,
    runtimeStateStore: {
      beginRemoteApply() {},
      completeRemoteApply() {}
    },
    vaultAdapter: {
      async applyRemoteOperation() {},
      async writeConflictCopy(filePath, content) {
        conflictCopies.push({ path: filePath, content: content });
      }
    },
    now: function() {
      return 2000;
    }
  });

  await engine.trackLocalChange({
    path: "notes/original.md",
    op: "create",
    content: "hello"
  });
  const initialState = stateStore.snapshot();
  const original = initialState.files["notes/original.md"];
  await engine.trackRename("notes/original.md", "notes/local.md", "hello");

  await engine.applyRemoteOperations([
    {
      device: "device-b",
      seq: 2,
      op: "rename",
      path: "notes/original.md",
      newPath: "notes/remote.md",
      fileId: original.fileId,
      blobHash: "sha256:local",
      parentBlobHashes: [original.blobHash],
      ts: 3000
    }
  ]);

  const finalState = stateStore.snapshot();
  assert.strictEqual(
    conflictCopies.length,
    1,
    "rename-vs-rename with different targets should emit a conflict copy instead of silently tracking both targets"
  );
  assert(
    !(finalState.files["notes/local.md"] && finalState.files["notes/remote.md"]),
    "rename-vs-rename should not leave both local and remote targets tracked for the same logical file"
  );
})();
