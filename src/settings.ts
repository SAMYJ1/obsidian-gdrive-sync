const obsidian = require("obsidian");

export type SnapshotPublishMode = "inplace" | "generations";
export type PollMode = "foreground" | "always" | "manual";

export interface PluginSettings {
  snapshotPublishMode: SnapshotPublishMode;
  generationRetentionCount: number;
  remoteApplyCooldownMs: number;
  ignorePatterns: string[];
  pushDebounceMs: number;
  pushWindowMs: number;
  pollIntervalSeconds: number;
  pollMode: PollMode;
  enableAutoSync: boolean;
  rootFolderName: string;
  googleAccessToken: string;
  googleAccessTokenExpiresAt: number;
  googleRefreshToken: string;
  googleClientId: string;
  googleClientSecret: string;
  googleTokenEndpoint: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  snapshotPublishMode: "inplace",
  generationRetentionCount: 3,
  remoteApplyCooldownMs: 2000,
  ignorePatterns: [],
  pushDebounceMs: 5000,
  pushWindowMs: 120000,
  pollIntervalSeconds: 30,
  pollMode: "foreground",
  enableAutoSync: true,
  rootFolderName: "ObsidianSync",
  googleAccessToken: "",
  googleAccessTokenExpiresAt: 0,
  googleRefreshToken: "",
  googleClientId: "",
  googleClientSecret: "",
  googleTokenEndpoint: "https://oauth2.googleapis.com/token"
};

export function normalizeSettings(input?: Partial<PluginSettings> | null): PluginSettings {
  const merged: PluginSettings = {
    ...DEFAULT_SETTINGS,
    ...(input || {})
  };
  if (merged.snapshotPublishMode !== "inplace" && merged.snapshotPublishMode !== "generations") {
    merged.snapshotPublishMode = DEFAULT_SETTINGS.snapshotPublishMode;
  }
  if (!Number.isInteger(merged.generationRetentionCount) || merged.generationRetentionCount < 2) {
    merged.generationRetentionCount = DEFAULT_SETTINGS.generationRetentionCount;
  }
  if (!Number.isInteger(merged.remoteApplyCooldownMs) || merged.remoteApplyCooldownMs < 0) {
    merged.remoteApplyCooldownMs = DEFAULT_SETTINGS.remoteApplyCooldownMs;
  }
  if (!Array.isArray(merged.ignorePatterns)) {
    merged.ignorePatterns = [];
  }
  if (!Number.isInteger(merged.pushDebounceMs) || merged.pushDebounceMs < 0) {
    merged.pushDebounceMs = DEFAULT_SETTINGS.pushDebounceMs;
  }
  if (!Number.isInteger(merged.pushWindowMs) || merged.pushWindowMs < 0) {
    merged.pushWindowMs = DEFAULT_SETTINGS.pushWindowMs;
  }
  if (!Number.isInteger(merged.pollIntervalSeconds) || merged.pollIntervalSeconds < 0) {
    merged.pollIntervalSeconds = DEFAULT_SETTINGS.pollIntervalSeconds;
  }
  if (!["foreground", "always", "manual"].includes(merged.pollMode)) {
    merged.pollMode = DEFAULT_SETTINGS.pollMode;
  }
  if (typeof merged.enableAutoSync !== "boolean") {
    merged.enableAutoSync = DEFAULT_SETTINGS.enableAutoSync;
  }
  merged.rootFolderName = merged.rootFolderName || DEFAULT_SETTINGS.rootFolderName;
  merged.googleAccessToken = merged.googleAccessToken || "";
  merged.googleAccessTokenExpiresAt = Number(merged.googleAccessTokenExpiresAt || 0);
  merged.googleRefreshToken = merged.googleRefreshToken || "";
  merged.googleClientId = merged.googleClientId || "";
  merged.googleClientSecret = merged.googleClientSecret || "";
  merged.googleTokenEndpoint = merged.googleTokenEndpoint || DEFAULT_SETTINGS.googleTokenEndpoint;
  return merged;
}

export class ObsidianGDriveSyncSettingTab extends obsidian.PluginSettingTab {
  plugin: any;
  activeTab: "general" | "advanced" = "general";

  constructor(app: any, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const containerEl = this.containerEl;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian Google Drive Sync" });
    containerEl.createEl("p", {
      text: "Configure everyday sync behavior from General. Lower-level snapshot and OAuth details live under Advanced / Experimental."
    });

    this.renderTabSwitcher(containerEl);

    if (this.activeTab === "general") {
      this.renderGeneralSettings(containerEl);
      return;
    }

    this.renderAdvancedSettings(containerEl);
  }

  private renderTabSwitcher(containerEl: any): void {
    const tabBar = containerEl.createDiv();
    tabBar.style.display = "flex";
    tabBar.style.gap = "8px";
    tabBar.style.marginBottom = "16px";

    this.renderTabButton(tabBar, "General", "general");
    this.renderTabButton(tabBar, "Advanced / Experimental", "advanced");
  }

  private renderTabButton(containerEl: any, label: string, tab: "general" | "advanced"): void {
    const buttonEl = containerEl.createEl("button", { text: label });
    buttonEl.type = "button";
    if (this.activeTab === tab) {
      buttonEl.classList.add("mod-cta");
    }
    buttonEl.addEventListener("click", () => {
      if (this.activeTab === tab) {
        return;
      }
      this.activeTab = tab;
      this.display();
    });
  }

  private renderGeneralSettings(containerEl: any): void {
    const signedIn = Boolean(
      this.plugin.settings.googleRefreshToken ||
      this.plugin.settings.googleAccessToken
    );

    new obsidian.Setting(containerEl)
      .setName("Sync now")
      .setDesc("Run a manual sync immediately.")
      .addButton((button: any) => {
        button.setButtonText("Sync now").onClick(async () => {
          try {
            await this.plugin.runSyncNow();
          } catch (error: any) {
            new obsidian.Notice(String(error && error.message ? error.message : error));
          }
        });
      });

    new obsidian.Setting(containerEl)
      .setName("Enable auto sync")
      .setDesc("Automatically sync local changes and poll for remote changes.")
      .addToggle((toggle: any) => {
        toggle
          .setValue(this.plugin.settings.enableAutoSync)
          .onChange(async (value: boolean) => {
            this.plugin.settings.enableAutoSync = value;
            await this.plugin.saveSettings();
            this.plugin.startPolling();
          });
      });

    new obsidian.Setting(containerEl)
      .setName("Poll mode")
      .setDesc("Foreground polls only when Obsidian is visible. Always keeps polling. Manual disables background polling.")
      .addDropdown((dropdown: any) => {
        dropdown
          .addOption("foreground", "Foreground")
          .addOption("always", "Always")
          .addOption("manual", "Manual")
          .setValue(this.plugin.settings.pollMode)
          .onChange(async (value: PollMode) => {
            this.plugin.settings.pollMode = value;
            await this.plugin.saveSettings();
            this.plugin.startPolling();
          });
      });

    new obsidian.Setting(containerEl)
      .setName("Poll interval (seconds)")
      .setDesc("How often to poll Google Drive for remote changes.")
      .addText((text: any) => {
        text
          .setPlaceholder("30")
          .setValue(String(this.plugin.settings.pollIntervalSeconds))
          .onChange(async (value: string) => {
            this.plugin.settings.pollIntervalSeconds = parseInt(value, 10);
            await this.plugin.saveSettings();
            this.plugin.startPolling();
          });
      });

    new obsidian.Setting(containerEl)
      .setName("Root folder name")
      .setDesc("Top-level Google Drive folder used by this plugin.")
      .addText((text: any) => {
        text
          .setPlaceholder("ObsidianSync")
          .setValue(this.plugin.settings.rootFolderName)
          .onChange(async (value: string) => {
            this.plugin.settings.rootFolderName = value;
            await this.plugin.saveSettings();
          });
      });

    new obsidian.Setting(containerEl)
      .setName("Google client ID")
      .setDesc("Required before the desktop browser sign-in flow can start.")
      .addText((text: any) => {
        text
          .setPlaceholder("client id")
          .setValue(this.plugin.settings.googleClientId)
          .onChange(async (value: string) => {
            this.plugin.settings.googleClientId = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new obsidian.Setting(containerEl)
      .setName("Google sign-in")
      .setDesc(
        signedIn
          ? "Authenticated on this desktop. Access and refresh tokens are stored locally and hidden from this settings page."
          : "Start the browser OAuth flow. Tokens are stored locally on this desktop and hidden from this settings page."
      )
      .addButton((button: any) => {
        button.setButtonText(signedIn ? "Re-authenticate" : "Sign in with Google").onClick(async () => {
          try {
            await this.plugin.startGoogleAuth();
            this.display();
          } catch (error: any) {
            new obsidian.Notice(String(error && error.message ? error.message : error));
          }
        });
      });
  }

  private renderAdvancedSettings(containerEl: any): void {
    containerEl.createEl("p", {
      text: "These settings are lower-level or experimental. Most users should not need to change them after initial setup."
    });

    new obsidian.Setting(containerEl)
      .setName("Snapshot publish mode")
      .setDesc("Choose between the lighter inplace mode and the stronger generations mode.")
      .addDropdown((dropdown: any) => {
        dropdown
          .addOption("inplace", "Inplace")
          .addOption("generations", "Generations")
          .setValue(this.plugin.settings.snapshotPublishMode)
          .onChange(async (value: SnapshotPublishMode) => {
            this.plugin.settings.snapshotPublishMode = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.snapshotPublishMode === "generations") {
      new obsidian.Setting(containerEl)
        .setName("Generation retention count")
        .setDesc("Generations mode keeps the newest published snapshots.")
        .addText((text: any) => {
          text
            .setPlaceholder("3")
            .setValue(String(this.plugin.settings.generationRetentionCount))
            .onChange(async (value: string) => {
              this.plugin.settings.generationRetentionCount = parseInt(value, 10);
              await this.plugin.saveSettings();
            });
        });
    }

    new obsidian.Setting(containerEl)
      .setName("Push debounce (seconds)")
      .setDesc("Delay before automatically syncing local edits.")
      .addText((text: any) => {
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.pushDebounceMs / 1000))
          .onChange(async (value: string) => {
            this.plugin.settings.pushDebounceMs = Math.round(parseFloat(value) * 1000);
            await this.plugin.saveSettings();
          });
      });

    new obsidian.Setting(containerEl)
      .setName("Push window (seconds)")
      .setDesc("Maximum wait time before auto-pushing batched changes.")
      .addText((text: any) => {
        text
          .setPlaceholder("120")
          .setValue(String(this.plugin.settings.pushWindowMs / 1000))
          .onChange(async (value: string) => {
            this.plugin.settings.pushWindowMs = Math.round(parseFloat(value) * 1000);
            await this.plugin.saveSettings();
          });
      });

    new obsidian.Setting(containerEl)
      .setName("Google client secret")
      .setDesc("Optional for desktop OAuth. Usually entered once and then left alone.")
      .addText((text: any) => {
        text
          .setPlaceholder("client secret")
          .setValue(this.plugin.settings.googleClientSecret)
          .onChange(async (value: string) => {
            this.plugin.settings.googleClientSecret = value.trim();
            await this.plugin.saveSettings();
          });
        if (text.inputEl) {
          text.inputEl.type = "password";
        }
      });

    new obsidian.Setting(containerEl)
      .setName("Ignore patterns")
      .setDesc("One gitignore-style pattern per line.")
      .addTextArea((text: any) => {
        text
          .setPlaceholder("drafts/**")
          .setValue((this.plugin.settings.ignorePatterns || []).join("\n"))
          .onChange(async (value: string) => {
            this.plugin.settings.ignorePatterns = value
              .split(/\r?\n/)
              .map((line: string) => line.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          });
      });
  }
}
