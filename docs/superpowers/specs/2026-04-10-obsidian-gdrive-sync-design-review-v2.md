# Review: Obsidian Google Drive Sync Plugin Design Spec

- Reviewed spec: [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design]]
- Review date: 2026-04-10
- Reviewer: Codex
- Review type: design review

## Overall Assessment

This revision is materially better than the original. The spec now has a real cold-start model, per-device cursors remove the worst manifest hot spot, and the Drive batch section is now aligned with the actual API. However, the design is still not closed under crash recovery because the authoritative store, pull-discovery path, snapshot publication, and compaction rules do not yet compose into a single recoverable state machine. The diff3 section also still needs a true parent-history model rather than a single `baseBlobHash` field.

## Findings

### 1. High: cold start + snapshot + op replay is still not fully closed under crash recovery

The new snapshot-plus-replay model is the right direction, but it is still missing two invariants that are required for correctness.

Why this is a problem:

- Cold start replays ops with `seq > snapshotSeq`, but compaction archives old ops based on active cursors only.
- The spec does not require the published snapshot watermark to stay ahead of the compaction floor.
- The cold-start flow does not say that archived ops are consulted when the snapshot lags behind the retained live log.
- `_snapshot_meta.json` is said to be updated "atomically with each snapshot write", but an in-place multi-file `vault/` refresh on Drive is not actually atomic.

Impact:

- A new or reactivated device can need ops that have already been compacted out of the active log.
- A crash during snapshot refresh can expose a mixed-generation `vault/` tree that does not correspond to any single published `snapshotSeqs` state.
- In those states, replay is no longer guaranteed to reconstruct a correct vault from the downloaded snapshot.

Recommended fix:

- Publish immutable snapshot generations and flip a single generation pointer only after the full tree is complete.
- Or, if `vault/` remains in-place, define `_snapshot_meta.json` as the final publish marker and require replay to fall back to archived ops whenever `snapshotSeq < compactionFloor`.
- Tie compaction eligibility to the latest fully published snapshot watermark, not only to device cursors.

### 2. High: diff3 merge is still not fully implementable with the current `baseBlobHash` ancestry model

Adding `baseBlobHash` is an improvement, but the model still only supports simple single-parent histories.

Why this is a problem:

- The schema defines a singular `baseBlobHash`.
- The merge algorithm later says a merged `modify` op should store "the two parent hashes", which contradicts the schema.
- `rename` and `delete` ops carry no ancestry, so rename-vs-modify and delete-vs-modify races do not have a defined merge-base rule.
- Blob hashes identify content, not unique revisions. Repeated content can legitimately re-use the same hash, so blob identity alone is not a durable revision DAG.

Impact:

- Straightforward "both edits share the same base blob" conflicts are implementable.
- General diff3 across longer divergent histories, prior merges, or path moves is still underspecified.
- The design risks falling back to ad hoc ancestry reconstruction in exactly the cases where correctness matters most.

Recommended fix:

- Store explicit parent revision metadata on every state-changing op, for example `parentRevisions: [...]` plus the resulting `blobHash`.
- If revision ids are too heavy, at minimum change `baseBlobHash` to `parentBlobHashes: string[]` and define rename semantics in that parent model.
- Make the merge section explicit about how path identity survives renames.

### 3. High: the recovery model still does not cover all publish and retry failure scenarios

The recovery table is better than v1, but it still leaves several critical states unspecified.

Why this is a problem:

- The spec says `ops/` is authoritative, but normal pull discovers remote work from `manifest.devices[].opsHead`.
- If an op append succeeds and the manifest update fails, the op is durable but can remain invisible unless some later sync explicitly scans raw op logs independently of manifest.
- Idempotency is defined as dedup by `(device, seq)`, but the spec never defines how `seq` allocation survives local crashes or retries.
- Cursor-write failure is omitted even though compaction depends on cursor correctness.

Impact:

- The authority model and the pull algorithm disagree about what makes an op visible.
- Crash-and-retry behavior can produce hidden committed ops or ambiguous retries unless sequence allocation is durably journaled.
- Compaction safety still depends on unspecified recovery behavior for stale or missing cursor files.

Recommended fix:

- Either make manifest publication the commit point, or add an explicit manifest-repair/reconciliation pass that enumerates each device log tail independently of manifest before pull.
- Define durable per-device sequence allocation, for example a local outbox or journal that binds content to `(device, seq)` before remote publish begins.
- Add cursor-write failure handling and repair rules to the recovery section, since cursor staleness is now part of correctness, not just housekeeping.

### 4. Medium: per-device cursors solve the original manifest cursor contention issue, but the spec is not yet internally consistent about cursor semantics

This part is mostly fixed, but the text still mixes the old scalar cursor model with the new per-producer cursor vector.

Why this is a problem:

- The cursor file schema is a map from producer device to consumed sequence.
- The workflow still says "fetch remote ops after local syncCursor" and "set cursor to current opsHead", both in singular form.
- The compaction section refers to "the minimum consumed seq" without explicitly saying it is computed per producer log.

Impact:

- The original v1 manifest contention problem is largely resolved.
- But an implementer still has to guess whether replay, compaction, and catch-up operate on one scalar cursor or a vector of per-device high-water marks.
- The phrase "eliminating contention on manifest.json" is true for cursor writes, not for manifest updates overall; `manifest.json` is still the shared CAS point for file-index changes.

Recommended fix:

- Rewrite pull, cold start, and compaction in terms of `cursor[producerDeviceId]`.
- Say explicitly that each consumer tracks one high-water mark per producer op-log.
- Narrow the zero-contention claim to consumer-progress tracking rather than manifest updates as a whole.

### 5. Resolved: the batch API description is now accurate

This issue from v1 appears fixed.

Why this is now correct:

- The spec now limits Drive batch usage to metadata-style requests.
- It explicitly states that media uploads and downloads are not supported by the batch API.
- It replaces the old claim with concurrent media transfers, which is the implementable approach.

Impact:

- The implementation plan is now aligned with the actual Drive API surface.
- Performance and quota expectations are much more realistic than in the prior version.

Recommended follow-up:

- Keep this section as written.
- One small clarification would help: batched inner calls still count individually for quota, so batching reduces connection overhead, not logical request count.

## Open Questions

1. Do you want `manifest.json` to be the publication barrier, or do you want every sync to begin with a log-tail reconciliation pass that can discover durable ops not yet reflected in manifest?
2. Are you willing to switch snapshot publication to immutable generations plus a final pointer flip, instead of mutating `vault/` in place?
3. Should ancestry be modeled as explicit parent revisions rather than a single `baseBlobHash`, especially if rename-aware merge is a hard requirement?
4. Is it acceptable that per-device cursors fix cursor contention but do not remove manifest CAS contention for file-index updates?

## References

- Google Drive changes API: https://developers.google.com/workspace/drive/api/guides/manage-changes
- Google Drive performance and batch requests: https://developers.google.com/workspace/drive/api/guides/performance
