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
  const allOperations = await input.backend.getPendingRemoteOperations(
    input.state.cursorByDevice,
    input.settings
  );
  // Filter out ops from our own device — they were applied locally when created.
  // Re-applying them would trigger vault events and create duplicate outbox entries.
  const remoteOperations = allOperations.filter(
    (op: any) => op.device !== input.deviceId
  );
  await input.applyRemoteOperations(remoteOperations);

  // Spec §3: advance cursors for ALL fetched ops (including own device) to prevent re-fetching.
  // Only remote ops are applied to the vault, but all cursors must advance.
  const appliedHeads: Record<string, number> = { ...(input.state.cursorByDevice || {}) };
  for (const op of allOperations) {
    if (op.device && typeof op.seq === "number") {
      appliedHeads[op.device] = Math.max(appliedHeads[op.device] || 0, op.seq);
    }
  }

  const freshState = await input.stateStore.load();
  let state = updateCursorVector(freshState, appliedHeads);
  await input.stateStore.save(state);

  // Only write cursor to Drive when it actually changed to avoid creating
  // unnecessary Drive changes that trigger the poll loop.
  const oldCursor = input.state.cursorByDevice || {};
  const newCursor = state.cursorByDevice || {};
  const cursorChanged = Object.keys(appliedHeads).some(
    (device) => (newCursor[device] ?? 0) !== (oldCursor[device] ?? 0)
  );
  if (cursorChanged) {
    await input.backend.writeCursor(input.deviceId, state.cursorByDevice);
  }

  return {
    state,
    remoteOperations
  };
}
