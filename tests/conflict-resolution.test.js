const assert = require("assert");
const { SyncEngine } = require("../dist/sync/engine");
const { normalizeLocalState } = require("../dist/sync/state");

function createMemoryStore(initialValue) {
  let current = initialValue;
  return {
    async load() { return current; },
    async save(nextValue) { current = nextValue; return current; },
    snapshot() { return current; }
  };
}

function createTestEngine(opts) {
  var blobs = opts.blobs || {};
  var opsForFile = opts.opsForFile || [];
  var remoteHeads = opts.remoteHeads || {};
  var pendingRemoteOps = opts.pendingRemoteOps || [];

  var appliedOps = [];
  var writtenFiles = [];
  var conflictCopies = [];

  var fakeBackend = {
    async fetchBlob(blobHash) {
      if (blobs[blobHash] !== undefined) return blobs[blobHash];
      throw new Error("blob not found: " + blobHash);
    },
    async getOpsForFile(fileId, limit) {
      return opsForFile;
    },
    async getRemoteHeads() {
      return remoteHeads;
    },
    async getPendingRemoteOperations() {
      return pendingRemoteOps;
    },
    async writeCursor() {},
    async uploadBlob() {},
    async appendOperation() { return {}; },
    async commitManifest() { return {}; },
    async publishSnapshot() { return { published: true }; }
  };

  var fakeVaultAdapter = {
    async applyRemoteOperation(entry) {
      appliedOps.push(entry);
    },
    async writeFile(filePath, content) {
      writtenFiles.push({ path: filePath, content: content });
    },
    async writeConflictCopy(filePath, content) {
      conflictCopies.push({ path: filePath, content: content });
    }
  };

  var stateStore = createMemoryStore(opts.initialState || undefined);
  var settingsStore = createMemoryStore({
    snapshotPublishMode: "inplace",
    generationRetentionCount: 3,
    remoteApplyCooldownMs: 2000,
    ignorePatterns: []
  });

  var fakeRuntimeStateStore = {
    beginRemoteApply: function() {},
    completeRemoteApply: function() {}
  };

  var engine = new SyncEngine({
    deviceId: opts.deviceId || "device-a",
    backend: fakeBackend,
    settingsStore: settingsStore,
    stateStore: stateStore,
    runtimeStateStore: fakeRuntimeStateStore,
    vaultAdapter: fakeVaultAdapter,
    now: opts.now || function() { return 1000; }
  });

  return {
    engine: engine,
    stateStore: stateStore,
    appliedOps: appliedOps,
    writtenFiles: writtenFiles,
    conflictCopies: conflictCopies
  };
}

module.exports = (async function() {

  // =========================================================================
  // 1. modify-vs-modify clean merge
  // =========================================================================
  {
    var state = normalizeLocalState();
    state.files["test.md"] = {
      path: "test.md",
      fileId: "file-1",
      version: 2,
      blobHash: "sha256:local-hash",
      content: "LOCAL-LINE1\nline2\nline3\nline4\n",
      lastModifiedBy: "device-a",
      updatedAt: 1000
    };

    var remoteOps = [{
      device: "device-b",
      seq: 5,
      op: "modify",
      path: "test.md",
      fileId: "file-1",
      blobHash: "sha256:remote-hash",
      parentBlobHashes: ["sha256:base-hash"],
      ts: 2000
    }];

    var blobs = {
      "sha256:base-hash": "line1\nline2\nline3\nline4\n",
      "sha256:local-hash": "LOCAL-LINE1\nline2\nline3\nline4\n",
      "sha256:remote-hash": "line1\nline2\nline3\nREMOTE-LINE4\n"
    };

    // Provide ops so findCommonAncestor BFS can trace
    // local-hash -> base-hash (common ancestor with remote's parentBlobHashes)
    var opsForFile = [
      { blobHash: "sha256:local-hash", parentBlobHashes: ["sha256:base-hash"] },
      { blobHash: "sha256:remote-hash", parentBlobHashes: ["sha256:base-hash"] }
    ];

    var t = createTestEngine({
      initialState: state,
      blobs: blobs,
      opsForFile: opsForFile
    });

    await t.engine.applyRemoteOperations(remoteOps);

    assert.strictEqual(t.writtenFiles.length, 1, "clean merge: writeFile should be called once");
    assert.strictEqual(t.appliedOps.length, 0, "clean merge: applyRemoteOperation should NOT be called");
    var merged = t.writtenFiles[0].content;
    assert(merged.indexOf("LOCAL-LINE1") !== -1, "clean merge: merged content should contain local change");
    assert(merged.indexOf("REMOTE-LINE4") !== -1, "clean merge: merged content should contain remote change");
    assert(merged.indexOf("<<<<<<<") === -1, "clean merge: should have no conflict markers");
    assert.strictEqual(
      t.stateStore.snapshot().files["test.md"].content,
      merged,
      "clean merge: tracked state should keep the merged content, not revert to the remote-only blob"
    );
  }

  // =========================================================================
  // 2. modify-vs-modify with conflict
  // =========================================================================
  {
    var state = normalizeLocalState();
    state.files["test.md"] = {
      path: "test.md",
      fileId: "file-1",
      version: 2,
      blobHash: "sha256:local-hash",
      content: "line1\nLOCAL-LINE2\nline3\n",
      lastModifiedBy: "device-a",
      updatedAt: 1000
    };

    var remoteOps = [{
      device: "device-b",
      seq: 5,
      op: "modify",
      path: "test.md",
      fileId: "file-1",
      blobHash: "sha256:remote-hash",
      parentBlobHashes: ["sha256:base-hash"],
      ts: 2000
    }];

    var blobs = {
      "sha256:base-hash": "line1\nline2\nline3\n",
      "sha256:local-hash": "line1\nLOCAL-LINE2\nline3\n",
      "sha256:remote-hash": "line1\nREMOTE-LINE2\nline3\n"
    };

    var t = createTestEngine({
      initialState: state,
      blobs: blobs,
      opsForFile: [
        { blobHash: "sha256:local-hash", parentBlobHashes: ["sha256:base-hash"] },
        { blobHash: "sha256:remote-hash", parentBlobHashes: ["sha256:base-hash"] }
      ]
    });

    await t.engine.applyRemoteOperations(remoteOps);

    assert.strictEqual(t.writtenFiles.length, 1, "conflict merge: writeFile should be called once");
    assert.strictEqual(t.appliedOps.length, 0, "conflict merge: applyRemoteOperation should NOT be called");
    var merged = t.writtenFiles[0].content;
    assert(merged.indexOf("<<<<<<<") !== -1, "conflict merge: should contain <<<<<<< marker");
    assert(merged.indexOf("=======") !== -1, "conflict merge: should contain ======= marker");
    assert(merged.indexOf(">>>>>>>") !== -1, "conflict merge: should contain >>>>>>> marker");
    assert(merged.indexOf("LOCAL-LINE2") !== -1, "conflict merge: should contain local change in markers");
    assert(merged.indexOf("REMOTE-LINE2") !== -1, "conflict merge: should contain remote change in markers");
    assert.strictEqual(
      t.stateStore.snapshot().files["test.md"].content,
      merged,
      "conflict merge: tracked state should keep the merged conflict-marked content"
    );
  }

  // =========================================================================
  // 3. modify-vs-modify no ancestor (two-way fallback)
  // =========================================================================
  {
    var state = normalizeLocalState();
    state.files["test.md"] = {
      path: "test.md",
      fileId: "file-1",
      version: 2,
      blobHash: "sha256:local-hash",
      content: "local content\n",
      lastModifiedBy: "device-a",
      updatedAt: 1000
    };

    // Remote op has parentBlobHashes that do NOT match localFile.blobHash
    // and no common ancestor can be found (getOpsForFile returns empty)
    var remoteOps = [{
      device: "device-b",
      seq: 5,
      op: "modify",
      path: "test.md",
      fileId: "file-1",
      blobHash: "sha256:remote-hash",
      parentBlobHashes: ["sha256:unknown-parent"],
      ts: 2000
    }];

    var blobs = {
      "sha256:local-hash": "local content\n",
      "sha256:remote-hash": "remote content\n"
    };
    // no blob for unknown-parent — ancestor lookup will return null

    var t = createTestEngine({
      initialState: state,
      blobs: blobs,
      opsForFile: []  // no ops history — ancestor search finds nothing
    });

    await t.engine.applyRemoteOperations(remoteOps);

    assert.strictEqual(t.writtenFiles.length, 1, "no-ancestor: writeFile should be called once");
    assert.strictEqual(t.appliedOps.length, 0, "no-ancestor: applyRemoteOperation should NOT be called");
    var merged = t.writtenFiles[0].content;
    // With empty base, all lines from both sides are diffed — should produce conflict markers
    assert(merged.indexOf("<<<<<<<") !== -1, "no-ancestor: should contain conflict markers when no common base exists");
    assert(merged.indexOf("local content") !== -1, "no-ancestor: should contain local content");
    assert(merged.indexOf("remote content") !== -1, "no-ancestor: should contain remote content");
  }

  // =========================================================================
  // 4. delete-vs-modify: remote deletes a locally modified file
  // =========================================================================
  {
    var state = normalizeLocalState();
    state.files["notes/important.md"] = {
      path: "notes/important.md",
      fileId: "file-2",
      version: 3,
      blobHash: "sha256:local-modified",
      content: "locally modified content\n",
      lastModifiedBy: "device-a",
      updatedAt: 1000
    };

    var remoteOps = [{
      device: "device-b",
      seq: 10,
      op: "delete",
      path: "notes/important.md",
      fileId: "file-2",
      blobHash: null,
      parentBlobHashes: ["sha256:original-hash"],
      ts: 2000
    }];

    var t = createTestEngine({
      initialState: state,
      blobs: {},
      opsForFile: []
    });

    await t.engine.applyRemoteOperations(remoteOps);

    assert.strictEqual(t.appliedOps.length, 0, "delete-vs-modify: delete should NOT be applied (file kept)");
    assert.strictEqual(t.conflictCopies.length, 1, "delete-vs-modify: writeConflictCopy should be called once");
    assert(
      t.conflictCopies[0].path.indexOf(".deleted-conflict.md") !== -1,
      "delete-vs-modify: conflict copy path should contain .deleted-conflict.md, got: " + t.conflictCopies[0].path
    );
    assert.strictEqual(
      t.conflictCopies[0].content,
      "locally modified content\n",
      "delete-vs-modify: conflict copy should contain local content"
    );

    // Verify the file is still tracked in state (not removed)
    var finalState = t.stateStore.snapshot();
    assert(
      finalState.files["notes/important.md"],
      "delete-vs-modify: file should still be tracked in state"
    );
  }

  // =========================================================================
  // 5. Binary modify-vs-modify: remote modifies a .png that was locally modified
  // =========================================================================
  {
    var state = normalizeLocalState();
    state.files["images/photo.png"] = {
      path: "images/photo.png",
      fileId: "file-3",
      version: 2,
      blobHash: "sha256:local-png-hash",
      content: "local-binary-data",
      lastModifiedBy: "device-a",
      updatedAt: 1000
    };

    var remoteOps = [{
      device: "device-b",
      seq: 7,
      op: "modify",
      path: "images/photo.png",
      fileId: "file-3",
      blobHash: "sha256:remote-png-hash",
      parentBlobHashes: ["sha256:base-png-hash"],
      ts: 2000
    }];

    var t = createTestEngine({
      initialState: state,
      blobs: {},
      opsForFile: []
    });

    await t.engine.applyRemoteOperations(remoteOps);

    assert.strictEqual(t.appliedOps.length, 1, "binary conflict: applyRemoteOperation should be called (remote wins)");
    assert.strictEqual(t.appliedOps[0].path, "images/photo.png", "binary conflict: applied op should target the correct file");
    assert.strictEqual(t.conflictCopies.length, 1, "binary conflict: writeConflictCopy should be called once");
    assert(
      t.conflictCopies[0].path.indexOf(".conflict-device-b-2000.png") !== -1,
      "binary conflict: conflict copy path should contain .conflict-{device}-{ts}.png, got: " + t.conflictCopies[0].path
    );
    assert.strictEqual(
      t.conflictCopies[0].content,
      "local-binary-data",
      "binary conflict: conflict copy should contain local binary content"
    );
  }

  // =========================================================================
  // 6. No conflict — normal apply
  // =========================================================================
  {
    var state = normalizeLocalState();
    state.files["doc.md"] = {
      path: "doc.md",
      fileId: "file-4",
      version: 1,
      blobHash: "sha256:base-hash",
      content: "original content\n",
      lastModifiedBy: "device-a",
      updatedAt: 500
    };

    // Remote modifies the file, and local blobHash matches remote's parentBlobHash
    // (i.e., local has NOT changed since the common ancestor)
    var remoteOps = [{
      device: "device-b",
      seq: 3,
      op: "modify",
      path: "doc.md",
      fileId: "file-4",
      blobHash: "sha256:new-remote-hash",
      parentBlobHashes: ["sha256:base-hash"],
      ts: 1500
    }];

    var t = createTestEngine({
      initialState: state,
      blobs: {},
      opsForFile: []
    });

    await t.engine.applyRemoteOperations(remoteOps);

    assert.strictEqual(t.appliedOps.length, 1, "no conflict: applyRemoteOperation should be called once");
    assert.strictEqual(t.appliedOps[0].path, "doc.md", "no conflict: applied op should target the correct file");
    assert.strictEqual(t.writtenFiles.length, 0, "no conflict: writeFile should NOT be called");
    assert.strictEqual(t.conflictCopies.length, 0, "no conflict: writeConflictCopy should NOT be called");
  }

})();
