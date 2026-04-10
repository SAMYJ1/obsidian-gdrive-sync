const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

function mustExist(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  assert(
    fs.existsSync(absolutePath),
    relativePath + " should exist"
  );
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const mainSource = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
const settingsSource = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");
const watcherSource = fs.readFileSync(path.join(repoRoot, "src/vault/watcher.ts"), "utf8");
const driveClientSource = fs.readFileSync(path.join(repoRoot, "src/drive/client.ts"), "utf8");
const blobStoreSource = fs.readFileSync(path.join(repoRoot, "src/drive/blob-store.ts"), "utf8");
const syncEngineSource = fs.readFileSync(path.join(repoRoot, "src/sync/engine.ts"), "utf8");
const syncPushSource = fs.readFileSync(path.join(repoRoot, "src/sync/push.ts"), "utf8");
const syncPullSource = fs.readFileSync(path.join(repoRoot, "src/sync/pull.ts"), "utf8");
const syncMergeSource = fs.readFileSync(path.join(repoRoot, "src/sync/merge.ts"), "utf8");
const syncManifestSource = fs.readFileSync(path.join(repoRoot, "src/sync/manifest.ts"), "utf8");
const vaultSnapshotSource = fs.readFileSync(path.join(repoRoot, "src/vault/snapshot.ts"), "utf8");

mustExist("tsconfig.json");
mustExist("esbuild.config.mjs");
mustExist("src/main.ts");
mustExist("src/settings.ts");
mustExist("src/sync/engine.ts");
mustExist("src/sync/push.ts");
mustExist("src/sync/pull.ts");
mustExist("src/sync/merge.ts");
mustExist("src/sync/manifest.ts");
mustExist("src/drive/auth.ts");
mustExist("src/drive/client.ts");
mustExist("src/drive/blob-store.ts");
mustExist("src/vault/watcher.ts");
mustExist("src/vault/filter.ts");
mustExist("src/vault/snapshot.ts");
mustExist("src/utils/diff3.ts");
mustExist("src/utils/hash.ts");
mustExist("src/utils/device.ts");

assert.strictEqual(
  typeof packageJson.scripts.build,
  "string",
  "package.json should define a build script for the TypeScript/esbuild layout"
);
assert.strictEqual(
  typeof packageJson.scripts.check,
  "string",
  "package.json should define a typecheck script"
);
assert(
  mainSource.includes("createVaultWatcher"),
  "src/main.ts should wire the plugin through src/vault/watcher.ts instead of staying as a stub"
);
assert(
  mainSource.includes("normalizeSettings"),
  "src/main.ts should consume src/settings.ts instead of bypassing the TypeScript config layer"
);
assert(
  mainSource.includes("addSettingTab") &&
    settingsSource.includes("PluginSettingTab"),
  "settings panel UI should live in src/settings.ts and be wired from src/main.ts"
);
assert(
  watcherSource.includes("trackLocalChange") && watcherSource.includes("trackRename"),
  "src/vault/watcher.ts should own the vault event wiring for create/modify/delete/rename"
);
assert(
  mainSource.includes('import { GoogleDriveClient } from "./drive/client"'),
  "src/main.ts should instantiate the Drive client from src/drive/client.ts"
);
assert(
  !mainSource.includes('../lib/google-drive-client'),
  "src/main.ts should not keep reaching into lib/google-drive-client.js after the TS migration"
);
assert(
  driveClientSource.includes("export class GoogleDriveClient") &&
    driveClientSource.includes("async listFiles") &&
    driveClientSource.includes("async appendOperation") &&
    driveClientSource.includes("async writeManifest"),
  "src/drive/client.ts should contain the real Google Drive client surface, not an empty placeholder"
);
assert(
  blobStoreSource.includes("export class DriveBlobStore") &&
    blobStoreSource.includes("uploadBlob"),
  "src/drive/blob-store.ts should own blob upload behavior instead of staying as a stub"
);
assert(
  mainSource.includes('import { SyncEngine } from "./sync/engine"'),
  "src/main.ts should instantiate the sync engine from src/sync/engine.ts"
);
assert(
  !mainSource.includes('../lib/sync-engine'),
  "src/main.ts should not keep reaching into lib/sync-engine.js after the TS migration"
);
assert(
  syncEngineSource.includes("export class SyncEngine") &&
    syncEngineSource.includes("async trackLocalChange") &&
    syncEngineSource.includes("async trackRename") &&
    syncEngineSource.includes("async syncNow"),
  "src/sync/engine.ts should contain the real sync engine surface, not an empty placeholder"
);
assert(
  syncPushSource.includes("pushOutboxEntry") &&
    syncPullSource.includes("pullRemoteOperations") &&
    syncMergeSource.includes("mergeRemoteText") &&
    syncManifestSource.includes("commitManifestPatch"),
  "src/sync/* should expose real helper modules instead of placeholder no-ops"
);
assert(
  vaultSnapshotSource.includes("planVaultSnapshotPublish") &&
    vaultSnapshotSource.includes("applyDownloadedSnapshot"),
  "src/vault/snapshot.ts should expose real snapshot planning/apply helpers instead of a placeholder"
);
