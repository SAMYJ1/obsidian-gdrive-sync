export interface VaultWatcherDependencies {
  app: any;
  vaultAdapter: {
    readChangeContent(filePath: string): Promise<string>;
  };
  syncEngine: {
    trackLocalChange(change: { path: string; op: "create" | "modify" | "delete"; content: string }): Promise<unknown>;
    trackRename(oldPath: string, newPath: string, content: string): Promise<unknown>;
  };
  registerEvent(callbackRef: any): void;
  shouldSuppressRemoteApplyEvent(filePath: string, atTime: number): boolean;
  scheduleSync(): void;
}

export function createVaultWatcher(deps: VaultWatcherDependencies): void {
  const handleTrackedChange = async (change: {
    path: string;
    op: "create" | "modify" | "delete";
  }): Promise<void> => {
    if (deps.shouldSuppressRemoteApplyEvent(change.path, Date.now())) {
      return;
    }
    const content = change.op === "delete" ? "" : await deps.vaultAdapter.readChangeContent(change.path);
    const result = await deps.syncEngine.trackLocalChange({
      path: change.path,
      op: change.op,
      content
    });
    // Only schedule sync if trackLocalChange created a real outbox entry.
    // No-op changes (e.g. unchanged files on startup) return null.
    if (result !== null && result !== undefined) {
      deps.scheduleSync();
    }
  };

  // Obsidian fires vault events for both TFile and TFolder.
  // TFolder has a `children` array; skip folders to avoid tracking directories.
  const isFolder = (f: any) => f && Array.isArray(f.children);

  deps.registerEvent(deps.app.vault.on("create", (file: any) => {
    if (file && file.path && !isFolder(file)) {
      void handleTrackedChange({ path: file.path, op: "create" });
    }
  }));
  deps.registerEvent(deps.app.vault.on("modify", (file: any) => {
    if (file && file.path && !isFolder(file)) {
      void handleTrackedChange({ path: file.path, op: "modify" });
    }
  }));
  deps.registerEvent(deps.app.vault.on("delete", (file: any) => {
    if (file && file.path && !isFolder(file)) {
      void handleTrackedChange({ path: file.path, op: "delete" });
    }
  }));
  deps.registerEvent(deps.app.vault.on("rename", async (file: any, oldPath: string) => {
    if (!file || !file.path || !oldPath || isFolder(file)) return;
    if (deps.shouldSuppressRemoteApplyEvent(file.path, Date.now())) return;
    const content = await deps.vaultAdapter.readChangeContent(file.path);
    await deps.syncEngine.trackRename(oldPath, file.path, content);
    deps.scheduleSync();
  }));
}
