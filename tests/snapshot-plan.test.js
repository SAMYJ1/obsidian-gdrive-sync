const assert = require("assert");
const {
  planGenerationBuild,
  planGenerationGarbageCollection
} = require("../dist/vault/snapshot");

const buildPlan = planGenerationBuild({
  previousGenerationId: "gen-001",
  nextGenerationId: "gen-002",
  previousFiles: [
    "vault/10 Raw/a.md",
    "vault/20 Wiki/Topics/old.md",
    "vault/20 Wiki/Topics/rename-me.md"
  ],
  changedFiles: [
    "vault/20 Wiki/Topics/old.md",
    "vault/20 Wiki/Topics/new.md"
  ],
  deletedFiles: ["vault/10 Raw/a.md"],
  renamedFiles: [
    {
      from: "vault/20 Wiki/Topics/rename-me.md",
      to: "vault/20 Wiki/Topics/renamed.md"
    }
  ]
});

assert.deepStrictEqual(
  buildPlan.copyPaths,
  [],
  "deleted and changed files should not be copied from the previous generation"
);

assert.deepStrictEqual(
  buildPlan.writePaths.sort(),
  [
    "vault/20 Wiki/Topics/new.md",
    "vault/20 Wiki/Topics/old.md",
    "vault/20 Wiki/Topics/renamed.md"
  ],
  "changed and renamed targets should be written into the new generation"
);

assert.deepStrictEqual(
  buildPlan.deletePaths,
  ["vault/10 Raw/a.md"],
  "deleted files should be tracked in the generation build plan"
);

const gcPlan = planGenerationGarbageCollection({
  generationIds: ["gen-001", "gen-002", "gen-003", "gen-004"],
  retentionCount: 3
});

assert.deepStrictEqual(
  gcPlan.keep,
  ["gen-002", "gen-003", "gen-004"],
  "garbage collection should keep the most recent generations"
);

assert.deepStrictEqual(
  gcPlan.remove,
  ["gen-001"],
  "garbage collection should remove generations older than the retention window"
);
