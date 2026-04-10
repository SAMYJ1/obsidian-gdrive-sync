# Spec Compliance Audit — 2026-04-11

> Auditing codebase against `docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design.md`

---

## Fully Implemented (Spec Compliant)

| Feature | Location | Notes |
|---|---|---|
| manifest.json schema (devices, files) | `client.ts:46-67`, `engine.ts` | All fields: fileId, blobHash, size, mtime, lastModifiedBy, version |
| Per-device cursor files | `client.ts:754`, `state.ts` | `ops/cursors/{device-id}.json` with cursors per producer + updatedAt |
| Op-log entries (all 9 fields) | `client.ts:88-99` | seq, op, path, fileId, blobHash, parentBlobHashes, mtime, device, ts, newPath |
| ETag-based manifest optimistic lock | `client.ts:689-752` | If-Match, HTTP 412 caught, re-read + re-merge on retry |
| Op-log append with ETag protection | `client.ts:642-671` | Atomic append, 3 retries on 412 |
| State machine (IDLE→PUSHING→PULLING→MERGING→FINALIZING) | `main.ts:316`, `engine.ts:312` | Phase guard, pending trigger coalescing |
| Reconciliation pass | `engine.ts:780` | Detects opsHead < highest durable seq, recommits |
| Local outbox journal (reserve→bind→publish→commit) | `engine.ts:217-310` | Full lifecycle, crash recovery rules |
| Cold start protocol | `engine.ts:41-121` | Device registration, snapshot download, op replay, read-validate with 3 retries |
| Compaction (1000 threshold, floor computation) | `engine.ts:125-172` | min of all cursors + snapshotSeqs, archive to ops/archive/ |
| diff3 three-way merge | `diff3.ts`, `merge.ts` | Line-level merge with conflict markers |
| Cross-type conflict resolution | `engine.ts:451` | delete-vs-modify, rename-vs-modify, rename-vs-rename, rename-vs-delete |
| Binary file fallback | `engine.ts` | Last-write-wins + conflict copy |
| Ancestry walk for merge base (bounded 100 ops) | `engine.ts:600-659` | Depth limit 100, fallback to two-way diff (empty base) |
| OAuth with PKCE, drive.file scope | `auth.ts` | Localhost redirect, refresh token persistence, state param CSRF protection |
| All Drive API endpoints | `client.ts` | changes.list, getStartPageToken, files.create/update/get/list, folder create |
| Token bucket rate limiter | `client.ts:107-152` | Configurable capacity/refill |
| Settings panel with all required fields | `settings.ts` | Poll Mode, Interval, Debounce, Window, Ignore Patterns |
| Foreground detection via visibilitychange | `main.ts:371-383` | Foreground mode stops polling when hidden |
| Remote change detection via changes.list + pageToken | `main.ts:281-314` | Full implementation with vault filtering |
| "Sync Now" ribbon icon + Command Palette | `main.ts:177-184` | Both implemented |
| Push debounce + push window | `main.ts:236` | 5s debounce, 120s window |
| Web Crypto SHA-256 | `hash.ts` | With Node.js crypto fallback |
| Push before Pull ordering | `engine.ts:339-405` | Push loop runs before pull |
| Content-addressed blob storage | `blob-store.ts`, `client.ts` | SHA-256 hash as key, stored at blobs/{hash} |
| File watcher with event suppression | `watcher.ts` | create/modify/delete/rename + remote-apply cooldown |
| Ignore pattern matching | `filter.ts` | Built-in rules + glob patterns + negation |
| Device inactive status (30-day threshold) | `client.ts:195` | Auto-marked inactive |
| Retry with exponential backoff | `retry.ts` | 3 attempts, exponential delay |
| Remote apply event suppression | `runtime-state.ts` | Prevents echo loops from applied remote changes |

---

## Deviations & Gaps

### HIGH — Functional Gaps

**1. Batch API has no 100-request cap**
- `client.ts` `batchMetadataRequests()` sends arbitrarily large batches
- Drive API rejects batches >100 — will cause runtime errors on large syncs
- **Spec:** "Drive batch API supports up to 100 metadata-only requests per batch"

**2. Resumable upload is not chunked**
- `client.ts:483-546` initiates a resumable session at the 5MB threshold but sends the entire body in a single PUT
- Network failure means starting over — unreliable for large attachments
- **Spec:** "Files >5MB use resumable upload protocol" (implies chunked resumable)

**3. No retry with exponential backoff on transient failures**
- `client.ts` `request()` throws immediately on any non-OK response
- Google recommends retrying 403 (rate limit), 500, 503 with exponential backoff
- `retryAfter` is parsed from response headers but never acted upon
- **Spec:** "Plugin implements a simple token bucket as insurance" (implies resilient retries)

**4. Content-addressed dedup not properly verified before upload**
- `blob-store.ts` / `client.ts` `uploadBlob` only checks if a Drive file exists at the path
- No content hash verification — a corrupt prior upload is silently skipped
- **Spec:** "Identical content is never re-uploaded (especially effective for renames)"

**5. No integrity verification on blob download**
- `fetchBlob` returns raw content but never validates that its hash matches the requested `blobHash`
- A corrupt download silently propagates bad data
- **Spec implied:** Content-addressed storage must verify integrity

**6. No optimistic lock via `files[path].version`**
- Spec explicitly says: "Uses `files[path].version` as an optimistic lock — Local modification is based on known version N, if remote has already advanced to version N+1 at upload time → trigger conflict merge"
- `TrackedFile.version` is tracked locally and incremented, but it is **never checked as a precondition during push/commit**
- Conflict detection currently relies entirely on `blobHash` comparison and `parentBlobHashes` — a different mechanism than the spec prescribes
- Concurrent modifications could silently overwrite each other without triggering the version-based conflict path
- **Spec:** Section 2, "Conflict detection"

**7. `getRemoteHeads()` possibly unimplemented**
- `pull.ts` line 24 calls `backend.getRemoteHeads()` but this method was not found in `backend.ts` or `client.ts`
- If unimplemented, this would be a runtime error on every pull
- **Spec implied:** Pull flow needs remote head tracking for cursor advancement

---

### MEDIUM — Robustness / Completeness Gaps

**8. Concurrent media transfers not generalized**
- Only `downloadSnapshot()` has a 5-worker pool; no reusable concurrent wrapper
- Other uploads/downloads are sequential
- **Spec:** "Blob uploads and downloads are parallelized via concurrent HTTP requests (capped at 5-10 concurrent connections)"

**9. No blob garbage collection**
- No mechanism to list and delete unreferenced blobs
- Orphaned blobs accumulate indefinitely
- **Spec:** "Periodic GC removes unreferenced blobs (not in any op or manifest, older than 7 days)"

**10. No token revocation / sign-out flow**
- No endpoint to revoke OAuth tokens at `https://oauth2.googleapis.com/revoke`
- Stale tokens remain valid after disconnect until they expire
- **Spec:** Implicit from token lifecycle management

**11. No status bar / progress indicator**
- `syncPhase` is tracked internally but no visible state shown to the user
- **Spec:** "UI reflects state: idle → spinner → conflict notification, etc."

**12. Snapshot update is synchronous, not async**
- Spec says: "Async update vault/ snapshot layer" in the commit step
- Implementation runs snapshot publishing synchronously inside `syncNow()` (engine.ts:419-437)
- No background queue, no fire-and-forget — slow snapshot publish blocks the entire sync cycle
- **Spec:** Section 3, step 5c

**13. Compaction stalls when all devices inactive**
- `computeCompactionFloor` returns `snapshotFloor` when `minActiveCursor` is 0
- If all devices are inactive and `snapshotFloor` is also 0, `maybeCompact` returns null (floor <= 0 guard)
- Abandoned device logs would never be cleaned up
- **Spec:** Section on compaction + inactive device handling

**14. `deletePath` is O(N) with no batch delete**
- Lists all managed files and iterates to find prefix matches
- Each deletion is a separate API call
- Inefficient for large vaults
- **Spec implied:** Efficient Drive API usage

---

### LOW — Minor / Cosmetic Gaps

**15. Settings UI shows debounce/window in ms, not seconds**
- Spec shows "Push Debounce: [5] seconds" and "Push Window: [120] seconds"
- Implementation uses raw ms values (5000, 120000) as placeholders and input
- **Spec:** Section 7, Settings panel layout

**16. `visibilitychange` handler structure slightly narrower**
- Spec: unconditionally calls `triggerSync` when `visibilityState === "visible"`
- Code: only fires `runSyncNow()` when `pollMode === "foreground"`
- Functionally equivalent for the default mode but narrower in scope

**17. No unit tests for `main.ts`**
- Polling logic, foreground hooks, `shouldAutoPoll()`, `pollForChanges()`, `scheduleSync()`, phase management — all untested
- `settings.test.js` coverage is partial (no boundary/invalid-value tests)
- **Spec:** Testability implied by architecture

---

## Summary

| Category | Count |
|---|---|
| Fully spec-compliant features | 30 |
| HIGH severity gaps | 7 |
| MEDIUM severity gaps | 7 |
| LOW severity gaps | 3 |

### Priority Fix Recommendations

1. **Version-based optimistic lock (#6)** — the spec's primary conflict detection mechanism; currently not enforced
2. **`getRemoteHeads()` existence (#7)** — potential runtime crash on every pull
3. **Batch API 100-request cap (#1)** — will cause errors on large sync batches
4. **Blob integrity checks (#4, #5)** — data correctness at rest and in transit
5. **Retry on transient failures (#3)** — resilience against Google API hiccups
6. **Chunked resumable upload (#2)** — reliability for large file transfers
