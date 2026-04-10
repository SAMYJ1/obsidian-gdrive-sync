import crypto from "crypto";

import { normalizeSettings } from "../settings";
import { isIgnoredPath } from "../vault/filter";
import { computeBlobHash } from "../utils/hash";
import { computeBlobHashSync, isBinaryPath, mergeRemoteText } from "./merge";
import { pullRemoteOperations } from "./pull";
import { pushOutboxEntry } from "./push";
import {
  normalizeLocalState,
  reserveOperation,
  bindReservedOperation,
  updateTrackedFile,
  removeTrackedFile,
  pruneStaleReservedEntries,
  updateCursorVector
} from "./state";

// --- Cold start (ported from lib/cold-start.js) ---

export function isColdStartState(state: any): boolean {
  const normalized = normalizeLocalState(state);
  return Object.keys(normalized.cursorByDevice || {}).length === 0 &&
    Object.keys(normalized.files || {}).length === 0;
}

function buildTargetHeads(manifest: any): Record<string, number> {
  const heads: Record<string, number> = {};
  Object.keys((manifest && manifest.devices) || {}).forEach((deviceId) => {
    heads[deviceId] = manifest.devices[deviceId].opsHead || 0;
  });
  return heads;
}

export function filterOperationsToTargetHeads(entries: any[], targetHeads: Record<string, number>): any[] {
  return (entries || []).filter((entry) => {
    const head = targetHeads[entry.device];
    return typeof head === "number" && entry.seq <= head;
  });
}

export async function coldStart(options: {
  backend: any;
  stateStore: any;
  vaultAdapter?: any;
  deviceId: string;
  applyRemoteOperations: (entries: any[]) => Promise<void>;
  maxAttempts?: number;
  settings?: any;
}): Promise<any> {
  const { backend, stateStore, vaultAdapter, deviceId, applyRemoteOperations } = options;
  const maxAttempts = options.maxAttempts || 3;
  const settings = options.settings || {};

  if (backend && typeof backend.registerDevice === "function") {
    await backend.registerDevice(deviceId);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const snapshotMetaBefore = await backend.readSnapshotMeta(settings);
    const manifest = await backend.readManifest();
    const snapshotSeqs: Record<string, number> = { ...((snapshotMetaBefore && snapshotMetaBefore.snapshotSeqs) || {}) };
    const targetHeads = buildTargetHeads(manifest);

    Object.keys(snapshotSeqs).forEach((producerId) => {
      if ((targetHeads[producerId] || 0) < snapshotSeqs[producerId]) {
        throw new Error("Snapshot ahead of committed manifest heads for " + producerId);
      }
    });

    const rawSnapshotFiles = await backend.downloadSnapshot(snapshotMetaBefore, settings);
    const ignorePatterns = settings.ignorePatterns || [];
    const snapshotFiles = (rawSnapshotFiles || []).filter(
      (file: any) => !isIgnoredPath(file.path, ignorePatterns)
    );
    if (vaultAdapter && typeof vaultAdapter.applySnapshot === "function") {
      await vaultAdapter.applySnapshot(snapshotFiles);
    }

    const snapshotMetaAfter = await backend.readSnapshotMeta(settings);
    const beforeKey = JSON.stringify(snapshotMetaBefore || {});
    const afterKey = JSON.stringify(snapshotMetaAfter || {});
    if (beforeKey !== afterKey) {
      if (attempt < maxAttempts - 1) {
        continue;
      }
      // Fallback: pure op-log replay from seq 0 (spec §3)
      console.warn("obsidian-gdrive-sync: cold start snapshot unstable after 3 attempts, falling back to pure op-log replay");
      let state = normalizeLocalState(await stateStore.load());
      state = { ...state, files: {} };
      await stateStore.save(state);
      const allOps = await backend.getPendingRemoteOperations({}, settings);
      const replayHeads = buildTargetHeads(manifest);
      const replayable = filterOperationsToTargetHeads(allOps, replayHeads);
      await applyRemoteOperations(replayable);
      state = normalizeLocalState(await stateStore.load());
      state = updateCursorVector(state, replayHeads);
      await stateStore.save(state);
      if (backend && typeof backend.writeCursor === "function") {
        await backend.writeCursor(deviceId, replayHeads);
      }
      return { snapshotMeta: null, targetHeads: replayHeads, replayedOperations: replayable };
    }

    let state = normalizeLocalState(await stateStore.load());
    state = { ...state, files: {} };
    (snapshotFiles || []).forEach((file: any) => {
      const manifestRecord = manifest.files && manifest.files[file.path] ? manifest.files[file.path] : {};
      state = updateTrackedFile(state, {
        path: file.path,
        fileId: manifestRecord.fileId || file.path,
        version: manifestRecord.version || 1,
        blobHash: manifestRecord.blobHash || null,
        content: file.content,
        lastModifiedBy: manifestRecord.lastModifiedBy || null,
        updatedAt: manifestRecord.updatedAt || null
      });
    });
    await stateStore.save(state);

    const pending = await backend.getPendingRemoteOperations(snapshotSeqs, settings);
    const replayable = filterOperationsToTargetHeads(pending, targetHeads);
    await applyRemoteOperations(replayable);

    state = normalizeLocalState(await stateStore.load());
    state = updateCursorVector(state, targetHeads);
    await stateStore.save(state);
    if (backend && typeof backend.writeCursor === "function") {
      await backend.writeCursor(deviceId, targetHeads);
    }

    return {
      snapshotMeta: snapshotMetaBefore,
      targetHeads,
      replayedOperations: replayable
    };
  }

  throw new Error("Cold start failed to stabilize snapshot view after " + maxAttempts + " attempts");
}

// --- Compaction (ported from lib/compaction.js) ---

export function shouldCompact(opLogLength: number, threshold?: number): boolean {
  return Number(opLogLength || 0) > Number(threshold || 1000);
}

export function computeCompactionFloor(
  allCursors: Array<Record<string, number>>,
  snapshotSeqs: Record<string, number> | undefined,
  producerId: string
): number {
  const vectors = Array.isArray(allCursors) ? allCursors : [];
  const activeCursorValues = vectors
    .map((cursorVector) =>
      cursorVector && typeof cursorVector[producerId] === "number" ? cursorVector[producerId] : Infinity
    )
    .filter((value) => Number.isFinite(value));
  const minActiveCursor = activeCursorValues.length > 0 ? Math.min(...activeCursorValues) : 0;
  const snapshotFloor = snapshotSeqs && typeof snapshotSeqs[producerId] === "number" ? snapshotSeqs[producerId] : 0;
  if (!minActiveCursor) {
    return snapshotFloor;
  }
  return Math.min(minActiveCursor, snapshotFloor);
}

export async function compact(options: {
  backend: any;
  deviceId: string;
  floor?: number;
}): Promise<{ archivedCount: number; activeCount: number }> {
  const { backend, deviceId } = options;
  const floor = options.floor || 0;
  const entries = await backend.readOperationLog(deviceId);
  const archiveEntries = (entries || []).filter((entry: any) => entry.seq < floor);
  const activeEntries = (entries || []).filter((entry: any) => entry.seq >= floor);

  if (archiveEntries.length > 0) {
    await backend.writeArchiveLog(
      deviceId,
      archiveEntries[0].seq,
      archiveEntries[archiveEntries.length - 1].seq,
      archiveEntries
    );
  }
  await backend.overwriteOperationLog(deviceId, activeEntries);
  return {
    archivedCount: archiveEntries.length,
    activeCount: activeEntries.length
  };
}

function defaultNow(): number {
  return Date.now();
}

function createFileId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

export interface SyncRunResult {
  state: any;
  remoteOperations: any[];
}

export class SyncEngine {
  private readonly deviceId: string;
  private readonly backend: any;
  private readonly settingsStore: any;
  private readonly stateStore: any;
  private readonly now: () => number;
  private readonly runtimeStateStore: any;
  private readonly vaultAdapter: any;
  private readonly notifyUser: ((message: string) => void) | null;
  private lastSyncHadConflicts = false;

  constructor(options: {
    deviceId: string;
    backend: any;
    settingsStore: any;
    stateStore: any;
    now?: () => number;
    runtimeStateStore?: any;
    vaultAdapter?: any;
    notifyUser?: (message: string) => void;
  }) {
    this.deviceId = options.deviceId;
    this.backend = options.backend;
    this.settingsStore = options.settingsStore;
    this.stateStore = options.stateStore;
    this.now = options.now ?? defaultNow;
    this.runtimeStateStore = options.runtimeStateStore ?? null;
    this.vaultAdapter = options.vaultAdapter ?? null;
    this.notifyUser = options.notifyUser ?? null;
  }

  async trackLocalChange(change: {
    path: string;
    op: "create" | "modify" | "delete";
    content: string;
    blobHash?: string;
    fileId?: string;
  }): Promise<any> {
    const settings = await this.loadSettings();
    if (isIgnoredPath(change.path, settings.ignorePatterns || [])) {
      return null;
    }

    let state = await this.loadState();
    const reservedState = reserveOperation(state);
    // Spec §3: Step 1 — persist reserved entry durably before binding
    await this.stateStore.save(reservedState);
    const reservedEntry = reservedState.outbox[reservedState.outbox.length - 1];
    const existingFile = state.files[change.path];
    const parentBlobHash = existingFile && existingFile.blobHash;
    const fileId = change.fileId || (existingFile && existingFile.fileId) || createFileId();
    const nextVersion = change.op === "create" ? 1 : ((existingFile && existingFile.version) || 0) + 1;
    // Spec: delete ops carry no blobHash
    const blobHash = change.op === "delete" ? undefined : (change.blobHash || await computeBlobHash(change.content));

    state = bindReservedOperation(reservedState, reservedEntry.seq, {
      device: this.deviceId,
      ts: this.now(),
      mtime: change.op === "delete" ? undefined : this.now(),
      op: change.op,
      path: change.path,
      fileId,
      blobHash,
      parentBlobHashes: parentBlobHash ? [parentBlobHash] : [],
      content: change.op === "delete" ? undefined : change.content,
      version: nextVersion
    });

    if (change.op === "delete") {
      state = removeTrackedFile(state, change.path);
    } else {
      state = updateTrackedFile(state, {
        path: change.path,
        fileId,
        version: nextVersion,
        blobHash,
        parentBlobHashes: parentBlobHash ? [parentBlobHash] : [],
        content: change.content,
        lastModifiedBy: this.deviceId,
        updatedAt: this.now()
      });
    }
    await this.stateStore.save(state);
    return state;
  }

  async trackRename(oldPath: string, newPath: string, content: string): Promise<any> {
    const settings = await this.loadSettings();
    if (isIgnoredPath(oldPath, settings.ignorePatterns || []) || isIgnoredPath(newPath, settings.ignorePatterns || [])) {
      return null;
    }

    let state = await this.loadState();
    const existingFile = state.files[oldPath];
    const reservedState = reserveOperation(state);
    // Spec §3: Step 1 — persist reserved entry durably before binding
    await this.stateStore.save(reservedState);
    const reservedEntry = reservedState.outbox[reservedState.outbox.length - 1];
    const fileId = (existingFile && existingFile.fileId) || createFileId();
    const blobHash = await computeBlobHash(content);
    const parentBlobHash = existingFile && existingFile.blobHash;
    const nextVersion = ((existingFile && existingFile.version) || 0) + 1;

    state = bindReservedOperation(reservedState, reservedEntry.seq, {
      device: this.deviceId,
      ts: this.now(),
      mtime: this.now(),
      op: "rename",
      path: oldPath,
      newPath,
      fileId,
      blobHash,
      parentBlobHashes: parentBlobHash ? [parentBlobHash] : [],
      content,
      version: nextVersion
    });
    state = removeTrackedFile(state, oldPath);
    state = updateTrackedFile(state, {
      path: newPath,
      fileId,
      version: existingFile ? existingFile.version : 1,
      blobHash,
      parentBlobHashes: parentBlobHash ? [parentBlobHash] : [],
      content,
      renamedFrom: oldPath,
      renamedTo: newPath,
      lastModifiedBy: this.deviceId,
      updatedAt: this.now()
    });
    await this.stateStore.save(state);
    return state;
  }

  async syncNow(options?: { onPhaseChange?: (phase: string) => void }): Promise<SyncRunResult> {
    const onPhaseChange = options?.onPhaseChange ?? (() => {});
    let state = await this.loadState();
    const settings = await this.loadSettings();
    const changedPaths = new Set<string>();
    const deletedPaths = new Set<string>();
    const renamedFiles: Array<{ from: string; to: string; content?: string }> = [];

    state = pruneStaleReservedEntries(state);
    await this.stateStore.save(state);

    // Reconciliation pass: detect published-but-uncommitted ops
    await this.reconcileUncommittedOps();

    if (await this.shouldColdStart(state, settings)) {
      await coldStart({
        backend: this.backend,
        deviceId: this.deviceId,
        settings,
        stateStore: this.stateStore,
        vaultAdapter: this.vaultAdapter,
        applyRemoteOperations: this.applyRemoteOperations.bind(this)
      });
      state = await this.loadState();
    }

    onPhaseChange("pushing");
    let pushHadErrors = false;
    for (const entry of state.outbox.slice()) {
      if (entry.status !== "pending" && entry.status !== "published") {
        continue;
      }
      try {
        state = await pushOutboxEntry({
          backend: this.backend,
          deviceId: this.deviceId,
          entry,
          state,
          stateStore: this.stateStore
        });

        if (entry.op === "delete") {
          deletedPaths.add(`vault/${entry.path}`);
        } else if (entry.op === "rename" && entry.newPath) {
          deletedPaths.add(`vault/${entry.path}`);
          changedPaths.add(entry.newPath);
          renamedFiles.push({
            from: `vault/${entry.path}`,
            to: `vault/${entry.newPath}`,
            content: entry.content || ""
          });
        } else {
          changedPaths.add(entry.path);
        }
      } catch (pushError) {
        console.warn(`obsidian-gdrive-sync: push failed for entry seq=${entry.seq}`, pushError);
        pushHadErrors = true;
      }
    }

    // Spec §7 state machine: PUSHING → FINALIZING on error (skip pull/merge)
    if (pushHadErrors) {
      onPhaseChange("finalizing");
      await this.stateStore.save(state);
      return { state, remoteOperations: [] };
    }

    onPhaseChange("pulling");
    let remoteOperations: any[] = [];
    try {
      const pullResult = await pullRemoteOperations({
        backend: this.backend,
        state,
        settings,
        deviceId: this.deviceId,
        stateStore: this.stateStore,
        applyRemoteOperations: this.applyRemoteOperations.bind(this)
      });
      state = pullResult.state;
      remoteOperations = pullResult.remoteOperations;

      // Transition to merging phase only if conflicts were detected (spec §7 state machine)
      // Note: conflicts are already resolved during applyRemoteOperations in the pull phase;
      // the merging phase is entered reactively when conflicts were found
      if (this.lastSyncHadConflicts) {
        onPhaseChange("merging");
      }

      for (const entry of remoteOperations) {
        if (entry.op === "delete") {
          deletedPaths.add(`vault/${entry.path}`);
        } else if (entry.op === "rename" && entry.newPath) {
          deletedPaths.add(`vault/${entry.path}`);
          changedPaths.add(entry.newPath);
          renamedFiles.push({
            from: `vault/${entry.path}`,
            to: `vault/${entry.newPath}`
          });
        } else {
          changedPaths.add(entry.path);
        }
      }
    } catch (pullError) {
      console.warn("obsidian-gdrive-sync: pull failed", pullError);
    }

    onPhaseChange("finalizing");
    state = await this.loadState();
    const changedFiles = [];
    for (const filePath of changedPaths) {
      if (state.files[filePath]) {
        changedFiles.push({
          path: `vault/${filePath}`,
          content: state.files[filePath].content || ""
        });
      }
    }

    try {
      const previousSnapshotMeta = settings.snapshotPublishMode === "generations" &&
        typeof this.backend.readSnapshotMeta === "function"
        ? await this.backend.readSnapshotMeta(settings)
        : null;
      await this.backend.publishSnapshot({
        snapshotPublishMode: settings.snapshotPublishMode,
        nextGenerationId: `gen-${this.now()}`,
        previousGenerationId: previousSnapshotMeta && previousSnapshotMeta.generationId,
        snapshotSeqs: state.cursorByDevice,
        previousFiles: Object.keys(state.files || {}).map((filePath: string) => `vault/${filePath}`),
        changedFiles,
        deletedFiles: Array.from(deletedPaths),
        renamedFiles,
        files: changedFiles
      });
    } catch (snapshotError) {
      console.warn("obsidian-gdrive-sync: snapshot publish failed", snapshotError);
    }

    try {
      await this.maybeCompact(state, settings);
    } catch (compactionError) {
      console.warn("obsidian-gdrive-sync: compaction failed", compactionError);
    }

    return {
      state,
      remoteOperations
    };
  }

  async applyRemoteOperations(entries: any[]): Promise<void> {
    this.lastSyncHadConflicts = false;
    const paths = (entries || []).map((entry) => entry.newPath || entry.path);
    if (this.runtimeStateStore) {
      this.runtimeStateStore.beginRemoteApply(paths);
    }
    // Deduplicate ops by (device, seq) pair for idempotency
    const seen = new Set<string>();
    const dedupedEntries = (entries || []).filter((entry) => {
      const key = `${entry.device}:${entry.seq}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    try {
      let state = await this.loadState();
      if (this.vaultAdapter && typeof this.vaultAdapter.applyRemoteOperation === "function") {
        for (const entry of dedupedEntries) {
          const hydratedEntry = await this.hydrateRemoteEntry(entry);
          const localFile = state.files[hydratedEntry.path];
          const localRenameFile = hydratedEntry.fileId ? this.findTrackedFileById(state, hydratedEntry.fileId) : null;

          if ((hydratedEntry.op === "modify" || hydratedEntry.op === "create") &&
            localFile && localFile.blobHash && localFile.blobHash !== hydratedEntry.blobHash) {
            const localChangedFromBase = hydratedEntry.parentBlobHashes &&
              hydratedEntry.parentBlobHashes.length > 0 &&
              localFile.blobHash !== hydratedEntry.parentBlobHashes[0];

            if (localChangedFromBase) {
              this.lastSyncHadConflicts = true;
              const modifyResolution = await this.resolveModifyConflict(state, localFile, hydratedEntry);
              const existingFile = state.files[hydratedEntry.path] || {};
              state = updateTrackedFile(state, {
                path: hydratedEntry.path,
                fileId: hydratedEntry.fileId || existingFile.fileId || createFileId(),
                version: hydratedEntry.version || ((existingFile.version || 0) + 1),
                blobHash: (modifyResolution && modifyResolution.blobHash) || hydratedEntry.blobHash,
                parentBlobHashes: [localFile.blobHash, hydratedEntry.blobHash],
                content: (modifyResolution && modifyResolution.content) || hydratedEntry.content,
                lastModifiedBy: (modifyResolution && modifyResolution.lastModifiedBy) || hydratedEntry.device,
                updatedAt: (modifyResolution && modifyResolution.updatedAt) || hydratedEntry.ts || this.now()
              });
              continue;
            }
          }

          if (hydratedEntry.op === "delete" && localFile && localFile.blobHash) {
            const remoteParent = hydratedEntry.parentBlobHashes && hydratedEntry.parentBlobHashes[0];
            if (remoteParent && localFile.blobHash !== remoteParent) {
              this.lastSyncHadConflicts = true;
              await this.resolveDeleteModifyConflict(localFile, hydratedEntry);
              continue;
            }
          }

          // rename-vs-delete: remote deletes a file that was locally renamed
          if (hydratedEntry.op === "delete" && localRenameFile && localRenameFile.renamedTo) {
            const remoteParent = hydratedEntry.parentBlobHashes && hydratedEntry.parentBlobHashes[0];
            const localContentChanged = remoteParent && localRenameFile.blobHash && localRenameFile.blobHash !== remoteParent;
            if (localContentChanged) {
              // Content was also modified during rename — apply delete-vs-modify rule at new path
              this.lastSyncHadConflicts = true;
              await this.resolveDeleteModifyConflict(
                { ...localRenameFile, path: localRenameFile.renamedTo },
                { ...hydratedEntry, path: localRenameFile.renamedTo }
              );
            }
            // Treat as delete: remove both old and new paths
            state = removeTrackedFile(state, hydratedEntry.path);
            state = removeTrackedFile(state, localRenameFile.renamedTo);
            if (this.vaultAdapter && typeof this.vaultAdapter.applyRemoteOperation === "function") {
              await this.vaultAdapter.applyRemoteOperation({ ...hydratedEntry, op: "delete", path: localRenameFile.renamedTo });
            }
            continue;
          }

          if (hydratedEntry.op === "rename" && localRenameFile && localRenameFile.renamedTo) {
            if (localRenameFile.renamedTo === hydratedEntry.newPath) {
              state = removeTrackedFile(state, hydratedEntry.path);
              state = updateTrackedFile(state, {
                path: hydratedEntry.newPath,
                fileId: hydratedEntry.fileId || localRenameFile.fileId || createFileId(),
                version: (localRenameFile.version || 0) + 1,
                blobHash: hydratedEntry.blobHash,
                parentBlobHashes: hydratedEntry.parentBlobHashes || [],
                content: hydratedEntry.content,
                lastModifiedBy: hydratedEntry.device,
                updatedAt: hydratedEntry.ts || this.now()
              });
              continue;
            }
            this.lastSyncHadConflicts = true;
            await this.resolveRenameConflict(localRenameFile, hydratedEntry);
            continue;
          }

          if (hydratedEntry.op === "rename" && localFile && localFile.blobHash) {
            const renameParent = hydratedEntry.parentBlobHashes && hydratedEntry.parentBlobHashes[0];
            if (renameParent && localFile.blobHash !== renameParent) {
              const renameResolution = await this.resolveRenameModifyConflict(localFile, hydratedEntry);
              state = removeTrackedFile(state, hydratedEntry.path);
              state = updateTrackedFile(state, {
                path: hydratedEntry.newPath,
                fileId: hydratedEntry.fileId || localFile.fileId || createFileId(),
                version: (localFile.version || 0) + 1,
                blobHash: (renameResolution && renameResolution.blobHash) || hydratedEntry.blobHash,
                parentBlobHashes: [localFile.blobHash, hydratedEntry.blobHash],
                content: (renameResolution && renameResolution.content) || hydratedEntry.content,
                lastModifiedBy: (renameResolution && renameResolution.lastModifiedBy) || hydratedEntry.device,
                updatedAt: (renameResolution && renameResolution.updatedAt) || hydratedEntry.ts || this.now()
              });
              continue;
            }
          }

          await this.vaultAdapter.applyRemoteOperation(hydratedEntry);
          if (hydratedEntry.op === "delete") {
            state = removeTrackedFile(state, hydratedEntry.path);
          } else if (hydratedEntry.op === "rename") {
            const existingFile = state.files[hydratedEntry.path] || {};
            state = removeTrackedFile(state, hydratedEntry.path);
            state = updateTrackedFile(state, {
              path: hydratedEntry.newPath,
              fileId: hydratedEntry.fileId || existingFile.fileId || createFileId(),
              version: (existingFile.version || 0) + 1,
              blobHash: hydratedEntry.blobHash,
              parentBlobHashes: hydratedEntry.parentBlobHashes || [],
              content: hydratedEntry.content,
              lastModifiedBy: hydratedEntry.device,
              updatedAt: hydratedEntry.ts || this.now()
            });
          } else {
            const existingFile = state.files[hydratedEntry.path] || {};
            state = updateTrackedFile(state, {
              path: hydratedEntry.path,
              fileId: hydratedEntry.fileId || existingFile.fileId || createFileId(),
              version: hydratedEntry.version || ((existingFile.version || 0) + 1),
              blobHash: hydratedEntry.blobHash,
              parentBlobHashes: hydratedEntry.parentBlobHashes || [],
              content: hydratedEntry.content,
              lastModifiedBy: hydratedEntry.device,
              updatedAt: hydratedEntry.ts || this.now()
            });
          }
        }
      }
      await this.stateStore.save(state);
    } finally {
      if (this.runtimeStateStore) {
        this.runtimeStateStore.completeRemoteApply();
      }
    }
  }

  async findCommonAncestor(localFile: any, remoteOp: any): Promise<string | null> {
    const localParents = localFile.parentBlobHashes || (localFile.blobHash ? [localFile.blobHash] : []);
    const remoteParents = remoteOp.parentBlobHashes || [];

    for (const localParent of localParents) {
      for (const remoteParent of remoteParents) {
        if (localParent === remoteParent) {
          return localParent;
        }
      }
    }

    const ops = await this.backend.getOpsForFile(remoteOp.fileId, 100);
    const ancestorMap: Record<string, string[]> = {};
    for (const op of ops) {
      if (op.blobHash) {
        ancestorMap[op.blobHash] = op.parentBlobHashes || [];
      }
    }

    let localQueue = localParents.slice();
    const localVisited: Record<string, boolean> = {};
    let remoteQueue = remoteParents.slice();
    const remoteVisited: Record<string, boolean> = {};

    for (let depth = 0; depth < 100; depth += 1) {
      const nextLocalQueue: string[] = [];
      for (const hash of localQueue) {
        if (remoteVisited[hash]) {
          return hash;
        }
        localVisited[hash] = true;
        for (const parent of ancestorMap[hash] || []) {
          if (!localVisited[parent]) {
            nextLocalQueue.push(parent);
          }
        }
      }
      localQueue = nextLocalQueue;

      const nextRemoteQueue: string[] = [];
      for (const hash of remoteQueue) {
        if (localVisited[hash]) {
          return hash;
        }
        remoteVisited[hash] = true;
        for (const parent of ancestorMap[hash] || []) {
          if (!remoteVisited[parent]) {
            nextRemoteQueue.push(parent);
          }
        }
      }
      remoteQueue = nextRemoteQueue;

      if (localQueue.length === 0 && remoteQueue.length === 0) {
        break;
      }
    }
    return null;
  }

  async resolveModifyConflict(state: any, localFile: any, remoteOp: any): Promise<any> {
    if (isBinaryPath(remoteOp.path)) {
      const ext = remoteOp.path.split(".").pop();
      const baseName = remoteOp.path.slice(0, remoteOp.path.length - ext.length - 1);
      // Spec §3: last-write-wins — newer version by mtime becomes primary
      const localMtime = localFile.mtime || localFile.updatedAt || 0;
      const remoteMtime = remoteOp.mtime || remoteOp.ts || 0;
      const remoteIsNewer = remoteMtime >= localMtime;
      const conflictDevice = remoteIsNewer ? "local" : (remoteOp.device || "unknown");
      const conflictTs = remoteIsNewer ? (localMtime || this.now()) : (remoteOp.ts || this.now());
      const conflictPath = `${baseName}.conflict-${conflictDevice}-${conflictTs}.${ext}`;
      if (this.vaultAdapter && typeof this.vaultAdapter.writeConflictCopy === "function") {
        if (remoteIsNewer) {
          // Remote is newer → remote becomes primary, local becomes conflict copy
          await this.vaultAdapter.writeConflictCopy(conflictPath, localFile.content || "");
          await this.vaultAdapter.applyRemoteOperation(remoteOp);
          return {
            blobHash: remoteOp.blobHash,
            content: remoteOp.content,
            lastModifiedBy: remoteOp.device,
            updatedAt: remoteOp.ts || this.now()
          };
        } else {
          // Local is newer → local stays as primary, remote becomes conflict copy
          await this.vaultAdapter.writeConflictCopy(conflictPath, remoteOp.content || "");
          return {
            blobHash: localFile.blobHash,
            content: localFile.content,
            lastModifiedBy: localFile.lastModifiedBy,
            updatedAt: localFile.updatedAt || this.now()
          };
        }
      }
      await this.vaultAdapter.applyRemoteOperation(remoteOp);
      return {
        blobHash: remoteOp.blobHash,
        content: remoteOp.content,
        lastModifiedBy: remoteOp.device,
        updatedAt: remoteOp.ts || this.now()
      };
    }

    const ancestorHash = await this.findCommonAncestor(localFile, remoteOp);
    let baseContent = "";
    if (ancestorHash) {
      try {
        baseContent = await this.backend.fetchBlob(ancestorHash);
      } catch {
        baseContent = "";
      }
    } else {
      // No common ancestor found — falling back to two-way diff (spec §3)
      console.warn(`obsidian-gdrive-sync: no common ancestor for ${remoteOp.path}, using two-way diff`);
      if (typeof this.notifyUser === "function") {
        this.notifyUser(`Merge conflict in ${remoteOp.path}: no common ancestor found, using two-way diff`);
      }
    }
    const localContent = localFile.content || "";
    let remoteContent = "";
    try {
      remoteContent = await this.backend.fetchBlob(remoteOp.blobHash);
    } catch {
      remoteContent = "";
    }

    const result = await mergeRemoteText(localContent, baseContent, remoteContent, remoteOp.device || "unknown");
    if (this.vaultAdapter && typeof this.vaultAdapter.writeFile === "function") {
      await this.vaultAdapter.writeFile(remoteOp.path, result.merged);
    } else {
      await this.vaultAdapter.applyRemoteOperation(remoteOp);
    }
    if (result.hasConflicts) {
      console.warn(`obsidian-gdrive-sync: ${result.conflictCount} conflict(s) in ${remoteOp.path}`);
    }
    return {
      blobHash: result.blobHash,
      content: result.merged,
      lastModifiedBy: this.deviceId,
      updatedAt: this.now()
    };
  }

  async resolveDeleteModifyConflict(localFile: any, remoteOp: any): Promise<void> {
    let conflictPath = remoteOp.path.replace(/\.md$/, ".deleted-conflict.md");
    if (conflictPath === remoteOp.path) {
      conflictPath = `${remoteOp.path}.deleted-conflict`;
    }
    if (this.vaultAdapter && typeof this.vaultAdapter.writeConflictCopy === "function") {
      await this.vaultAdapter.writeConflictCopy(conflictPath, localFile.content || "");
    }
  }

  async resolveRenameConflict(localFile: any, remoteOp: any): Promise<void> {
    const ext = remoteOp.newPath.split(".").pop() || "";
    const baseName = remoteOp.newPath.slice(0, remoteOp.newPath.length - ext.length - 1);
    const conflictPath = `${baseName}.conflict-${this.deviceId}-${this.now()}.${ext}`;

    await this.vaultAdapter.applyRemoteOperation(remoteOp);
    if (this.vaultAdapter && typeof this.vaultAdapter.writeConflictCopy === "function" && localFile.content) {
      await this.vaultAdapter.writeConflictCopy(conflictPath, localFile.content);
    }
  }

  async resolveRenameModifyConflict(localFile: any, remoteOp: any): Promise<any> {
    await this.vaultAdapter.applyRemoteOperation(remoteOp);
    const renameParent = remoteOp.parentBlobHashes && remoteOp.parentBlobHashes[0];
    if (renameParent && localFile.blobHash !== renameParent && !isBinaryPath(remoteOp.newPath)) {
      let baseContent = "";
      try {
        baseContent = await this.backend.fetchBlob(renameParent);
      } catch {
        baseContent = "";
      }
      const localContent = localFile.content || "";
      let remoteContent = "";
      try {
        remoteContent = await this.backend.fetchBlob(remoteOp.blobHash);
      } catch {
        remoteContent = "";
      }
      const result = await mergeRemoteText(localContent, baseContent, remoteContent, remoteOp.device || "unknown");
      if (this.vaultAdapter && typeof this.vaultAdapter.writeFile === "function") {
        await this.vaultAdapter.writeFile(remoteOp.newPath, result.merged);
      }
      if (result.hasConflicts) {
        console.warn(`obsidian-gdrive-sync: ${result.conflictCount} conflict(s) in ${remoteOp.newPath}`);
      }
      return {
        blobHash: result.blobHash,
        content: result.merged,
        lastModifiedBy: this.deviceId,
        updatedAt: this.now()
      };
    }
    return {
      blobHash: remoteOp.blobHash,
      content: remoteOp.content,
      lastModifiedBy: remoteOp.device,
      updatedAt: remoteOp.ts || this.now()
    };
  }

  async loadSettings(): Promise<any> {
    return normalizeSettings(await this.settingsStore.load());
  }

  async loadState(): Promise<any> {
    return normalizeLocalState(await this.stateStore.load());
  }

  async reconcileUncommittedOps(): Promise<void> {
    if (typeof this.backend.readManifest !== "function" ||
      typeof this.backend.readOperationLog !== "function" ||
      typeof this.backend.commitManifest !== "function") {
      return;
    }
    try {
      const manifest = await this.backend.readManifest();
      const committedHead = manifest.devices?.[this.deviceId]?.opsHead ?? 0;
      const opLog = await this.backend.readOperationLog(this.deviceId);
      if (!opLog.length) return;
      const highestDurableSeq = opLog[opLog.length - 1].seq;
      if (highestDurableSeq <= committedHead) return;
      // Published but uncommitted ops found — recommit manifest
      const uncommitted = opLog.filter((entry: any) => entry.seq > committedHead);
      console.warn(
        `obsidian-gdrive-sync: reconciling ${uncommitted.length} uncommitted ops (seq ${committedHead + 1}..${highestDurableSeq})`
      );
      await this.backend.commitManifest({
        deviceId: this.deviceId,
        files: uncommitted.map((entry: any) => {
          const patch: Record<string, unknown> = {
            path: entry.path,
            op: entry.op,
            fileId: entry.fileId,
            lastModifiedBy: this.deviceId,
            updatedAt: entry.ts,
            seq: entry.seq
          };
          if (entry.newPath) patch.newPath = entry.newPath;
          if (entry.op !== "delete") {
            patch.blobHash = entry.blobHash;
            patch.size = typeof entry.content === "string" ? entry.content.length : undefined;
            patch.mtime = entry.mtime || entry.ts;
          }
          return patch;
        })
      });
    } catch (error) {
      console.warn("obsidian-gdrive-sync: reconciliation failed", error);
    }
  }

  findTrackedFileById(state: any, fileId: string): any {
    if (!fileId) {
      return null;
    }
    const paths = Object.keys((state && state.files) || {});
    for (const candidatePath of paths) {
      const candidate = state.files[candidatePath];
      if (candidate && candidate.fileId === fileId) {
        return candidate;
      }
    }
    return null;
  }

  async hydrateRemoteEntry(entry: any): Promise<any> {
    if (!entry || entry.op === "delete" || entry.content != null || !entry.blobHash || !this.backend || typeof this.backend.fetchBlob !== "function") {
      return entry;
    }
    try {
      return {
        ...entry,
        content: await this.backend.fetchBlob(entry.blobHash)
      };
    } catch {
      return entry;
    }
  }

  async maybeCompact(state: any, settings: any): Promise<any> {
    if (typeof this.backend.readOperationLog !== "function" ||
      typeof this.backend.writeArchiveLog !== "function" ||
      typeof this.backend.overwriteOperationLog !== "function" ||
      typeof this.backend.listCursorVectors !== "function" ||
      typeof this.backend.readSnapshotMeta !== "function") {
      return null;
    }

    const operationLog = await this.backend.readOperationLog(this.deviceId);
    if (!shouldCompact(operationLog.length, 1000)) {
      return null;
    }

    const snapshotMeta = await this.backend.readSnapshotMeta(settings);
    const allCursorVectors = await this.backend.listCursorVectors();
    // Filter out inactive device cursors per spec §3: compaction ignores inactive devices
    const manifest = await this.backend.readManifest();
    const activeCursors = allCursorVectors
      .filter((cv: { deviceId: string; cursors: Record<string, number> }) => {
        const device = manifest.devices?.[cv.deviceId];
        return !device || device.status !== "inactive";
      })
      .map((cv: { cursors: Record<string, number> }) => cv.cursors);
    const floor = computeCompactionFloor(activeCursors, snapshotMeta && snapshotMeta.snapshotSeqs, this.deviceId);
    if (!floor || floor <= 0) {
      return null;
    }
    const compactionResult = await compact({
      backend: this.backend,
      deviceId: this.deviceId,
      floor
    });

    // Spec §3: periodic GC of unreferenced blobs older than 7 days
    if (typeof this.backend.garbageCollectBlobs === "function") {
      try {
        await this.backend.garbageCollectBlobs();
      } catch (gcError) {
        console.warn("obsidian-gdrive-sync: blob GC failed", gcError);
      }
    }

    return compactionResult;
  }

  async shouldColdStart(state: any, settings: any): Promise<boolean> {
    if (!isColdStartState(state)) {
      if (typeof this.backend.readManifest !== "function") {
        return false;
      }
      try {
        const manifest = await this.backend.readManifest(settings);
        const device = manifest && manifest.devices ? manifest.devices[this.deviceId] : null;
        return Boolean(device && device.status === "inactive");
      } catch {
        return false;
      }
    }

    return typeof this.backend.readSnapshotMeta === "function" &&
      typeof this.backend.downloadSnapshot === "function" &&
      typeof this.backend.readManifest === "function";
  }
}
