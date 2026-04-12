import { retryWithBackoff } from "../utils/retry";
import { markOperationPublished, markOperationCommitted } from "./state";

import { commitManifestPatch } from "./manifest";

export interface PushOutboxEntryInput {
  backend: any;
  deviceId: string;
  entry: any;
  state: any;
  vaultAdapter?: {
    readChangeContent?(filePath: string): Promise<string | Uint8Array>;
  };
  stateStore: {
    save(state: any): Promise<any>;
  };
}

/**
 * Upload blob + append op for a single entry (does NOT commit manifest).
 * Returns the entry status after publish ("published" or unchanged).
 */
export async function publishOutboxEntry(input: PushOutboxEntryInput): Promise<any> {
  let state = input.state;
  const entry = input.entry;

  if (entry.status === "pending") {
    const opPayload: Record<string, unknown> = {
      seq: entry.seq,
      device: input.deviceId,
      op: entry.op,
      path: entry.path,
      fileId: entry.fileId,
      parentBlobHashes: entry.parentBlobHashes,
      ts: entry.ts
    };
    if (entry.newPath) opPayload.newPath = entry.newPath;
    if (entry.op !== "delete") {
      opPayload.blobHash = entry.blobHash;
      opPayload.mtime = entry.mtime || entry.ts;
    }

    // Blob upload and op append write to independent files — run in parallel
    const blobPromise = entry.op !== "delete"
      ? (async () => {
          let uploadEntry = entry;
          if (uploadEntry.content == null) {
            const contentPath = entry.op === "rename" && entry.newPath ? entry.newPath : entry.path;
            if (!contentPath || !input.vaultAdapter || typeof input.vaultAdapter.readChangeContent !== "function") {
              throw new Error(`Missing content for pending entry seq=${entry.seq}`);
            }
            uploadEntry = {
              ...entry,
              content: await input.vaultAdapter.readChangeContent(contentPath)
            };
          }
          return retryWithBackoff(() => input.backend.uploadBlob(uploadEntry));
        })()
      : Promise.resolve();

    const opPromise = retryWithBackoff(() =>
      input.backend.appendOperation(opPayload)
    );

    const [, publishResult] = await Promise.all([blobPromise, opPromise]);
    state = markOperationPublished(state, entry.seq, publishResult as Record<string, unknown>);
    await input.stateStore.save(state);
  }

  return state;
}

/**
 * Push a single entry: publish (blob + op) then commit manifest.
 * Used for incremental syncs with small outbox counts.
 */
export async function pushOutboxEntry(input: PushOutboxEntryInput): Promise<any> {
  let state = await publishOutboxEntry(input);
  const entry = input.entry;

  // For published entries, check if the manifest already has this entry committed
  // (e.g., via reconciliation). If so, skip directly to committed.
  if (entry.status === "published" && typeof input.backend.readManifest === "function") {
    try {
      const manifest = await input.backend.readManifest();
      const device = manifest?.devices?.[input.deviceId];
      if (device && typeof device.opsHead === "number" && device.opsHead >= entry.seq) {
        state = markOperationCommitted(state, entry.seq);
        await input.stateStore.save(state);
        return state;
      }
    } catch {
      // Fall through to normal commit path
    }
  }

  await commitManifestPatch({
    backend: input.backend,
    deviceId: input.deviceId,
    entry
  });

  state = markOperationCommitted(state, entry.seq);
  await input.stateStore.save(state);
  return state;
}
