const assert = require("assert");
const {
  normalizeLocalState
} = require("../dist/sync/state");
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
    },
    snapshot() {
      return current;
    }
  };
}

module.exports = (async function () {
  const settingsStore = createMemoryStore({
    snapshotPublishMode: "inplace",
    generationRetentionCount: 3,
    remoteApplyCooldownMs: 2000,
    ignorePatterns: []
  });
  const stateStore = createMemoryStore(normalizeLocalState());
  const engine = new SyncEngine({
    deviceId: "device-a",
    backend: {
      async uploadBlob() {},
      async appendOperation() { return {}; },
      async commitManifest() {},
      async getRemoteHeads() { return {}; },
      async getPendingRemoteOperations() { return []; },
      async writeCursor() {},
      async publishSnapshot() {}
    },
    settingsStore,
    stateStore,
    now: function () {
      return 1000;
    }
  });

  await engine.trackLocalChange({
    path: "20 Wiki/Topics/a.md",
    op: "create",
    content: "a"
  });

  const afterCreate = stateStore.snapshot();
  const fileId = afterCreate.files["20 Wiki/Topics/a.md"].fileId;
  assert(fileId, "created files should get a stable fileId");

  await engine.trackRename("20 Wiki/Topics/a.md", "20 Wiki/Topics/b.md", "a");
  const afterRename = stateStore.snapshot();
  assert.strictEqual(
    afterRename.files["20 Wiki/Topics/b.md"].fileId,
    fileId,
    "rename should preserve fileId on the new path"
  );
  assert.strictEqual(
    afterRename.files["20 Wiki/Topics/a.md"],
    undefined,
    "rename should remove the old path from tracked files"
  );

  await engine.trackLocalChange({
    path: "20 Wiki/Topics/b.md",
    op: "delete",
    content: ""
  });
  const afterDelete = stateStore.snapshot();
  assert.strictEqual(
    afterDelete.files["20 Wiki/Topics/b.md"],
    undefined,
    "delete should remove the file from tracked state"
  );
})();
