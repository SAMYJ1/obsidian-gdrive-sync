const obsidian = require("obsidian");

export class ObsidianVaultAdapter {
  private readonly app: any;
  private readonly backend: any;

  constructor(options: { app: any; backend: any }) {
    this.app = options.app;
    this.backend = options.backend;
  }

  async readChangeContent(filePath: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof obsidian.TFile)) {
      return "";
    }
    const bytes = await this.app.vault.readBinary(file);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("utf8");
    }
    return "";
  }

  async applyRemoteOperation(entry: any): Promise<void> {
    if (entry.op === "delete") {
      const existing = this.app.vault.getAbstractFileByPath(entry.path);
      if (existing) {
        await this.app.vault.delete(existing, true);
      }
      return;
    }

    if (entry.op === "rename" && entry.newPath) {
      const existing = this.app.vault.getAbstractFileByPath(entry.path);
      if (existing) {
        await this.app.fileManager.renameFile(existing, entry.newPath);
      }
      return;
    }

    const content = await this.backend.fetchBlob(entry.blobHash);
    const existing = this.app.vault.getAbstractFileByPath(entry.path);
    if (existing instanceof obsidian.TFile) {
      await this.app.vault.modify(existing, content);
      return;
    }
    await this.ensureParentFolder(entry.path);
    await this.app.vault.create(entry.path, content);
  }

  async applySnapshot(files: Array<{ path: string; content: string }>): Promise<void> {
    for (const file of files || []) {
      await this.writeFile(file.path, file.content);
    }
  }

  async ensureParentFolder(filePath: string): Promise<void> {
    const parts = filePath.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? current + "/" + part : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.ensureParentFolder(filePath);
      await this.app.vault.create(filePath, content);
    }
  }

  async writeConflictCopy(filePath: string, content: string): Promise<void> {
    await this.ensureParentFolder(filePath);
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }
}
