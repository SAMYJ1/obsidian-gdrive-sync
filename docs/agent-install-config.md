# Agent Install And Configuration Guide

This document is for an automation agent or operator that needs to install and configure the plugin with minimal interpretation.

## Goal

Install `obsidian-gdrive-sync` into one desktop Obsidian vault, configure Google OAuth, authenticate successfully, and complete an initial sync.

## Preconditions

The agent should assume all of the following are required:

- OS: desktop environment supported by Obsidian desktop
- Obsidian: `>= 1.6.0`
- This repository is available locally
- `npm` is available
- The target vault path is known
- The operator can enable Community Plugins in Obsidian
- A Google Cloud project can be created or reused
- The Google Drive API can be enabled
- A Google OAuth client of type `Desktop app` can be created

## Required Inputs

Before configuration, collect these values:

- `vault_path`: absolute path to the target Obsidian vault
- `vault_name`: current Obsidian vault name
- `google_client_id`: OAuth desktop client ID
- `google_client_secret`: optional OAuth desktop client secret
- `root_folder_name`: optional; defaults to `ObsidianSync`

## Build And Install

Run from the repository root:

```bash
npm install
npm run build
```

Create the plugin directory:

```bash
mkdir -p "<vault_path>/.obsidian/plugins/obsidian-gdrive-sync"
```

Copy install artifacts:

```bash
cp manifest.json main.js styles.css "<vault_path>/.obsidian/plugins/obsidian-gdrive-sync/"
```

Expected destination:

```text
<vault_path>/.obsidian/plugins/obsidian-gdrive-sync/
  manifest.json
  main.js
  styles.css
```

## Enable The Plugin

In Obsidian desktop:

1. Open the target vault
2. Go to `Settings -> Community plugins`
3. Enable Community Plugins if disabled
4. Enable `Obsidian Google Drive Sync`
5. Open the plugin settings page

## Google Cloud Setup

In Google Cloud Console:

1. Create or select a project
2. Enable `Google Drive API`
3. Create OAuth consent screen if required
4. Create an OAuth client with application type `Desktop app`
5. Record `Client ID`
6. Record `Client secret` if one is shown

Do not use a web client type. The plugin expects a desktop OAuth flow with a localhost callback server on `127.0.0.1`.

## Configure Plugin Settings

### General Tab

Set:

- `Google client ID` = `google_client_id`
- `Root folder name` = `root_folder_name` if the default should be changed

Recommended defaults unless the operator asked otherwise:

- `Enable auto sync` = `true`
- `Poll mode` = `foreground`
- `Poll interval (seconds)` = `30`

### Advanced / Experimental Tab

Set only if needed:

- `Google client secret` = `google_client_secret`
- `Snapshot publish mode` = `inplace` unless generation history is explicitly wanted
- `Generation retention count` = `3` if using `generations`
- `Ignore patterns` only for explicit exclusions

Default advanced values in current code:

- `Snapshot publish mode` = `inplace`
- `Generation retention count` = `3`
- `Push debounce` = `5` seconds
- `Push window` = `120` seconds

## Authenticate

From the General tab, click `Sign in with Google`.

Expected auth flow:

1. The plugin opens the default browser
2. The browser loads Google OAuth consent
3. After approval, Google redirects to `http://127.0.0.1:<random-port>/callback`
4. The browser page shows `Google Drive authentication complete. You can close this window.`
5. Obsidian shows the notice `Google Drive authentication complete.`

Implementation details the agent may rely on:

- OAuth scope is `https://www.googleapis.com/auth/drive.file`
- The flow requests offline access
- Tokens are stored locally in plugin data after success
- Access and refresh tokens are intentionally hidden in the settings UI

## Run Initial Sync

Trigger `Sync now` from any of these entry points:

- plugin settings page
- command palette
- ribbon button

Expected runtime behavior:

- status bar transitions through sync phases
- final steady state is `GDrive: idle`

If the remote already contains data for this vault and the local state is empty, the plugin may perform a cold start by downloading the snapshot and replaying remaining ops.

## Validation Checklist

The install/config is successful when all of these are true:

- the plugin is enabled in Obsidian
- Google auth completed without error
- `Sync now` completes and returns to `GDrive: idle`
- Google Drive contains the configured root folder
- Google Drive root contains a subfolder named exactly `vault_name`
- that vault folder contains plugin-managed content such as `manifest.json`, `ops/`, `blobs/`, or `vault/`

Local validation points:

- `<vault_path>/.obsidian/plugins/obsidian-gdrive-sync/data.json` exists after settings are saved
- `<vault_path>/.obsidian/plugins/obsidian-gdrive-sync/outbox.json` exists after sync state is persisted
- `<vault_path>/.obsidian/plugins/obsidian-gdrive-sync/runtime-state.json` may appear during sync operation
- `<vault_path>/.obsidian/plugins/obsidian-gdrive-sync/debug.log` may exist after recoverable failures

## Built-In Ignore Rules

The plugin always excludes these from normal vault sync:

```text
.obsidian/plugins/obsidian-gdrive-sync/**
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.trash/**
.DS_Store
```

Agents should not treat missing uploads for these paths as a bug.

## Failure Cases

### OAuth Cannot Start

Likely causes:

- `Google client ID` is empty
- OAuth client type is not `Desktop app`
- Google Drive API is not enabled

### OAuth Browser Flow Opens But Never Completes

Likely causes:

- localhost callback is blocked by local policy or another process
- the browser flow timed out before returning to Obsidian

### Sync Does Not Pull Remote Changes

Check:

- `Enable auto sync` is `true`
- `Poll mode` is not `manual`
- `Poll interval (seconds)` is greater than `0`
- valid tokens are stored locally

### Sync Does Not Push Local Changes

Check:

- the changed file path is not matched by built-in ignore rules
- the changed file path is not matched by user-provided ignore patterns
- the plugin is installed in the active vault

## Safe Assumptions For Agents

- The plugin is desktop-only
- The plugin does not bundle shared Google credentials
- The plugin manages one vault namespace under `<Root Folder Name>/<Vault Name>/`
- Manual sync is always available even if automatic polling is disabled
- Local plugin state should not be edited directly unless doing explicit recovery work
