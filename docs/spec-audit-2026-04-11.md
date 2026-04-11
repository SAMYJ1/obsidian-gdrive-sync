# Spec Compliance Audit — 2026-04-11

> Scope: focused code review against `docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design.md`, aimed at finding omissions and semantic deviations rather than restating every implemented feature.

## Summary

The implementation already covers much of the spec surface area, but this review found several correctness gaps where the code shape looks aligned while the runtime semantics are not. The highest-risk issues are:

1. pull cursor advancement can skip unapplied remote ops
2. delete operations bypass version-conflict detection
3. binary files are processed as UTF-8 text and can be corrupted
4. cold start does not fully enforce the spec's coherent-cut validation
5. cold start snapshot apply does not remove stale local files

## Findings

### 1. High — Pull advances cursors to latest remote heads, not to the ops actually applied

- Spec reference: sync workflow section 3, pull and commit steps
- Code: [src/sync/pull.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/pull.ts:19), [src/sync/pull.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/pull.ts:24)

`pullRemoteOperations()` fetches pending ops using the current cursor vector, applies them, then discards that bounded result and overwrites local cursors with a fresh `getRemoteHeads()` call. If new remote ops arrive between fetch and cursor write, the cursor can jump past ops that were never applied locally.

Impact: permanent data loss in incremental pull, because future syncs will treat those skipped seqs as already consumed.

### 2. High — Delete operations do not participate in version-based optimistic locking

- Spec reference: conflict detection in section 2; delete-vs-modify handling in section 3
- Code: [src/sync/manifest.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/manifest.ts:18), [src/drive/client.ts](/Users/eugene/code/obsidian-gdrive-sync/src/drive/client.ts:767)

`commitManifestPatch()` sends `expectedVersion` for every non-`create` op, which includes `delete`. But `writeManifest()` explicitly skips optimistic-lock validation when `file.op === "delete"`.

Impact: a concurrent remote modify can be silently removed by a local delete instead of entering the conflict path required by the spec.

### 3. High — Binary files are handled as UTF-8 text throughout the pipeline

- Spec reference: binary conflict fallback in section 3
- Code: [src/vault/adapter.ts](/Users/eugene/code/obsidian-gdrive-sync/src/vault/adapter.ts:12), [src/drive/client.ts](/Users/eugene/code/obsidian-gdrive-sync/src/drive/client.ts:616), [src/utils/hash.ts](/Users/eugene/code/obsidian-gdrive-sync/src/utils/hash.ts:21)

The implementation classifies some extensions as binary during conflict handling, but the storage pipeline is still text-based:

- local reads use `readBinary()` and immediately decode with `Buffer(...).toString("utf8")`
- Drive downloads use `response.text()`
- blob hashes are then computed from that decoded text

Impact: images, PDFs, archives, fonts, and other binary files can be corrupted before conflict policy even matters.

### 4. Medium-High — Cold start weakens the coherent-cut validation instead of retrying until the cut is valid

- Spec reference: cold start read-validate protocol in section 3
- Code: [src/sync/engine.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/engine.ts:60), [src/sync/engine.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/engine.ts:65), [src/sync/engine.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/engine.ts:94), [src/sync/engine.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/engine.ts:144)

When `opsHead < snapshotSeqs_before` for some producer, the spec says to re-read until that condition no longer holds. The current code instead mutates the replay cursor down to the stale `opsHead`, then proceeds with snapshot download and replay.

Impact: a new device can initialize from a snapshot cut that was not actually proven coherent with the pinned manifest heads.

### 5. Medium — Cold start snapshot apply is additive only and leaves stale local files behind

- Spec reference: cold start full download from snapshot layer in section 3
- Code: [src/vault/adapter.ts](/Users/eugene/code/obsidian-gdrive-sync/src/vault/adapter.ts:51), [src/sync/engine.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/engine.ts:1034)

`applySnapshot()` writes every downloaded snapshot file but never removes local files that are absent from the snapshot. This matters because the engine can force cold start for devices marked inactive.

Impact: a rejoining device can retain old local files that were deleted remotely long ago, so its local vault is not actually reset to the snapshot baseline before op replay.

## Lower-Risk Drift

### Built-in ignore rules do not match the actual local state file

- Spec reference: file filtering defaults in section 6
- Code: [src/main.ts](/Users/eugene/code/obsidian-gdrive-sync/src/main.ts:45), [src/vault/filter.ts](/Users/eugene/code/obsidian-gdrive-sync/src/vault/filter.ts:1)

The local state file is stored in `outbox.json`, but built-in ignore rules still list `data.json`. This is lower risk because the plugin writes `outbox.json` through the adapter directly rather than through vault events, but the documented default no longer matches the implementation.

### Rename conflict handling depends on vault-side rename succeeding

- Spec reference: rename-vs-rename and rename-vs-delete handling in section 3
- Code: [src/sync/engine.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/engine.ts:634), [src/sync/engine.ts](/Users/eugene/code/obsidian-gdrive-sync/src/sync/engine.ts:865), [src/vault/adapter.ts](/Users/eugene/code/obsidian-gdrive-sync/src/vault/adapter.ts:33)

`resolveRenameConflict()` first calls `applyRemoteOperation(rename)` and only then writes the conflict copy. If the old path is already gone locally, the rename becomes a no-op at the vault layer, while tracked state still resolves around the remote target.

Impact: conflict handling is more fragile than the spec's logical-file semantics suggest, especially after local path drift.

## Verification

Ran:

```bash
node tests/run-tests.js
```

Result: all current tests passed. That means these findings are not covered by the existing test suite and should be treated as review-discovered semantic gaps, not currently failing regressions.

## Recommended Next Steps

1. Fix pull cursor advancement first; it is the clearest data-loss risk.
2. Make delete participate in version conflict detection.
3. Split text and binary blob handling end-to-end.
4. Tighten cold start validation to either prove a coherent cut or fall back.
5. Add regression tests for all five findings before changing behavior.
