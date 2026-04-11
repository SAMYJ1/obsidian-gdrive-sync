# Obsidian Google Drive Sync

Desktop-only Obsidian plugin that syncs a vault to Google Drive using an operation log, remote cursors, and published snapshots.

`v0.1.0` is intended for desktop Obsidian only. The plugin's Google sign-in flow depends on Electron and a localhost callback server, so `manifest.json` now marks it as desktop-only.

## What This Plugin Does

The plugin watches local vault changes, records them into a durable local outbox, pushes those changes to Google Drive, then polls Drive for remote updates and replays them back into the vault.

Current behavior includes:

- Local file tracking for create, modify, delete, and rename events
- Manual sync command and ribbon action
- Debounced automatic push after local edits
- Periodic polling for remote changes
- Cold-start hydration from remote snapshot plus op-log replay
- Two snapshot publish modes: `inplace` and `generations`
- Conflict handling for text merges, delete/modify cases, and rename conflicts
- Binary-safe reads and writes for common binary file types

## Current Scope And Limits

- Desktop Obsidian only
- Manual installation only; this repository is not packaged for the Obsidian community marketplace
- Google OAuth credentials are not bundled; you must provide your own Google OAuth client
- The plugin stores sync metadata in the vault's plugin directory and excludes those files from sync

## Install

### 1. Build The Plugin

```bash
npm install
npm run build
```

The build outputs `main.js` in the repository root.

### 2. Copy It Into Your Vault

Create this folder inside your vault:

```text
<your-vault>/.obsidian/plugins/obsidian-gdrive-sync
```

Copy these files into that folder:

- `manifest.json`
- `main.js`

Example:

```bash
mkdir -p "<your-vault>/.obsidian/plugins/obsidian-gdrive-sync"
cp manifest.json main.js "<your-vault>/.obsidian/plugins/obsidian-gdrive-sync/"
```

### 3. Enable It In Obsidian

In Obsidian:

1. Open `Settings -> Community plugins`
2. Enable community plugins if they are still disabled
3. Enable `Obsidian Google Drive Sync`
4. Open the plugin's settings tab

If Obsidian was already open while you copied the files, reload the app once.

## Google Drive Setup

Before you can click `Sign in with Google`, you need a Google OAuth client for this plugin.

### 1. Create Or Choose A Google Cloud Project

In Google Cloud Console:

1. Create a project, or reuse an existing one dedicated to this plugin
2. Open `APIs & Services`
3. Enable `Google Drive API`

### 2. Create A Desktop OAuth Client

In `APIs & Services -> Credentials`:

1. Create an OAuth consent screen if your project does not already have one
2. Create an OAuth client ID
3. Choose application type `Desktop app`
4. Copy the generated `Client ID`
5. If Google also shows a `Client secret`, keep it; the plugin has a field for it

Use a desktop OAuth client. The plugin opens the system browser and listens on a temporary `127.0.0.1` callback port, which matches the installed-app/desktop OAuth pattern.

### 3. Fill Plugin Settings

Open `Settings -> Community plugins -> Obsidian Google Drive Sync` and fill:

- `Google client ID`
- `Google client secret` only if your OAuth client uses one

`Google client secret` lives under `Advanced / Experimental`. Access and refresh tokens are stored locally after sign-in and are not shown as editable fields in the settings UI.

After that, click `Sign in with Google`.

## Why Google Client ID Is Required Before Sign-In

This plugin uses the standard Google OAuth authorization-code flow. Google needs to know which OAuth application is requesting access before it can show the consent screen, issue an authorization code, or mint refresh tokens.

In this codebase:

- The sign-in button calls `startGoogleAuth()`
- `startGoogleAuth()` throws if `googleClientId` is empty
- The OAuth request includes that `client_id`
- Later token refresh also uses the same client identity

The plugin does not ship a shared Google OAuth app on purpose, so every deployment supplies its own credentials.

## Google Auth Flow

This is the complete desktop flow implemented by the plugin.

### What Happens

1. You enter `Google client ID` in the plugin settings.
2. You click `Sign in with Google`.
3. The plugin starts a temporary localhost callback server on `127.0.0.1:<random-port>`.
4. The plugin opens your default browser to Google's OAuth consent page.
5. You sign in and approve Google Drive access.
6. Google redirects the browser back to the localhost callback URL.
7. The plugin exchanges the authorization code for:
   - an access token
   - a refresh token when Google returns one
   - an access-token expiry timestamp
8. The plugin saves those values into the plugin's settings data.
9. Future API calls use the access token, and the plugin refreshes it automatically when a refresh token is available.

### What You Need To See

On success:

- The browser tab shows a completion message
- Obsidian shows `Google Drive authentication complete.`

### If Sign-In Fails

Common causes:

- `Google client ID` was not filled in
- Google Drive API is not enabled for the project
- The OAuth client type is not `Desktop app`
- Another local process blocks the temporary callback port
- The browser consent flow timed out before returning to Obsidian

## Plugin Settings

The settings UI is split into two in-page tabs:

- `General`
  - everyday sync controls and Google sign-in
- `Advanced / Experimental`
  - lower-level snapshot, debounce, ignore, and OAuth client-secret settings

### General

### Sync Now

Runs a manual sync immediately from the settings page.

The same action is also available from:

- Command palette: `Sync now`
- Ribbon button: refresh icon

### Enable Auto Sync

Turns automatic push and polling behavior on or off.

- Enabled: local edits queue automatically and remote polling runs according to poll settings
- Disabled: no automatic sync cycle; use the command, settings button, or ribbon button manually

### Poll Mode

- `foreground`
  - Poll only while the Obsidian window is visible
  - Also triggers sync when the window regains focus
- `always`
  - Poll continuously
- `manual`
  - Disable background polling
  - You can still use `Sync now`

### Poll Interval

How often the plugin asks Google Drive for remote changes.

- Default: `30` seconds

### Root Folder Name

Top-level folder name created in Google Drive.

Default: `ObsidianSync`

The plugin stores the current vault's sync artifacts under that Drive root, including:

- manifest data
- op logs
- cursor files
- blobs
- snapshots

### Google Client ID

Required for the desktop sign-in flow.

### Google Sign-In

Starts the browser OAuth flow.

- On success, access and refresh tokens are stored locally in the plugin data
- Those tokens are intentionally hidden from the settings UI
- Use the same button again if you want to re-authenticate

### Advanced / Experimental

### Snapshot Publish Mode

Controls how the plugin publishes the vault snapshot after sync finalization.

- `inplace`
  - Lighter-weight mode
  - Updates the current snapshot files in place on Drive
- `generations`
  - Writes each snapshot to a new generation directory
  - Keeps a rolling history of recent generations
  - Uses `Generation retention count` to prune older generations

Use `inplace` if you want lower storage churn. Use `generations` if you want stronger snapshot isolation and easier rollback inspection on Drive.

### Generation Retention Count

Only shown when `Snapshot publish mode` is set to `generations`.

- Minimum effective value is `2`
- Default is `3`
- Older generations beyond the retention count are deleted from Drive

### Push Debounce

How long the plugin waits after local edits before starting an automatic sync.

- Default: `5` seconds
- Increase it if you make many rapid edits and want fewer sync runs

### Push Window

Maximum delay before a queued local change is pushed, even if continuous edits keep resetting the debounce timer.

- Default: `120` seconds

### Google Client Secret

Optional, depending on how your Google OAuth desktop client is configured.

- Usually entered once and then left alone
- Hidden behind the advanced tab because most users should not need it day to day

### Ignore Patterns

Additional gitignore-style patterns to exclude from sync.

Examples:

```text
drafts/**
*.tmp
private/*.md
```

## Built-In Ignore Rules

The plugin always excludes these paths:

```text
.obsidian/plugins/obsidian-gdrive-sync/runtime-state.json
.obsidian/plugins/obsidian-gdrive-sync/data.json
.obsidian/plugins/obsidian-gdrive-sync/outbox.json
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.trash/**
.DS_Store
```

That prevents local plugin state and volatile workspace files from being re-synced as normal vault content.

## How Sync Works

### Local Change Tracking

The plugin listens to Obsidian vault events and tracks:

- file create
- file modify
- file delete
- file rename

Each change is first recorded into a local outbox before it is pushed remotely. That outbox is stored under the plugin directory in the vault so queued operations survive app restarts.

### Manual Sync

You can trigger a sync in two ways:

- Command palette: `Sync now`
- Ribbon button: refresh icon

The plugin also shows a status bar indicator:

- `GDrive: idle`
- `GDrive: pushing ↑`
- `GDrive: pulling ↓`
- `GDrive: merging ⇄`
- `GDrive: finalizing…`

### Automatic Sync

When auto sync is enabled:

1. Local changes are queued
2. A debounced push starts after the configured delay
3. The plugin uploads pending operations
4. The plugin polls Drive for remote changes
5. Remote operations are applied locally
6. The plugin republishes the snapshot

### Cold Start

If a device has no local cursor state and no tracked file state yet, the plugin treats it as a cold start:

1. Register the device remotely
2. Download the latest snapshot
3. Apply that snapshot into the vault
4. Replay any remaining remote operations after the snapshot cut
5. Save the resulting cursor vector locally

That is how a new desktop instance can hydrate from an existing Drive-backed vault.

## Conflict Behavior

The plugin tries to preserve both sides when possible instead of silently dropping one side.

### Text Modify/Modify Conflicts

For text files, the plugin attempts a 3-way merge using a common ancestor blob.

- If a common ancestor exists, the merged text is written back to the original file
- If the merge still contains conflict regions, the merged file is written with conflict markers
- If no common ancestor can be found, the plugin falls back to a two-way diff and notifies the user

### Binary Conflicts

Binary files are not merged line-by-line.

Depending on the case, one side becomes the primary file and the other side is preserved as a conflict copy.

### Conflict Copy Naming

Typical conflict filenames include:

- `<name>.conflict-<device>-<timestamp>.<ext>`
- `<name>.deleted-conflict.md`
- `<path>.deleted-conflict`

### Rename Conflicts

Rename-related conflicts are resolved by applying the remote rename and preserving the local content as a conflict copy when necessary.

### Delete/Modify Conflicts

If one side deletes a file while the other side modifies it, the plugin preserves the modified content in a separate conflict file.

## Local Plugin State Files

The plugin writes local state under:

```text
.obsidian/plugins/obsidian-gdrive-sync/
```

Important files:

- `data.json`
  - plugin settings persisted by Obsidian, including locally stored OAuth tokens
- `outbox.json`
  - local queued operations, file tracking state, cursor vector, and Drive page token
- `runtime-state.json`
  - temporary remote-apply state used to suppress sync loops while remote changes are being written locally

You usually should not edit these files by hand.

## Recommended First-Time Setup

1. Install and enable the plugin on your desktop vault
2. Create a Google Cloud project
3. Enable Google Drive API
4. Create a `Desktop app` OAuth client
5. Fill `Google client ID` in `General` and optionally `Google client secret` in `Advanced / Experimental`
6. Click `Sign in with Google`
7. Confirm that Obsidian shows the authentication success notice
8. Leave `Enable auto sync` on unless you want a manual-only workflow
9. Review `Root folder name` before first sync if you want a custom Drive root
10. Run `Sync now`
11. Wait for the status bar to return to `GDrive: idle`

## Day-To-Day Usage

Typical workflow:

1. Edit notes normally
2. Let the plugin auto-push changes after the debounce window
3. Keep polling enabled on any device that should receive remote updates automatically
4. If needed, run `Sync now` before closing Obsidian
5. If a conflict file appears, resolve it manually and keep the version you want

## Troubleshooting

### The Sign-In Button Fails Immediately

Check:

- `Google client ID` is filled
- Google Drive API is enabled
- the OAuth client is a desktop client

### Remote Changes Never Arrive

Check:

- `Enable auto sync` is on
- `Poll mode` is not `manual`
- `Poll interval` is greater than `0`
- your locally stored access token is valid or your refresh token can refresh it

Then run `Sync now` manually once.

### Local Changes Are Not Uploading

Check:

- the file path is not excluded by built-in ignore rules or your custom ignore patterns
- the plugin is enabled in the correct vault
- Google auth completed successfully

### I See Conflict Files

That means the plugin preserved divergent edits instead of discarding one side. Resolve the note manually, then delete the extra conflict copy when you are done.

### I Want Manual-Only Sync

Set `Poll mode` to `manual`.

If you also want to disable automatic push after local edits, turn off `Enable auto sync` as well.

Then use the `Sync now` command or ribbon icon whenever you want to sync.

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
