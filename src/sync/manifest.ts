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
        lastModifiedBy: input.deviceId,
        updatedAt: input.entry.ts,
        seq: input.entry.seq
      }
    ]
  }));
}
