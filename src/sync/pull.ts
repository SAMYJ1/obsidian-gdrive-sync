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
  const remoteHeads = await input.backend.getRemoteHeads();
  // Reload state to pick up file tracking changes from applyRemoteOperations
  const freshState = await input.stateStore.load();
  let state = updateCursorVector(freshState, remoteHeads);
  await input.stateStore.save(state);
  await input.backend.writeCursor(input.deviceId, state.cursorByDevice);
  return {
    state,
    remoteOperations
  };
}
