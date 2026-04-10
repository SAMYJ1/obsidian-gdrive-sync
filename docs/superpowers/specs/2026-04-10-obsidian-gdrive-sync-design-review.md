# Review: Obsidian Google Drive Sync Plugin Design Spec

- Reviewed spec: [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design]]
- Review date: 2026-04-10
- Reviewer: Codex
- Review type: design review

## Overall Assessment

The spec is directionally coherent, but the current state model is not closed under crash recovery and concurrent sync. The main issues are not stylistic; they affect correctness of cold start, conflict merge feasibility, and recoverability when `ops/`, `manifest.json`, and `vault/` diverge.

## Findings

### 1. High: cold start can permanently miss committed changes

The spec updates `manifest.json` first and updates `vault/` asynchronously afterward, but cold start downloads from `vault/` and then advances `syncCursor` to current `opsHead`.

Why this is a problem:

- If a new device initializes after `manifest.json` has advanced but before `vault/` catches up, it downloads a stale snapshot.
- It then skips historical ops by setting `syncCursor` directly to current heads.
- Result: committed changes that exist in `manifest.json` and/or op-log but not yet in `vault/` are never replayed on the new device.

Impact:

- Permanent data loss from the perspective of the newly initialized device.

Recommended fix:

- Define a snapshot generation point and replay ops after that point during cold start.
- Or make snapshot publication atomic with manifest advancement.

### 2. High: current schema cannot actually support diff3 merge

The conflict flow says the plugin finds the common ancestor from the previous version in `manifest`, but the schema only stores current file state.

Why this is a problem:

- `manifest.files[path]` stores only the current head blob/version.
- Op entries do not carry `baseVersion` or `baseBlobHash`.
- After a concurrent remote advance, there is no durable way to reconstruct the merge base for a true three-way merge.

Impact:

- Diff3 is underspecified and not implementable as written.
- In real conflicts, the system will fall back to guesswork or incorrect merge bases.

Recommended fix:

- Persist ancestry explicitly, for example by adding `baseVersion` and `baseBlobHash` to each write op.
- Alternatively, maintain per-file revision history or a compact version chain.

### 3. High: writes to blobs, op-log, manifest, and snapshot are not failure-safe

The spec relies on multiple stores with different write orderings, but does not define crash recovery or replay semantics.

Why this is a problem:

- Blob upload may succeed while op append fails.
- Op append may succeed while `manifest.json` update fails.
- `manifest.json` may advance while local apply or `vault/` snapshot update has not completed.

Impact:

- Orphaned blobs
- Invisible or partially published ops
- Duplicate replay after retry
- Divergence between `manifest.json`, `ops/`, and `vault/`

Recommended fix:

- Decide which store is authoritative.
- Add an explicit recovery model, such as idempotent op replay with durable publish markers.
- Avoid treating both op-log and manifest as independently authoritative without a reconciliation rule.

### 4. Medium: global `syncCursor` in manifest creates unnecessary contention and correctness risk

The spec stores every device's consumption cursor in shared `manifest.json`, and compaction depends on all device cursors being correct.

Why this is a problem:

- Every device pull updates the same shared mutable file.
- This increases ETag conflicts on the hottest object in the system.
- Offline or crashed devices can block compaction indefinitely unless additional liveness rules are defined.

Impact:

- Higher write contention
- Operational ambiguity around inactive devices

Recommended fix:

- Move consumer progress to per-device state rather than global shared manifest state.
- Define retention and expiry rules for inactive devices before compaction depends on them.

### 5. Medium: Drive batch optimization is described inaccurately

The spec says blob uploads and downloads in a sync cycle are batched via Drive batch API.

Why this is a problem:

- Google Drive batch requests do not batch media upload or media download.
- The optimization section therefore overstates what can be implemented.

Impact:

- Throughput and quota assumptions are too optimistic.
- The implementation plan may be built around a non-existent API capability.

Recommended fix:

- Remove batch upload/download from the design.
- Keep batching only for supported metadata operations, or describe request parallelism instead of API batch.

## Open Questions

1. Is `manifest.json` intended to be the source of truth or a derived index?
2. During cold start, is correctness more important than startup speed?
3. Are you willing to store per-op ancestry metadata so diff3 can be implemented correctly?
4. What is the lifecycle for inactive devices in compaction and cursor retention?

## References

- Google Drive auth scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google Drive changes API: https://developers.google.com/workspace/drive/api/guides/manage-changes
- Google Drive performance and batch requests: https://developers.google.com/workspace/drive/api/guides/performance
