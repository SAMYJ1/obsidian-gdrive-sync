export class GoogleDriveBackend {
  private readonly driveClient: any;
  private readonly generationPublisher: any;
  private readonly now: () => number;
  private readonly concurrency: number;

  constructor(options: { driveClient: any; generationPublisher?: any; now?: () => number; concurrency?: number }) {
    this.driveClient = options.driveClient;
    this.generationPublisher = options.generationPublisher;
    this.now = options.now || (() => Date.now());
    this.concurrency = options.concurrency ?? 5;
  }

  setBootstrapMode(enabled: boolean): void {
    if (typeof this.driveClient.setBootstrapMode === "function") {
      this.driveClient.setBootstrapMode(enabled);
    }
  }

  private async runConcurrent<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
    let remaining = items.slice();
    const maxRounds = 3;
    for (let round = 0; round < maxRounds; round++) {
      const failed: T[] = [];
      const queue = remaining.slice();
      const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
          const item = queue.shift()!;
          try {
            await fn(item);
          } catch (err) {
            console.log(`obsidian-gdrive-sync: runConcurrent item failed (round ${round + 1}), will retry`);
            failed.push(item);
          }
        }
      });
      await Promise.all(workers);
      if (failed.length === 0) return;
      if (round + 1 >= maxRounds) {
        throw new Error(`runConcurrent: ${failed.length} items still failing after ${maxRounds} rounds`);
      }
      remaining = failed;
      // Back off before retrying failed items
      await new Promise((resolve) => setTimeout(resolve, 2000 * (round + 1)));
      console.log(`obsidian-gdrive-sync: retrying ${failed.length} failed items (round ${round + 2})`);
    }
  }

  async uploadBlob(change: any): Promise<any> {
    return this.driveClient.uploadBlob(change);
  }

  async appendOperation(entry: any): Promise<any> {
    return this.driveClient.appendOperation(entry);
  }

  async commitManifest(manifestPatch: any): Promise<any> {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.driveClient.writeManifest(manifestPatch);
      } catch (error: any) {
        if (error?.status === 412 && attempt < maxRetries - 1) {
          // Reset ETag so next writeManifest re-reads fresh manifest + ETag
          if (typeof this.driveClient.resetManifestETag === "function") {
            this.driveClient.resetManifestETag();
          }
          continue;
        }
        throw error;
      }
    }
  }

  async writeCursor(deviceId: string, cursorVector: Record<string, number>): Promise<any> {
    return this.driveClient.writeCursor(deviceId, cursorVector);
  }

  async registerDevice(deviceId: string): Promise<any> {
    return this.commitManifest({ deviceId, files: [] });
  }

  async readManifest(): Promise<any> {
    return this.driveClient.readManifest();
  }

  async readSnapshotMeta(settings?: any): Promise<any> {
    return this.driveClient.readSnapshotMeta(settings?.snapshotPublishMode);
  }

  async downloadSnapshot(snapshotMeta: any, settings?: any): Promise<any> {
    return this.driveClient.downloadSnapshot(snapshotMeta, settings?.snapshotPublishMode);
  }

  async getRemoteHeads(): Promise<any> {
    return this.driveClient.getRemoteHeads();
  }

  async getPendingRemoteOperations(cursorByDevice: Record<string, number>): Promise<any> {
    return this.driveClient.listOperationsSince(cursorByDevice);
  }

  async fetchBlob(blobHash: string, binary?: boolean): Promise<string | Uint8Array> {
    return this.driveClient.fetchBlob(blobHash, binary);
  }

  async getOpsForFile(fileId: string, limit?: number): Promise<any> {
    return this.driveClient.getOpsForFile(fileId, limit);
  }

  async getStartPageToken(): Promise<string> {
    return this.driveClient.getStartPageToken();
  }

  async listChanges(pageToken: string): Promise<any> {
    return this.driveClient.listChanges(pageToken);
  }

  async readOperationLog(deviceId: string): Promise<any> {
    return this.driveClient.readOperationLog(deviceId);
  }

  async overwriteOperationLog(deviceId: string, entries: any[]): Promise<any> {
    return this.driveClient.overwriteOperationLog(deviceId, entries);
  }

  async writeArchiveLog(deviceId: string, startSeq: number, endSeq: number, entries: any[]): Promise<any> {
    return this.driveClient.writeArchiveLog(deviceId, startSeq, endSeq, entries);
  }

  async listCursorVectors(): Promise<any> {
    return this.driveClient.listCursorVectors();
  }

  async publishSnapshot(input: any): Promise<any> {
    if (input.snapshotPublishMode === "generations") {
      return this.generationPublisher.publish(input);
    }

    await this.runConcurrent(input.files || [], async (file: any) => {
      await this.driveClient.writeSnapshotFile(file.path, file.content);
    });
    await this.runConcurrent(input.deletedFiles || [], async (deletedPath: any) => {
      await this.driveClient.deletePath(deletedPath);
    });
    await this.driveClient.writeJson("vault/_snapshot_meta.json", {
      snapshotSeqs: input.snapshotSeqs || {},
      updatedAt: this.now()
    });
    return {
      snapshotPublishMode: "inplace",
      updatedAt: this.now()
    };
  }

  async garbageCollectBlobs(options?: { maxAgeMs?: number }): Promise<{ deletedCount: number }> {
    return this.driveClient.garbageCollectBlobs(options);
  }
}
