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
    },
    snapshot() {
      return current;
    }
  };
}

module.exports = (async function() {
  const backendCalls = [];
  const vaultContents = {
    "Folder/a.md": "A",
    "Folder/b.md": "B"
  };
  const stateStore = createMemoryStore(undefined);
  const settingsStore = createMemoryStore({
    snapshotPublishMode: "inplace",
    generationRetentionCount: 3,
    remoteApplyCooldownMs: 2000,
    ignorePatterns: []
  });

  const engine = new SyncEngine({
    deviceId: "device-local",
    backend: {
      async readManifest() {
        return { version: 2, devices: {}, files: {} };
      },
      async readSnapshotMeta() {
        return { snapshotSeqs: {} };
      },
      async uploadBlob(change) {
        backendCalls.push(["uploadBlob", change.path]);
        return { blobHash: change.blobHash };
      },
      async appendOperation(entry) {
        backendCalls.push(["appendOperation", entry.path]);
        return { remoteOpLogId: "op-" + entry.seq };
      },
      async commitManifest(patch) {
        backendCalls.push(["commitManifest", patch.files.map((file) => file.path)]);
        return {};
      },
      async getPendingRemoteOperations() {
        return [];
      },
      async writeCursor() {},
      async publishSnapshot(input) {
        backendCalls.push(["publishSnapshot", input.files.map((file) => file.path)]);
        return {};
      }
    },
    settingsStore,
    stateStore,
    runtimeStateStore: {
      beginRemoteApply() {},
      completeRemoteApply() {}
    },
    vaultAdapter: {
      async listSnapshotFiles() {
        return [
          { path: "Folder/a.md", content: "A" },
          { path: "Folder/b.md", content: "B" }
        ];
      },
      async readChangeContent(filePath) {
        return vaultContents[filePath] || "";
      }
    },
    now: function() {
      return 1000;
    }
  });

  await engine.syncNow();

  const uploadedPaths = backendCalls
    .filter((entry) => entry[0] === "uploadBlob")
    .map((entry) => entry[1])
    .sort();

  assert.deepStrictEqual(
    uploadedPaths,
    ["Folder/a.md", "Folder/b.md"],
    "initial local bootstrap should upload the full local vault when remote state is empty"
  );

  const snapshotCall = backendCalls.find((entry) => entry[0] === "publishSnapshot");
  assert.deepStrictEqual(
    snapshotCall[1].sort(),
    ["vault/Folder/a.md", "vault/Folder/b.md"],
    "initial local bootstrap should publish a full snapshot for the active vault"
  );
})();
