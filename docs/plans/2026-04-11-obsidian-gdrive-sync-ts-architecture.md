# Obsidian GDrive Sync TS Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild `~/code/obsidian-gdrive-sync` to match section 7 of `docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design.md`, using a strict `src/**.ts` module layout instead of the current flat `lib/*.js` structure.

**Architecture:** Replace the current JavaScript flat-module plugin with a TypeScript + esbuild architecture rooted at `src/`. Split the current implementation into the exact `sync/`, `drive/`, `vault/`, and `utils/` boundaries required by the spec, while preserving the current behavior, tests, and plugin manifest contract.

**Tech Stack:** TypeScript, esbuild, Node test runner via `node`, Obsidian plugin manifest output, no runtime framework changes.

---

### Task 1: Create TypeScript Build Skeleton

**Files:**
- Create: `/Users/eugene/code/obsidian-gdrive-sync/tsconfig.json`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/esbuild.config.mjs`
- Modify: `/Users/eugene/code/obsidian-gdrive-sync/package.json`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/main.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/settings.ts`

**Step 1: Write the failing infrastructure test**

Create a minimal structure test that asserts `src/main.ts` and `tsconfig.json` exist, and that `package.json` contains `build` and `test` scripts for the TypeScript layout.

**Step 2: Run test to verify it fails**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: FAIL because the TS scaffold files do not exist yet.

**Step 3: Write minimal TypeScript build infrastructure**

- Add `tsconfig.json` targeting modern desktop Obsidian.
- Add `esbuild.config.mjs` that bundles `src/main.ts` to `main.js`.
- Update `package.json` with `build`, `check`, and `test` scripts.
- Add stub `src/main.ts` and `src/settings.ts`.

**Step 4: Run tests to verify the new structure test passes**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: PASS for the new scaffold test, with older JS-path tests still allowed to fail until later tasks migrate them.

**Step 5: Commit**

```bash
cd /Users/eugene/code/obsidian-gdrive-sync
git add tsconfig.json esbuild.config.mjs package.json src/main.ts src/settings.ts tests
git commit -m "build: add TypeScript plugin scaffold"
```

### Task 2: Create Spec-Compliant Module Layout

**Files:**
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/sync/engine.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/sync/push.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/sync/pull.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/sync/merge.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/sync/manifest.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/drive/auth.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/drive/client.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/drive/blob-store.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/vault/watcher.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/vault/filter.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/vault/snapshot.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/utils/diff3.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/utils/hash.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/utils/device.ts`

**Step 1: Write the failing module layout test**

Add a test that asserts the exact section-7 file tree exists under `src/`.

**Step 2: Run test to verify it fails**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: FAIL because the required TS modules do not exist yet.

**Step 3: Create the directory and file skeleton**

Create every required TS file with the exported symbols needed for later migration.

**Step 4: Run tests to verify the layout test passes**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: PASS for the layout test.

**Step 5: Commit**

```bash
cd /Users/eugene/code/obsidian-gdrive-sync
git add src tests
git commit -m "refactor: create spec-compliant TypeScript module tree"
```

### Task 3: Migrate Utility and Vault Filters to TypeScript

**Files:**
- Migrate: `/Users/eugene/code/obsidian-gdrive-sync/lib/diff3.js` -> `/Users/eugene/code/obsidian-gdrive-sync/src/utils/diff3.ts`
- Migrate: `/Users/eugene/code/obsidian-gdrive-sync/lib/device-id.js` -> `/Users/eugene/code/obsidian-gdrive-sync/src/utils/device.ts`
- Migrate: `/Users/eugene/code/obsidian-gdrive-sync/lib/ignore-rules.js` -> `/Users/eugene/code/obsidian-gdrive-sync/src/vault/filter.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/utils/hash.ts`
- Modify tests to import the TS modules through compiled output or direct TS execution seam

**Step 1: Write failing tests for the new import locations**

Update `diff3`, `ignore-rules`, and device-id tests so they target the `src/` implementation boundaries.

**Step 2: Run tests to verify they fail**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: FAIL because the TS module exports are not implemented yet.

**Step 3: Port the implementations**

- Move diff3 logic to `src/utils/diff3.ts`
- Move device ID generation to `src/utils/device.ts`
- Move ignore/filter logic to `src/vault/filter.ts`
- Add `src/utils/hash.ts` to own SHA-256/blob hashing

**Step 4: Run tests to verify they pass**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: PASS for these units.

**Step 5: Commit**

```bash
cd /Users/eugene/code/obsidian-gdrive-sync
git add src tests
git commit -m "refactor: migrate utility and vault filter modules to TypeScript"
```

### Task 4: Migrate Drive Layer to `src/drive`

**Files:**
- Migrate: `/Users/eugene/code/obsidian-gdrive-sync/lib/google-auth.js` -> `/Users/eugene/code/obsidian-gdrive-sync/src/drive/auth.ts`
- Migrate: `/Users/eugene/code/obsidian-gdrive-sync/lib/google-drive-client.js` -> `/Users/eugene/code/obsidian-gdrive-sync/src/drive/client.ts`
- Split blob responsibilities into `/Users/eugene/code/obsidian-gdrive-sync/src/drive/blob-store.ts`
- Move shared rate/retry helpers into TypeScript modules if still needed by drive layer

**Step 1: Write failing drive-layer tests against the new TS entry points**

Update client/backend auth tests so they import the new drive modules.

**Step 2: Run tests to verify they fail**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: FAIL because the new TS drive modules are not fully wired yet.

**Step 3: Port and split the drive implementation**

- Keep OAuth in `auth.ts`
- Keep raw Drive API wrapper in `client.ts`
- Move blob upload/fetch/dedup helpers to `blob-store.ts`
- Preserve manifest CAS, changes polling, resumable upload, and cursor helpers

**Step 4: Run tests to verify they pass**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: PASS for drive tests.

**Step 5: Commit**

```bash
cd /Users/eugene/code/obsidian-gdrive-sync
git add src tests
git commit -m "refactor: move Drive layer into src/drive"
```

### Task 5: Split Sync Engine into `engine/push/pull/merge/manifest`

**Files:**
- Migrate: `/Users/eugene/code/obsidian-gdrive-sync/lib/sync-engine.js` -> `/Users/eugene/code/obsidian-gdrive-sync/src/sync/engine.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/sync/push.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/sync/pull.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/sync/merge.ts`
- Create: `/Users/eugene/code/obsidian-gdrive-sync/src/sync/manifest.ts`
- Migrate: `/Users/eugene/code/obsidian-gdrive-sync/lib/cold-start.js` -> supporting sync files as appropriate
- Migrate: `/Users/eugene/code/obsidian-gdrive-sync/lib/compaction.js` into the sync layer if still part of engine behavior

**Step 1: Write failing tests for the split boundaries**

Add or update tests so `engine` delegates to push/pull/merge/manifest responsibilities instead of one monolith.

**Step 2: Run tests to verify they fail**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: FAIL while the logic still lives only in the old JS module.

**Step 3: Port and split logic**

- `engine.ts`: scheduler/state machine and cold start trigger
- `push.ts`: outbox upload + manifest commit sequence
- `pull.ts`: remote fetch + apply + cursor advance
- `merge.ts`: conflict policy orchestration on top of diff3
- `manifest.ts`: manifest patch construction and vector handling

**Step 4: Run tests to verify they pass**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: PASS for sync, cold start, conflict, rename, and snapshot tests.

**Step 5: Commit**

```bash
cd /Users/eugene/code/obsidian-gdrive-sync
git add src tests
git commit -m "refactor: split sync engine into spec-defined TypeScript modules"
```

### Task 6: Migrate Vault Layer and Plugin Entry

**Files:**
- Migrate plugin wiring into `/Users/eugene/code/obsidian-gdrive-sync/src/main.ts`
- Move settings UI into `/Users/eugene/code/obsidian-gdrive-sync/src/settings.ts`
- Migrate watcher logic into `/Users/eugene/code/obsidian-gdrive-sync/src/vault/watcher.ts`
- Migrate snapshot logic into `/Users/eugene/code/obsidian-gdrive-sync/src/vault/snapshot.ts`
- Keep adapter/runtime data helpers in the closest matching TS modules, or add internal helpers under `src/` if unavoidable

**Step 1: Write failing tests for entry-point and watcher integration**

Add structure/integration tests that assert the plugin entry is now `src/main.ts` and watcher/filter/snapshot are wired through the spec-defined vault modules.

**Step 2: Run tests to verify they fail**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: FAIL because the plugin still depends on old JS module paths.

**Step 3: Port the plugin/vault implementation**

- `main.ts`: plugin lifecycle and composition root
- `settings.ts`: settings panel UI and config
- `vault/watcher.ts`: event handling, debounce, suppression interaction
- `vault/snapshot.ts`: snapshot publish helpers

**Step 4: Run tests to verify they pass**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: PASS for plugin integration tests and existing behavior tests.

**Step 5: Commit**

```bash
cd /Users/eugene/code/obsidian-gdrive-sync
git add src tests
git commit -m "refactor: migrate plugin entry and vault layer to TypeScript"
```

### Task 7: Remove Legacy `lib/*.js` Runtime and Finish TS Output

**Files:**
- Delete or archive legacy JS runtime files in `/Users/eugene/code/obsidian-gdrive-sync/lib/`
- Modify `/Users/eugene/code/obsidian-gdrive-sync/main.js` to be build output only
- Update `/Users/eugene/code/obsidian-gdrive-sync/README.md`
- Update `/Users/eugene/code/obsidian-gdrive-sync/package.json`

**Step 1: Write failing cleanup test**

Add a final repository structure test that asserts runtime logic no longer depends on `lib/*.js`, and the canonical source tree is `src/**/*.ts`.

**Step 2: Run tests to verify it fails**

Run: `cd /Users/eugene/code/obsidian-gdrive-sync && node tests/run-tests.js`
Expected: FAIL until old runtime paths are removed from the source graph.

**Step 3: Remove the legacy runtime layer**

- Ensure compiled `main.js` comes from `src/main.ts`
- Remove or retire `lib/*.js` as runtime source
- Update README to document TS/esbuild workflow

**Step 4: Run full verification**

Run:

```bash
cd /Users/eugene/code/obsidian-gdrive-sync
node tests/run-tests.js
find src tests -name '*.ts' -print0 | xargs -0 -n1 npx tsc --noEmit --pretty false
npx esbuild --config=esbuild.config.mjs
node --check main.js
```

Expected:
- all tests pass
- TypeScript typecheck passes
- bundle succeeds
- generated `main.js` is syntactically valid

**Step 5: Commit**

```bash
cd /Users/eugene/code/obsidian-gdrive-sync
git add -A
git commit -m "refactor: align plugin architecture with section 7 TypeScript layout"
```

---

Plan complete and saved to `docs/plans/2026-04-11-obsidian-gdrive-sync-ts-architecture.md`.

执行上我会直接按这个计划在当前会话继续，不走过渡态。  
