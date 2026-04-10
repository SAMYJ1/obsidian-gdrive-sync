const assert = require("assert");
const {
  GenerationPublisher
} = require("../dist/vault/snapshot");

function createFakeDrive() {
  const calls = [];
  return {
    calls,
    async ensureFolder(folderPath) {
      calls.push(["ensureFolder", folderPath]);
    },
    async copyFile(sourcePath, destinationPath) {
      calls.push(["copyFile", sourcePath, destinationPath]);
    },
    async writeFile(filePath, content) {
      calls.push(["writeFile", filePath, String(content)]);
    },
    async writeJson(filePath, value) {
      calls.push(["writeJson", filePath, value]);
    },
    async listGenerationIds() {
      return ["gen-001", "gen-002", "gen-003"];
    },
    async deletePath(filePath) {
      calls.push(["deletePath", filePath]);
    }
  };
}

module.exports = (async function () {
  const fakeDrive = createFakeDrive();
  const publisher = new GenerationPublisher({
    driveClient: fakeDrive,
    generationRetentionCount: 3
  });

  const result = await publisher.publish({
    previousGenerationId: "gen-003",
    nextGenerationId: "gen-004",
    snapshotSeqs: { "device-a": 4 },
    previousFiles: [
      "vault/20 Wiki/Topics/keep.md",
      "vault/20 Wiki/Topics/change.md"
    ],
    changedFiles: [
      {
        path: "vault/20 Wiki/Topics/change.md",
        content: "updated"
      },
      {
        path: "vault/20 Wiki/Topics/new.md",
        content: "new"
      }
    ],
    deletedFiles: [],
    renamedFiles: []
  });

  assert.strictEqual(result.currentGenerationId, "gen-004");
  assert.deepStrictEqual(result.removedGenerationIds, ["gen-001"]);
  assert(
    fakeDrive.calls.some((entry) => entry[0] === "copyFile" && entry[1].indexOf("gen-003") !== -1 && entry[2].indexOf("gen-004") !== -1),
    "unchanged files should be copied from the previous generation"
  );
  assert(
    fakeDrive.calls.some((entry) => entry[0] === "writeFile" && entry[1].indexOf("change.md") !== -1),
    "changed files should be written into the new generation"
  );
  assert(
    fakeDrive.calls.some((entry) => entry[0] === "writeJson" && entry[1] === "snapshots/current.json"),
    "publishing should update the current generation pointer"
  );
})();
