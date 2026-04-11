const obsidian = require("obsidian");
import { isBinaryPath } from "../sync/merge";

export class ObsidianVaultAdapter {
  private readonly app: any;
  private readonly backend: any;

  constructor(options: { app: any; backend: any }) {
    this.app = options.app;
    this.backend = options.backend;
  }

  async readChangeContent(filePath: string): Promise<string | Uint8Array> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof obsidian.TFile)) {
      return "";
    }
    const bytes = await this.app.vault.readBinary(file);
    // Return raw bytes for binary files to avoid UTF-8 corruption
    if (isBinaryPath(filePath)) {
      return new Uint8Array(bytes);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("utf8");
    }
    return new TextDecoder().decode(bytes);
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
    // Use binary-safe write for binary files to avoid UTF-8 corruption
    if (isBinaryPath(entry.path) && content instanceof Uint8Array) {
      if (existing instanceof obsidian.TFile) {
        await this.app.vault.modifyBinary(existing, content.buffer);
        return;
      }
      await this.ensureParentFolder(entry.path);
      await this.app.vault.createBinary(entry.path, content.buffer);
      return;
    }
    const textContent = typeof content === "string" ? content : new TextDecoder().decode(content);
    if (existing instanceof obsidian.TFile) {
      await this.app.vault.modify(existing, textContent);
      return;
    }
    await this.ensureParentFolder(entry.path);
    await this.app.vault.create(entry.path, textContent);
  }

  async applySnapshot(files: Array<{ path: string; content: string }>): Promise<void> {
    const snapshotPaths = new Set((files || []).map((f) => f.path));

    // Remove local files not present in snapshot to avoid stale files persisting
    const allLocalFiles = this.app.vault.getFiles ? this.app.vault.getFiles() : [];
    for (const localFile of allLocalFiles) {
      if (!snapshotPaths.has(localFile.path) && !localFile.path.startsWith(".obsidian/")) {
        try {
          await this.app.vault.delete(localFile, true);
        } catch { /* file may already be gone */ }
      }
    }

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

  async writeFile(filePath: string, content: string | Uint8Array): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (content instanceof Uint8Array) {
      if (existing) {
        await this.app.vault.modifyBinary(existing, content.buffer);
      } else {
        await this.ensureParentFolder(filePath);
        await this.app.vault.createBinary(filePath, content.buffer);
      }
      return;
    }
    if (existing) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.ensureParentFolder(filePath);
      await this.app.vault.create(filePath, content);
    }
  }

  async writeConflictCopy(filePath: string, content: string | Uint8Array): Promise<void> {
    await this.ensureParentFolder(filePath);
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (content instanceof Uint8Array) {
      if (existing) {
        await this.app.vault.modifyBinary(existing, content.buffer);
      } else {
        await this.app.vault.createBinary(filePath, content.buffer);
      }
      return;
    }
    if (existing) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }
}
