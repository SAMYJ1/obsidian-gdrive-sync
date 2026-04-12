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
        // Spec §3 step 2b: re-read manifest until opsHead >= snapshotSeqs for every producer
        // Mark for retry by setting snapshotSeqs mismatch flag
        snapshotSeqs[producerId] = targetHeads[producerId] || 0;
      }
    });

    // If any producer's opsHead < snapshotSeqs, re-read manifest (retry loop)
    let manifestRetries = 0;
    const maxManifestRetries = 5;
    let coherentCutValidated = false;
    while (manifestRetries < maxManifestRetries) {
      const freshManifest = await backend.readManifest();
      const freshHeads = buildTargetHeads(freshManifest);
      let allCaughtUp = true;
      for (const producerId of Object.keys(snapshotSeqs)) {
        if ((freshHeads[producerId] || 0) < ((snapshotMetaBefore && snapshotMetaBefore.snapshotSeqs && snapshotMetaBefore.snapshotSeqs[producerId]) || 0)) {
          allCaughtUp = false;
          break;
        }
      }
      if (allCaughtUp) {
        Object.assign(targetHeads, freshHeads);
        coherentCutValidated = true;
        break;
      }
      manifestRetries++;
      await new Promise((resolve) => setTimeout(resolve, 500 * manifestRetries));
    }

    // If coherent cut could not be validated, skip snapshot and retry outer loop
    if (!coherentCutValidated) {
      if (attempt < maxAttempts - 1) {
        continue;
      }
      // Final attempt exhausted — fall back to pure op-log replay
      console.warn("obsidian-gdrive-sync: cold start coherent cut unverifiable, falling back to pure op-log replay");
      let state = normalizeLocalState(await stateStore.load());
      state = { ...state, files: {} };
      await stateStore.save(state);
      const allOps = await backend.getPendingRemoteOperations({}, settings);
      const replayHeads = buildTargetHeads(await backend.readManifest());
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
  const minActiveCursor = activeCursorValues.length > 0 ? Math.min(...activeCursorValues) : null;
  const snapshotFloor = snapshotSeqs && typeof snapshotSeqs[producerId] === "number" ? snapshotSeqs[producerId] : 0;
  if (minActiveCursor === null) {
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
  private fullSnapshotNeeded = false;

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
    const existingFile = state.files[change.path];
    const parentBlobHash = existingFile && existingFile.blobHash;

    // Compute hash early to check for no-op changes.
    const blobHash = change.op === "delete" ? undefined : (change.blobHash || await computeBlobHash(change.content));

    // Skip if content hasn't actually changed — prevents no-op entries
    // from vault reload events on startup.
    if (change.op !== "delete" && existingFile && blobHash && existingFile.blobHash === blobHash) {
      return null;
    }

    const reservedState = reserveOperation(state);
    // Spec §3: Step 1 — persist reserved entry durably before binding
    await this.stateStore.save(reservedState);
    const reservedEntry = reservedState.outbox[reservedState.outbox.length - 1];
    const fileId = change.fileId || (existingFile && existingFile.fileId) || createFileId();
    const nextVersion = change.op === "create" ? 1 : ((existingFile && existingFile.version) || 0) + 1;

    state = bindReservedOperation(reservedState, reservedEntry.seq, {
      device: this.deviceId,
      ts: this.now(),
      mtime: change.op === "delete" ? undefined : this.now(),
      op: change.op,
      path: change.path,
      fileId,
      blobHash,
      parentBlobHashes: parentBlobHash ? [parentBlobHash] : [],
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
      version: nextVersion
    });
    state = removeTrackedFile(state, oldPath);
    state = updateTrackedFile(state, {
      path: newPath,
      fileId,
      version: existingFile ? nextVersion : 1,
      blobHash,
      parentBlobHashes: parentBlobHash ? [parentBlobHash] : [],
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
    const renamedFiles: Array<{ from: string; to: string; content?: string | Uint8Array }> = [];

    state = pruneStaleReservedEntries(state);
    await this.stateStore.save(state);

    if (await this.shouldBootstrapLocalVault(state, settings)) {
      await this.bootstrapLocalVault(state, settings);
      this.fullSnapshotNeeded = true;
      state = await this.loadState();
    }

    if (await this.shouldColdStart(state, settings)) {
      await coldStart({
        backend: this.backend,
        deviceId: this.deviceId,
        settings,
        stateStore: this.stateStore,
        vaultAdapter: this.vaultAdapter,
        applyRemoteOperations: this.applyRemoteOperations.bind(this)
      });
      this.fullSnapshotNeeded = true;
      state = await this.loadState();
    }

    // Dedup outbox: remove pending "create" entries that are clearly duplicates from the
    // pull feedback loop. We identify duplicates by checking if the manifest on Drive already
    // has the file at a version >= the entry's version (meaning it was already pushed).
    // Simple local-only check is insufficient because trackLocalChange sets both tracked.version
    // and entry.version to the same value, making new files indistinguishable from duplicates.
    // Instead, only dedup entries whose status is "pending" and where the file is already
    // committed (i.e. not pending) in a PRIOR committed entry in the outbox.
    // NOTE: The primary fix is cursor advancement + pull filter. This dedup is removed
    // as it was incorrectly filtering out new file entries.

    onPhaseChange("pushing");
    let pushHadErrors = false;
    let pushHadVersionConflict = false;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 5;
    console.log(`obsidian-gdrive-sync: push phase starting, ${state.outbox.length} outbox entries`);
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
          vaultAdapter: this.vaultAdapter,
          stateStore: this.stateStore
        });
        consecutiveFailures = 0;

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
      } catch (pushError: any) {
        // Spec §2: version conflict (409) should trigger conflict merge via pull
        if (pushError && pushError.versionConflict) {
          console.warn(`obsidian-gdrive-sync: version conflict for entry seq=${entry.seq}, will merge after pull`);
          pushHadVersionConflict = true;
        } else {
          console.warn(`obsidian-gdrive-sync: push failed for entry seq=${entry.seq}`, pushError);
          pushHadErrors = true;
          consecutiveFailures++;
          // Stop trying more entries if we hit too many consecutive failures
          // (likely a systemic issue like auth or network failure)
          if (consecutiveFailures >= maxConsecutiveFailures) {
            console.warn(`obsidian-gdrive-sync: ${maxConsecutiveFailures} consecutive push failures, stopping push phase`);
            break;
          }
        }
      }
    }

    // Advance cursorByDevice for own device after push so the pull phase
    // doesn't re-fetch ops we just committed (prevents feedback loop).
    if (typeof this.backend.readManifest === "function") {
      try {
        const postPushManifest = await this.backend.readManifest();
        const ownOpsHead = postPushManifest?.devices?.[this.deviceId]?.opsHead;
        if (typeof ownOpsHead === "number" && ownOpsHead > (state.cursorByDevice?.[this.deviceId] ?? 0)) {
          state = updateCursorVector(state, { [this.deviceId]: ownOpsHead });
          await this.stateStore.save(state);
        }
      } catch (cursorError) {
        console.warn("obsidian-gdrive-sync: failed to advance own cursor after push", cursorError);
      }
    }

    // Spec §7 state machine: continue to pull phase even with push errors.
    // Individual entry failures are retried on next sync; only skip pull
    // if all entries failed consecutively (systemic failure like auth issues).
    if (pushHadErrors && !pushHadVersionConflict && consecutiveFailures >= maxConsecutiveFailures) {
      onPhaseChange("finalizing");
      await this.stateStore.save(state);
      return { state, remoteOperations: [] };
    }

    onPhaseChange("pulling");

    // Spec §3: reconciliation pass runs at the start of each pull
    await this.reconcileUncommittedOps();
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
    const changedFiles: Array<{ path: string; content: string | Uint8Array }> = [];

    // On first finalize after startup, ensure all tracked files are in the snapshot.
    // Incremental publishes only cover files changed in this cycle; if a previous
    // session was interrupted, the vault mirror on Drive may be incomplete.
    if (this.fullSnapshotNeeded && Object.keys(state.files || {}).length > 0) {
      for (const filePath of Object.keys(state.files || {})) {
        changedPaths.add(filePath);
      }
      this.fullSnapshotNeeded = false;
    }

    for (const filePath of changedPaths) {
      if (state.files[filePath]) {
        try {
          const content = await this.readTrackedFileContent(state.files[filePath], filePath);
          changedFiles.push({
            path: `vault/${filePath}`,
            content
          });
        } catch (readError) {
          console.warn(`obsidian-gdrive-sync: failed to read ${filePath} for snapshot`, readError);
        }
      }
    }

    // Only publish snapshot when there are actual changes to publish.
    // Writing _snapshot_meta.json on every sync creates a Drive change that
    // triggers the poll, causing an infinite sync loop.
    const hasSnapshotChanges = changedFiles.length > 0 || deletedPaths.size > 0 || renamedFiles.length > 0;
    if (hasSnapshotChanges) {
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
    }

    try {
      await this.maybeCompact(state, settings);
    } catch (compactionError) {
      console.warn("obsidian-gdrive-sync: compaction failed", compactionError);
    }

    // Spec §3: periodic blob GC runs independently of compaction
    if (typeof this.backend.garbageCollectBlobs === "function") {
      try {
        await this.backend.garbageCollectBlobs();
      } catch (gcError) {
        console.warn("obsidian-gdrive-sync: blob GC failed", gcError);
      }
    }

    return {
      state,
      remoteOperations
    };
  }

  async shouldBootstrapLocalVault(state: any, settings: any): Promise<boolean> {
    if (!this.vaultAdapter || typeof this.vaultAdapter.listSnapshotFiles !== "function") {
      return false;
    }
    const normalized = normalizeLocalState(state);
    if (Object.keys(normalized.cursorByDevice || {}).length > 0) {
      return false;
    }
    if (typeof this.backend.readManifest !== "function") {
      return false;
    }
    try {
      const manifest = await this.backend.readManifest(settings);
      // Only check for remote files, not just device registrations.
      // A device registration alone (from registerDevice) shouldn't prevent bootstrap.
      const hasRemoteFiles = Object.keys(manifest?.files || {}).length > 0;
      return !hasRemoteFiles;
    } catch {
      return false;
    }
  }

  async bootstrapLocalVault(state: any, settings: any): Promise<void> {
    const snapshotFiles = await this.vaultAdapter.listSnapshotFiles(settings.ignorePatterns || []);
    const queuedPaths = new Set(
      normalizeLocalState(state).outbox.map((entry: any) => entry.newPath || entry.path).filter(Boolean)
    );
    for (const file of snapshotFiles) {
      if (!file.path || queuedPaths.has(file.path)) {
        continue;
      }
      await this.trackLocalChange({
        path: file.path,
        op: "create",
        content: file.content
      });
      queuedPaths.add(file.path);
    }
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
          let localFile = state.files[hydratedEntry.path];
          const localRenameFile = hydratedEntry.fileId ? this.findTrackedFileById(state, hydratedEntry.fileId) : null;

          // Spec §3 rename-vs-modify: if local side renamed this fileId,
          // retarget remote modify/create to the new path
          if ((hydratedEntry.op === "modify" || hydratedEntry.op === "create") &&
            !localFile && localRenameFile && localRenameFile.renamedTo) {
            hydratedEntry.path = localRenameFile.renamedTo;
            localFile = state.files[hydratedEntry.path];
          }

          // Spec §3 delete-vs-modify: check outbox for pending local deletes
          if ((hydratedEntry.op === "modify" || hydratedEntry.op === "create") &&
            !localFile && state.outbox) {
            const pendingDelete = state.outbox.find(
              (e: any) => e.op === "delete" && e.path === hydratedEntry.path && e.status !== "committed"
            );
            if (pendingDelete) {
              // Local deleted, remote modified — apply remote version and create conflict marker
              this.lastSyncHadConflicts = true;
              // Apply the remote modification to restore the file
              await this.vaultAdapter.applyRemoteOperation(hydratedEntry);
              // Write conflict marker noting the file was locally deleted
              await this.resolveDeleteModifyConflict(
                { path: hydratedEntry.path, content: hydratedEntry.content || "" },
                hydratedEntry
              );
              // Update tracked state with the remote version
              const existingFile = state.files[hydratedEntry.path] || {};
              state = updateTrackedFile(state, {
                path: hydratedEntry.path,
                fileId: hydratedEntry.fileId || existingFile.fileId || createFileId(),
                version: hydratedEntry.version || ((existingFile.version || 0) + 1),
                blobHash: hydratedEntry.blobHash,
                lastModifiedBy: hydratedEntry.device,
                updatedAt: hydratedEntry.ts || this.now()
              });
              continue;
            }
          }

          if ((hydratedEntry.op === "modify" || hydratedEntry.op === "create") &&
            localFile && localFile.blobHash && localFile.blobHash !== hydratedEntry.blobHash) {
            // Spec §2: verify fileId match — path reuse by different file should not trigger conflict
            const fileIdMatches = !hydratedEntry.fileId || !localFile.fileId || hydratedEntry.fileId === localFile.fileId;
            const localChangedFromBase = fileIdMatches && hydratedEntry.parentBlobHashes &&
              hydratedEntry.parentBlobHashes.length > 0 &&
              localFile.blobHash !== hydratedEntry.parentBlobHashes[0];

            if (localChangedFromBase) {
              this.lastSyncHadConflicts = true;
              const modifyResolution = await this.resolveModifyConflict(state, localFile, hydratedEntry);
              const existingFile = state.files[hydratedEntry.path] || {};
              const mergedBlobHash = (modifyResolution && modifyResolution.blobHash) || hydratedEntry.blobHash;
              const mergedContent = (modifyResolution && modifyResolution.content) || hydratedEntry.content;
              const mergedFileId = hydratedEntry.fileId || existingFile.fileId || createFileId();
              const mergedVersion = ((existingFile.version || 0) + 1);
              state = updateTrackedFile(state, {
                path: hydratedEntry.path,
                fileId: mergedFileId,
                version: mergedVersion,
                blobHash: mergedBlobHash,
                parentBlobHashes: [localFile.blobHash, hydratedEntry.blobHash],
                lastModifiedBy: this.deviceId,
                updatedAt: this.now()
              });

              // Spec §3 step 4: upload merged blob + emit modify op with two parents
              const reservedState = reserveOperation(state);
              await this.stateStore.save(reservedState);
              const reservedEntry = reservedState.outbox[reservedState.outbox.length - 1];
              state = bindReservedOperation(reservedState, reservedEntry.seq, {
                device: this.deviceId,
                ts: this.now(),
                mtime: this.now(),
                op: "modify",
                path: hydratedEntry.path,
                fileId: mergedFileId,
                blobHash: mergedBlobHash,
                parentBlobHashes: [localFile.blobHash, hydratedEntry.blobHash],
                version: mergedVersion
              });
              await this.stateStore.save(state);
              continue;
            }
          }

          if (hydratedEntry.op === "delete" && localFile && localFile.blobHash) {
            // Spec §2: verify fileId match for delete — path reuse means different file
            const deleteFileIdMatches = !hydratedEntry.fileId || !localFile.fileId || hydratedEntry.fileId === localFile.fileId;
            const remoteParent = hydratedEntry.parentBlobHashes && hydratedEntry.parentBlobHashes[0];
            if (deleteFileIdMatches && remoteParent && localFile.blobHash !== remoteParent) {
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
              // Content was also modified during rename — apply delete-vs-modify rule
              // Spec: restore file with conflict marker, user sees modified version alongside conflict copy
              this.lastSyncHadConflicts = true;
              await this.resolveDeleteModifyConflict(
                { ...localRenameFile, path: localRenameFile.renamedTo },
                { ...hydratedEntry, path: localRenameFile.renamedTo }
              );
              // Remove only the old path; keep the renamed (modified) file
              state = removeTrackedFile(state, hydratedEntry.path);
            } else {
              // No content change — treat as simple delete of both paths
              state = removeTrackedFile(state, hydratedEntry.path);
              state = removeTrackedFile(state, localRenameFile.renamedTo);
              if (this.vaultAdapter && typeof this.vaultAdapter.applyRemoteOperation === "function") {
                await this.vaultAdapter.applyRemoteOperation({ ...hydratedEntry, op: "delete", path: localRenameFile.renamedTo });
              }
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

  resolveTrackedFilePath(fileRecord: any, fallbackPath?: string): string {
    return fileRecord?.renamedTo || fileRecord?.path || fallbackPath || "";
  }

  async readTrackedFileContent(fileRecord: any, fallbackPath?: string): Promise<string | Uint8Array> {
    const filePath = this.resolveTrackedFilePath(fileRecord, fallbackPath);
    if (this.vaultAdapter && typeof this.vaultAdapter.readChangeContent === "function" && filePath) {
      try {
        return await this.vaultAdapter.readChangeContent(filePath);
      } catch {
        // Fall through to any cached content still present in state.
      }
    }
    return fileRecord?.content || "";
  }

  async readTrackedTextContent(fileRecord: any, fallbackPath?: string): Promise<string> {
    const content = await this.readTrackedFileContent(fileRecord, fallbackPath);
    if (typeof content === "string") {
      return content;
    }
    return new TextDecoder().decode(content);
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
      const localContent = await this.readTrackedFileContent(localFile, remoteOp.path);
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
          await this.vaultAdapter.writeConflictCopy(conflictPath, localContent);
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
            content: localContent,
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
        const fetchedBaseContent = await this.backend.fetchBlob(ancestorHash);
        baseContent = typeof fetchedBaseContent === "string"
          ? fetchedBaseContent
          : new TextDecoder().decode(fetchedBaseContent);
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
    const localContent = await this.readTrackedTextContent(localFile, remoteOp.path);
    let remoteContent = "";
    try {
      const fetchedRemoteContent = await this.backend.fetchBlob(remoteOp.blobHash);
      remoteContent = typeof fetchedRemoteContent === "string"
        ? fetchedRemoteContent
        : new TextDecoder().decode(fetchedRemoteContent);
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
      const localContent = await this.readTrackedFileContent(localFile, remoteOp.path);
      await this.vaultAdapter.writeConflictCopy(conflictPath, localContent);
    }
  }

  async resolveRenameConflict(localFile: any, remoteOp: any): Promise<void> {
    const ext = remoteOp.newPath.split(".").pop() || "";
    const baseName = remoteOp.newPath.slice(0, remoteOp.newPath.length - ext.length - 1);
    const conflictPath = `${baseName}.conflict-${this.deviceId}-${this.now()}.${ext}`;

    await this.vaultAdapter.applyRemoteOperation(remoteOp);
    const localContent = await this.readTrackedFileContent(localFile, remoteOp.newPath);
    if (this.vaultAdapter && typeof this.vaultAdapter.writeConflictCopy === "function" && localContent) {
      await this.vaultAdapter.writeConflictCopy(conflictPath, localContent);
    }
  }

  async resolveRenameModifyConflict(localFile: any, remoteOp: any): Promise<any> {
    await this.vaultAdapter.applyRemoteOperation(remoteOp);
    const renameParent = remoteOp.parentBlobHashes && remoteOp.parentBlobHashes[0];
    if (renameParent && localFile.blobHash !== renameParent && !isBinaryPath(remoteOp.newPath)) {
      let baseContent = "";
      try {
        const fetchedBaseContent = await this.backend.fetchBlob(renameParent);
        baseContent = typeof fetchedBaseContent === "string"
          ? fetchedBaseContent
          : new TextDecoder().decode(fetchedBaseContent);
      } catch {
        baseContent = "";
      }
      const localContent = await this.readTrackedTextContent(localFile, remoteOp.newPath);
      let remoteContent = "";
      try {
        const fetchedRemoteContent = await this.backend.fetchBlob(remoteOp.blobHash);
        remoteContent = typeof fetchedRemoteContent === "string"
          ? fetchedRemoteContent
          : new TextDecoder().decode(fetchedRemoteContent);
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
      // Spec §3: check ALL producer devices, not just current device
      const allDeviceIds = Object.keys(manifest.devices ?? {});
      for (const deviceId of allDeviceIds) {
        const committedHead = manifest.devices?.[deviceId]?.opsHead ?? 0;
        const opLog = await this.backend.readOperationLog(deviceId);
        if (!opLog.length) continue;
        const highestDurableSeq = opLog[opLog.length - 1].seq;
        if (highestDurableSeq <= committedHead) continue;
        const uncommitted = opLog.filter((entry: any) => entry.seq > committedHead);
        console.warn(
          `obsidian-gdrive-sync: reconciling ${uncommitted.length} uncommitted ops for device ${deviceId} (seq ${committedHead + 1}..${highestDurableSeq})`
        );
        await this.backend.commitManifest({
          deviceId,
          files: uncommitted.map((entry: any) => {
            const patch: Record<string, unknown> = {
              path: entry.path,
              op: entry.op,
              fileId: entry.fileId,
              lastModifiedBy: deviceId,
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
      }
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

    if (!(typeof this.backend.readSnapshotMeta === "function" &&
      typeof this.backend.downloadSnapshot === "function" &&
      typeof this.backend.readManifest === "function")) {
      return false;
    }

    try {
      const manifest = await this.backend.readManifest(settings);
      const snapshotMeta = await this.backend.readSnapshotMeta(settings);
      return Boolean(
        Object.keys(manifest?.devices || {}).length > 0 ||
        Object.keys(manifest?.files || {}).length > 0 ||
        Object.keys(snapshotMeta?.snapshotSeqs || {}).length > 0 ||
        snapshotMeta?.generationId
      );
    } catch {
      return false;
    }
  }
}
