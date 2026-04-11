import { updateCursorVector } from "./state";

export interface PullRemoteOperationsInput {
  backend: any;
  state: any;
  settings: any;
  deviceId: string;
  stateStore: {
    load(): Promise<any>;
    save(state: any): Promise<any>;
  };
  applyRemoteOperations(entries: any[]): Promise<void>;
}

export async function pullRemoteOperations(input: PullRemoteOperationsInput): Promise<{
  state: any;
  remoteOperations: any[];
}> {
  const remoteOperations = await input.backend.getPendingRemoteOperations(
    input.state.cursorByDevice,
    input.settings
  );
  await input.applyRemoteOperations(remoteOperations);

  // Spec §3: advance cursors only to the ops actually applied, not to latest remote heads.
  // Deriving heads from fetched ops prevents skipping ops that arrive during pull.
  const appliedHeads: Record<string, number> = { ...(input.state.cursorByDevice || {}) };
  for (const op of remoteOperations) {
    if (op.device && typeof op.seq === "number") {
      appliedHeads[op.device] = Math.max(appliedHeads[op.device] || 0, op.seq);
    }
  }

  const freshState = await input.stateStore.load();
  let state = updateCursorVector(freshState, appliedHeads);
  await input.stateStore.save(state);
  await input.backend.writeCursor(input.deviceId, state.cursorByDevice);
  return {
    state,
    remoteOperations
  };
}
