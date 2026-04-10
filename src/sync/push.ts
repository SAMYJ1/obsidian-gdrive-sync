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
    await retryWithBackoff(() => input.backend.uploadBlob(entry));
    const publishResult = await retryWithBackoff(() =>
      input.backend.appendOperation({
        seq: entry.seq,
        device: input.deviceId,
        op: entry.op,
        path: entry.path,
        newPath: entry.newPath,
        fileId: entry.fileId,
        blobHash: entry.blobHash,
        parentBlobHashes: entry.parentBlobHashes,
        ts: entry.ts
      })
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
