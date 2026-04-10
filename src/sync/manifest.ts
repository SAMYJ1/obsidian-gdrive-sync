import { retryWithBackoff } from "../utils/retry";

export interface CommitManifestPatchInput {
  backend: any;
  deviceId: string;
  entry: any;
}

export async function commitManifestPatch(input: CommitManifestPatchInput): Promise<any> {
  return retryWithBackoff(() => input.backend.commitManifest({
    deviceId: input.deviceId,
    files: [
      {
        path: input.entry.path,
        newPath: input.entry.newPath,
        op: input.entry.op,
        fileId: input.entry.fileId,
        blobHash: input.entry.blobHash,
        size: typeof input.entry.content === "string" ? input.entry.content.length : undefined,
        mtime: input.entry.mtime || input.entry.ts,
        lastModifiedBy: input.deviceId,
        updatedAt: input.entry.ts,
        seq: input.entry.seq
      }
    ]
  }));
}
