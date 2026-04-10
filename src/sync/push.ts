import { retryWithBackoff } from "../utils/retry";
import { markOperationPublished, markOperationCommitted } from "./state";

import { commitManifestPatch } from "./manifest";

export interface PushOutboxEntryInput {
  backend: any;
  deviceId: string;
  entry: any;
  state: any;
  stateStore: {
    save(state: any): Promise<any>;
  };
}

export async function pushOutboxEntry(input: PushOutboxEntryInput): Promise<any> {
  let state = input.state;
  const entry = input.entry;

  if (entry.status === "pending") {
    if (entry.op !== "delete") {
      await retryWithBackoff(() => input.backend.uploadBlob(entry));
    }
    const opPayload: Record<string, unknown> = {
      seq: entry.seq,
      device: input.deviceId,
      op: entry.op,
      path: entry.path,
      fileId: entry.fileId,
      parentBlobHashes: entry.parentBlobHashes,
      mtime: entry.mtime || entry.ts,
      ts: entry.ts
    };
    if (entry.newPath) opPayload.newPath = entry.newPath;
    if (entry.op !== "delete") opPayload.blobHash = entry.blobHash;
    const publishResult = await retryWithBackoff(() =>
      input.backend.appendOperation(opPayload)
    );
    state = markOperationPublished(state, entry.seq, publishResult as Record<string, unknown>);
    await input.stateStore.save(state);
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
