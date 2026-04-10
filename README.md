# Obsidian Google Drive Sync

Fresh plugin scaffold for the design tracked in `docs/superpowers/specs/2026-04-10-obsidian-gdrive-sync-design.md`.

Current implementation includes:

- `inplace` and `generations` snapshot publish modes
- generation build planning, publish flow, and retention GC helpers
- local `runtime-state.json` for remote-apply suppression and external tool coordination
- local outbox/cursor state primitives for sync sequencing
- Google Drive backend and client wrappers for blobs, manifest, cursors, op-log, and snapshots
- Obsidian plugin wiring for settings, vault event tracking, debounced sync, and polling

## Test

```bash
node tests/run-tests.js
```
