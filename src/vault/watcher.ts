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
    await deps.syncEngine.trackLocalChange({
      path: change.path,
      op: change.op,
      content
    });
    deps.scheduleSync();
  };

  deps.registerEvent(deps.app.vault.on("create", (file: any) => {
    if (file && file.path) {
      void handleTrackedChange({ path: file.path, op: "create" });
    }
  }));
  deps.registerEvent(deps.app.vault.on("modify", (file: any) => {
    if (file && file.path) {
      void handleTrackedChange({ path: file.path, op: "modify" });
    }
  }));
  deps.registerEvent(deps.app.vault.on("delete", (file: any) => {
    if (file && file.path) {
      void handleTrackedChange({ path: file.path, op: "delete" });
    }
  }));
  deps.registerEvent(deps.app.vault.on("rename", async (file: any, oldPath: string) => {
    if (!file || !file.path || !oldPath) return;
    if (deps.shouldSuppressRemoteApplyEvent(file.path, Date.now())) return;
    const content = await deps.vaultAdapter.readChangeContent(file.path);
    await deps.syncEngine.trackRename(oldPath, file.path, content);
    deps.scheduleSync();
  }));
}
