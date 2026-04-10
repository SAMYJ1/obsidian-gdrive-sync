# Review: Obsidian Google Drive Sync Plugin Design Spec

- Reviewed spec: [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design]]
- Prior review: [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design-review-v3]]
- Review date: 2026-04-10
- Reviewer: Codex
- Review type: design review

## Overall Assessment

This revision closes four of the five targeted v3 concerns. The ancestry model is now strong enough for the spec's content-based diff3 semantics, the WAL/outbox and reconciliation story is materially closed under crash recovery, the physical op-log layout is now consistent, and the original cold-start cursor-ahead bug is fixed. One older follow-up remains open: the archive fallback in cold start is still unreachable under the stated compaction invariant. More importantly, the new pinned-head cold-start flow introduces a fresh cut-consistency bug because the downloaded snapshot can be newer than the pinned head vector.

## Findings

### 1. High: cold start can combine a snapshot newer than the pinned `targetHeads`, so initialization is still not anchored to one coherent cut

This is a new issue introduced by the revised fix for the cold-start cursor problem.

Why this is a problem:

- Cold start now pins `targetHeads` from `manifest.devices[*].opsHead`, then reads `vault/_snapshot_meta.json`, then downloads the snapshot.
- Snapshot publication is asynchronous after manifest commit, so `_snapshot_meta.json` can legitimately advance between those reads.
- That means `snapshotSeqs[producer]` can be greater than the already-pinned `targetHeads[producer]`.
- In that case the device downloads a snapshot that already includes ops beyond `targetHeads`, replays nothing for that range, and then writes its cursor vector back to the older `targetHeads`.

Impact:

- The follow-up incremental pull can re-fetch ops that are already represented in the downloaded snapshot, causing duplicate application or conflict handling against already-applied state.
- More fundamentally, cold start is still not defined against one stable snapshot/log cut.

Recommended fix:

- Require a coherent cut where `snapshotSeqs <= targetHeads` for every producer before replay begins.
- One workable approach is: read `_snapshot_meta.json`, then read manifest and pin `targetHeads` only once every producer's `opsHead` is at least that snapshot seq; otherwise retry.
- Another workable approach is to publish a snapshot generation id and bind both snapshot metadata and replay heads to that same generation.

### 2. Medium: the cold-start archive fallback branch is still unreachable under the stated invariant

This follow-up from v3 is still open.

Why this is still a problem:

- Cold start replays `snapshotSeq < seq <= targetHeads`.
- Compaction is defined as `compactionFloor = min(minActiveCursor, snapshotSeqs[thisProducer])`.
- Archived entries are `seq < compactionFloor`, while the live log retains entries at or above the floor.
- Therefore every seq needed for cold-start replay is already guaranteed to remain in `ops/live/{device-id}.jsonl`.
- The new sentence "if for any reason they are not found in the active log, fall back to `ops/archive/`" only makes sense as an invariant-violation repair path, not as part of the normal retrieval model.

Impact:

- The spec still presents two overlapping cold-start data paths even though only one is reachable in the normal model.
- That leaves implementers unsure whether archive lookup is part of standard replay or only emergency recovery.

Recommended fix:

- Remove archive lookup from the mainline cold-start flow, or explicitly label it as a repair-only fallback when the live-log invariant has been violated.

### 3. Resolved: `fileId` plus lineage-scoped `parentBlobHashes` is now sufficient for the spec's diff3 ancestry model

This v3 issue appears fixed.

Why this is now correct:

- The prior wrong-lineage cases are closed: unrelated files with identical bytes, delete-and-recreate at the same path, and path reuse now get different `fileId`s.
- Rename continuity now rides on stable `fileId`, not on path matching.
- The merge algorithm only needs ancestor content for diff3. Within one `fileId` lineage, recurring blob hashes are content-equivalent, so revert-to-old-content histories no longer create the cross-lineage ambiguity that v3 flagged.
- The spec now clearly scopes ancestry walks to prior ops with the same `fileId`, which is the missing constraint the previous revision lacked.

Impact:

- General content-based diff3 ancestry is now implementable for the design as written.
- Explicit revision ids are no longer required for correctness unless the design later grows requirements around exact revision provenance rather than ancestor content.

Recommended follow-up:

- Keep the current lineage model. The 100-op ancestry cap is a deliberate fallback/performance tradeoff, not the original lineage bug.

### 4. Resolved: the WAL-based outbox and seq-based reconciliation model is now materially closed under crash recovery

This v3 issue appears fixed.

Why this is now correct:

- The local outbox is now explicitly a write-ahead journal with a durable `reserved` state before remote publish starts.
- Restart behavior is defined for each relevant crash window: `reserved`, `pending`, and `published`.
- The spec now explicitly allows seq gaps, so a crash after reservation no longer creates ambiguity about reuse versus skip.
- Reconciliation no longer relies on op-log file length; it compares `manifest.opsHead` against the highest durable seq observed in the live log and then rebuilds from the uncommitted tail.

Impact:

- The original seq-allocation ambiguity is gone.
- Recovery from "op durable, manifest not committed" is now specified in terms that remain valid after compaction.

Recommended follow-up:

- The implementation should still use atomic local file replacement for `outbox.json`, but that is now an implementation detail rather than a design hole.

### 5. Resolved: the physical op-log layout is now internally consistent

This v3 issue appears fixed.

Why this is now correct:

- The storage layout, push path, compaction rules, and reconciliation pass all agree on one active per-device live log at `ops/live/{device-id}.jsonl`.
- Archived history is now clearly an immutable compacted prefix stored as `ops/archive/{device-id}-{startSeq}-{endSeq}.jsonl`.
- `opsHead` is now used as a highest-seq concept rather than as a proxy for file length.

Impact:

- Append, tail discovery, compaction, and recovery are now described against one coherent physical representation.

Recommended follow-up:

- Keep this layout. It is materially clearer and implementable.

### 6. Resolved as stated: pinned `targetHeads` fixes the original "cursor advanced past unreplayed ops" bug

This specific v3 issue appears fixed.

Why this is now correct:

- Cold start no longer writes cursors to whatever heads are current at the end of replay.
- It pins a target head vector up front, replays exactly through that vector, and writes cursors to that same vector.
- A follow-up incremental pull is then used for anything newer.

Impact:

- The original data-loss path from writing cursors past later-arriving ops is closed.

Recommended follow-up:

- Keep the pinned-head rule, but pair it with the cut-consistency fix in Finding 1 so the snapshot and replay target are coherent.

## Open Questions

1. During cold start, do you want to enforce `snapshotSeqs <= targetHeads` by retrying until manifest has caught up to the published snapshot, or do you want an explicit snapshot generation id that both reads can pin to?
2. Is archive lookup intended only as a repair path when live-log invariants are violated, rather than as part of the normal cold-start algorithm?

## References

- [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design]]
- [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design-review-v3]]
