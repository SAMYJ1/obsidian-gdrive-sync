# Review: Obsidian Google Drive Sync Plugin Design Spec

- Reviewed spec: [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design]]
- Prior review: [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design-review-v2]]
- Review date: 2026-04-10
- Reviewer: Codex
- Review type: design review

## Overall Assessment

This revision closes two of the four previously open issues. The cold-start/snapshot/compaction invariant is now materially correct, and the cursor model is now mostly internally coherent. However, the ancestry model is still not strong enough to support general diff3 history walking, and the recovery design is still not fully closed under crash-and-retry because the outbox and reconciliation rules remain underspecified. The new text also introduces two new correctness risks: the physical op-log layout is no longer described consistently, and cold start can advance its cursor past ops it never replayed.

## Findings

### 1. Resolved: cold start + snapshot + compaction floor invariant is now correct in the important ways

This issue from v2 appears fixed.

Why this is now correct:

- `_snapshot_meta.json` is now defined as the final publish marker for an in-place snapshot refresh.
- Compaction is now bounded by the published snapshot watermark as well as active consumer progress: `compactionFloor = min(minActiveCursor, snapshotSeqs[thisProducer])`.
- Cold start is explicitly defined as snapshot download plus replay of all committed ops after `snapshotSeqs`.
- Inactive devices are forced through cold start rather than relying on stale incremental cursors.

Impact:

- A new or reactivated device can reconstruct a committed state without depending on already-compacted live-log entries.
- Snapshot lag is now a performance issue, not a correctness hole.

Recommended follow-up:

- The branch "if `snapshotSeq < compactionFloor`, also read from `ops/archive/`" is unreachable under the stated invariant, because `compactionFloor` is defined as `min(..., snapshotSeq)`. Remove that branch or restate it in terms of an explicit archive lookup rule, so the cold-start story reads as one coherent model instead of two overlapping ones.

### 2. High: diff3 is still not fully implementable with `parentBlobHashes` as the ancestry model

This issue from v2 is still open.

Why this is still a problem:

- `parentBlobHashes` improves the schema, but blob hashes are still content ids, not stable revision ids or stable file-lineage ids.
- The same blob hash can legitimately recur after a revert-to-old-content edit, across delete-and-recreate cycles, or across two unrelated files that happen to share bytes.
- The spec says to walk the `parentBlobHashes` chain through prior ops to find a nearest common ancestor, but it never defines how that walk is constrained to one file lineage across renames and recreations.
- `rename` now carries path transition metadata, but that is still not the same as a durable identity that survives multiple renames or path reuse.

Impact:

- Simple one-parent conflicts are implementable.
- Longer divergent histories, repeated-content histories, and rename-heavy histories can still choose the wrong ancestor or even the wrong lineage.

Recommended fix:

- Introduce explicit revision identity, for example `revisionId` plus `parentRevisionIds`, and bind those revisions to a stable logical file identity.
- If revision ids are considered too heavy, add an explicit lineage id at minimum and define ancestry walks as lineage-scoped rather than global hash-scoped.

### 3. High: the recovery model is improved, but the outbox + reconciliation design is still not closed under crash recovery

This issue from v2 is only partially fixed.

Why this is still a problem:

- The spec now says `nextSeq` is persisted before each op is created, and that after a partial outbox write the op can be "re-created with the same seq". But the shown outbox format does not persist a durable seq reservation or a write-ahead intent record that lets restart logic recover which exact seq-to-op binding was lost.
- If the process crashes after incrementing `nextSeq` but before a valid pending entry is durably written, the design as written cannot prove whether the reserved seq should be reused, skipped, or treated as partially published.
- The reconciliation pass is the right direction, but it is defined against "actual op-log file length", which is not a reliable notion once compaction and archived segments exist.

Impact:

- Sequence allocation is still ambiguous across local crashes in the exact window the new outbox design was supposed to close.
- Manifest repair can still mis-detect or under-specify durable remote tails, especially after compaction.

Recommended fix:

- Turn the outbox into an explicit write-ahead journal with durable reservation records, so restart logic can recover exact `(device, seq) -> op` bindings even if a crash happens mid-write.
- Define reconciliation in terms of highest durable seq and explicit segment enumeration, not "file length".
- State the exact repair algorithm that recomputes manifest state from committed-but-unpublished tails.

### 4. Resolved: cursor semantics are now internally consistent enough

This issue from v2 appears fixed.

Why this is now correct:

- The cursor file schema is now explicitly a per-producer vector.
- Pull is now written in terms of `cursor[producerDeviceId]`.
- Compaction is now defined per producer log rather than around a global scalar cursor.
- The spec now correctly narrows the "zero contention" claim to consumer-progress tracking rather than to all manifest writes.

Impact:

- The original scalar-cursor ambiguity is largely removed.
- Implementers no longer have to guess whether compaction and catch-up are per producer or global.

Recommended follow-up:

- Keep this model. Only minor wording cleanup remains.

### 5. High: the physical op-log layout is now internally inconsistent across storage, append, compaction, and repair

This is a new issue introduced by the revised text.

Why this is a problem:

- The storage layout shows `ops/{device-id}-{seq}.jsonl`, which reads like seq-scoped files or immutable segments.
- The normal sync flow says "append ops to `ops/{device-id}-{seq}.jsonl`", which is not a stable append target if the filename itself varies by sequence.
- Compaction then assumes a single active per-device log whose prefix can be archived and whose suffix can remain live.
- The reconciliation pass compares `manifest.opsHead` to op-log "length", which only makes sense for one contiguous live file and even then stops making sense after compaction.

Impact:

- An implementer cannot tell whether the system uses one active log per device, immutable segment files, or one file per op.
- Tail discovery, compaction, archive lookup, and `opsHead` repair are therefore not implementable from the current spec.

Recommended fix:

- Choose one physical representation and use it consistently everywhere.
- A workable option is `ops/live/{device-id}.jsonl` for the active tail plus `ops/archive/{device-id}-{startSeq}-{endSeq}.jsonl` for immutable archived ranges.
- Define `opsHead` as the highest durable sequence number, not as a file length proxy.

### 6. High: cold start can advance its cursor vector past committed ops it never replayed

This is a new issue introduced by the revised cold-start flow.

Why this is a problem:

- Cold start replays from `snapshotSeqs`, then sets its own cursor vector to each producer's "current `opsHead`" after replay completes.
- Those heads can advance while the new device is downloading the snapshot or replaying the initial tail.
- If the device writes cursors to a later head than it actually replayed, it can declare those ops consumed without ever applying them locally.

Impact:

- A brand-new device can silently skip committed updates that land during initialization.
- Because later incremental pulls start from the stored cursor vector, this becomes a real data-loss scenario rather than a temporary lag.

Recommended fix:

- Freeze a target committed head vector from a single manifest read before replay begins.
- Replay exactly through that vector, write cursors to that same vector, then run one normal incremental pull for anything newer.
- Alternatively, write cursors to the highest seq actually replayed, never to a later observed head.

## Open Questions

1. Do you want to introduce stable revision and lineage ids for merge ancestry, or is the design intentionally limited to shallow same-content-base conflicts only?
2. What exact physical op-log representation should the implementation use: one active per-device log, immutable seq-range segments, or one file per op?
3. During cold start, should the device pin a target manifest head vector and then do a second incremental pull, rather than writing cursors to whatever heads are current at the end?
4. How should the outbox persist seq reservations so that a crash between `nextSeq` increment and pending-entry durability is recoverable without ambiguity?

## References

- [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design]]
- [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design-review-v2]]
