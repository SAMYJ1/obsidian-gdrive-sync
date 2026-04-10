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

module.exports = (async function () {
  const backendCalls = [];
  let lastCursorWrite = null;
  const fakeBackend = {
    async uploadBlob(change) {
      backendCalls.push(["uploadBlob", change.path]);
      return "sha256:" + change.path;
    },
    async appendOperation(entry) {
      backendCalls.push(["appendOperation", entry.seq, entry.path]);
      return { remoteOpLogId: "op-" + entry.seq };
    },
    async commitManifest(manifestPatch) {
      backendCalls.push(["commitManifest", manifestPatch.files.length]);
      return { committedAt: 1 };
    },
    async writeCursor(deviceId, cursorVector) {
      backendCalls.push(["writeCursor", deviceId, cursorVector]);
      lastCursorWrite = cursorVector;
    },
    async publishSnapshot(input) {
      backendCalls.push(["publishSnapshot", input.snapshotPublishMode, input]);
      return { published: true };
    },
    async getRemoteHeads() {
      return { "device-b": 3 };
    },
    async getPendingRemoteOperations(cursorByDevice) {
      backendCalls.push(["getPendingRemoteOperations", cursorByDevice]);
      return [
        {
          device: "device-b",
          seq: 3,
          path: "20 Wiki/Topics/remote.md",
          op: "modify",
          blobHash: "sha256-remote"
        }
      ];
    },
    async fetchBlob(blobHash) {
      return blobHash === "sha256-remote" ? "remote" : "";
    }
  };

  const settingsStore = createMemoryStore({
    snapshotPublishMode: "inplace",
    generationRetentionCount: 3,
    remoteApplyCooldownMs: 2000,
    ignorePatterns: []
  });
  const stateStore = createMemoryStore(undefined);
  const appliedRemoteOps = [];
  const engine = new SyncEngine({
    deviceId: "device-a",
    backend: fakeBackend,
    settingsStore,
    stateStore,
    runtimeStateStore: {
      beginRemoteApply() {},
      completeRemoteApply() {}
    },
    vaultAdapter: {
      async applyRemoteOperation(entry) {
        appliedRemoteOps.push(entry);
      }
    },
    now: function () {
      return 1000;
    }
  });

  await engine.trackLocalChange({
    path: "20 Wiki/Topics/example.md",
    op: "modify",
    content: "hello"
  });
  await engine.trackLocalChange({
    path: "20 Wiki/Topics/removed.md",
    op: "create",
    content: "bye"
  });
  await engine.trackLocalChange({
    path: "20 Wiki/Topics/removed.md",
    op: "delete",
    content: ""
  });
  await engine.syncNow();

  const finalState = stateStore.snapshot();
  assert.deepStrictEqual(finalState.outbox, [], "successful sync should commit and clear the outbox");
  assert(
    backendCalls.some((entry) => entry[0] === "uploadBlob"),
    "sync should upload changed blobs"
  );
  assert(
    backendCalls.some((entry) => entry[0] === "appendOperation"),
    "sync should append operations to the remote log"
  );
  assert(
    backendCalls.some((entry) => entry[0] === "commitManifest"),
    "sync should commit the manifest after publishing operations"
  );
  assert(
    backendCalls.some((entry) => entry[0] === "publishSnapshot" && entry[1] === "inplace"),
    "sync should publish a snapshot using the selected publish mode"
  );
  const snapshotCall = backendCalls.find((entry) => entry[0] === "publishSnapshot");
  assert(
    snapshotCall[2].deletedFiles.indexOf("vault/20 Wiki/Topics/removed.md") !== -1,
    "sync should publish local deletes into the snapshot layer"
  );
  const remoteSnapshotFile = snapshotCall[2].changedFiles.find((file) => file.path === "vault/20 Wiki/Topics/remote.md");
  assert.strictEqual(
    remoteSnapshotFile.content,
    "remote",
    "sync should publish remote-applied content into the snapshot layer instead of an empty placeholder"
  );
  const remoteFetchCall = backendCalls.find((entry) => entry[0] === "getPendingRemoteOperations");
  assert.deepStrictEqual(
    remoteFetchCall[1],
    {},
    "remote pulls should fetch using the pre-apply cursor vector, not the latest heads"
  );
  assert.deepStrictEqual(
    appliedRemoteOps.map((entry) => entry.path),
    ["20 Wiki/Topics/remote.md"],
    "sync should apply fetched remote operations before advancing cursors"
  );
  assert.deepStrictEqual(
    lastCursorWrite,
    {
      "device-b": 3
    },
    "cursor writes should reflect applied remote progress"
  );
})();
