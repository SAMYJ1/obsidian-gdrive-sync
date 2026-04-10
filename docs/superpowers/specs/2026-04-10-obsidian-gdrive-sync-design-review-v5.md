# Review: Obsidian Google Drive Sync Plugin Design Spec

- Reviewed spec: [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design]]
- Prior review: [[docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design-review-v4]]
- Review date: 2026-04-10
- Reviewer: Codex
- Review type: design review

## Overall Assessment

One of the two v4 issues is closed as written: archive fallback is now correctly labeled repair-only. The cold-start fix is only partially closed. The spec fixed the manifest/head ordering bug, but it still does not guarantee that the downloaded `vault/` files correspond to the pinned `_snapshot_meta.json`, so cold start is still not anchored to one coherent snapshot/log cut.

## Findings

### 1. High: `_snapshot_meta.json` is not actually a safe publish barrier for cold start readers

The revised cold-start flow now does the right logical ordering:

- read `vault/_snapshot_meta.json`
- read `manifest.devices[*].opsHead`
- verify `snapshotSeqs <= opsHead`
- pin `targetHeads`

That closes the specific v4 bug where `targetHeads` could be pinned before checking the snapshot cut. But the spec still updates snapshot files in place before updating `_snapshot_meta.json`:

1. write changed files into `vault/`
2. then update `_snapshot_meta.json`

Because readers download `vault/` after reading `_snapshot_meta.json`, they can still observe files from a newer in-progress snapshot than the pinned `snapshotSeqs`. That recreates the same class of failure the v4 review was concerned about: local initialization may already include content beyond `targetHeads`, and the later replay/pull can re-apply those ops against state that already contains them.

Recommended fix:

- Make snapshot publication generation-based or copy-on-write so readers can fetch an immutable snapshot matching the pinned metadata.
- Or revalidate after download with a stronger protocol that proves the downloaded file set still matches the pinned snapshot generation.

### 2. Closed: archive fallback is now clearly repair-only

This is now specified correctly. The mainline cold-start path replays only from `ops/live/`, and the archive path is explicitly described as an invariant-violation repair path that is not reachable under normal operation.

## Conclusion

Issue (2) is closed. Issue (1) is not fully closed yet: the head-pinning change is correct, but snapshot publication still lacks a reader-safe atomic cut.
