export interface LocalState {
  nextSeq: number;
  cursorByDevice: Record<string, number>;
  outbox: OutboxEntry[];
  files: Record<string, TrackedFile>;
  changesPageToken: string | null;
  deviceId?: string;
}

export interface OutboxEntry {
  seq: number;
  status: string;
  device?: string;
  ts?: number;
  op?: string;
  path?: string;
  newPath?: string;
  fileId?: string;
  blobHash?: string;
  parentBlobHashes?: string[];
  content?: string;
  [key: string]: unknown;
}

export interface TrackedFile {
  path: string;
  fileId?: string;
  version?: number;
  blobHash?: string | null;
  content?: string;
  lastModifiedBy?: string | null;
  updatedAt?: number | null;
  [key: string]: unknown;
}

export const DEFAULT_LOCAL_STATE: LocalState = {
  nextSeq: 1,
  cursorByDevice: {},
  outbox: [],
  files: {},
  changesPageToken: null
};

function cloneValue<T>(value: T): T {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, cloneValue(entry)])
    ) as T;
  }
  return value;
}

function cloneState(state: LocalState): LocalState {
  return cloneValue(state);
}

export function normalizeLocalState(input?: Partial<LocalState> | null): LocalState {
  const merged: LocalState = {
    ...DEFAULT_LOCAL_STATE,
    ...(input || {}),
    cursorByDevice: { ...DEFAULT_LOCAL_STATE.cursorByDevice, ...((input && input.cursorByDevice) || {}) },
    outbox: Array.isArray(input?.outbox) ? input!.outbox.slice() : [],
    files: { ...DEFAULT_LOCAL_STATE.files, ...((input && input.files) || {}) }
  };
  if (!Number.isInteger(merged.nextSeq) || merged.nextSeq < 1) {
    merged.nextSeq = DEFAULT_LOCAL_STATE.nextSeq;
  }
  return merged;
}

export function reserveOperation(state: LocalState): LocalState {
  const next = normalizeLocalState(cloneState(state));
  const seq = next.nextSeq;
  next.nextSeq += 1;
  next.outbox.push({ seq, status: "reserved" });
  return next;
}

export function bindReservedOperation(state: LocalState, seq: number, operation: Record<string, unknown>): LocalState {
  const next = normalizeLocalState(cloneState(state));
  next.outbox = next.outbox.map((entry) => {
    if (entry.seq !== seq) return entry;
    return { ...entry, ...operation, status: "pending" } as OutboxEntry;
  });
  return next;
}

export function markOperationPublished(state: LocalState, seq: number, extra?: Record<string, unknown>): LocalState {
  const next = normalizeLocalState(cloneState(state));
  next.outbox = next.outbox.map((entry) => {
    if (entry.seq !== seq) return entry;
    return { ...entry, ...(extra || {}), status: "published" } as OutboxEntry;
  });
  return next;
}

export function markOperationCommitted(state: LocalState, seq: number): LocalState {
  const next = normalizeLocalState(cloneState(state));
  next.outbox = next.outbox.filter((entry) => entry.seq !== seq);
  return next;
}

export function updateCursorVector(state: LocalState, cursorByDevice: Record<string, number>): LocalState {
  const next = normalizeLocalState(cloneState(state));
  next.cursorByDevice = { ...(cursorByDevice || {}) };
  return next;
}

export function updateTrackedFile(state: LocalState, fileRecord: TrackedFile): LocalState {
  const next = normalizeLocalState(cloneState(state));
  next.files[fileRecord.path] = { ...(next.files[fileRecord.path] || {}), ...fileRecord };
  return next;
}

export function removeTrackedFile(state: LocalState, filePath: string): LocalState {
  const next = normalizeLocalState(cloneState(state));
  delete next.files[filePath];
  return next;
}

export function pruneStaleReservedEntries(state: LocalState): LocalState {
  const next = normalizeLocalState(cloneState(state));
  next.outbox = next.outbox.filter((entry) => entry.status !== "reserved");
  return next;
}

export function updateChangesPageToken(state: LocalState, token: string): LocalState {
  const next = normalizeLocalState(cloneState(state));
  next.changesPageToken = token;
  return next;
}

export function hasPendingOutboxEntries(input?: Partial<LocalState> | null): boolean {
  const state = normalizeLocalState(input);
  return state.outbox.some((entry) => entry.status === "pending" || entry.status === "published");
}
