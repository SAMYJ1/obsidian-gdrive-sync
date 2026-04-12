const obsidian = require("obsidian");

import { startOAuthFlow, fetchAccessToken } from "./drive/auth";
import { GoogleDriveBackend } from "./drive/backend";
import { GoogleDriveClient } from "./drive/client";
import { GOOGLE_DRIVE_BACKEND_CAPABILITIES } from "./drive/provider";
import { normalizeSettings, ObsidianGDriveSyncSettingTab, type PluginSettings } from "./settings";
import { SyncEngine } from "./sync/engine";
import { RuntimeStateStore } from "./sync/runtime-state";
import { normalizeLocalState, updateChangesPageToken } from "./sync/state";
import { prepareLocalStateForStorage, restoreLocalStateFromStorage, stripLocalStateContent } from "./sync/local-state-serialization";
import { createDeviceId } from "./utils/device";
import { createObsidianFetch } from "./utils/obsidian-fetch";
import { ObsidianVaultAdapter } from "./vault/adapter";
import { BUILT_IN_IGNORE_PATHS } from "./vault/filter";
import { GenerationPublisher } from "./vault/snapshot";
import { createVaultWatcher } from "./vault/watcher";
import { hasPendingOutboxEntries } from "./sync/state";

// --- Plugin data store (ported from lib/plugin-data-store.js) ---

async function loadPluginData(plugin: any): Promise<any> {
  const raw = await plugin.loadData();
  return raw || {};
}

async function savePluginData(plugin: any, data: any): Promise<any> {
  await plugin.saveData(data);
  return data;
}

function createSettingsStore(plugin: any) {
  return {
    async load() {
      const data = await loadPluginData(plugin);
      return normalizeSettings(data.settings);
    },
    async save(settings: any) {
      const data = await loadPluginData(plugin);
      data.settings = normalizeSettings(settings);
      await savePluginData(plugin, data);
      return data.settings;
    }
  };
}

function createLocalStateStore(plugin: any) {
  const outboxPath = `${plugin.manifest.dir}/outbox.json`;

  return {
    async load() {
      try {
        const raw = await plugin.app.vault.adapter.read(outboxPath);
        return stripLocalStateContent(restoreLocalStateFromStorage(normalizeLocalState(JSON.parse(raw))));
      } catch {
        const data = await loadPluginData(plugin);
        if (data.localState) {
          return stripLocalStateContent(restoreLocalStateFromStorage(normalizeLocalState(data.localState)));
        }
        return normalizeLocalState({});
      }
    },
    async save(localState: any) {
      const normalized = normalizeLocalState(localState);
      const serializable = prepareLocalStateForStorage(normalized);
      await plugin.app.vault.adapter.write(outboxPath, JSON.stringify(serializable, null, 2));
      return normalized;
    }
  };
}

class ObsidianGDriveSyncPlugin extends obsidian.Plugin {
  settings!: PluginSettings;
  localState: any;
  settingsStore: any;
  stateStore: any;
  runtimeStateStore: any;
  driveClient: any;
  generationPublisher: any;
  backend: any;
  vaultAdapter: any;
  syncEngine: any;
  debouncedSyncNow: any;
  pushWindowHandle: any;
  pollIntervalHandle: any;
  syncPhase: "idle" | "pushing" | "pulling" | "merging" | "finalizing" = "idle";
  pendingSyncTrigger = false;
  private lastSyncCompletedAt = 0;
  statusBarEl: any;
  ribbonIconEl: any;

  async onload(): Promise<void> {
    const rawData = await loadPluginData(this);
    this.settings = normalizeSettings(rawData.settings);
    this.localState = rawData.localState || {};
    if (!this.localState.deviceId) {
      this.localState.deviceId = createDeviceId("mac");
      await savePluginData(this, {
        settings: this.settings,
        localState: this.localState
      });
    }

    this.settingsStore = createSettingsStore(this);
    this.stateStore = createLocalStateStore(this);
    this.runtimeStateStore = new RuntimeStateStore({
      statePath: this.getRuntimeStatePath(),
      cooldownMs: this.settings.remoteApplyCooldownMs
    });
    this.runtimeStateStore.recoverIfStale();

    const driveFetch = createObsidianFetch(obsidian);
    this.driveClient = new GoogleDriveClient({
      fetchImpl: driveFetch,
      getAccessToken: () => fetchAccessToken(this.settingsStore, driveFetch as any),
      rootFolderName: this.settings.rootFolderName,
      vaultName: this.app.vault.getName()
    });
    this.generationPublisher = new GenerationPublisher({
      driveClient: this.driveClient,
      generationRetentionCount: this.settings.generationRetentionCount
    });
    this.backend = new GoogleDriveBackend({
      driveClient: this.driveClient,
      generationPublisher: this.generationPublisher
    });
    this.vaultAdapter = new ObsidianVaultAdapter({
      app: this.app,
      backend: this.backend
    });
    this.syncEngine = new SyncEngine({
      deviceId: this.localState.deviceId,
      backend: this.backend,
      settingsStore: this.settingsStore,
      stateStore: this.stateStore,
      runtimeStateStore: this.runtimeStateStore,
      vaultAdapter: this.vaultAdapter,
      notifyUser: (msg: string) => new obsidian.Notice(msg)
    });

    this.addSettingTab(new ObsidianGDriveSyncSettingTab(this.app, this));
    this.addCommand({
      id: "show-runtime-state-path",
      name: "Show runtime state path",
      callback: () => {
        new obsidian.Notice(this.getRuntimeStatePath());
      }
    });
    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        await this.runSyncNow();
      }
    });
    this.ribbonIconEl = this.addRibbonIcon("refresh-cw", "Sync now", async () => {
      await this.runSyncNow();
    });
    this.ensureSyncAnimationStyle();
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.registerVaultEvents();
    this.registerForegroundPollingHooks();
    this.startPolling();
    this.runInitialSyncIfNeeded().catch((error: unknown) => {
      console.warn("obsidian-gdrive-sync: initial sync failed", error);
      this.writeDebugLog("initial-sync-failed", error);
    });
  }

  private writeDebugLog(label: string, data: unknown): void {
    try {
      const logPath = this.app.vault.configDir + "/plugins/" + this.manifest.id + "/debug.log";
      const ts = new Date().toISOString();
      const line = `[${ts}] ${label}: ${data instanceof Error ? data.stack || data.message : JSON.stringify(data)}\n`;
      const existing = (() => { try { return require("fs").readFileSync(
        (this.app.vault.adapter as any).getBasePath() + "/" + logPath, "utf8"
      ); } catch { return ""; } })();
      require("fs").writeFileSync(
        (this.app.vault.adapter as any).getBasePath() + "/" + logPath,
        existing + line
      );
    } catch { /* best effort */ }
  }

  async onunload(): Promise<void> {
    this.stopPolling();
    this.clearPushWindow();
    await this.saveSettings();
  }

  getRuntimeStatePath(): string {
    return this.app.vault.configDir + "/plugins/" + this.manifest.id + "/runtime-state.json";
  }

  getBuiltInIgnorePaths(): string[] {
    return BUILT_IN_IGNORE_PATHS.slice();
  }

  getBackendCapabilities(): unknown {
    return GOOGLE_DRIVE_BACKEND_CAPABILITIES;
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await savePluginData(this, {
      settings: this.settings,
      localState: this.localState
    });
  }

  shouldSuppressRemoteApplyEvent(filePath: string, atTime: number): boolean {
    return this.runtimeStateStore.shouldSuppressPath(filePath, atTime);
  }

  registerVaultEvents(): void {
    createVaultWatcher({
      app: this.app,
      vaultAdapter: this.vaultAdapter,
      syncEngine: this.syncEngine,
      registerEvent: this.registerEvent.bind(this),
      shouldSuppressRemoteApplyEvent: this.shouldSuppressRemoteApplyEvent.bind(this),
      scheduleSync: this.scheduleSync.bind(this)
    });
  }

  scheduleSync(): void {
    if (!this.debouncedSyncNow) {
      this.debouncedSyncNow = obsidian.debounce(
        () => {
          this.clearPushWindow();
          this.runSyncNow().catch((error: unknown) => new obsidian.Notice(String(error)));
        },
        this.settings.pushDebounceMs,
        true
      );
    }
    this.debouncedSyncNow();
    // Push window: guarantee sync fires within pushWindowMs even if debounce keeps resetting
    if (!this.pushWindowHandle && this.settings.pushWindowMs > 0) {
      this.pushWindowHandle = window.setTimeout(() => {
        this.pushWindowHandle = null;
        this.runSyncNow().catch((error: unknown) => new obsidian.Notice(String(error)));
      }, this.settings.pushWindowMs);
    }
  }

  clearPushWindow(): void {
    if (this.pushWindowHandle) {
      window.clearTimeout(this.pushWindowHandle);
      this.pushWindowHandle = null;
    }
  }

  startPolling(): void {
    this.stopPolling();
    if (!this.shouldAutoPoll()) {
      return;
    }
    this.pollIntervalHandle = window.setInterval(() => {
      this.pollForChanges().catch((error: unknown) => new obsidian.Notice(String(error)));
    }, this.settings.pollIntervalSeconds * 1000);
  }

  stopPolling(): void {
    if (this.pollIntervalHandle) {
      window.clearInterval(this.pollIntervalHandle);
      this.pollIntervalHandle = null;
    }
  }

  async pollForChanges(): Promise<void> {
    if (this.syncPhase !== "idle") return;
    // Skip poll if sync completed very recently — Drive API has eventual
    // consistency, so our own writes may still appear as "new changes".
    const sinceLast = Date.now() - this.lastSyncCompletedAt;
    if (this.lastSyncCompletedAt > 0 && sinceLast < 30_000) {
      return;
    }
    try {
      let state = await this.stateStore.load();
      if (!state.changesPageToken) {
        const token = await this.backend.getStartPageToken();
        state = updateChangesPageToken(state, token);
        await this.stateStore.save(state);
        if (this.isColdStartCandidate(state)) {
          this.writeDebugLog("poll", "cold start candidate detected, running sync");
          await this.runSyncNow();
          return;
        }
        return;
      }
      const result = await this.backend.listChanges(state.changesPageToken);
      // Only trigger sync for changes that belong to this vault.
      // Ignore `change.removed` without vault context — it fires for any
      // trashed file in Drive (including our own snapshot/cursor writes).
      const hasChanges = (result.changes || []).some((change: any) => {
        const props = change.file && change.file.appProperties;
        return props && props.vault === this.app.vault.getName();
      });
      // Always advance the page token regardless of whether we sync.
      if (result.newStartPageToken || result.nextPageToken) {
        state = await this.stateStore.load();
        state = updateChangesPageToken(state, result.newStartPageToken || result.nextPageToken);
        await this.stateStore.save(state);
      }
      if (hasChanges) {
        this.writeDebugLog("poll", "remote changes detected, running sync");
        await this.runSyncNow();
      }
    } catch (error) {
      this.writeDebugLog("poll-error", error);
      console.warn("obsidian-gdrive-sync: poll failed, will retry on next interval", error);
    }
  }

  ensureSyncAnimationStyle(): void {
    if (typeof document === "undefined") {
      return;
    }
    if (document.getElementById("obsidian-gdrive-sync-style")) {
      return;
    }
    const styleEl = document.createElement("style");
    styleEl.id = "obsidian-gdrive-sync-style";
    styleEl.textContent = `
      @keyframes obsidian-gdrive-sync-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .obsidian-gdrive-sync-is-syncing svg {
        animation: obsidian-gdrive-sync-spin 1s linear infinite;
      }
    `;
    document.head.appendChild(styleEl);
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
    const labels: Record<string, string> = {
      idle: "GDrive: idle",
      pushing: "GDrive: pushing ↑",
      pulling: "GDrive: pulling ↓",
      merging: "GDrive: merging ⇄",
      finalizing: "GDrive: finalizing…"
    };
    this.statusBarEl.setText(labels[this.syncPhase] || `GDrive: ${this.syncPhase}`);
    if (this.ribbonIconEl) {
      if (this.syncPhase === "idle") {
        this.ribbonIconEl.removeClass("obsidian-gdrive-sync-is-syncing");
      } else {
        this.ribbonIconEl.addClass("obsidian-gdrive-sync-is-syncing");
      }
    }
  }

  async runSyncNow(): Promise<void> {
    if (this.syncPhase !== "idle") {
      this.pendingSyncTrigger = true;
      return;
    }
    this.syncPhase = "pushing";
    this.updateStatusBar();
    try {
      this.writeDebugLog("sync-start", "beginning sync cycle");
      await this.syncEngine.syncNow({
        onPhaseChange: (phase: string) => {
          this.writeDebugLog("phase-change", phase);
          if (phase === "pushing" || phase === "pulling" || phase === "merging" || phase === "finalizing") {
            this.syncPhase = phase;
            this.updateStatusBar();
          }
        }
      });
      this.writeDebugLog("sync-complete", "sync cycle finished");
      // After sync, refresh the changes page token so the next poll
      // starts from after our own Drive writes and won't re-trigger sync.
      // Wait briefly for Drive's eventual consistency to settle.
      try {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const freshToken = await this.backend.getStartPageToken();
        let postSyncState = await this.stateStore.load();
        postSyncState = updateChangesPageToken(postSyncState, freshToken);
        await this.stateStore.save(postSyncState);
      } catch (tokenError) {
        console.warn("obsidian-gdrive-sync: failed to refresh page token after sync", tokenError);
      }
    } catch (syncError: unknown) {
      this.writeDebugLog("sync-error", syncError);
    } finally {
      this.syncPhase = "idle";
      this.lastSyncCompletedAt = Date.now();
      this.updateStatusBar();
      if (this.pendingSyncTrigger) {
        this.pendingSyncTrigger = false;
        this.runSyncNow().catch((error: unknown) => new obsidian.Notice(String(error)));
      }
    }
  }

  async runInitialSyncIfNeeded(): Promise<void> {
    if (!this.settings.enableAutoSync) {
      return;
    }
    const state = await this.stateStore.load();
    if (hasPendingOutboxEntries(state)) {
      await this.runSyncNow();
      return;
    }
    // On startup, silently refresh the changes page token instead of
    // polling for changes.  The Drive changes API has eventual consistency
    // so our own writes from the previous session may still appear as
    // "new changes" — triggering an unnecessary sync cycle.  By refreshing
    // the token now and only responding to FUTURE changes, we avoid the
    // startup sync loop while still catching real remote edits on the
    // next regular poll interval.
    try {
      const freshToken = await this.backend.getStartPageToken();
      let updated = await this.stateStore.load();
      updated = updateChangesPageToken(updated, freshToken);
      await this.stateStore.save(updated);
      this.lastSyncCompletedAt = Date.now();
      this.writeDebugLog("startup", "refreshed page token, skipping initial poll");
    } catch (err) {
      this.writeDebugLog("startup-token-error", err);
    }
  }

  isColdStartCandidate(state: any): boolean {
    const current = state || {};
    return Object.keys(current.cursorByDevice || {}).length === 0 &&
      Object.keys(current.files || {}).length === 0;
  }

  shouldAutoPoll(): boolean {
    if (!this.settings.enableAutoSync || this.settings.pollIntervalSeconds <= 0) {
      return false;
    }
    if (this.settings.pollMode === "manual") {
      return false;
    }
    if (this.settings.pollMode === "always") {
      return true;
    }
    if (typeof document === "undefined") {
      return true;
    }
    return document.visibilityState !== "hidden";
  }

  registerForegroundPollingHooks(): void {
    if (typeof document !== "undefined") {
      this.registerDomEvent(document, "visibilitychange", () => {
        if (document.visibilityState === "hidden" && this.settings.pollMode === "foreground") {
          this.stopPolling();
        } else {
          this.startPolling();
          if (this.settings.pollMode === "foreground" && document.visibilityState !== "hidden") {
            this.handleForegroundSyncTrigger().catch((error: unknown) => new obsidian.Notice(String(error)));
          }
        }
      });
    }
    if (typeof window !== "undefined") {
      this.registerDomEvent(window, "focus", () => {
        if (this.settings.pollMode === "foreground") {
          this.startPolling();
          this.handleForegroundSyncTrigger().catch((error: unknown) => new obsidian.Notice(String(error)));
        }
      });
    }
  }

  async handleForegroundSyncTrigger(): Promise<void> {
    const state = await this.stateStore.load();
    if (hasPendingOutboxEntries(state)) {
      await this.runSyncNow();
      return;
    }
    await this.pollForChanges();
  }

  async startGoogleAuth(): Promise<void> {
    if (!this.settings.googleClientId) {
      throw new Error("Google client ID is required before starting OAuth");
    }
    const tokenSet = await startOAuthFlow({
      clientId: this.settings.googleClientId,
      clientSecret: this.settings.googleClientSecret,
      tokenEndpoint: this.settings.googleTokenEndpoint,
      fetchImpl: createObsidianFetch(obsidian) as any
    });
    this.settings.googleAccessToken = tokenSet.accessToken;
    this.settings.googleAccessTokenExpiresAt = tokenSet.expiresAt;
    if (tokenSet.refreshToken) {
      this.settings.googleRefreshToken = tokenSet.refreshToken;
    }
    await this.saveSettings();
    new obsidian.Notice("Google Drive authentication complete.");
  }
}

module.exports = ObsidianGDriveSyncPlugin;
