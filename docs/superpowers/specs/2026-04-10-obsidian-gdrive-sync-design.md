# Obsidian Google Drive Sync Plugin — Design Spec

> Mac-to-Mac Obsidian vault sync via Google Drive API, no relay server.

## Requirements

- Pure Google Drive API calls — no desktop client dependency, no relay server
- Lightweight periodic sync with debounce + batch push
- Line-level diff3 merge for Markdown conflict resolution
- Configurable file filtering (ignore patterns)
- Google Drive doubles as readable cloud backup
- Cold start support for new device initialization

---

## 1. Drive Storage Structure

```
Google Drive:
  /ObsidianSync/
    ├── manifest.json                ← global file index + device registry
    ├── ops/
    │   ├── live/
    │   │   └── {device-id}.jsonl    ← per-device active op-log (append-only, one file per device)
    │   ├── archive/
    │   │   └── {device-id}-{startSeq}-{endSeq}.jsonl  ← compacted immutable segments
    │   ├── cursors/
    │   │   └── {device-id}.json     ← per-device consumption cursor (zero contention)
    │   └── ...
    ├── blobs/
    │   ├── {content-sha256}         ← content-addressed file blobs
    │   └── ...
    └── vault/                       ← snapshot layer: full file mirror (readable backup)
        ├── _snapshot_meta.json      ← snapshot generation metadata (snapshotSeq per device)
        ├── 10 Raw/
        ├── 15 Manual/
        ├── 20 Wiki/
        └── ...
```

### Dual-layer design

| Layer | Purpose | R/W Frequency |
|---|---|---|
| `ops/` + `blobs/` | Incremental sync engine: op-log + content-addressed storage | Every sync cycle |
| `vault/` | Snapshot backup + cold start source for new devices | Async update after sync; full read on cold start |

`vault/` preserves the real directory structure and filenames, so the vault is browsable directly from the Google Drive web UI.

---

## 2. Data Model

### manifest.json

```json
{
  "version": 2,
  "devices": {
    "mac-home-a1b2": {
      "name": "MacBook Pro Home",
      "lastSeenAt": 1744300000000,
      "opsHead": 42,
      "status": "active"
    },
    "mac-office-c3d4": {
      "name": "Mac Mini Office",
      "lastSeenAt": 1744299500000,
      "opsHead": 38,
      "status": "active"
    }
  },
  "files": {
    "20 Wiki/Topics/example.md": {
      "fileId": "f-a1b2c3d4",
      "blobHash": "sha256-abc123...",
      "size": 2048,
      "mtime": 1744299000000,
      "lastModifiedBy": "mac-home-a1b2",
      "version": 7
    }
  }
}
```

- `devices`: device registry with liveness status (`active` / `inactive`)
- `devices[].status`: devices with `lastSeenAt` older than 30 days are auto-marked `inactive`
- `files`: current state of every file (hash, size, mtime, last modifier, version number)
- `syncCursor` has been moved out of manifest — see per-device cursor files below

### Per-device cursor files

Stored at `ops/cursors/{device-id}.json` — each device writes only its own file, eliminating contention for consumer-progress tracking. Note: manifest.json is still the shared CAS point for file-index updates; per-device cursors only remove the cursor-write hot spot.

Each consumer device tracks one high-water mark **per producer device** — i.e., a vector of how far it has consumed each producer's op-log.

```json
{
  "cursors": {
    "mac-home-a1b2": 42,
    "mac-office-c3d4": 38
  },
  "updatedAt": 1744300000000
}
```

Each device reads all cursor files to determine global consumption progress (needed for compaction), but only writes its own.

### Op-log entries (JSONL format)

```json
{"seq": 43, "op": "modify", "path": "20 Wiki/Topics/example.md", "fileId": "f-a1b2c3d4", "blobHash": "sha256-def456...", "parentBlobHashes": ["sha256-abc123..."], "mtime": 1744300100000, "device": "mac-home-a1b2", "ts": 1744300100000}
{"seq": 44, "op": "create", "path": "10 Raw/Web/new-article.md", "fileId": "f-e5f6g7h8", "blobHash": "sha256-ghi789...", "parentBlobHashes": [], "mtime": 1744300200000, "device": "mac-home-a1b2", "ts": 1744300200000}
{"seq": 45, "op": "delete", "path": "temp/scratch.md", "fileId": "f-i9j0k1l2", "parentBlobHashes": ["sha256-jkl012..."], "device": "mac-home-a1b2", "ts": 1744300300000}
{"seq": 46, "op": "rename", "path": "old-name.md", "newPath": "new-name.md", "fileId": "f-m3n4o5p6", "blobHash": "sha256-ghi789...", "parentBlobHashes": ["sha256-ghi789..."], "device": "mac-home-a1b2", "ts": 1744300300000}
```

Four operation types: `create` / `modify` / `delete` / `rename`. Every op carries a blob hash (except `delete`), enabling out-of-order replay by hash lookup.

**File identity (`fileId`):**

Every file is assigned a stable UUID (`fileId`) at creation time. This ID survives renames, content reverts, and path reuse. It is stored in:
- Every op entry (binds the op to a logical file, not just a path)
- `manifest.files[path].fileId` (current path → identity mapping)

This solves the problem where content hashes alone cannot distinguish between: a revert to old content, two unrelated files with identical bytes, or a delete-and-recreate at the same path. `fileId` provides stable lineage scoping for ancestry walks.

**Ancestry model (`parentBlobHashes`):**

Every state-changing op carries `parentBlobHashes: string[]` — the blob hash(es) the operation was based on. Ancestry walks are **scoped to the same `fileId`** — only ops with matching `fileId` are considered when traversing the parent chain:

| Op type | parentBlobHashes | Notes |
|---|---|---|
| `create` | `[]` (empty) | No prior content; new `fileId` assigned |
| `modify` | `["sha256-..."]` (single parent) | The blob hash of the file content before the edit |
| `modify` (merge result) | `["sha256-local...", "sha256-remote..."]` | Two parents — records both sides of a resolved merge |
| `delete` | `["sha256-..."]` (single parent) | The blob hash of the deleted file's last content |
| `rename` | `["sha256-..."]` (single parent) | Same `fileId` carried to new path; path identity tracked via `path` → `newPath` |

This model supports:
- **Simple conflicts**: both ops share the same single parent → direct diff3 ancestor
- **Post-merge conflicts**: walk `parentBlobHashes` chain (scoped by `fileId`) to find the nearest common ancestor
- **Content-revert ambiguity**: same blob hash on different `fileId`s are distinct lineages
- **Rename-vs-modify**: both ops carry the same `fileId`; rename op provides path transition, modify is retargeted to new path
- **Delete-vs-modify**: `delete` op carries `parentBlobHashes` and `fileId`; concurrent `modify` on same `fileId` is surfaced as conflict
- **Delete-and-recreate**: new `create` at same path gets a new `fileId`, breaking lineage cleanly

**Ancestry walk limits:** for practical purposes, ancestry walking is bounded to 100 ops depth. If a common ancestor is not found within that window, the merge falls back to two-way diff (local vs remote, no base) with user notification.

### Conflict detection

Uses `files[path].version` as an optimistic lock:
- Local modification is based on known version N
- If remote has already advanced to version N+1 at upload time → trigger conflict merge
- No conflict → version increments monotonically

### manifest.json concurrency

manifest.json is the single shared mutable state. Two devices may attempt concurrent updates. Protection via Google Drive ETag:

1. When reading manifest.json, store the response's ETag header
2. When writing, pass `If-Match: {etag}` on `files.update`
3. If ETag mismatch (HTTP 412) → re-read manifest, rebase local changes, retry
4. Op-log files have no contention — each device writes only its own file

---

## 3. Sync Engine Workflow

### Normal sync cycle

```
┌─────────────┐
│ 1. Collect   │  Vault.on('modify/create/delete/rename')
│    Local Ops │  → debounce 5s → write to in-memory op queue
└──────┬──────┘
       ▼
┌─────────────┐
│ 2. Push      │  a. Upload new blobs to blobs/ (skip existing hashes)
│    Changes   │  b. Append ops to ops/live/{device-id}.jsonl
└──────┬──────┘
       ▼
┌─────────────┐
│ 3. Pull      │  a. Read manifest.json for each device's opsHead
│    Remote    │  b. For each producer device, fetch ops where seq > own cursor[producerDeviceId]
└──────┬──────┘
       ▼
┌─────────────┐
│ 4. Merge     │  Per-path version check:
│              │  - No conflict → apply directly (download blob → write local)
│              │  - Conflict → diff3 line-level merge (see below)
└──────┬──────┘
       ▼
┌─────────────┐
│ 5. Commit    │  a. Update manifest.json (files + devices) via ETag optimistic lock
│              │  b. Update own cursor file in ops/cursors/{device-id}.json
│              │  c. Async update vault/ snapshot layer + _snapshot_meta.json
└─────────────┘
```

Push before Pull — local changes are uploaded first, ensuring no ops are missed.

### Conflict merge (diff3)

When the same file's version is concurrently advanced by two devices:

1. **Find common ancestor:** both conflicting `modify` ops carry the same `fileId` and `parentBlobHashes`. If they share the same single parent hash, that is the merge base. If parents differ (longer divergence), walk the `parentBlobHashes` chain through prior ops **scoped to the same `fileId`** to find the nearest common ancestor. Walk is bounded to 100 ops; if no common ancestor is found, fall back to two-way diff with user notification.
2. Download three versions from `blobs/`: base (ancestor), local, remote
3. Execute diff3 line-level merge:
   - Different lines changed → auto-merge
   - Same lines changed → mark conflict block:
     ```
     <<<<<<< local
     local content
     =======
     remote content
     >>>>>>> remote (mac-office-c3d4)
     ```
4. Write merged result locally + upload new blob + emit `modify` op with `parentBlobHashes: [localHash, remoteHash]` (merge commit with two parents)

**Cross-type conflicts:**

| Conflict | Resolution |
|---|---|
| modify-vs-modify | diff3 merge as above |
| rename-vs-modify | Retarget modify to new path (rename op carries `path` → `newPath` transition). If content also changed on both sides, diff3 merge at the new path. |
| delete-vs-modify | Restore file with conflict marker. User sees `{name}.deleted-conflict.md` alongside the modified version and resolves manually. |
| rename-vs-rename | If both rename to the same target, no-op. If different targets, keep both (one gets a conflict suffix). |
| rename-vs-delete | Treat as delete — the file no longer exists at the old or new path. If the user on the rename side also modified content, apply delete-vs-modify rule. |

For binary files (images, PDFs, etc.), line-level merge is impossible. Fallback: **last-write-wins + keep conflict copy** — newer version becomes the primary file, older version is saved as `{name}.conflict-{device}-{timestamp}.{ext}`.

### Cold start (new device initialization)

1. Register new device-id → write to `manifest.devices`
2. **Establish coherent cut (read-validate protocol):**
   a. Read `vault/_snapshot_meta.json` → pin as `snapshotSeqs_before`
   b. Read `manifest.devices[*].opsHead` → verify `opsHead >= snapshotSeqs_before[producer]` for every producer. If not, re-read manifest until the condition holds. Pin verified heads as `targetHeads`.
   c. Full download from `vault/` snapshot layer to local vault
   d. Re-read `vault/_snapshot_meta.json` → get `snapshotSeqs_after`
   e. **Validate:** if `snapshotSeqs_after != snapshotSeqs_before`, the snapshot was updated during download — restart from step 2a (retry loop, bounded to 3 attempts before falling back to pure op-log replay without snapshot)
   f. If equal, the downloaded files are coherent with the pinned `snapshotSeqs`
3. For each producer device, replay ops from `ops/live/{device-id}.jsonl` where `snapshotSeqs[producerDeviceId] < seq <= targetHeads[producerDeviceId]`. Under the compaction floor invariant, all needed ops are guaranteed to be in the active live log.
4. Set own cursor vector to `targetHeads` (the exact vector that was pinned and verified)
5. Run one normal incremental pull cycle to catch up any ops that arrived during initialization
6. Enter normal sync cycle

The read-validate protocol ensures the snapshot cut is coherent: if any writer updates `vault/` files between the initial `_snapshot_meta.json` read and the download completion, the final re-read will detect the change and trigger a retry. The pinned-head approach ensures the new device never writes a cursor past ops it hasn't actually replayed.

**Fallback:** if the read-validate loop fails 3 times (extremely active vault during cold start), skip the snapshot layer entirely and do a pure op-log replay from seq 0 for each producer. This is slower but always correct.

**Repair-only archive fallback:** if the live log is ever found to be missing expected ops (invariant violation due to a bug or manual intervention), the sync engine falls back to reading from `ops/archive/` and logs a warning. This path is not reachable under normal operation.

### Snapshot metadata (`vault/_snapshot_meta.json`)

`_snapshot_meta.json` serves as the **final publish marker** for snapshot consistency. The snapshot update protocol is:

1. Write all changed files to `vault/` directory
2. Only after all file writes succeed, update `_snapshot_meta.json` with the new `snapshotSeqs`
3. If the process crashes before step 2, the old `_snapshot_meta.json` remains and cold start will replay more ops (correct, just slower)

```json
{
  "snapshotSeqs": {
    "mac-home-a1b2": 40,
    "mac-office-c3d4": 37
  },
  "updatedAt": 1744299800000
}
```

Records the highest op sequence per producer device that is fully reflected in the snapshot. Any ops beyond these sequences must be replayed during cold start.

**Invariant:** compaction must never delete ops that are still needed by the snapshot layer or cold start. The compaction floor per producer is `min(minActiveCursor, snapshotSeqs[thisProducer])` — whichever is lower. Since `snapshotSeq` is always part of this minimum, all ops needed for cold start replay (from `snapshotSeq` to `opsHead`) are guaranteed to remain in the active log.

### Op-log compaction

When a single device's op-log exceeds 1000 entries:
1. Read all cursor files from `ops/cursors/` to find, for this producer's log, the minimum consumed seq across all **active** consumer devices: `minActiveCursor`
2. Read `vault/_snapshot_meta.json` to get `snapshotSeqs[thisProducer]`
3. Compute compaction floor: `compactionFloor = min(minActiveCursor, snapshotSeqs[thisProducer])`
4. Archive ops with `seq < compactionFloor` to `ops/archive/{device-id}-{startSeq}-{endSeq}.jsonl`
5. Active op-log file retains only entries at or above the compaction floor

**Inactive device handling:** devices with `lastSeenAt` older than 30 days are marked `inactive` in manifest. Compaction ignores inactive device cursors. When an inactive device reconnects, it performs a cold start (snapshot + op replay) rather than incremental sync, since its cursor may point to compacted ops.

### Recovery model

**Authority and commit point:** `manifest.json` is the **commit point** — a change is considered visible to other devices only when manifest has been updated to reflect it. op-log entries that exist without a corresponding manifest update are treated as uncommitted and will be reconciled on the next sync.

**Local outbox (write-ahead journal) and durable sequence allocation:**

Each device maintains a local write-ahead journal (`.obsidian/plugins/obsidian-gdrive-sync/outbox.json`) that durably reserves `(device, seq)` bindings before any remote publish begins. The journal follows a strict protocol:

1. **Reserve**: increment `nextSeq`, write a `reserved` entry with the new seq — this is the durable intent record
2. **Bind**: populate the entry with op details (path, blobHash, etc.), mark as `pending`
3. **Publish**: upload blob → append to remote op-log → mark as `published`
4. **Commit**: manifest updated → mark as `committed` → prune from journal

```json
{
  "nextSeq": 47,
  "journal": [
    {"seq": 45, "status": "published", "op": "modify", "path": "...", "blobHash": "..."},
    {"seq": 46, "status": "reserved"}
  ]
}
```

**Crash recovery rules:**
- `reserved` entry with no op details → seq was reserved but op never created. Skip this seq (gap is harmless; consumers tolerate missing seq numbers). Advance to next seq.
- `pending` entry (op details present, not yet published) → retry full publish from the beginning
- `published` entry (remote op-log written, manifest not yet updated) → reconciliation pass will detect and commit

This eliminates the ambiguity of whether a reserved seq should be reused or skipped after crash.

**Reconciliation pass:** at the start of each pull, the sync engine performs a lightweight reconciliation:
1. Read `manifest.devices[*].opsHead` to discover the last committed seq per device
2. For each producer device, read the last entry of its `ops/live/{device-id}.jsonl` to determine the highest durable seq in the remote log
3. If a producer's highest durable seq > its `manifest.opsHead`, those ops were published but the manifest update failed — read the uncommitted tail, recompute manifest state, retry the manifest commit via ETag CAS

This closes the gap where ops are durable on Drive but invisible via manifest. The check uses explicit seq comparison, not file length, so it remains correct after compaction.

**Failure scenarios and recovery:**

| Failure | Effect | Recovery |
|---|---|---|
| Blob upload succeeds, op append fails | Orphaned blob in `blobs/` | Harmless; journal entry stays `pending`, retried on next sync. Periodic GC removes unreferenced blobs (not in any op or manifest, older than 7 days) |
| Op append succeeds, manifest update fails | Op is durable but invisible | Reconciliation pass detects highest durable seq > opsHead, recomputes and retries manifest commit |
| Manifest updates, vault/ snapshot fails | Snapshot lags behind manifest | Normal — snapshot is eventually consistent. `_snapshot_meta.json` is the publish marker; cold start replays the gap |
| Sync crashes mid-pull (local files partially written) | Local vault inconsistent with cursor | Cursor is only advanced after all local writes succeed. On restart, pull replays from old cursor position |
| Local crash after seq reservation, before op bind | `reserved` entry with no op details | Seq is skipped (gap tolerated). `nextSeq` already advanced, so next op gets a fresh seq |
| Local crash after op bind, before publish | `pending` entry with op details | Full publish retried from the beginning on next sync |
| Cursor-write failure | Own cursor file not updated | Next sync re-reads cursor, finds it stale, re-advances after successful pull. Compaction is conservative (minimum of all cursors + snapshot floor), so a stale cursor only delays compaction, never causes data loss |

**Idempotency:** ops are deduplicated by `(device, seq)` pair. Replaying the same op multiple times produces the same result. This makes retry-on-failure safe without risk of duplicate application.

---

## 4. Trigger Mechanism

### Manual trigger

- One "Sync Now" button (ribbon icon + Command Palette)
- Executes full push → pull flow

### Auto-poll mode (settings)

| Mode | Behavior |
|---|---|
| `foreground` (default) | Poll only when Obsidian is in foreground; trigger one sync immediately on window focus |
| `always` | Poll continuously regardless of focus |
| `manual` | No auto-poll, fully manual |

### Foreground detection

Obsidian runs on Electron — use DOM `visibilitychange` event:

```typescript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    this.triggerSync();
    if (this.settings.pollMode === 'foreground') {
      this.startPolling();
    }
  } else {
    if (this.settings.pollMode === 'foreground') {
      this.stopPolling();
    }
  }
});
```

### Remote change detection

Uses Google Drive `changes.list` API with a stored `pageToken`:
- Poll at configurable interval (default 30s)
- API cost is minimal when there are no changes (single HTTP request, empty response)
- Only enters full Pull → Merge flow when changes are detected

---

## 5. Google Drive API Layer

### OAuth authentication

1. User clicks "Sign in with Google" in plugin settings
2. System browser opens → Google OAuth consent screen
3. User authorizes → callback returns authorization code
4. Plugin exchanges code for refresh_token + access_token
5. refresh_token persisted in plugin `data.json`
6. access_token auto-refreshed via refresh_token when expired

**Scope:** `https://www.googleapis.com/auth/drive.file` — only accesses files created by the plugin (minimum privilege).

### API call mapping

| Operation | Drive API | Notes |
|---|---|---|
| Detect remote changes | `changes.list(pageToken)` | Incremental change detection, polling core |
| Get pageToken | `changes.getStartPageToken` | Initialize at cold start |
| Upload file | `files.create` (multipart) | New blobs / new op-log entries |
| Update file | `files.update` (multipart) | Update manifest / vault snapshot |
| Download file | `files.get(alt=media)` | Fetch blob content |
| Find file | `files.list(q=...)` | Locate file by name + parent |
| Create folder | `files.create(mimeType=folder)` | Initialize directory structure |

### Request optimization

1. **Batch API for metadata** — Drive batch API supports up to 100 metadata-only requests per batch (file lookup, folder creation, etc.). Media uploads and downloads are **not** supported by batch API. Note: batched inner calls still count individually toward quota — batching reduces connection overhead, not logical request count.
2. **Concurrent media transfers** — blob uploads and downloads are parallelized via concurrent HTTP requests (capped at 5-10 concurrent connections) rather than batch API
3. **Content-addressed dedup** — before uploading a blob, check manifest.files for existing hash; identical content is never re-uploaded (especially effective for renames)
4. **Resumable upload** — files >5MB use resumable upload protocol (binary attachments may hit this path)
5. **Rate control** — Drive API quota is 12,000 requests/min/user (unlikely to reach); plugin implements a simple token bucket as insurance

### drive.file scope constraint

`drive.file` scope can only access files created by the plugin:
- All folders and files are created by the plugin at initialization → fully controllable afterward
- Other files in user's Drive are invisible → privacy-friendly
- Files manually placed in the vault/ directory via Drive web UI will not be visible to the plugin → expected behavior, sync is plugin-managed

---

## 6. File Filtering

### Default ignore rules

```
.obsidian/plugins/obsidian-gdrive-sync/data.json   ← plugin's own tokens/config
.obsidian/workspace.json                            ← per-device workspace layout
.trash/**
.DS_Store
```

### User-configurable patterns

.gitignore-style syntax, configured in the settings panel. Examples:

```
*.tmp
drafts/**
node_modules/**
```

### Filter application points

- **Local event listener**: matching file changes are discarded before entering op queue
- **Cold start full pull**: matching remote files are skipped

---

## 7. Plugin Architecture

### Module structure

```
src/
├── main.ts                  ← Obsidian Plugin entry, lifecycle management
├── settings.ts              ← Settings panel UI + config data structure
│
├── sync/
│   ├── engine.ts            ← Sync scheduler: timers, trigger logic, state machine
│   ├── push.ts              ← Push flow: collect local ops → upload blobs → append op-log
│   ├── pull.ts              ← Pull flow: fetch remote ops → apply changes
│   ├── merge.ts             ← diff3 line-level merge + conflict marking
│   └── manifest.ts          ← manifest.json read/write + version vector management
│
├── drive/
│   ├── auth.ts              ← OAuth flow + token management
│   ├── client.ts            ← Drive API wrapper (CRUD, batch, changes)
│   └── blob-store.ts        ← Content-addressed blob upload/download/dedup
│
├── vault/
│   ├── watcher.ts           ← Vault file event listener + debounce
│   ├── filter.ts            ← Ignore pattern matching
│   └── snapshot.ts          ← vault/ snapshot layer async update
│
└── utils/
    ├── diff3.ts             ← Three-way merge algorithm
    ├── hash.ts              ← SHA-256 computation
    └── device.ts            ← Device ID generation and management
```

### State machine

```
         ┌──────────┐
         │   IDLE   │◄──────────────────────┐
         └────┬─────┘                       │
   trigger    │                             │
              ▼                             │
         ┌──────────┐    error/done    ┌────┴─────┐
         │ PUSHING  │────────────────►│FINALIZING│
         └────┬─────┘                 └────┬─────┘
   done       │                            │ done
              ▼                            │
         ┌──────────┐                      │
         │ PULLING  │──────────────────────┘
         └────┬─────┘
   conflict   │
              ▼
         ┌──────────┐
         │ MERGING  │──────────────────────┘
         └──────────┘
```

- Only one sync flow runs at any time
- Triggers received during sync are coalesced into one queued run
- UI reflects state: idle → spinner → conflict notification, etc.

### Settings panel

```
Sync Settings
├── Poll Mode:        [Foreground ▾]    ← foreground / always / manual
├── Poll Interval:    [30] seconds      ← Changes API poll interval
├── Push Debounce:    [5] seconds       ← wait time after file change
├── Push Window:      [120] seconds     ← max wait before auto-push
└── Ignore Patterns:  [textarea]        ← .gitignore-style rules
```

### Tech stack

- Language: TypeScript (Obsidian plugin standard)
- Build: esbuild (Obsidian community recommended)
- diff3: self-implemented or port core logic from `node-diff3` (no external dependency)
- SHA-256: Web Crypto API (`crypto.subtle.digest`)
- HTTP: Obsidian's `requestUrl` (bypasses CORS restrictions)
