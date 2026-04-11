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
  // Spec: delete ops carry no blobHash, size, or mtime
  if (input.entry.op !== "delete") {
    patch.blobHash = input.entry.blobHash;
    patch.size = typeof input.entry.content === "string" ? input.entry.content.length : undefined;
    patch.mtime = input.entry.mtime || input.entry.ts;
  }

  // Version conflict retry: on versionConflict, re-read manifest to get
  // current version, then retry with the correct expectedVersion.
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Spec §2: version-based optimistic lock — pass expected version for conflict detection
      // On first attempt use the entry's version; on retries re-read manifest for current version
      if (attempt === 0) {
        if (typeof input.entry.version === "number" && input.entry.op !== "create") {
          patch.expectedVersion = input.entry.version - 1;
        }
      }
      return await retryWithBackoff(() => input.backend.commitManifest({
        deviceId: input.deviceId,
        files: [patch]
      }));
    } catch (error: any) {
      if (error?.versionConflict && attempt < maxAttempts - 1 &&
          typeof input.backend.readManifest === "function") {
        // Re-read manifest to get current version at path
        const manifest = await input.backend.readManifest();
        const currentRecord = manifest?.files?.[input.entry.path];
        if (currentRecord && typeof currentRecord.version === "number") {
          // Update version to current+1 and retry
          patch.expectedVersion = currentRecord.version;
          const newVersion = currentRecord.version + 1;
          patch.version = newVersion;
        } else {
          // File doesn't exist in manifest yet — treat as create (no expectedVersion)
          delete patch.expectedVersion;
        }
        continue;
      }
      throw error;
    }
  }
}
