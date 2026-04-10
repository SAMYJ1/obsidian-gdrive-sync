const assert = require("assert");
const { GoogleDriveBackend } = require("../dist/drive/backend");

module.exports = (async function () {
  const calls = [];
  const fakeClient = {
    async uploadBlob(change) {
      calls.push(["uploadBlob", change.path]);
      return { blobHash: change.blobHash };
    },
    async appendOperation(entry) {
      calls.push(["appendOperation", entry.path]);
      return { remoteOpLogId: "op-" + entry.seq };
    },
    async writeManifest(manifestPatch) {
      calls.push(["writeManifest", manifestPatch.files.length]);
      return { manifestVersion: 1 };
    },
    async writeJson(filePath, value) {
      calls.push(["writeJson", filePath, value]);
      return value;
    },
    async writeCursor(deviceId, cursorVector) {
      calls.push(["writeCursor", deviceId, cursorVector]);
    },
    async getRemoteHeads() {
      return { "device-a": 3 };
    },
    async listOperationsSince() {
      return [];
    },
    async writeSnapshotFile(filePath, content) {
      calls.push(["writeSnapshotFile", filePath, String(content)]);
    }
  };

  const fakePublisher = {
    async publish(input) {
      calls.push(["publishGeneration", input.nextGenerationId]);
      return { currentGenerationId: input.nextGenerationId };
    }
  };

  const backend = new GoogleDriveBackend({
    driveClient: fakeClient,
    generationPublisher: fakePublisher,
    now: function () {
      return 1234;
    }
  });

  await backend.publishSnapshot({
    snapshotPublishMode: "inplace",
    files: [{ path: "vault/example.md", content: "hello" }]
  });
  await backend.publishSnapshot({
    snapshotPublishMode: "generations",
    nextGenerationId: "gen-001",
    snapshotSeqs: { "device-a": 3 },
    previousFiles: [],
    changedFiles: [{ path: "vault/example.md", content: "hello" }],
    deletedFiles: [],
    renamedFiles: []
  });

  assert(
    calls.some((entry) => entry[0] === "writeSnapshotFile"),
    "inplace snapshot mode should write directly to the snapshot layer"
  );
  assert(
    calls.some((entry) => entry[0] === "publishGeneration"),
    "generations mode should delegate to the generation publisher"
  );

  let registerAttempts = 0;
  const retryingBackend = new GoogleDriveBackend({
    driveClient: {
      async writeManifest(manifestPatch) {
        registerAttempts += 1;
        if (registerAttempts === 1) {
          const error = new Error("precondition failed");
          error.status = 412;
          throw error;
        }
        return manifestPatch;
      }
    },
    generationPublisher: fakePublisher
  });
  await retryingBackend.registerDevice("device-z");
  assert.strictEqual(
    registerAttempts,
    2,
    "registerDevice should reuse the manifest CAS retry path instead of failing on the first 412"
  );
})();
