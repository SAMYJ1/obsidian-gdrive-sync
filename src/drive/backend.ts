export class GoogleDriveBackend {
  private readonly driveClient: any;
  private readonly generationPublisher: any;
  private readonly now: () => number;

  constructor(options: { driveClient: any; generationPublisher?: any; now?: () => number }) {
    this.driveClient = options.driveClient;
    this.generationPublisher = options.generationPublisher;
    this.now = options.now || (() => Date.now());
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

  async fetchBlob(blobHash: string): Promise<string> {
    return this.driveClient.fetchBlob(blobHash);
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

    for (const file of input.files || []) {
      await this.driveClient.writeSnapshotFile(file.path, file.content);
    }
    for (const deletedPath of input.deletedFiles || []) {
      await this.driveClient.deletePath(deletedPath);
    }
    await this.driveClient.writeJson("vault/_snapshot_meta.json", {
      snapshotSeqs: input.snapshotSeqs || {},
      updatedAt: this.now()
    });
    return {
      snapshotPublishMode: "inplace",
      updatedAt: this.now()
    };
  }
}
