const assert = require("assert");
const { coldStart, isColdStartState } = require("../dist/sync/engine");
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
  assert.strictEqual(
    isColdStartState(normalizeLocalState()),
    true,
    "empty local state should trigger cold start"
  );
  assert.strictEqual(
    isColdStartState(normalizeLocalState({
      cursorByDevice: { "device-a": 1 }
    })),
    false,
    "existing cursors should disable cold start"
  );

  const appliedSnapshots = [];
  const appliedRemoteOps = [];
  const cursorWrites = [];
  const stateStore = createMemoryStore(normalizeLocalState());

  const backend = {
    async registerDevice(deviceId) {
      return deviceId;
    },
    async readSnapshotMeta() {
      return {
        snapshotSeqs: { "device-a": 2 }
      };
    },
    async readManifest() {
      return {
        version: 1,
        devices: {
          "device-a": { opsHead: 3, status: "active" },
          "device-b": { opsHead: 1, status: "active" }
        },
        files: {
          "notes/a.md": {
            fileId: "file-1",
            version: 2,
            blobHash: "sha256:a",
            lastModifiedBy: "device-a",
            updatedAt: 10
          }
        }
      };
    },
    async downloadSnapshot() {
      return [
        { path: "notes/a.md", content: "snapshot-a" }
      ];
    },
    async getPendingRemoteOperations(cursorByDevice) {
      assert.deepStrictEqual(
        cursorByDevice,
        { "device-a": 2 },
        "cold start should replay from pinned snapshotSeqs"
      );
      return [
        { device: "device-a", seq: 3, path: "notes/a.md", op: "modify", blobHash: "sha256:a3", ts: 20 },
        { device: "device-b", seq: 1, path: "notes/b.md", op: "create", blobHash: "sha256:b1", ts: 21 },
        { device: "device-b", seq: 2, path: "notes/c.md", op: "create", blobHash: "sha256:future", ts: 22 }
      ];
    },
    async writeCursor(deviceId, cursorVector) {
      cursorWrites.push([deviceId, cursorVector]);
    }
  };

  const result = await coldStart({
    backend: backend,
    deviceId: "device-local",
    stateStore: stateStore,
    vaultAdapter: {
      async applySnapshot(files) {
        appliedSnapshots.push(files);
      }
    },
    applyRemoteOperations: async function(entries) {
      appliedRemoteOps.push(entries);
      var state = await stateStore.load();
      entries.forEach(function(entry) {
        if (entry.op === "delete") {
          delete state.files[entry.path];
        } else {
          state.files[entry.path] = {
            path: entry.path,
            blobHash: entry.blobHash,
            fileId: entry.fileId || entry.path,
            version: 1,
            content: entry.path
          };
        }
      });
      await stateStore.save(state);
    }
  });

  assert.strictEqual(appliedSnapshots.length, 1, "cold start should download and apply the pinned snapshot first");
  assert.strictEqual(appliedRemoteOps.length, 1, "cold start should replay remote ops after snapshot");
  assert.deepStrictEqual(
    appliedRemoteOps[0].map((entry) => entry.device + ":" + entry.seq),
    ["device-a:3", "device-b:1"],
    "cold start should cap replay at target heads pinned from the manifest"
  );
  assert.deepStrictEqual(
    cursorWrites[0],
    ["device-local", { "device-a": 3, "device-b": 1 }],
    "cold start should advance local cursors to the pinned target heads"
  );
  assert.deepStrictEqual(
    result.targetHeads,
    { "device-a": 3, "device-b": 1 },
    "cold start should return the pinned target heads"
  );
})();
