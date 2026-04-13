# Obsidian Google Drive Sync

Desktop-only Obsidian plugin that syncs one vault through Google Drive using:

- a per-device op log
- a durable local outbox
- remote cursor vectors
- a published snapshot layer for cold start and backup

This repository is currently a manual-install plugin, not an Obsidian Community Plugins release.

## Current Scope

- Desktop Obsidian only (`manifest.json` marks the plugin as desktop-only)
- Minimum Obsidian version: `1.6.0`
- Google OAuth credentials are not bundled; each deployment supplies its own desktop OAuth client
- The Google sign-in flow depends on Electron plus a temporary `127.0.0.1` callback server
- Sync metadata is stored under the vault's plugin directory and excluded from sync

## What The Plugin Does

Current implementation includes:

- Tracking local create, modify, delete, and rename events
- Manual sync from the command palette, settings page, and ribbon button
- Debounced automatic push after local edits
- Periodic polling for remote changes
- Cold-start hydration from a remote snapshot plus op replay
- Two snapshot publish modes: `inplace` and `generations`
- Text conflict handling with diff3-style merge behavior
- Preserve-both-sides handling for delete/modify, rename, and binary conflicts
- Binary-safe reads and writes for common non-text files
- Status bar and ribbon-state feedback during sync

## Install

### 1. Build

```bash
npm install
npm run build
```

Build output:

- `main.js`
- `manifest.json`
- `styles.css` exists in the repo and can be copied alongside the plugin, even though it is currently minimal

### 2. Copy Into Your Vault

Create the plugin directory:

```text
<your-vault>/.obsidian/plugins/obsidian-gdrive-sync
```

Copy these files:

- `manifest.json`
- `main.js`
- `styles.css`

Example:

```bash
mkdir -p "<your-vault>/.obsidian/plugins/obsidian-gdrive-sync"
cp manifest.json main.js styles.css "<your-vault>/.obsidian/plugins/obsidian-gdrive-sync/"
```

### 3. Enable In Obsidian

In Obsidian:

1. Open `Settings -> Community plugins`
2. Enable community plugins if needed
3. Enable `Obsidian Google Drive Sync`
4. Open the plugin settings tab

If Obsidian was already open while you copied the files, reload the app once.

## Google Drive Setup

Before using `Sign in with Google`, create your own Google OAuth desktop client.

### 1. Prepare A Google Cloud Project

In Google Cloud Console:

1. Create or choose a project for this plugin
2. Open `APIs & Services`
3. Enable `Google Drive API`

### 2. Create A Desktop OAuth Client

In `APIs & Services -> Credentials`:

1. Create the OAuth consent screen if it does not already exist
2. Create an OAuth client ID
3. Choose application type `Desktop app`
4. Copy the generated `Client ID`
5. Keep the `Client secret` too if Google shows one for your client

The plugin uses a desktop OAuth flow with a temporary localhost callback like `http://127.0.0.1:<random-port>/callback`.

### 3. Fill Plugin Settings

Open `Settings -> Community plugins -> Obsidian Google Drive Sync`.

Required:

- `Google client ID`

Optional:

- `Google client secret`

Then click `Sign in with Google`.

The plugin requests the Google Drive scope:

```text
https://www.googleapis.com/auth/drive.file
```

That scope is limited to files created or opened by the plugin's Drive app identity.

## First-Time Setup Checklist

1. Install and enable the plugin
2. Fill `Google client ID`
3. Optionally fill `Google client secret`
4. Leave `Enable auto sync` on unless you want manual-only behavior
5. Review `Root folder name` before the first sync
6. Click `Sign in with Google`
7. Confirm Obsidian shows `Google Drive authentication complete.`
8. Run `Sync now`
9. Wait until the status bar returns to `GDrive: idle`

If this is a new machine with an existing remote vault, the first sync may cold-start from the published snapshot.

## Settings

The settings UI has two tabs:

- `General`
- `Advanced / Experimental`

### General

`Sync now`

- Runs a manual sync immediately
- Also available from the command palette and ribbon button

`Enable auto sync`

- Default: `true`
- Controls automatic local push and background polling

`Poll mode`

- `foreground`: poll only while Obsidian is visible; also checks when focus returns
- `always`: poll continuously
- `manual`: disable background polling

`Poll interval (seconds)`

- Default: `30`
- Effective only when polling is enabled

`Root folder name`

- Default: `ObsidianSync`
- This is the top-level folder created in Google Drive
- Under that root, the plugin creates a vault-specific folder named after the current Obsidian vault

`Google client ID`

- Required before the OAuth flow can start

`Google sign-in`

- Starts browser-based desktop OAuth
- After success, access and refresh tokens are stored locally in plugin data
- Those token values are intentionally hidden from the settings UI

### Advanced / Experimental

`Snapshot publish mode`

- `inplace`: update the active snapshot in place
- `generations`: publish snapshots into rolling generation directories

`Generation retention count`

- Only shown when snapshot mode is `generations`
- Default: `3`
- Minimum effective value: `2`

`Push debounce (seconds)`

- Default: `5`
- Delay before queued local edits trigger automatic sync

`Push window (seconds)`

- Default: `120`
- Maximum wait before a queued change is pushed even if edits keep resetting the debounce timer

`Google client secret`

- Optional for desktop OAuth
- Hidden in the advanced tab because most setups only enter it once

`Ignore patterns`

- One gitignore-style pattern per line
- Examples:

```text
drafts/**
*.tmp
private/*.md
```

## How Sync Works

### Local Changes

The plugin watches vault events for:

- create
- modify
- delete
- rename

Changes are queued into a local outbox first so pending work survives restarts.

### Manual Sync

Manual sync is available from:

- Command palette: `Sync now`
- Ribbon button: refresh icon
- Settings tab: `Sync now`

The plugin also shows sync phase in the status bar:

- `GDrive: idle`
- `GDrive: pushing ↑`
- `GDrive: pulling ↓`
- `GDrive: merging ⇄`
- `GDrive: finalizing…`

### Automatic Sync

When auto sync is enabled:

1. Local edits are queued
2. A debounced push starts after the configured delay
3. Pending operations are uploaded to Drive
4. Drive is polled for remote changes
5. Remote operations are applied locally
6. The snapshot layer is republished

### Cold Start

When a device has no local cursor state and no tracked files yet, the plugin treats it as a cold-start candidate:

1. Download the published snapshot from Drive
2. Apply that snapshot into the vault
3. Replay remaining remote operations after the snapshot cut
4. Persist the resulting local cursor state

This is how a new desktop device can hydrate from an existing Drive-backed vault.

## Drive Layout

The plugin stores data under:

```text
<Root Folder Name>/<Vault Name>/
```

Typical managed content includes:

- `manifest.json`
- `ops/live/*.jsonl`
- `ops/archive/*.jsonl`
- `ops/cursors/*.json`
- `blobs/*`
- `vault/*`
- `vault/_snapshot_meta.json`
- `snapshots/generations/*` when generation publishing is enabled

## Conflict Behavior

The plugin tries to preserve information instead of silently overwriting it.

### Text Conflicts

For text files, the plugin attempts a 3-way merge using a common ancestor blob.

- If mergeable, the merged content is written back to the original file
- If conflicting regions remain, the file is written with conflict markers
- If no suitable ancestor is found, the plugin falls back to a two-way diff path and notifies the user

### Binary Conflicts

Binary files are not line-merged.

- One side becomes the primary file
- The other side is preserved as a conflict copy

Typical conflict filenames include:

- `<name>.conflict-<device>-<timestamp>.<ext>`
- `<name>.deleted-conflict.md`
- `<path>.deleted-conflict`

### Delete / Modify And Rename Cases

- Delete/modify conflicts preserve the modified side in a separate file
- Rename conflicts apply the rename and preserve divergent content when necessary

## Local State And Ignore Rules

Local plugin state lives under:

```text
.obsidian/plugins/obsidian-gdrive-sync/
```

Important files:

- `data.json`
  - Obsidian-managed plugin settings, including locally stored OAuth tokens
- `outbox.json`
  - persisted local queued operations, tracked file state, cursor vector, and Drive page token
- `runtime-state.json`
  - remote-apply suppression state used to avoid local echo loops
- `debug.log`
  - best-effort local debug log when sync/auth/runtime operations fail

Built-in ignore rules always exclude:

```text
.obsidian/plugins/obsidian-gdrive-sync/**
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.trash/**
.DS_Store
```

You usually should not edit plugin state files by hand.

## Troubleshooting

### Sign-In Fails Immediately

Check:

- `Google client ID` is filled
- Google Drive API is enabled
- the OAuth client type is `Desktop app`
- another local process is not blocking the temporary callback port

### Remote Changes Never Arrive

Check:

- `Enable auto sync` is on
- `Poll mode` is not `manual`
- `Poll interval` is greater than `0`
- local auth completed successfully

Then run `Sync now` once manually.

### Local Changes Are Not Uploading

Check:

- the file path is not excluded by built-in ignore rules or your custom ignore patterns
- the plugin is enabled in the correct vault
- the first sign-in completed successfully

### I See Conflict Files

That means the plugin preserved divergent edits instead of discarding one side. Resolve the desired final content manually, then remove the extra conflict copy.

### I Want Manual-Only Sync

Set `Poll mode` to `manual`.

If you also want to disable auto-push after edits, turn off `Enable auto sync`.

Then use `Sync now` whenever you want to sync.

## Agent Setup Guide

For an automation-oriented install/configuration checklist, see [docs/agent-install-config.md](docs/agent-install-config.md).

## Development

Build:

```bash
npm run build
```

Type-check:

```bash
npm run check
```

Test:

```bash
npm test
```
