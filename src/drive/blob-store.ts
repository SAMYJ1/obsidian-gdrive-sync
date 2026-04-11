import { computeBlobHash } from "../utils/hash";
import { GoogleDriveClient } from "./client";

export interface BlobUploadInput {
  blobHash?: string;
  content: string | Uint8Array | Buffer;
}

export class DriveBlobStore {
  constructor(private readonly driveClient: GoogleDriveClient) {}

  async uploadBlob(input: BlobUploadInput): Promise<{ blobHash: string }> {
    const blobHash = input.blobHash ?? await computeBlobHash(input.content);
    return this.driveClient.uploadBlob({
      blobHash,
      content: input.content
    });
  }

  async fetchBlob(blobHash: string, binary?: boolean): Promise<string | Uint8Array> {
    const content = await this.driveClient.fetchBlob(blobHash, binary);
    const actualHash = await computeBlobHash(content);
    if (actualHash !== blobHash) {
      throw new Error(`Blob integrity check failed: expected ${blobHash}, got ${actualHash}`);
    }
    return content;
  }
}
