const assert = require("assert");
const { GoogleDriveBackend } = require("../dist/drive/backend");

module.exports = (async function () {
  const writes = [];
  const fakeClient = {
    async writeSnapshotFile(filePath, content) {
      writes.push(["writeSnapshotFile", filePath, content]);
    },
    async writeJson(filePath, value) {
      writes.push(["writeJson", filePath, value]);
    },
    async deletePath(filePath) {
      writes.push(["deletePath", filePath]);
    }
  };

  const backend = new GoogleDriveBackend({
    driveClient: fakeClient,
    generationPublisher: {
      async publish(input) {
        writes.push(["publishGeneration", input.nextGenerationId]);
        return { currentGenerationId: input.nextGenerationId };
      }
    },
    now: function () {
      return 5000;
    }
  });

  await backend.publishSnapshot({
    snapshotPublishMode: "inplace",
    files: [
      {
        path: "vault/20 Wiki/Topics/a.md",
        content: "a"
      }
    ],
    snapshotSeqs: {
      "device-a": 4
    },
    deletedFiles: ["vault/20 Wiki/Topics/old.md"]
  });

  assert(
    writes.some((entry) => entry[0] === "writeSnapshotFile" && entry[1] === "vault/20 Wiki/Topics/a.md"),
    "inplace snapshot mode should write snapshot files"
  );
  assert(
    writes.some((entry) => entry[0] === "writeJson" && entry[1] === "vault/_snapshot_meta.json"),
    "inplace snapshot mode should write snapshot metadata"
  );
  assert(
    writes.some((entry) => entry[0] === "deletePath" && entry[1] === "vault/20 Wiki/Topics/old.md"),
    "inplace snapshot mode should remove deleted snapshot paths"
  );
  const metaIndex = writes.findIndex((entry) => entry[0] === "writeJson" && entry[1] === "vault/_snapshot_meta.json");
  let lastContentMutationIndex = -1;
  writes.forEach((entry, index) => {
    if (entry[0] === "writeSnapshotFile" || entry[0] === "deletePath") {
      lastContentMutationIndex = index;
    }
  });
  assert(
    metaIndex > lastContentMutationIndex,
    "snapshot metadata must be written only after snapshot file writes and deletes complete"
  );
})();
