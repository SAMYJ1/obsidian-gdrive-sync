const assert = require("assert");
const {
  BUILT_IN_IGNORE_PATHS,
  isIgnoredPath
} = require("../dist/vault/filter");

assert(
  BUILT_IN_IGNORE_PATHS.includes(
    ".obsidian/plugins/obsidian-gdrive-sync/runtime-state.json"
  ),
  "runtime-state.json must be a built-in ignored path"
);

assert.strictEqual(
  isIgnoredPath(".obsidian/plugins/obsidian-gdrive-sync/runtime-state.json"),
  true,
  "runtime-state.json should always be ignored"
);

assert.strictEqual(
  isIgnoredPath("20 Wiki/Topics/example.md"),
  false,
  "normal knowledge-base files should not be ignored by default"
);

assert.strictEqual(
  isIgnoredPath("tmp/cache.tmp", ["*.tmp"]),
  true,
  "wildcard patterns should match file names across folders"
);

assert.strictEqual(
  isIgnoredPath("drafts/keep.md", ["drafts/**", "!drafts/keep.md"]),
  false,
  "negated patterns should re-include matching files"
);
