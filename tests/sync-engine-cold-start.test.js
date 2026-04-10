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
  const calls = [];
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
      async registerDevice(deviceId) {
        calls.push(["registerDevice", deviceId]);
      },
      async readSnapshotMeta() {
        calls.push(["readSnapshotMeta"]);
        return { snapshotSeqs: { "device-a": 1 } };
      },
      async readManifest() {
        calls.push(["readManifest"]);
        return {
          version: 1,
          devices: {
            "device-a": { opsHead: 2, status: "active" }
          },
          files: {
            "notes/a.md": { fileId: "f-a", version: 1, blobHash: "sha256:a" }
          }
        };
      },
      async downloadSnapshot() {
        calls.push(["downloadSnapshot"]);
        return [{ path: "notes/a.md", content: "snapshot-a" }];
      },
      async getPendingRemoteOperations(cursorByDevice) {
        calls.push(["getPendingRemoteOperations", cursorByDevice]);
        return [{ device: "device-a", seq: 2, path: "notes/a.md", op: "modify", blobHash: "sha256:a2", ts: 20 }];
      },
      async writeCursor(deviceId, vector) {
        calls.push(["writeCursor", deviceId, vector]);
      },
      async getRemoteHeads() {
        calls.push(["getRemoteHeads"]);
        return { "device-a": 2 };
      },
      async publishSnapshot() {
        calls.push(["publishSnapshot"]);
      },
      async fetchBlob(blobHash) {
        return blobHash === "sha256:a2" ? "remote-a2" : "";
      }
    },
    settingsStore: settingsStore,
    stateStore: stateStore,
    runtimeStateStore: {
      beginRemoteApply() {},
      completeRemoteApply() {}
    },
    vaultAdapter: {
      async applySnapshot(files) {
        calls.push(["applySnapshot", files.length]);
      },
      async applyRemoteOperation(entry) {
        calls.push(["applyRemoteOperation", entry.path, entry.seq]);
      }
    },
    now: function() {
      return 1000;
    }
  });

  await engine.syncNow();

  assert(
    calls.some((entry) => entry[0] === "downloadSnapshot"),
    "syncNow should cold start by downloading the snapshot on a fresh device"
  );
  assert(
    calls.some((entry) => entry[0] === "applyRemoteOperation" && entry[2] === 2),
    "syncNow should replay remote operations after cold start"
  );
  const finalState = stateStore.snapshot();
  assert.deepStrictEqual(
    finalState.cursorByDevice,
    { "device-a": 2 },
    "syncNow cold start should persist the pinned cursor vector"
  );
})();
