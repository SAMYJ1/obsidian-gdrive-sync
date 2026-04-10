import { retryWithBackoff } from "../utils/retry";

export interface CommitManifestPatchInput {
  backend: any;
  deviceId: string;
  entry: any;
}

export async function commitManifestPatch(input: CommitManifestPatchInput): Promise<any> {
  const patch: Record<string, unknown> = {
    path: input.entry.path,
    op: input.entry.op,
    fileId: input.entry.fileId,
    lastModifiedBy: input.deviceId,
    updatedAt: input.entry.ts,
    seq: input.entry.seq
  };
  if (input.entry.newPath) patch.newPath = input.entry.newPath;
  // Spec §2: version-based optimistic lock — pass expected version for conflict detection
  if (typeof input.entry.version === "number" && input.entry.op !== "create") {
    patch.expectedVersion = input.entry.version - 1;
  }
  // Spec: delete ops carry no blobHash, size, or mtime
  if (input.entry.op !== "delete") {
    patch.blobHash = input.entry.blobHash;
    patch.size = typeof input.entry.content === "string" ? input.entry.content.length : undefined;
    patch.mtime = input.entry.mtime || input.entry.ts;
  }
  return retryWithBackoff(() => input.backend.commitManifest({
    deviceId: input.deviceId,
    files: [patch]
  }));
}
