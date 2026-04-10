"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/local-state.js
var require_local_state = __commonJS({
  "lib/local-state.js"(exports2, module2) {
    "use strict";
    var DEFAULT_LOCAL_STATE = {
      nextSeq: 1,
      cursorByDevice: {},
      outbox: [],
      files: {},
      changesPageToken: null
    };
    function cloneState(state) {
      return JSON.parse(JSON.stringify(state));
    }
    function normalizeLocalState2(input) {
      const merged = Object.assign({}, DEFAULT_LOCAL_STATE, input || {});
      merged.cursorByDevice = Object.assign({}, DEFAULT_LOCAL_STATE.cursorByDevice, merged.cursorByDevice || {});
      merged.outbox = Array.isArray(merged.outbox) ? merged.outbox.slice() : [];
      merged.files = Object.assign({}, DEFAULT_LOCAL_STATE.files, merged.files || {});
      if (!Number.isInteger(merged.nextSeq) || merged.nextSeq < 1) {
        merged.nextSeq = DEFAULT_LOCAL_STATE.nextSeq;
      }
      return merged;
    }
    function reserveOperation2(state) {
      const next = normalizeLocalState2(cloneState(state));
      const seq = next.nextSeq;
      next.nextSeq += 1;
      next.outbox.push({
        seq,
        status: "reserved"
      });
      return next;
    }
    function bindReservedOperation2(state, seq, operation) {
      const next = normalizeLocalState2(cloneState(state));
      next.outbox = next.outbox.map(function(entry) {
        if (entry.seq !== seq) {
          return entry;
        }
        return Object.assign({}, entry, operation, {
          status: "pending"
        });
      });
      return next;
    }
    function markOperationPublished2(state, seq, extra) {
      const next = normalizeLocalState2(cloneState(state));
      next.outbox = next.outbox.map(function(entry) {
        if (entry.seq !== seq) {
          return entry;
        }
        return Object.assign({}, entry, extra || {}, {
          status: "published"
        });
      });
      return next;
    }
    function markOperationCommitted2(state, seq) {
      const next = normalizeLocalState2(cloneState(state));
      next.outbox = next.outbox.filter(function(entry) {
        return entry.seq !== seq;
      });
      return next;
    }
    function updateCursorVector2(state, cursorByDevice) {
      const next = normalizeLocalState2(cloneState(state));
      next.cursorByDevice = Object.assign({}, cursorByDevice || {});
      return next;
    }
    function updateTrackedFile2(state, fileRecord) {
      const next = normalizeLocalState2(cloneState(state));
      next.files[fileRecord.path] = Object.assign({}, next.files[fileRecord.path] || {}, fileRecord);
      return next;
    }
    function removeTrackedFile2(state, filePath) {
      const next = normalizeLocalState2(cloneState(state));
      delete next.files[filePath];
      return next;
    }
    function pruneStaleReservedEntries2(state) {
      const next = normalizeLocalState2(cloneState(state));
      next.outbox = next.outbox.filter(function(entry) {
        return entry.status !== "reserved";
      });
      return next;
    }
    function updateChangesPageToken2(state, token) {
      var next = normalizeLocalState2(cloneState(state));
      next.changesPageToken = token;
      return next;
    }
    module2.exports = {
      DEFAULT_LOCAL_STATE,
      normalizeLocalState: normalizeLocalState2,
      reserveOperation: reserveOperation2,
      bindReservedOperation: bindReservedOperation2,
      markOperationPublished: markOperationPublished2,
      markOperationCommitted: markOperationCommitted2,
      updateCursorVector: updateCursorVector2,
      updateTrackedFile: updateTrackedFile2,
      removeTrackedFile: removeTrackedFile2,
      pruneStaleReservedEntries: pruneStaleReservedEntries2,
      updateChangesPageToken: updateChangesPageToken2
    };
  }
});

// lib/retry.js
var require_retry = __commonJS({
  "lib/retry.js"(exports2, module2) {
    "use strict";
    function isRetryableStatus(status) {
      return status === 429 || status >= 500 && status < 600;
    }
    function getRetryDelay(error, attempt, baseDelayMs) {
      if (error && error.retryAfter) {
        return error.retryAfter * 1e3;
      }
      return baseDelayMs * Math.pow(2, attempt - 1);
    }
    async function retryWithBackoff3(fn, options) {
      var maxAttempts = options && options.maxAttempts || 3;
      var baseDelayMs = options && options.baseDelayMs || 1e3;
      var lastError;
      for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await fn();
        } catch (error) {
          lastError = error;
          var status = error && error.status;
          if (status && !isRetryableStatus(status)) {
            throw error;
          }
          if (attempt < maxAttempts) {
            var delay = getRetryDelay(error, attempt, baseDelayMs);
            await new Promise(function(resolve) {
              setTimeout(resolve, delay);
            });
          }
        }
      }
      throw lastError;
    }
    module2.exports = {
      retryWithBackoff: retryWithBackoff3,
      isRetryableStatus,
      getRetryDelay
    };
  }
});

// lib/cold-start.js
var require_cold_start = __commonJS({
  "lib/cold-start.js"(exports2, module2) {
    "use strict";
    var {
      normalizeLocalState: normalizeLocalState2,
      updateCursorVector: updateCursorVector2,
      updateTrackedFile: updateTrackedFile2
    } = require_local_state();
    function isColdStartState2(state) {
      const normalized = normalizeLocalState2(state);
      return Object.keys(normalized.cursorByDevice || {}).length === 0 && Object.keys(normalized.files || {}).length === 0;
    }
    function buildTargetHeads(manifest) {
      const heads = {};
      Object.keys(manifest && manifest.devices || {}).forEach(function(deviceId) {
        heads[deviceId] = manifest.devices[deviceId].opsHead || 0;
      });
      return heads;
    }
    function filterOperationsToTargetHeads(entries, targetHeads) {
      return (entries || []).filter(function(entry) {
        const head = targetHeads[entry.device];
        return typeof head === "number" && entry.seq <= head;
      });
    }
    async function coldStart2(options) {
      const backend = options.backend;
      const stateStore = options.stateStore;
      const vaultAdapter = options.vaultAdapter;
      const deviceId = options.deviceId;
      const applyRemoteOperations = options.applyRemoteOperations;
      const maxAttempts = options.maxAttempts || 3;
      const settings = options.settings || {};
      if (backend && typeof backend.registerDevice === "function") {
        await backend.registerDevice(deviceId);
      }
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const snapshotMetaBefore = await backend.readSnapshotMeta(settings);
        const manifest = await backend.readManifest();
        const snapshotSeqs = Object.assign({}, snapshotMetaBefore && snapshotMetaBefore.snapshotSeqs || {});
        const targetHeads = buildTargetHeads(manifest);
        Object.keys(snapshotSeqs).forEach(function(producerId) {
          if ((targetHeads[producerId] || 0) < snapshotSeqs[producerId]) {
            throw new Error("Snapshot ahead of committed manifest heads for " + producerId);
          }
        });
        const snapshotFiles = await backend.downloadSnapshot(snapshotMetaBefore, settings);
        if (vaultAdapter && typeof vaultAdapter.applySnapshot === "function") {
          await vaultAdapter.applySnapshot(snapshotFiles || []);
        }
        const snapshotMetaAfter = await backend.readSnapshotMeta(settings);
        const beforeKey = JSON.stringify(snapshotMetaBefore || {});
        const afterKey = JSON.stringify(snapshotMetaAfter || {});
        if (beforeKey !== afterKey && attempt < maxAttempts - 1) {
          continue;
        }
        let state = normalizeLocalState2(await stateStore.load());
        state.files = {};
        (snapshotFiles || []).forEach(function(file) {
          const manifestRecord = manifest.files && manifest.files[file.path] ? manifest.files[file.path] : {};
          state = updateTrackedFile2(state, {
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
        state = normalizeLocalState2(await stateStore.load());
        state = updateCursorVector2(state, targetHeads);
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
    module2.exports = {
      coldStart: coldStart2,
      filterOperationsToTargetHeads,
      isColdStartState: isColdStartState2
    };
  }
});

// lib/compaction.js
var require_compaction = __commonJS({
  "lib/compaction.js"(exports2, module2) {
    "use strict";
    function shouldCompact2(opLogLength, threshold) {
      return Number(opLogLength || 0) > Number(threshold || 1e3);
    }
    function computeCompactionFloor2(allCursors, snapshotSeqs, producerId) {
      const vectors = Array.isArray(allCursors) ? allCursors : [];
      const activeCursorValues = vectors.map(function(cursorVector) {
        return cursorVector && typeof cursorVector[producerId] === "number" ? cursorVector[producerId] : Infinity;
      }).filter(function(value) {
        return Number.isFinite(value);
      });
      const minActiveCursor = activeCursorValues.length > 0 ? Math.min.apply(Math, activeCursorValues) : 0;
      const snapshotFloor = snapshotSeqs && typeof snapshotSeqs[producerId] === "number" ? snapshotSeqs[producerId] : 0;
      if (!minActiveCursor) {
        return snapshotFloor;
      }
      return Math.min(minActiveCursor, snapshotFloor || minActiveCursor);
    }
    async function compact2(options) {
      const backend = options.backend;
      const deviceId = options.deviceId;
      const floor = options.floor || 0;
      const entries = await backend.readOperationLog(deviceId);
      const archiveEntries = (entries || []).filter(function(entry) {
        return entry.seq < floor;
      });
      const activeEntries = (entries || []).filter(function(entry) {
        return entry.seq >= floor;
      });
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
    module2.exports = {
      compact: compact2,
      computeCompactionFloor: computeCompactionFloor2,
      shouldCompact: shouldCompact2
    };
  }
});

// lib/runtime-state.js
var require_runtime_state = __commonJS({
  "lib/runtime-state.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path = require("path");
    function defaultNow2() {
      return Date.now();
    }
    function createIdleState(now) {
      return {
        phase: "idle",
        sessionId: null,
        startedAt: 0,
        endedAt: now || 0,
        paths: [],
        source: "remote_sync",
        cooldownUntil: 0
      };
    }
    function writeJsonAtomically(targetPath, value) {
      const dirPath = path.dirname(targetPath);
      const tempPath = targetPath + ".tmp";
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
      fs.renameSync(tempPath, targetPath);
    }
    var RuntimeStateStore2 = class {
      constructor(options) {
        this.statePath = options.statePath;
        this.cooldownMs = options.cooldownMs || 0;
        this.now = options.now || defaultNow2;
      }
      readState() {
        if (!fs.existsSync(this.statePath)) {
          return createIdleState(this.now());
        }
        return JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      }
      writeState(state) {
        writeJsonAtomically(this.statePath, state);
      }
      beginRemoteApply(paths) {
        const startedAt = this.now();
        const state = {
          phase: "remote_apply",
          sessionId: "remote-" + startedAt,
          startedAt,
          endedAt: 0,
          paths: Array.from(new Set(paths || [])),
          source: "remote_sync",
          cooldownUntil: 0
        };
        this.writeState(state);
        return state;
      }
      completeRemoteApply() {
        const current = this.readState();
        const endedAt = this.now();
        const nextState = {
          phase: "idle",
          sessionId: current.sessionId,
          startedAt: current.startedAt || 0,
          endedAt,
          paths: current.paths || [],
          source: "remote_sync",
          cooldownUntil: endedAt + this.cooldownMs
        };
        this.writeState(nextState);
        return nextState;
      }
      shouldSuppressPath(filePath, atTime) {
        const current = this.readState();
        const now = typeof atTime === "number" ? atTime : this.now();
        const matches = (current.paths || []).indexOf(filePath) !== -1;
        if (!matches) {
          return false;
        }
        if (current.phase === "remote_apply") {
          return true;
        }
        return now < (current.cooldownUntil || 0);
      }
      recoverIfStale() {
        const current = this.readState();
        const now = this.now();
        const staleRemoteApply = current.phase === "remote_apply" && current.startedAt + this.cooldownMs <= now;
        const staleCooldown = current.phase === "idle" && (current.cooldownUntil || 0) <= now && Array.isArray(current.paths) && current.paths.length > 0;
        if (staleRemoteApply || staleCooldown) {
          this.writeState(createIdleState(now));
        }
      }
    };
    module2.exports = {
      RuntimeStateStore: RuntimeStateStore2,
      createIdleState
    };
  }
});

// lib/provider.js
var require_provider = __commonJS({
  "lib/provider.js"(exports2, module2) {
    "use strict";
    var GOOGLE_DRIVE_BACKEND_CAPABILITIES2 = {
      providerId: "google-drive",
      publicProviderApi: false,
      snapshotModes: ["inplace", "generations"]
    };
    function supportsSnapshotMode(capabilities, mode) {
      return Array.isArray(capabilities.snapshotModes) && capabilities.snapshotModes.indexOf(mode) !== -1;
    }
    module2.exports = {
      GOOGLE_DRIVE_BACKEND_CAPABILITIES: GOOGLE_DRIVE_BACKEND_CAPABILITIES2,
      supportsSnapshotMode
    };
  }
});

// lib/settings.js
var require_settings = __commonJS({
  "lib/settings.js"(exports2, module2) {
    "use strict";
    var DEFAULT_SETTINGS2 = {
      snapshotPublishMode: "inplace",
      generationRetentionCount: 3,
      remoteApplyCooldownMs: 2e3,
      ignorePatterns: [],
      pushDebounceMs: 5e3,
      pollIntervalSeconds: 30,
      pollMode: "foreground",
      enableAutoSync: true,
      rootFolderName: "ObsidianSync",
      googleAccessToken: "",
      googleAccessTokenExpiresAt: 0,
      googleRefreshToken: "",
      googleClientId: "",
      googleClientSecret: "",
      googleTokenEndpoint: "https://oauth2.googleapis.com/token"
    };
    function normalizeSettings2(input) {
      const merged = Object.assign({}, DEFAULT_SETTINGS2, input || {});
      if (merged.snapshotPublishMode !== "inplace" && merged.snapshotPublishMode !== "generations") {
        merged.snapshotPublishMode = DEFAULT_SETTINGS2.snapshotPublishMode;
      }
      if (!Number.isInteger(merged.generationRetentionCount) || merged.generationRetentionCount < 2) {
        merged.generationRetentionCount = DEFAULT_SETTINGS2.generationRetentionCount;
      }
      if (!Number.isInteger(merged.remoteApplyCooldownMs) || merged.remoteApplyCooldownMs < 0) {
        merged.remoteApplyCooldownMs = DEFAULT_SETTINGS2.remoteApplyCooldownMs;
      }
      if (!Array.isArray(merged.ignorePatterns)) {
        merged.ignorePatterns = [];
      }
      if (!Number.isInteger(merged.pushDebounceMs) || merged.pushDebounceMs < 0) {
        merged.pushDebounceMs = DEFAULT_SETTINGS2.pushDebounceMs;
      }
      if (!Number.isInteger(merged.pollIntervalSeconds) || merged.pollIntervalSeconds < 0) {
        merged.pollIntervalSeconds = DEFAULT_SETTINGS2.pollIntervalSeconds;
      }
      if (["foreground", "always", "manual"].indexOf(merged.pollMode) === -1) {
        merged.pollMode = DEFAULT_SETTINGS2.pollMode;
      }
      if (typeof merged.enableAutoSync !== "boolean") {
        merged.enableAutoSync = DEFAULT_SETTINGS2.enableAutoSync;
      }
      merged.rootFolderName = merged.rootFolderName || DEFAULT_SETTINGS2.rootFolderName;
      merged.googleAccessToken = merged.googleAccessToken || "";
      merged.googleAccessTokenExpiresAt = Number(merged.googleAccessTokenExpiresAt || 0);
      merged.googleRefreshToken = merged.googleRefreshToken || "";
      merged.googleClientId = merged.googleClientId || "";
      merged.googleClientSecret = merged.googleClientSecret || "";
      merged.googleTokenEndpoint = merged.googleTokenEndpoint || DEFAULT_SETTINGS2.googleTokenEndpoint;
      return merged;
    }
    module2.exports = {
      DEFAULT_SETTINGS: DEFAULT_SETTINGS2,
      normalizeSettings: normalizeSettings2
    };
  }
});

// lib/plugin-data-store.js
var require_plugin_data_store = __commonJS({
  "lib/plugin-data-store.js"(exports2, module2) {
    "use strict";
    var { normalizeSettings: normalizeSettings2 } = require_settings();
    var { normalizeLocalState: normalizeLocalState2 } = require_local_state();
    async function loadPluginData2(plugin) {
      const raw = await plugin.loadData();
      return raw || {};
    }
    async function savePluginData2(plugin, data) {
      await plugin.saveData(data);
      return data;
    }
    function createSettingsStore2(plugin) {
      return {
        async load() {
          const data = await loadPluginData2(plugin);
          return normalizeSettings2(data.settings);
        },
        async save(settings) {
          const data = await loadPluginData2(plugin);
          data.settings = normalizeSettings2(settings);
          await savePluginData2(plugin, data);
          return data.settings;
        }
      };
    }
    function createLocalStateStore2(plugin) {
      return {
        async load() {
          const data = await loadPluginData2(plugin);
          return normalizeLocalState2(data.localState);
        },
        async save(localState) {
          const data = await loadPluginData2(plugin);
          data.localState = normalizeLocalState2(localState);
          await savePluginData2(plugin, data);
          return data.localState;
        }
      };
    }
    module2.exports = {
      loadPluginData: loadPluginData2,
      savePluginData: savePluginData2,
      createSettingsStore: createSettingsStore2,
      createLocalStateStore: createLocalStateStore2
    };
  }
});

// lib/snapshot-plan.js
var require_snapshot_plan = __commonJS({
  "lib/snapshot-plan.js"(exports2, module2) {
    "use strict";
    function uniquePaths(paths) {
      return Array.from(new Set(paths));
    }
    function planGenerationBuild(options) {
      const previousFiles = options.previousFiles || [];
      const changedFiles = uniquePaths(options.changedFiles || []);
      const deletedFiles = uniquePaths(options.deletedFiles || []);
      const renamedFiles = options.renamedFiles || [];
      const renamedSources = renamedFiles.map(function(rename) {
        return rename.from;
      });
      const renamedTargets = renamedFiles.map(function(rename) {
        return rename.to;
      });
      const copyPaths = previousFiles.filter(function(filePath) {
        return changedFiles.indexOf(filePath) === -1 && deletedFiles.indexOf(filePath) === -1 && renamedSources.indexOf(filePath) === -1;
      });
      return {
        previousGenerationId: options.previousGenerationId || null,
        nextGenerationId: options.nextGenerationId,
        copyPaths: uniquePaths(copyPaths),
        writePaths: uniquePaths(changedFiles.concat(renamedTargets)),
        deletePaths: deletedFiles
      };
    }
    function planGenerationGarbageCollection(options) {
      const generationIds = options.generationIds || [];
      const retentionCount = Math.max(1, options.retentionCount || 1);
      const keep = generationIds.slice(Math.max(0, generationIds.length - retentionCount));
      const remove = generationIds.slice(0, Math.max(0, generationIds.length - retentionCount));
      return { keep, remove };
    }
    module2.exports = {
      planGenerationBuild,
      planGenerationGarbageCollection
    };
  }
});

// lib/generation-publisher.js
var require_generation_publisher = __commonJS({
  "lib/generation-publisher.js"(exports2, module2) {
    "use strict";
    var {
      planGenerationBuild,
      planGenerationGarbageCollection
    } = require_snapshot_plan();
    var GenerationPublisher2 = class {
      constructor(options) {
        this.driveClient = options.driveClient;
        this.generationRetentionCount = options.generationRetentionCount || 3;
      }
      async publish(input) {
        const generationRoot = "snapshots/generations/" + input.nextGenerationId;
        const buildPlan = planGenerationBuild({
          previousGenerationId: input.previousGenerationId,
          nextGenerationId: input.nextGenerationId,
          previousFiles: input.previousFiles,
          changedFiles: (input.changedFiles || []).map(function(entry) {
            return entry.path;
          }),
          deletedFiles: input.deletedFiles,
          renamedFiles: input.renamedFiles
        });
        await this.driveClient.ensureFolder(generationRoot);
        await this.driveClient.ensureFolder(generationRoot + "/vault");
        for (const copyPath of buildPlan.copyPaths) {
          const previousPath = this.mapGenerationPath(input.previousGenerationId, copyPath);
          const nextPath = this.mapGenerationPath(input.nextGenerationId, copyPath);
          await this.driveClient.copyFile(previousPath, nextPath);
        }
        for (const changedFile of input.changedFiles || []) {
          const destinationPath = this.mapGenerationPath(input.nextGenerationId, changedFile.path);
          await this.driveClient.writeFile(destinationPath, changedFile.content);
        }
        for (const renamedFile of input.renamedFiles || []) {
          const destinationPath = this.mapGenerationPath(input.nextGenerationId, renamedFile.to);
          const sourceContent = renamedFile.content != null ? renamedFile.content : "";
          await this.driveClient.writeFile(destinationPath, sourceContent);
        }
        await this.driveClient.writeJson(generationRoot + "/_meta.json", {
          generationId: input.nextGenerationId,
          snapshotSeqs: input.snapshotSeqs || {}
        });
        await this.driveClient.writeJson("snapshots/current.json", {
          generationId: input.nextGenerationId
        });
        const generationIds = await this.driveClient.listGenerationIds();
        const allGenerationIds = generationIds.indexOf(input.nextGenerationId) === -1 ? generationIds.concat([input.nextGenerationId]) : generationIds;
        const gcPlan = planGenerationGarbageCollection({
          generationIds: allGenerationIds,
          retentionCount: this.generationRetentionCount
        });
        for (const generationId of gcPlan.remove) {
          await this.driveClient.deletePath("snapshots/generations/" + generationId);
        }
        return {
          currentGenerationId: input.nextGenerationId,
          buildPlan,
          removedGenerationIds: gcPlan.remove
        };
      }
      mapGenerationPath(generationId, relativePath) {
        return "snapshots/generations/" + generationId + "/" + relativePath;
      }
    };
    module2.exports = {
      GenerationPublisher: GenerationPublisher2
    };
  }
});

// lib/google-drive-backend.js
var require_google_drive_backend = __commonJS({
  "lib/google-drive-backend.js"(exports2, module2) {
    "use strict";
    var GoogleDriveBackend2 = class {
      constructor(options) {
        this.driveClient = options.driveClient;
        this.generationPublisher = options.generationPublisher;
        this.now = options.now || function() {
          return Date.now();
        };
      }
      async uploadBlob(change) {
        return this.driveClient.uploadBlob(change);
      }
      async appendOperation(entry) {
        return this.driveClient.appendOperation(entry);
      }
      async commitManifest(manifestPatch) {
        var maxRetries = 3;
        for (var attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await this.driveClient.writeManifest(manifestPatch);
          } catch (error) {
            if (error && error.status === 412 && attempt < maxRetries - 1) {
              continue;
            }
            throw error;
          }
        }
      }
      async writeCursor(deviceId, cursorVector) {
        return this.driveClient.writeCursor(deviceId, cursorVector);
      }
      async registerDevice(deviceId) {
        return this.commitManifest({
          deviceId,
          files: []
        });
      }
      async readManifest() {
        return this.driveClient.readManifest();
      }
      async readSnapshotMeta(settings) {
        return this.driveClient.readSnapshotMeta(settings && settings.snapshotPublishMode);
      }
      async downloadSnapshot(snapshotMeta, settings) {
        return this.driveClient.downloadSnapshot(snapshotMeta, settings && settings.snapshotPublishMode);
      }
      async getRemoteHeads() {
        return this.driveClient.getRemoteHeads();
      }
      async getPendingRemoteOperations(cursorByDevice) {
        return this.driveClient.listOperationsSince(cursorByDevice);
      }
      async fetchBlob(blobHash) {
        return this.driveClient.fetchBlob(blobHash);
      }
      async getOpsForFile(fileId, limit) {
        return this.driveClient.getOpsForFile(fileId, limit);
      }
      async getStartPageToken() {
        return this.driveClient.getStartPageToken();
      }
      async listChanges(pageToken) {
        return this.driveClient.listChanges(pageToken);
      }
      async readOperationLog(deviceId) {
        return this.driveClient.readOperationLog(deviceId);
      }
      async overwriteOperationLog(deviceId, entries) {
        return this.driveClient.overwriteOperationLog(deviceId, entries);
      }
      async writeArchiveLog(deviceId, startSeq, endSeq, entries) {
        return this.driveClient.writeArchiveLog(deviceId, startSeq, endSeq, entries);
      }
      async listCursorVectors() {
        return this.driveClient.listCursorVectors();
      }
      async publishSnapshot(input) {
        if (input.snapshotPublishMode === "generations") {
          return this.generationPublisher.publish(input);
        }
        for (const file of input.files || []) {
          await this.driveClient.writeSnapshotFile(file.path, file.content);
        }
        for (const deletedPath of input.deletedFiles || []) {
          await this.driveClient.deletePath(deletedPath);
        }
        await this.driveClient.writeJson("vault/_snapshot_meta.json", {
          snapshotSeqs: input.snapshotSeqs || {},
          updatedAt: this.now()
        });
        return {
          snapshotPublishMode: "inplace",
          updatedAt: this.now()
        };
      }
    };
    module2.exports = {
      GoogleDriveBackend: GoogleDriveBackend2
    };
  }
});

// lib/obsidian-vault-adapter.js
var require_obsidian_vault_adapter = __commonJS({
  "lib/obsidian-vault-adapter.js"(exports2, module2) {
    "use strict";
    var obsidian3 = require("obsidian");
    var ObsidianVaultAdapter2 = class {
      constructor(options) {
        this.app = options.app;
        this.backend = options.backend;
      }
      async readChangeContent(filePath) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof obsidian3.TFile)) {
          return "";
        }
        const bytes = await this.app.vault.readBinary(file);
        if (typeof Buffer !== "undefined") {
          return Buffer.from(bytes).toString("utf8");
        }
        return "";
      }
      async applyRemoteOperation(entry) {
        if (entry.op === "delete") {
          const existing2 = this.app.vault.getAbstractFileByPath(entry.path);
          if (existing2) {
            await this.app.vault.delete(existing2, true);
          }
          return;
        }
        if (entry.op === "rename" && entry.newPath) {
          const existing2 = this.app.vault.getAbstractFileByPath(entry.path);
          if (existing2) {
            await this.app.fileManager.renameFile(existing2, entry.newPath);
          }
          return;
        }
        const content = await this.backend.fetchBlob(entry.blobHash);
        const existing = this.app.vault.getAbstractFileByPath(entry.path);
        if (existing instanceof obsidian3.TFile) {
          await this.app.vault.modify(existing, content);
          return;
        }
        await this.ensureParentFolder(entry.path);
        await this.app.vault.create(entry.path, content);
      }
      async applySnapshot(files) {
        for (const file of files || []) {
          await this.writeFile(file.path, file.content);
        }
      }
      async ensureParentFolder(filePath) {
        const parts = filePath.split("/").slice(0, -1);
        let current = "";
        for (const part of parts) {
          current = current ? current + "/" + part : part;
          if (!this.app.vault.getAbstractFileByPath(current)) {
            await this.app.vault.createFolder(current);
          }
        }
      }
      async writeFile(filePath, content) {
        var existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing) {
          await this.app.vault.modify(existing, content);
        } else {
          await this.ensureParentFolder(filePath);
          await this.app.vault.create(filePath, content);
        }
      }
      async writeConflictCopy(filePath, content) {
        await this.ensureParentFolder(filePath);
        var existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing) {
          await this.app.vault.modify(existing, content);
        } else {
          await this.app.vault.create(filePath, content);
        }
      }
    };
    module2.exports = {
      ObsidianVaultAdapter: ObsidianVaultAdapter2
    };
  }
});

// src/drive/auth.ts
var import_crypto = __toESM(require("crypto"));
var import_http = __toESM(require("http"));
async function fetchAccessToken(settingsStore, fetchImpl) {
  const settings = await settingsStore.load();
  const now = Date.now();
  if (settings.googleAccessToken && settings.googleAccessTokenExpiresAt > now + 6e4) {
    return settings.googleAccessToken;
  }
  if (!settings.googleRefreshToken || !settings.googleClientId || !fetchImpl) {
    return settings.googleAccessToken || "";
  }
  const body = new URLSearchParams({
    client_id: settings.googleClientId,
    client_secret: settings.googleClientSecret || "",
    refresh_token: settings.googleRefreshToken,
    grant_type: "refresh_token"
  });
  const response = await fetchImpl(settings.googleTokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  if (!response.ok) {
    throw new Error("Failed to refresh Google access token");
  }
  const payload = await response.json();
  settings.googleAccessToken = payload.access_token || "";
  settings.googleAccessTokenExpiresAt = now + (payload.expires_in || 3600) * 1e3;
  await settingsStore.save(settings);
  return settings.googleAccessToken;
}
function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomVerifier() {
  return base64Url(import_crypto.default.randomBytes(32));
}
function createCodeChallenge(verifier) {
  return base64Url(import_crypto.default.createHash("sha256").update(verifier).digest());
}
async function exchangeAuthorizationCode(options) {
  const body = new URLSearchParams({
    client_id: options.clientId,
    code: options.code,
    code_verifier: options.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: options.redirectUri
  });
  if (options.clientSecret) {
    body.set("client_secret", options.clientSecret);
  }
  const response = await options.fetchImpl(options.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  if (!response.ok) {
    throw new Error("Failed to exchange Google OAuth code");
  }
  return response.json();
}
async function startOAuthFlow(options) {
  const openExternal = options.openExternal || (async (url) => {
    return require("electron").shell.openExternal(url);
  });
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  const authorizeEndpoint = options.authorizeEndpoint || "https://accounts.google.com/o/oauth2/v2/auth";
  const tokenEndpoint = options.tokenEndpoint || "https://oauth2.googleapis.com/token";
  const scope = options.scope || "https://www.googleapis.com/auth/drive.file";
  const timeoutMs = options.timeoutMs || 12e4;
  const state = randomVerifier();
  const codeVerifier = randomVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  let server;
  let timeoutHandle;
  try {
    const callback = await new Promise((resolve, reject) => {
      server = import_http.default.createServer((req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        if (url.searchParams.get("state") !== state) {
          res.statusCode = 400;
          res.end("Invalid OAuth state");
          reject(new Error("Google OAuth state mismatch"));
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          res.statusCode = 400;
          res.end("Missing OAuth code");
          reject(new Error("Missing Google OAuth code"));
          return;
        }
        res.statusCode = 200;
        res.end("Google Drive authentication complete. You can close this window.");
        resolve({ code });
      });
      server.listen(0, "127.0.0.1", async () => {
        const address2 = server?.address();
        if (!address2 || typeof address2 === "string") {
          reject(new Error("OAuth callback server failed to bind"));
          return;
        }
        const redirectUri2 = "http://127.0.0.1:" + address2.port + "/callback";
        const authUrl = authorizeEndpoint + "?" + new URLSearchParams({
          client_id: options.clientId,
          redirect_uri: redirectUri2,
          response_type: "code",
          scope,
          access_type: "offline",
          prompt: "consent",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256"
        }).toString();
        try {
          await openExternal(authUrl);
        } catch (error) {
          reject(error);
        }
      });
      timeoutHandle = setTimeout(() => {
        reject(new Error("Google OAuth flow timed out"));
      }, timeoutMs);
    });
    const address = server?.address();
    if (!address || typeof address === "string") {
      throw new Error("OAuth callback server closed unexpectedly");
    }
    const redirectUri = "http://127.0.0.1:" + address.port + "/callback";
    const tokenPayload = await exchangeAuthorizationCode({
      fetchImpl,
      tokenEndpoint,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      code: callback.code,
      codeVerifier,
      redirectUri
    });
    return {
      accessToken: tokenPayload.access_token || "",
      refreshToken: tokenPayload.refresh_token || "",
      expiresAt: Date.now() + (tokenPayload.expires_in || 3600) * 1e3,
      raw: tokenPayload
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (server) {
      await new Promise((resolve) => {
        server?.close(() => resolve());
      });
    }
  }
}

// src/drive/client.ts
var TokenBucketRateLimiter = class {
  capacity;
  refillPerSecond;
  now;
  sleep;
  tokens;
  lastRefillAt;
  constructor(options) {
    this.capacity = options?.capacity ?? 100;
    this.refillPerSecond = options?.refillPerSecond ?? 200;
    this.now = options?.now ?? (() => Date.now());
    this.sleep = options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.tokens = this.capacity;
    this.lastRefillAt = this.now();
  }
  refill() {
    const currentTime = this.now();
    const elapsedMs = Math.max(0, currentTime - this.lastRefillAt);
    if (elapsedMs <= 0) {
      return;
    }
    const refillTokens = elapsedMs / 1e3 * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + refillTokens);
    this.lastRefillAt = currentTime;
  }
  async acquire(tokenCount = 1) {
    while (true) {
      this.refill();
      if (this.tokens >= tokenCount) {
        this.tokens -= tokenCount;
        return;
      }
      const missing = tokenCount - this.tokens;
      const waitMs = Math.ceil(missing / this.refillPerSecond * 1e3);
      await this.sleep(Math.max(waitMs, 1));
    }
  }
};
function toQueryString(query) {
  if (!query) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null) {
      continue;
    }
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}
function headerLookup(response, name) {
  return response.headers && typeof response.headers.get === "function" ? response.headers.get(name) : null;
}
var GoogleDriveClient = class {
  fetchImpl;
  getAccessToken;
  rootFolderName;
  vaultName;
  baseUrl;
  now;
  deviceInactiveThresholdMs;
  rateLimiter;
  resumableUploadThresholdBytes;
  manifestETag = null;
  manifestFileId = null;
  constructor(options) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.getAccessToken = options.getAccessToken;
    this.rootFolderName = options.rootFolderName ?? "ObsidianSync";
    this.vaultName = options.vaultName ?? "ObsidianVault";
    this.baseUrl = "https://www.googleapis.com";
    this.now = options.now ?? (() => Date.now());
    this.deviceInactiveThresholdMs = options.deviceInactiveThresholdMs ?? 30 * 24 * 60 * 60 * 1e3;
    this.rateLimiter = options.rateLimiter ?? new TokenBucketRateLimiter();
    this.resumableUploadThresholdBytes = options.resumableUploadThresholdBytes ?? 5 * 1024 * 1024;
  }
  async request(method, resourcePath, options) {
    const accessToken = await this.getAccessToken();
    const headers = {
      ...options?.headers ?? {},
      Authorization: `Bearer ${accessToken}`
    };
    await this.rateLimiter.acquire(1);
    const response = await this.fetchImpl(`${this.baseUrl}${resourcePath}${toQueryString(options?.query)}`, {
      method,
      headers,
      body: options?.body
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`Google Drive request failed: ${method} ${resourcePath} ${text}`);
      error.status = response.status;
      const retryAfter = headerLookup(response, "retry-after");
      if (retryAfter != null) {
        error.retryAfter = Number(retryAfter);
      }
      throw error;
    }
    return response;
  }
  async requestJson(method, resourcePath, options) {
    const response = await this.request(method, resourcePath, options);
    return response.status === 204 ? {} : response.json();
  }
  buildAppProperties(logicalPath, kind) {
    return {
      logicalPath,
      kind,
      vault: this.vaultName
    };
  }
  async listFiles(query) {
    const allFiles = [];
    let pageToken;
    do {
      const payload = await this.requestJson("GET", "/drive/v3/files", {
        query: {
          q: query,
          fields: "files(id,name,mimeType,parents,appProperties),nextPageToken",
          pageSize: 1e3,
          pageToken
        }
      });
      allFiles.push(...payload.files ?? []);
      pageToken = payload.nextPageToken;
    } while (pageToken);
    return allFiles;
  }
  async ensureRootFolder() {
    const existing = await this.listFiles(
      `mimeType='application/vnd.google-apps.folder' and name='${this.rootFolderName}' and trashed=false`
    );
    if (existing.length > 0) {
      return existing[0];
    }
    return this.requestJson("POST", "/drive/v3/files", {
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: this.rootFolderName,
        mimeType: "application/vnd.google-apps.folder",
        appProperties: {
          kind: "root",
          vault: this.vaultName
        }
      })
    });
  }
  async findByLogicalPath(logicalPath) {
    const files = await this.listFiles(
      `appProperties has { key='logicalPath' and value='${logicalPath}' } and trashed=false`
    );
    return files[0] ?? null;
  }
  async listManagedFiles() {
    return this.listFiles(`appProperties has { key='vault' and value='${this.vaultName}' } and trashed=false`);
  }
  async createFolder(name, parentId, logicalPath) {
    return this.requestJson("POST", "/drive/v3/files", {
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : void 0,
        appProperties: this.buildAppProperties(logicalPath, "folder")
      })
    });
  }
  async ensureFolder(logicalFolderPath) {
    const root = await this.ensureRootFolder();
    const parts = logicalFolderPath.split("/").filter(Boolean);
    let currentParentId = root.id;
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = await this.findByLogicalPath(currentPath);
      if (existing) {
        currentParentId = existing.id;
      } else {
        const created = await this.createFolder(part, currentParentId, currentPath);
        currentParentId = created.id;
      }
    }
    return currentParentId;
  }
  async createOrUpdateFile(logicalPath, content, mimeType = "application/octet-stream", kind = "file", options) {
    const fileName = logicalPath.split("/").pop() ?? logicalPath;
    const parentPath = logicalPath.split("/").slice(0, -1).join("/");
    const parentId = parentPath ? await this.ensureFolder(parentPath) : (await this.ensureRootFolder()).id;
    const existing = await this.findByLogicalPath(logicalPath);
    const contentBuffer = this.toContentBuffer(content);
    if (contentBuffer.length > this.resumableUploadThresholdBytes) {
      return this.createOrUpdateFileResumable(logicalPath, contentBuffer, mimeType, kind, {
        existing,
        parentId,
        fileName,
        ifMatch: options?.ifMatch
      });
    }
    const boundary = `ogds-${Date.now()}`;
    const metadata = {
      name: fileName,
      parents: [parentId],
      mimeType,
      appProperties: this.buildAppProperties(logicalPath, kind)
    };
    const body = this.buildMultipartBody(boundary, metadata, contentBuffer, mimeType);
    if (existing) {
      const updateBody = this.buildMultipartBody(boundary, {
        name: fileName,
        mimeType,
        appProperties: this.buildAppProperties(logicalPath, kind)
      }, contentBuffer, mimeType);
      return this.requestJson("PATCH", `/upload/drive/v3/files/${existing.id}`, {
        query: {
          uploadType: "multipart",
          fields: "id,name,appProperties",
          addParents: parentId
        },
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
          ...options?.ifMatch ? { "If-Match": options.ifMatch } : {}
        },
        body: updateBody
      });
    }
    return this.requestJson("POST", "/upload/drive/v3/files", {
      query: {
        uploadType: "multipart",
        fields: "id,name,appProperties"
      },
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    });
  }
  toContentBuffer(content) {
    if (Buffer.isBuffer(content)) {
      return content;
    }
    if (content instanceof Uint8Array) {
      return Buffer.from(content);
    }
    return Buffer.from(typeof content === "string" ? content : String(content ?? ""), "utf8");
  }
  buildMultipartBody(boundary, metadata, contentBuffer, mimeType) {
    return Buffer.concat([
      Buffer.from(`--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${JSON.stringify(metadata)}\r
`),
      Buffer.from(`--${boundary}\r
Content-Type: ${mimeType}\r
\r
`),
      contentBuffer,
      Buffer.from(`\r
--${boundary}--`)
    ]);
  }
  async createOrUpdateFileResumable(logicalPath, contentBuffer, mimeType, kind, options) {
    const metadata = {
      name: options.fileName,
      parents: options.existing ? void 0 : [options.parentId],
      mimeType,
      appProperties: this.buildAppProperties(logicalPath, kind)
    };
    const accessToken = await this.getAccessToken();
    const resourcePath = options.existing ? `/upload/drive/v3/files/${options.existing.id}` : "/upload/drive/v3/files";
    const query = options.existing ? { uploadType: "resumable", fields: "id,name,appProperties", addParents: options.parentId } : { uploadType: "resumable", fields: "id,name,appProperties" };
    await this.rateLimiter.acquire(1);
    const session = await this.fetchImpl(`${this.baseUrl}${resourcePath}${toQueryString(query)}`, {
      method: options.existing ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        ...options.ifMatch ? { "If-Match": options.ifMatch } : {}
      },
      body: JSON.stringify(metadata)
    });
    if (!session.ok) {
      const text = await session.text();
      const error = new Error(`Google Drive resumable upload init failed: ${text}`);
      error.status = session.status;
      throw error;
    }
    const uploadUrl = headerLookup(session, "location");
    if (!uploadUrl) {
      throw new Error("Missing resumable upload session URL");
    }
    await this.rateLimiter.acquire(1);
    const uploadResponse = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mimeType,
        "Content-Length": String(contentBuffer.length)
      },
      body: contentBuffer
    });
    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      const error = new Error(`Google Drive resumable upload failed: ${text}`);
      error.status = uploadResponse.status;
      throw error;
    }
    return uploadResponse.status === 204 ? {} : uploadResponse.json();
  }
  async writeFile(logicalPath, content) {
    return this.createOrUpdateFile(logicalPath, content, "application/octet-stream", "file");
  }
  async writeJson(logicalPath, value) {
    return this.createOrUpdateFile(logicalPath, JSON.stringify(value, null, 2), "application/json", "json");
  }
  async readJson(logicalPath) {
    const body = await this.readFile(logicalPath);
    if (body == null || body === "") {
      return null;
    }
    return JSON.parse(body);
  }
  async writeSnapshotFile(logicalPath, content) {
    return this.writeFile(logicalPath, content);
  }
  async readFile(logicalPath) {
    const existing = await this.findByLogicalPath(logicalPath);
    if (!existing) {
      return null;
    }
    const response = await this.request("GET", `/drive/v3/files/${existing.id}`, {
      query: {
        alt: "media"
      }
    });
    return response.text();
  }
  async copyFile(sourceLogicalPath, destinationLogicalPath) {
    const source = await this.findByLogicalPath(sourceLogicalPath);
    if (!source) {
      throw new Error(`Source file not found for copy: ${sourceLogicalPath}`);
    }
    const fileName = destinationLogicalPath.split("/").pop() ?? destinationLogicalPath;
    const parentPath = destinationLogicalPath.split("/").slice(0, -1).join("/");
    const parentId = parentPath ? await this.ensureFolder(parentPath) : (await this.ensureRootFolder()).id;
    return this.requestJson("POST", `/drive/v3/files/${source.id}/copy`, {
      query: {
        fields: "id,name,appProperties"
      },
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: fileName,
        parents: [parentId],
        appProperties: this.buildAppProperties(destinationLogicalPath, "file")
      })
    });
  }
  async deletePath(logicalPath) {
    const files = await this.listManagedFiles();
    for (const file of files) {
      const candidatePath = file.appProperties?.logicalPath;
      if (!candidatePath) {
        continue;
      }
      if (candidatePath === logicalPath || candidatePath.startsWith(`${logicalPath}/`)) {
        await this.request("DELETE", `/drive/v3/files/${file.id}`, {});
      }
    }
  }
  async listGenerationIds() {
    const files = await this.listManagedFiles();
    const ids = /* @__PURE__ */ new Set();
    for (const file of files) {
      const logicalPath = file.appProperties?.logicalPath;
      if (!logicalPath || !logicalPath.startsWith("snapshots/generations/")) {
        continue;
      }
      const generationId = logicalPath.split("/")[2];
      if (generationId) {
        ids.add(generationId);
      }
    }
    return Array.from(ids).sort();
  }
  async uploadBlob(change) {
    const logicalPath = `blobs/${change.blobHash}`;
    const existing = await this.findByLogicalPath(logicalPath);
    if (!existing) {
      await this.writeFile(logicalPath, change.content ?? "");
    }
    return { blobHash: change.blobHash };
  }
  async appendOperation(entry) {
    const logicalPath = `ops/live/${entry.device}.jsonl`;
    const line = `${JSON.stringify(entry)}
`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.findByLogicalPath(logicalPath);
      if (!existing) {
        await this.writeFile(logicalPath, line);
        return { remoteOpLogId: `${logicalPath}#${entry.seq}` };
      }
      const response = await this.request("GET", `/drive/v3/files/${existing.id}`, {
        query: { alt: "media" }
      });
      const etag = headerLookup(response, "etag");
      const currentBody = await response.text();
      const nextBody = currentBody ? `${currentBody.replace(/\s*$/, "")}
${line}` : line;
      try {
        await this.createOrUpdateFile(logicalPath, nextBody, "application/octet-stream", "file", {
          ifMatch: etag ?? void 0
        });
        return { remoteOpLogId: `${logicalPath}#${entry.seq}` };
      } catch (error) {
        const driveError = error;
        if (driveError.status !== 412 || attempt === 2) {
          throw error;
        }
      }
    }
    return { remoteOpLogId: `${logicalPath}#${entry.seq}` };
  }
  async readManifest() {
    const existing = await this.findByLogicalPath("manifest.json");
    if (!existing) {
      this.manifestETag = null;
      this.manifestFileId = null;
      return { version: 1, devices: {}, files: {} };
    }
    this.manifestFileId = existing.id;
    const response = await this.request("GET", `/drive/v3/files/${existing.id}`, {
      query: { alt: "media" }
    });
    this.manifestETag = headerLookup(response, "etag");
    const body = await response.text();
    return JSON.parse(body);
  }
  async writeManifest(patch) {
    const manifest = await this.readManifest();
    const device = manifest.devices[patch.deviceId] ?? {};
    let opsHead = device.opsHead ?? 0;
    const now = this.now();
    for (const deviceId of Object.keys(manifest.devices ?? {})) {
      const current = manifest.devices[deviceId] ?? {};
      const nextStatus = current.lastSeenAt && now - current.lastSeenAt > this.deviceInactiveThresholdMs ? "inactive" : current.status ?? "active";
      manifest.devices[deviceId] = {
        ...current,
        status: nextStatus
      };
    }
    for (const file of patch.files ?? []) {
      if (file.op === "delete") {
        delete manifest.files[file.path];
      } else if (file.op === "rename" && file.newPath) {
        const previousRecord = manifest.files[file.path] ?? { fileId: file.newPath };
        delete manifest.files[file.path];
        manifest.files[file.newPath] = {
          fileId: file.fileId ?? previousRecord.fileId ?? file.newPath,
          version: file.version ?? (previousRecord.version ?? 0) + 1,
          blobHash: file.blobHash,
          lastModifiedBy: file.lastModifiedBy,
          updatedAt: file.updatedAt
        };
      } else {
        const previousRecord = manifest.files[file.path] ?? { fileId: file.path };
        manifest.files[file.path] = {
          fileId: file.fileId ?? previousRecord.fileId ?? file.path,
          version: file.version ?? (previousRecord.version ?? 0) + 1,
          blobHash: file.blobHash,
          lastModifiedBy: file.lastModifiedBy,
          updatedAt: file.updatedAt
        };
      }
      if (typeof file.seq === "number" && file.seq > opsHead) {
        opsHead = file.seq;
      }
    }
    manifest.devices[patch.deviceId] = {
      lastSeenAt: now,
      opsHead,
      status: "active"
    };
    manifest.version = (manifest.version ?? 0) + 1;
    await this.createOrUpdateFile("manifest.json", JSON.stringify(manifest, null, 2), "application/json", "json", {
      ifMatch: this.manifestETag ?? void 0
    });
    return manifest;
  }
  async writeCursor(deviceId, cursorVector) {
    await this.writeJson(`ops/cursors/${deviceId}.json`, {
      cursors: cursorVector
    });
    return cursorVector;
  }
  async getRemoteHeads() {
    const manifest = await this.readManifest();
    const heads = {};
    for (const deviceId of Object.keys(manifest.devices ?? {})) {
      heads[deviceId] = manifest.devices[deviceId]?.opsHead ?? 0;
    }
    return heads;
  }
  async listOperationsSince(cursorByDevice) {
    const manifest = await this.readManifest();
    const results = [];
    for (const deviceId of Object.keys(manifest.devices ?? {})) {
      const since = cursorByDevice?.[deviceId] ?? 0;
      const committedHead = manifest.devices[deviceId]?.opsHead ?? 0;
      const body = await this.readFile(`ops/live/${deviceId}.jsonl`);
      if (!body) {
        continue;
      }
      for (const line of body.split("\n").filter(Boolean)) {
        const entry = JSON.parse(line);
        if (entry.seq > since && entry.seq <= committedHead) {
          results.push(entry);
        }
      }
    }
    return results.sort((left, right) => (left.ts ?? 0) - (right.ts ?? 0));
  }
  async fetchBlob(blobHash) {
    const body = await this.readFile(`blobs/${blobHash}`);
    if (body == null) {
      throw new Error(`Missing blob: ${blobHash}`);
    }
    return body;
  }
  async getOpsForFile(fileId, limit) {
    const manifest = await this.readManifest();
    const results = [];
    for (const deviceId of Object.keys(manifest.devices ?? {})) {
      const body = await this.readFile(`ops/live/${deviceId}.jsonl`);
      if (!body) {
        continue;
      }
      for (const line of body.split("\n").filter(Boolean)) {
        const entry = JSON.parse(line);
        if (entry.fileId === fileId) {
          results.push(entry);
        }
      }
    }
    results.sort((left, right) => (right.ts ?? 0) - (left.ts ?? 0));
    return typeof limit === "number" ? results.slice(0, limit) : results;
  }
  async getStartPageToken() {
    const result = await this.requestJson("GET", "/drive/v3/changes/startPageToken");
    return result.startPageToken;
  }
  async listChanges(pageToken) {
    return this.requestJson("GET", "/drive/v3/changes", {
      query: {
        pageToken,
        spaces: "drive",
        fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,appProperties))",
        pageSize: 100
      }
    });
  }
  async readSnapshotMeta(snapshotPublishMode) {
    if (snapshotPublishMode === "generations") {
      const current = await this.readJson("snapshots/current.json");
      if (!current?.generationId) {
        return {
          generationId: null,
          snapshotSeqs: {}
        };
      }
      const meta = await this.readJson(`snapshots/generations/${current.generationId}/_meta.json`);
      return {
        ...meta ?? { snapshotSeqs: {} },
        generationId: current.generationId
      };
    }
    return await this.readJson("vault/_snapshot_meta.json") ?? {
      snapshotSeqs: {}
    };
  }
  async downloadSnapshot(snapshotMeta, snapshotPublishMode) {
    const prefix = snapshotPublishMode === "generations" && snapshotMeta?.generationId ? `snapshots/generations/${snapshotMeta.generationId}/vault/` : "vault/";
    const files = await this.listManagedFiles();
    const snapshotFiles = files.filter((file) => {
      const logicalPath = file.appProperties?.logicalPath;
      return Boolean(logicalPath && logicalPath.startsWith(prefix) && logicalPath.slice(prefix.length) !== "_snapshot_meta.json");
    });
    snapshotFiles.sort(
      (left, right) => (left.appProperties?.logicalPath ?? "").localeCompare(right.appProperties?.logicalPath ?? "")
    );
    const results = [];
    for (const file of snapshotFiles) {
      const logicalPath = file.appProperties?.logicalPath;
      if (!logicalPath) {
        continue;
      }
      const content = await this.readFile(logicalPath);
      results.push({
        path: logicalPath.slice(prefix.length),
        content: content ?? ""
      });
    }
    return results;
  }
  async readOperationLog(deviceId) {
    const body = await this.readFile(`ops/live/${deviceId}.jsonl`);
    if (!body) {
      return [];
    }
    return body.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }
  async overwriteOperationLog(deviceId, entries) {
    const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
    await this.writeFile(`ops/live/${deviceId}.jsonl`, body ? `${body}
` : "");
  }
  async writeArchiveLog(deviceId, startSeq, endSeq, entries) {
    const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
    await this.writeFile(`ops/archive/${deviceId}-${startSeq}-${endSeq}.jsonl`, body ? `${body}
` : "");
  }
  async listCursorVectors() {
    const files = await this.listManagedFiles();
    const vectors = [];
    for (const file of files) {
      const logicalPath = file.appProperties?.logicalPath;
      if (!logicalPath || !logicalPath.startsWith("ops/cursors/")) {
        continue;
      }
      const body = await this.readFile(logicalPath);
      if (!body) {
        continue;
      }
      const parsed = JSON.parse(body);
      vectors.push({
        deviceId: logicalPath.replace(/^ops\/cursors\//, "").replace(/\.json$/, ""),
        cursors: parsed.cursors ?? {}
      });
    }
    return vectors;
  }
};

// src/settings.ts
var obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  snapshotPublishMode: "inplace",
  generationRetentionCount: 3,
  remoteApplyCooldownMs: 2e3,
  ignorePatterns: [],
  pushDebounceMs: 5e3,
  pollIntervalSeconds: 30,
  pollMode: "foreground",
  enableAutoSync: true,
  rootFolderName: "ObsidianSync",
  googleAccessToken: "",
  googleAccessTokenExpiresAt: 0,
  googleRefreshToken: "",
  googleClientId: "",
  googleClientSecret: "",
  googleTokenEndpoint: "https://oauth2.googleapis.com/token"
};
function normalizeSettings(input) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...input || {}
  };
  if (merged.snapshotPublishMode !== "inplace" && merged.snapshotPublishMode !== "generations") {
    merged.snapshotPublishMode = DEFAULT_SETTINGS.snapshotPublishMode;
  }
  if (!Number.isInteger(merged.generationRetentionCount) || merged.generationRetentionCount < 2) {
    merged.generationRetentionCount = DEFAULT_SETTINGS.generationRetentionCount;
  }
  if (!Number.isInteger(merged.remoteApplyCooldownMs) || merged.remoteApplyCooldownMs < 0) {
    merged.remoteApplyCooldownMs = DEFAULT_SETTINGS.remoteApplyCooldownMs;
  }
  if (!Array.isArray(merged.ignorePatterns)) {
    merged.ignorePatterns = [];
  }
  if (!Number.isInteger(merged.pushDebounceMs) || merged.pushDebounceMs < 0) {
    merged.pushDebounceMs = DEFAULT_SETTINGS.pushDebounceMs;
  }
  if (!Number.isInteger(merged.pollIntervalSeconds) || merged.pollIntervalSeconds < 0) {
    merged.pollIntervalSeconds = DEFAULT_SETTINGS.pollIntervalSeconds;
  }
  if (!["foreground", "always", "manual"].includes(merged.pollMode)) {
    merged.pollMode = DEFAULT_SETTINGS.pollMode;
  }
  if (typeof merged.enableAutoSync !== "boolean") {
    merged.enableAutoSync = DEFAULT_SETTINGS.enableAutoSync;
  }
  merged.rootFolderName = merged.rootFolderName || DEFAULT_SETTINGS.rootFolderName;
  merged.googleAccessToken = merged.googleAccessToken || "";
  merged.googleAccessTokenExpiresAt = Number(merged.googleAccessTokenExpiresAt || 0);
  merged.googleRefreshToken = merged.googleRefreshToken || "";
  merged.googleClientId = merged.googleClientId || "";
  merged.googleClientSecret = merged.googleClientSecret || "";
  merged.googleTokenEndpoint = merged.googleTokenEndpoint || DEFAULT_SETTINGS.googleTokenEndpoint;
  return merged;
}
var ObsidianGDriveSyncSettingTab = class extends obsidian.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const containerEl = this.containerEl;
    containerEl.empty();
    new obsidian.Setting(containerEl).setName("Snapshot publish mode").setDesc("Choose between the lighter inplace mode and the stronger generations mode.").addDropdown((dropdown) => {
      dropdown.addOption("inplace", "Inplace").addOption("generations", "Generations").setValue(this.plugin.settings.snapshotPublishMode).onChange(async (value) => {
        this.plugin.settings.snapshotPublishMode = value;
        await this.plugin.saveSettings();
      });
    });
    new obsidian.Setting(containerEl).setName("Generation retention count").setDesc("Generations mode keeps the newest published snapshots.").addText((text) => {
      text.setPlaceholder("3").setValue(String(this.plugin.settings.generationRetentionCount)).onChange(async (value) => {
        this.plugin.settings.generationRetentionCount = parseInt(value, 10);
        await this.plugin.saveSettings();
      });
    });
    new obsidian.Setting(containerEl).setName("Push debounce (ms)").setDesc("Delay before automatically syncing local edits.").addText((text) => {
      text.setPlaceholder("5000").setValue(String(this.plugin.settings.pushDebounceMs)).onChange(async (value) => {
        this.plugin.settings.pushDebounceMs = parseInt(value, 10);
        await this.plugin.saveSettings();
      });
    });
    new obsidian.Setting(containerEl).setName("Poll interval (seconds)").setDesc("How often to poll Google Drive for remote changes.").addText((text) => {
      text.setPlaceholder("30").setValue(String(this.plugin.settings.pollIntervalSeconds)).onChange(async (value) => {
        this.plugin.settings.pollIntervalSeconds = parseInt(value, 10);
        await this.plugin.saveSettings();
        this.plugin.startPolling();
      });
    });
    new obsidian.Setting(containerEl).setName("Poll mode").setDesc("Foreground polls only when Obsidian is visible. Always keeps polling. Manual disables background polling.").addDropdown((dropdown) => {
      dropdown.addOption("foreground", "Foreground").addOption("always", "Always").addOption("manual", "Manual").setValue(this.plugin.settings.pollMode).onChange(async (value) => {
        this.plugin.settings.pollMode = value;
        await this.plugin.saveSettings();
        this.plugin.startPolling();
      });
    });
    new obsidian.Setting(containerEl).setName("Enable auto sync").setDesc("Automatically sync local changes and poll for remote changes.").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.enableAutoSync).onChange(async (value) => {
        this.plugin.settings.enableAutoSync = value;
        await this.plugin.saveSettings();
        this.plugin.startPolling();
      });
    });
    new obsidian.Setting(containerEl).setName("Root folder name").setDesc("Top-level Google Drive folder used by this plugin.").addText((text) => {
      text.setPlaceholder("ObsidianSync").setValue(this.plugin.settings.rootFolderName).onChange(async (value) => {
        this.plugin.settings.rootFolderName = value;
        await this.plugin.saveSettings();
      });
    });
    new obsidian.Setting(containerEl).setName("Google sign-in").setDesc("Start the browser OAuth flow. Manual token fields remain available as a fallback.").addButton((button) => {
      button.setButtonText("Sign in with Google").onClick(async () => {
        try {
          await this.plugin.startGoogleAuth();
          this.display();
        } catch (error) {
          new obsidian.Notice(String(error && error.message ? error.message : error));
        }
      });
    });
    new obsidian.Setting(containerEl).setName("Google access token").setDesc("Optional current access token for Google Drive API calls.").addTextArea((text) => {
      text.setPlaceholder("ya29...").setValue(this.plugin.settings.googleAccessToken).onChange(async (value) => {
        this.plugin.settings.googleAccessToken = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new obsidian.Setting(containerEl).setName("Google refresh token").setDesc("Optional refresh token used to renew the Google access token.").addTextArea((text) => {
      text.setPlaceholder("1//...").setValue(this.plugin.settings.googleRefreshToken).onChange(async (value) => {
        this.plugin.settings.googleRefreshToken = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new obsidian.Setting(containerEl).setName("Google client ID").setDesc("OAuth client ID used with the refresh token flow.").addText((text) => {
      text.setPlaceholder("client id").setValue(this.plugin.settings.googleClientId).onChange(async (value) => {
        this.plugin.settings.googleClientId = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new obsidian.Setting(containerEl).setName("Google client secret").setDesc("OAuth client secret used with the refresh token flow when required.").addText((text) => {
      text.setPlaceholder("client secret").setValue(this.plugin.settings.googleClientSecret).onChange(async (value) => {
        this.plugin.settings.googleClientSecret = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new obsidian.Setting(containerEl).setName("Ignore patterns").setDesc("One gitignore-style pattern per line.").addTextArea((text) => {
      text.setPlaceholder("drafts/**").setValue((this.plugin.settings.ignorePatterns || []).join("\n")).onChange(async (value) => {
        this.plugin.settings.ignorePatterns = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      });
    });
  }
};

// src/sync/engine.ts
var import_crypto3 = __toESM(require("crypto"));

// src/vault/filter.ts
var BUILT_IN_IGNORE_PATHS = [
  ".obsidian/plugins/obsidian-gdrive-sync/runtime-state.json",
  ".obsidian/plugins/obsidian-gdrive-sync/data.json",
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".trash/**",
  ".DS_Store"
];
function globMatch(text, pattern) {
  const re = "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\xA7DOUBLESTAR\xA7").replace(/\*/g, "[^/]*").replace(/§DOUBLESTAR§/g, ".*").replace(/\?/g, "[^/]") + "$";
  return new RegExp(re).test(text);
}
function matchesPattern(filePath, pattern) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filePath === prefix || filePath.indexOf(prefix + "/") === 0;
  }
  if (!pattern.includes("/") && pattern.includes("*")) {
    const fileName = filePath.split("/").pop() || "";
    return globMatch(fileName, pattern);
  }
  if (pattern.includes("*") || pattern.includes("?")) {
    return globMatch(filePath, pattern);
  }
  return filePath === pattern;
}
function isIgnoredPath(filePath, extraPatterns = []) {
  const patterns = BUILT_IN_IGNORE_PATHS.concat(extraPatterns || []);
  let ignored = false;
  patterns.forEach((pattern) => {
    if (!pattern) {
      return;
    }
    const negated = pattern.charAt(0) === "!";
    const candidate = negated ? pattern.slice(1) : pattern;
    if (matchesPattern(filePath, candidate)) {
      ignored = !negated;
    }
  });
  return ignored;
}

// src/sync/merge.ts
var import_crypto2 = __toESM(require("crypto"));

// src/utils/diff3.ts
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = new Array(n + 1);
  for (let i2 = 0; i2 <= n; i2 += 1) {
    dp[i2] = new Uint32Array(m + 1);
  }
  for (let i2 = 1; i2 <= n; i2 += 1) {
    for (let j2 = 1; j2 <= m; j2 += 1) {
      if (a[i2 - 1] === b[j2 - 1]) {
        dp[i2][j2] = dp[i2 - 1][j2 - 1] + 1;
      } else {
        dp[i2][j2] = dp[i2 - 1][j2] > dp[i2][j2 - 1] ? dp[i2 - 1][j2] : dp[i2][j2 - 1];
      }
    }
  }
  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  pairs.reverse();
  return pairs;
}
function computeEdits(base, target) {
  const pairs = lcs(base, target);
  const edits = [];
  let bi = 0;
  let ti = 0;
  for (const [pb, pt] of pairs) {
    if (bi < pb || ti < pt) {
      edits.push({
        baseStart: bi,
        baseEnd: pb,
        lines: target.slice(ti, pt)
      });
    }
    bi = pb + 1;
    ti = pt + 1;
  }
  if (bi < base.length || ti < target.length) {
    edits.push({
      baseStart: bi,
      baseEnd: base.length,
      lines: target.slice(ti)
    });
  }
  return edits;
}
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}
function pushOk(result, lines) {
  if (lines.length === 0) return;
  const last = result.length > 0 ? result[result.length - 1] : null;
  if (last && "ok" in last) {
    last.ok = last.ok.concat(lines);
  } else {
    result.push({ ok: lines.slice() });
  }
}
function mergeAdjacentOk(regions) {
  if (regions.length === 0) return regions;
  const out = [regions[0]];
  for (let i = 1; i < regions.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = regions[i];
    if ("ok" in prev && "ok" in cur) {
      prev.ok = prev.ok.concat(cur.ok);
    } else {
      out.push(cur);
    }
  }
  return out;
}
function diff3Merge(localLines, baseLines, remoteLines) {
  const localEdits = computeEdits(baseLines, localLines);
  const remoteEdits = computeEdits(baseLines, remoteLines);
  const result = [];
  let baseIdx = 0;
  let li = 0;
  let ri = 0;
  while (li < localEdits.length || ri < remoteEdits.length || baseIdx < baseLines.length) {
    const le = li < localEdits.length ? localEdits[li] : null;
    const re = ri < remoteEdits.length ? remoteEdits[ri] : null;
    const leStart = le ? le.baseStart : baseLines.length;
    const reStart = re ? re.baseStart : baseLines.length;
    const nextEdit = Math.min(leStart, reStart);
    if (baseIdx < nextEdit) {
      pushOk(result, baseLines.slice(baseIdx, nextEdit));
      baseIdx = nextEdit;
    }
    if (baseIdx >= baseLines.length && !le && !re) break;
    if (le && re && le.baseStart === re.baseStart) {
      const overlapEnd = Math.max(le.baseEnd, re.baseEnd);
      if (arraysEqual(le.lines, re.lines) && le.baseEnd === re.baseEnd) {
        pushOk(result, le.lines);
        baseIdx = le.baseEnd;
        li += 1;
        ri += 1;
      } else {
        let localConflictLines = le.lines.slice();
        let localEnd = le.baseEnd;
        li += 1;
        while (li < localEdits.length && localEdits[li].baseStart < overlapEnd) {
          if (localEdits[li].baseStart > localEnd) {
            localConflictLines = localConflictLines.concat(baseLines.slice(localEnd, localEdits[li].baseStart));
          }
          localConflictLines = localConflictLines.concat(localEdits[li].lines);
          localEnd = localEdits[li].baseEnd;
          li += 1;
        }
        let remoteConflictLines = re.lines.slice();
        let remoteEnd = re.baseEnd;
        ri += 1;
        while (ri < remoteEdits.length && remoteEdits[ri].baseStart < overlapEnd) {
          if (remoteEdits[ri].baseStart > remoteEnd) {
            remoteConflictLines = remoteConflictLines.concat(baseLines.slice(remoteEnd, remoteEdits[ri].baseStart));
          }
          remoteConflictLines = remoteConflictLines.concat(remoteEdits[ri].lines);
          remoteEnd = remoteEdits[ri].baseEnd;
          ri += 1;
        }
        result.push({
          conflict: {
            local: localConflictLines,
            base: baseLines.slice(le.baseStart, overlapEnd),
            remote: remoteConflictLines
          }
        });
        baseIdx = overlapEnd;
      }
    } else if (le && leStart <= reStart) {
      if (re && le.baseEnd > re.baseStart) {
        const overlapEnd = Math.max(le.baseEnd, re.baseEnd);
        result.push({
          conflict: {
            local: le.lines,
            base: baseLines.slice(le.baseStart, overlapEnd),
            remote: re.lines
          }
        });
        baseIdx = overlapEnd;
        li += 1;
        ri += 1;
      } else {
        pushOk(result, le.lines);
        baseIdx = le.baseEnd;
        li += 1;
      }
    } else if (re) {
      if (le && re.baseEnd > le.baseStart) {
        const overlapEnd = Math.max(le.baseEnd, re.baseEnd);
        result.push({
          conflict: {
            local: le.lines,
            base: baseLines.slice(re.baseStart, overlapEnd),
            remote: re.lines
          }
        });
        baseIdx = overlapEnd;
        li += 1;
        ri += 1;
      } else {
        pushOk(result, re.lines);
        baseIdx = re.baseEnd;
        ri += 1;
      }
    } else {
      if (baseIdx < baseLines.length) {
        pushOk(result, baseLines.slice(baseIdx));
        baseIdx = baseLines.length;
      }
      break;
    }
  }
  if (baseIdx < baseLines.length) {
    pushOk(result, baseLines.slice(baseIdx));
  }
  return mergeAdjacentOk(result);
}
function splitLines(text) {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
function merge3(localText, baseText, remoteText, options = {}) {
  const localLabel = options.localLabel || "local";
  const remoteLabel = options.remoteLabel || "remote";
  const localLines = splitLines(localText);
  const baseLines = splitLines(baseText);
  const remoteLines = splitLines(remoteText);
  const regions = diff3Merge(localLines, baseLines, remoteLines);
  const outputParts = [];
  let conflictCount = 0;
  for (const region of regions) {
    if ("ok" in region) {
      outputParts.push(region.ok.join("\n"));
    } else if ("conflict" in region) {
      conflictCount += 1;
      outputParts.push(
        "<<<<<<< " + localLabel + "\n" + region.conflict.local.join("\n") + "\n=======\n" + region.conflict.remote.join("\n") + "\n>>>>>>> " + remoteLabel
      );
    }
  }
  let merged = outputParts.join("\n");
  if (localText.length > 0 && localText[localText.length - 1] === "\n" || remoteText.length > 0 && remoteText[remoteText.length - 1] === "\n" || baseText.length > 0 && baseText[baseText.length - 1] === "\n") {
    if (merged.length > 0 && merged[merged.length - 1] !== "\n") {
      merged += "\n";
    }
  }
  return {
    merged,
    hasConflicts: conflictCount > 0,
    conflictCount
  };
}

// src/sync/merge.ts
function isBinaryPath(filePath) {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const binaryExts = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "pdf", "mp3", "mp4", "wav", "ogg", "zip", "tar", "gz", "7z", "rar", "woff", "woff2", "ttf", "otf", "eot"];
  return binaryExts.includes(ext);
}
function computeBlobHashSync(content) {
  return `sha256:${import_crypto2.default.createHash("sha256").update(String(content || "")).digest("hex")}`;
}
function mergeRemoteText(localContent, baseContent, remoteContent, remoteDevice) {
  const result = merge3(localContent, baseContent, remoteContent, {
    localLabel: "local",
    remoteLabel: `remote (${remoteDevice || "unknown"})`
  });
  return {
    ...result,
    blobHash: computeBlobHashSync(result.merged)
  };
}

// src/sync/pull.ts
var { updateCursorVector } = require_local_state();
async function pullRemoteOperations(input) {
  const remoteOperations = await input.backend.getPendingRemoteOperations(
    input.state.cursorByDevice,
    input.settings
  );
  await input.applyRemoteOperations(remoteOperations);
  const remoteHeads = await input.backend.getRemoteHeads();
  let state = updateCursorVector(input.state, remoteHeads);
  await input.stateStore.save(state);
  await input.backend.writeCursor(input.deviceId, state.cursorByDevice);
  return {
    state,
    remoteOperations
  };
}

// src/sync/manifest.ts
var { retryWithBackoff } = require_retry();
async function commitManifestPatch(input) {
  return retryWithBackoff(() => input.backend.commitManifest({
    deviceId: input.deviceId,
    files: [
      {
        path: input.entry.path,
        newPath: input.entry.newPath,
        op: input.entry.op,
        fileId: input.entry.fileId,
        blobHash: input.entry.blobHash,
        lastModifiedBy: input.deviceId,
        updatedAt: input.entry.ts,
        seq: input.entry.seq
      }
    ]
  }));
}

// src/sync/push.ts
var { retryWithBackoff: retryWithBackoff2 } = require_retry();
var { markOperationPublished, markOperationCommitted } = require_local_state();
async function pushOutboxEntry(input) {
  let state = input.state;
  const entry = input.entry;
  if (entry.status === "pending") {
    await retryWithBackoff2(() => input.backend.uploadBlob(entry));
    const publishResult = await retryWithBackoff2(
      () => input.backend.appendOperation({
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
    state = markOperationPublished(state, entry.seq, publishResult);
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

// src/sync/engine.ts
var {
  normalizeLocalState,
  reserveOperation,
  bindReservedOperation,
  updateTrackedFile,
  removeTrackedFile,
  pruneStaleReservedEntries
} = require_local_state();
var { coldStart, isColdStartState } = require_cold_start();
var { compact, computeCompactionFloor, shouldCompact } = require_compaction();
function defaultNow() {
  return Date.now();
}
function createFileId() {
  if (typeof import_crypto3.default.randomUUID === "function") {
    return import_crypto3.default.randomUUID();
  }
  return import_crypto3.default.randomBytes(16).toString("hex");
}
var SyncEngine = class {
  deviceId;
  backend;
  settingsStore;
  stateStore;
  now;
  runtimeStateStore;
  vaultAdapter;
  constructor(options) {
    this.deviceId = options.deviceId;
    this.backend = options.backend;
    this.settingsStore = options.settingsStore;
    this.stateStore = options.stateStore;
    this.now = options.now ?? defaultNow;
    this.runtimeStateStore = options.runtimeStateStore ?? null;
    this.vaultAdapter = options.vaultAdapter ?? null;
  }
  async trackLocalChange(change) {
    const settings = await this.loadSettings();
    if (isIgnoredPath(change.path, settings.ignorePatterns || [])) {
      return null;
    }
    let state = await this.loadState();
    const reservedState = reserveOperation(state);
    const reservedEntry = reservedState.outbox[reservedState.outbox.length - 1];
    const blobHash = change.blobHash || computeBlobHashSync(change.content);
    const existingFile = state.files[change.path];
    const parentBlobHash = existingFile && existingFile.blobHash;
    const fileId = change.fileId || existingFile && existingFile.fileId || createFileId();
    const nextVersion = change.op === "create" ? 1 : (existingFile && existingFile.version || 0) + 1;
    state = bindReservedOperation(reservedState, reservedEntry.seq, {
      device: this.deviceId,
      ts: this.now(),
      op: change.op,
      path: change.path,
      fileId,
      blobHash,
      parentBlobHashes: parentBlobHash ? [parentBlobHash] : [],
      content: change.content
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
  async trackRename(oldPath, newPath, content) {
    const settings = await this.loadSettings();
    if (isIgnoredPath(oldPath, settings.ignorePatterns || []) || isIgnoredPath(newPath, settings.ignorePatterns || [])) {
      return null;
    }
    let state = await this.loadState();
    const existingFile = state.files[oldPath];
    const reservedState = reserveOperation(state);
    const reservedEntry = reservedState.outbox[reservedState.outbox.length - 1];
    const fileId = existingFile && existingFile.fileId || createFileId();
    const blobHash = computeBlobHashSync(content);
    const parentBlobHash = existingFile && existingFile.blobHash;
    state = bindReservedOperation(reservedState, reservedEntry.seq, {
      device: this.deviceId,
      ts: this.now(),
      op: "rename",
      path: oldPath,
      newPath,
      fileId,
      blobHash,
      parentBlobHashes: parentBlobHash ? [parentBlobHash] : [],
      content
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
  async syncNow() {
    let state = await this.loadState();
    const settings = await this.loadSettings();
    const changedPaths = /* @__PURE__ */ new Set();
    const deletedPaths = /* @__PURE__ */ new Set();
    const renamedFiles = [];
    state = pruneStaleReservedEntries(state);
    await this.stateStore.save(state);
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
      }
    }
    let remoteOperations = [];
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
      const previousSnapshotMeta = settings.snapshotPublishMode === "generations" && typeof this.backend.readSnapshotMeta === "function" ? await this.backend.readSnapshotMeta(settings) : null;
      await this.backend.publishSnapshot({
        snapshotPublishMode: settings.snapshotPublishMode,
        nextGenerationId: `gen-${this.now()}`,
        previousGenerationId: previousSnapshotMeta && previousSnapshotMeta.generationId,
        snapshotSeqs: state.cursorByDevice,
        previousFiles: Object.keys(state.files || {}).map((filePath) => `vault/${filePath}`),
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
  async applyRemoteOperations(entries) {
    const paths = (entries || []).map((entry) => entry.newPath || entry.path);
    if (this.runtimeStateStore) {
      this.runtimeStateStore.beginRemoteApply(paths);
    }
    try {
      let state = await this.loadState();
      if (this.vaultAdapter && typeof this.vaultAdapter.applyRemoteOperation === "function") {
        for (const entry of entries || []) {
          const hydratedEntry = await this.hydrateRemoteEntry(entry);
          const localFile = state.files[hydratedEntry.path];
          const localRenameFile = hydratedEntry.fileId ? this.findTrackedFileById(state, hydratedEntry.fileId) : null;
          if ((hydratedEntry.op === "modify" || hydratedEntry.op === "create") && localFile && localFile.blobHash && localFile.blobHash !== hydratedEntry.blobHash) {
            const localChangedFromBase = hydratedEntry.parentBlobHashes && hydratedEntry.parentBlobHashes.length > 0 && localFile.blobHash !== hydratedEntry.parentBlobHashes[0];
            if (localChangedFromBase) {
              const modifyResolution = await this.resolveModifyConflict(state, localFile, hydratedEntry);
              const existingFile = state.files[hydratedEntry.path] || {};
              state = updateTrackedFile(state, {
                path: hydratedEntry.path,
                fileId: hydratedEntry.fileId || existingFile.fileId || createFileId(),
                version: hydratedEntry.version || (existingFile.version || 0) + 1,
                blobHash: modifyResolution && modifyResolution.blobHash || hydratedEntry.blobHash,
                parentBlobHashes: hydratedEntry.parentBlobHashes || [],
                content: modifyResolution && modifyResolution.content || hydratedEntry.content,
                lastModifiedBy: modifyResolution && modifyResolution.lastModifiedBy || hydratedEntry.device,
                updatedAt: modifyResolution && modifyResolution.updatedAt || hydratedEntry.ts || this.now()
              });
              continue;
            }
          }
          if (hydratedEntry.op === "delete" && localFile && localFile.blobHash) {
            const remoteParent = hydratedEntry.parentBlobHashes && hydratedEntry.parentBlobHashes[0];
            if (remoteParent && localFile.blobHash !== remoteParent) {
              await this.resolveDeleteModifyConflict(localFile, hydratedEntry);
              continue;
            }
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
                blobHash: renameResolution && renameResolution.blobHash || hydratedEntry.blobHash,
                parentBlobHashes: hydratedEntry.parentBlobHashes || [],
                content: renameResolution && renameResolution.content || hydratedEntry.content,
                lastModifiedBy: renameResolution && renameResolution.lastModifiedBy || hydratedEntry.device,
                updatedAt: renameResolution && renameResolution.updatedAt || hydratedEntry.ts || this.now()
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
              version: hydratedEntry.version || (existingFile.version || 0) + 1,
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
  async findCommonAncestor(localFile, remoteOp) {
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
    const ancestorMap = {};
    for (const op of ops) {
      if (op.blobHash) {
        ancestorMap[op.blobHash] = op.parentBlobHashes || [];
      }
    }
    let localQueue = localParents.slice();
    const localVisited = {};
    let remoteQueue = remoteParents.slice();
    const remoteVisited = {};
    for (let depth = 0; depth < 100; depth += 1) {
      const nextLocalQueue = [];
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
      const nextRemoteQueue = [];
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
  async resolveModifyConflict(state, localFile, remoteOp) {
    if (isBinaryPath(remoteOp.path)) {
      const ext = remoteOp.path.split(".").pop();
      const baseName = remoteOp.path.slice(0, remoteOp.path.length - ext.length - 1);
      const conflictPath = `${baseName}.conflict-${remoteOp.device || "unknown"}-${remoteOp.ts || this.now()}.${ext}`;
      if (this.vaultAdapter && typeof this.vaultAdapter.writeConflictCopy === "function") {
        await this.vaultAdapter.writeConflictCopy(conflictPath, localFile.content || "");
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
    }
    const localContent = localFile.content || "";
    let remoteContent = "";
    try {
      remoteContent = await this.backend.fetchBlob(remoteOp.blobHash);
    } catch {
      remoteContent = "";
    }
    const result = mergeRemoteText(localContent, baseContent, remoteContent, remoteOp.device || "unknown");
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
  async resolveDeleteModifyConflict(localFile, remoteOp) {
    let conflictPath = remoteOp.path.replace(/\.md$/, ".deleted-conflict.md");
    if (conflictPath === remoteOp.path) {
      conflictPath = `${remoteOp.path}.deleted-conflict`;
    }
    if (this.vaultAdapter && typeof this.vaultAdapter.writeConflictCopy === "function") {
      await this.vaultAdapter.writeConflictCopy(conflictPath, localFile.content || "");
    }
  }
  async resolveRenameConflict(localFile, remoteOp) {
    const ext = remoteOp.newPath.split(".").pop() || "";
    const baseName = remoteOp.newPath.slice(0, remoteOp.newPath.length - ext.length - 1);
    const conflictPath = `${baseName}.conflict-${this.deviceId}-${this.now()}.${ext}`;
    await this.vaultAdapter.applyRemoteOperation(remoteOp);
    if (this.vaultAdapter && typeof this.vaultAdapter.writeConflictCopy === "function" && localFile.content) {
      await this.vaultAdapter.writeConflictCopy(conflictPath, localFile.content);
    }
  }
  async resolveRenameModifyConflict(localFile, remoteOp) {
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
      const result = mergeRemoteText(localContent, baseContent, remoteContent, remoteOp.device || "unknown");
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
  async loadSettings() {
    return normalizeSettings(await this.settingsStore.load());
  }
  async loadState() {
    return normalizeLocalState(await this.stateStore.load());
  }
  findTrackedFileById(state, fileId) {
    if (!fileId) {
      return null;
    }
    const paths = Object.keys(state && state.files || {});
    for (const candidatePath of paths) {
      const candidate = state.files[candidatePath];
      if (candidate && candidate.fileId === fileId) {
        return candidate;
      }
    }
    return null;
  }
  async hydrateRemoteEntry(entry) {
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
  async maybeCompact(state, settings) {
    if (typeof this.backend.readOperationLog !== "function" || typeof this.backend.writeArchiveLog !== "function" || typeof this.backend.overwriteOperationLog !== "function" || typeof this.backend.listCursorVectors !== "function" || typeof this.backend.readSnapshotMeta !== "function") {
      return null;
    }
    const operationLog = await this.backend.readOperationLog(this.deviceId);
    if (!shouldCompact(operationLog.length, 1e3)) {
      return null;
    }
    const snapshotMeta = await this.backend.readSnapshotMeta(settings);
    const allCursors = await this.backend.listCursorVectors();
    const floor = computeCompactionFloor(allCursors, snapshotMeta && snapshotMeta.snapshotSeqs, this.deviceId);
    if (!floor || floor <= 0) {
      return null;
    }
    return compact({
      backend: this.backend,
      deviceId: this.deviceId,
      floor
    });
  }
  async shouldColdStart(state, settings) {
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
    return typeof this.backend.readSnapshotMeta === "function" && typeof this.backend.downloadSnapshot === "function" && typeof this.backend.readManifest === "function";
  }
};

// src/utils/device.ts
var import_crypto4 = __toESM(require("crypto"));
function createDeviceId(prefix = "device") {
  if (typeof import_crypto4.default.randomUUID === "function") {
    return prefix + "-" + import_crypto4.default.randomUUID();
  }
  return prefix + "-" + import_crypto4.default.randomBytes(8).toString("hex");
}

// src/vault/watcher.ts
function createVaultWatcher(deps) {
  const handleTrackedChange = async (change) => {
    if (deps.shouldSuppressRemoteApplyEvent(change.path, Date.now())) {
      return;
    }
    const content = change.op === "delete" ? "" : await deps.vaultAdapter.readChangeContent(change.path);
    await deps.syncEngine.trackLocalChange({
      path: change.path,
      op: change.op,
      content
    });
    deps.scheduleSync();
  };
  deps.registerEvent(deps.app.vault.on("create", (file) => {
    if (file && file.path) {
      void handleTrackedChange({ path: file.path, op: "create" });
    }
  }));
  deps.registerEvent(deps.app.vault.on("modify", (file) => {
    if (file && file.path) {
      void handleTrackedChange({ path: file.path, op: "modify" });
    }
  }));
  deps.registerEvent(deps.app.vault.on("delete", (file) => {
    if (file && file.path) {
      void handleTrackedChange({ path: file.path, op: "delete" });
    }
  }));
  deps.registerEvent(deps.app.vault.on("rename", async (file, oldPath) => {
    if (!file || !file.path || !oldPath) return;
    if (deps.shouldSuppressRemoteApplyEvent(file.path, Date.now())) return;
    const content = await deps.vaultAdapter.readChangeContent(file.path);
    await deps.syncEngine.trackRename(oldPath, file.path, content);
    deps.scheduleSync();
  }));
}

// src/main.ts
var obsidian2 = require("obsidian");
var { RuntimeStateStore } = require_runtime_state();
var { GOOGLE_DRIVE_BACKEND_CAPABILITIES } = require_provider();
var {
  loadPluginData,
  savePluginData,
  createSettingsStore,
  createLocalStateStore
} = require_plugin_data_store();
var { GenerationPublisher } = require_generation_publisher();
var { GoogleDriveBackend } = require_google_drive_backend();
var { ObsidianVaultAdapter } = require_obsidian_vault_adapter();
var { updateChangesPageToken } = require_local_state();
function createObsidianFetch(obsidianModule) {
  return async function obsidianFetch(url, init) {
    if (typeof obsidianModule.requestUrl !== "function") {
      return globalThis.fetch(url, init);
    }
    const options = {
      url,
      method: init && init.method || "GET",
      headers: init && init.headers ? { ...init.headers } : {},
      body: init && init.body ? init.body : void 0,
      throw: false
    };
    const result = await obsidianModule.requestUrl(options);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: {
        get(name) {
          const lower = name.toLowerCase();
          const headers = result.headers || {};
          for (const key in headers) {
            if (key.toLowerCase() === lower) return headers[key];
          }
          return null;
        }
      },
      text() {
        return Promise.resolve(typeof result.text === "string" ? result.text : JSON.stringify(result.json));
      },
      json() {
        return Promise.resolve(result.json);
      },
      arrayBuffer() {
        if (result.arrayBuffer) {
          return Promise.resolve(result.arrayBuffer);
        }
        return Promise.resolve(Buffer.from(typeof result.text === "string" ? result.text : JSON.stringify(result.json)));
      }
    };
  };
}
var ObsidianGDriveSyncPlugin = class extends obsidian2.Plugin {
  settings;
  localState;
  settingsStore;
  stateStore;
  runtimeStateStore;
  driveClient;
  generationPublisher;
  backend;
  vaultAdapter;
  syncEngine;
  debouncedSyncNow;
  pollIntervalHandle;
  syncInFlight = false;
  async onload() {
    const rawData = await loadPluginData(this);
    this.settings = normalizeSettings(rawData.settings);
    this.localState = rawData.localState || {};
    if (!this.localState.deviceId) {
      this.localState.deviceId = createDeviceId("mac");
      await savePluginData(this, {
        settings: this.settings,
        localState: this.localState
      });
    }
    this.settingsStore = createSettingsStore(this);
    this.stateStore = createLocalStateStore(this);
    this.runtimeStateStore = new RuntimeStateStore({
      statePath: this.getRuntimeStatePath(),
      cooldownMs: this.settings.remoteApplyCooldownMs
    });
    this.runtimeStateStore.recoverIfStale();
    this.driveClient = new GoogleDriveClient({
      fetchImpl: createObsidianFetch(obsidian2),
      getAccessToken: () => fetchAccessToken(this.settingsStore, createObsidianFetch(obsidian2)),
      rootFolderName: this.settings.rootFolderName,
      vaultName: this.app.vault.getName()
    });
    this.generationPublisher = new GenerationPublisher({
      driveClient: this.driveClient,
      generationRetentionCount: this.settings.generationRetentionCount
    });
    this.backend = new GoogleDriveBackend({
      driveClient: this.driveClient,
      generationPublisher: this.generationPublisher
    });
    this.vaultAdapter = new ObsidianVaultAdapter({
      app: this.app,
      backend: this.backend
    });
    this.syncEngine = new SyncEngine({
      deviceId: this.localState.deviceId,
      backend: this.backend,
      settingsStore: this.settingsStore,
      stateStore: this.stateStore,
      runtimeStateStore: this.runtimeStateStore,
      vaultAdapter: this.vaultAdapter
    });
    this.addSettingTab(new ObsidianGDriveSyncSettingTab(this.app, this));
    this.addCommand({
      id: "show-runtime-state-path",
      name: "Show runtime state path",
      callback: () => {
        new obsidian2.Notice(this.getRuntimeStatePath());
      }
    });
    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        await this.runSyncNow();
      }
    });
    this.registerVaultEvents();
    this.registerForegroundPollingHooks();
    this.startPolling();
    this.runInitialSyncIfNeeded().catch((error) => {
      console.warn("obsidian-gdrive-sync: initial sync failed", error);
    });
  }
  async onunload() {
    this.stopPolling();
    await this.saveSettings();
  }
  getRuntimeStatePath() {
    return this.app.vault.configDir + "/plugins/" + this.manifest.id + "/runtime-state.json";
  }
  getBuiltInIgnorePaths() {
    return BUILT_IN_IGNORE_PATHS.slice();
  }
  getBackendCapabilities() {
    return GOOGLE_DRIVE_BACKEND_CAPABILITIES;
  }
  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    await savePluginData(this, {
      settings: this.settings,
      localState: this.localState
    });
  }
  shouldSuppressRemoteApplyEvent(filePath, atTime) {
    return this.runtimeStateStore.shouldSuppressPath(filePath, atTime);
  }
  registerVaultEvents() {
    createVaultWatcher({
      app: this.app,
      vaultAdapter: this.vaultAdapter,
      syncEngine: this.syncEngine,
      registerEvent: this.registerEvent.bind(this),
      shouldSuppressRemoteApplyEvent: this.shouldSuppressRemoteApplyEvent.bind(this),
      scheduleSync: this.scheduleSync.bind(this)
    });
  }
  scheduleSync() {
    if (!this.debouncedSyncNow) {
      this.debouncedSyncNow = obsidian2.debounce(
        () => this.runSyncNow().catch((error) => new obsidian2.Notice(String(error))),
        this.settings.pushDebounceMs,
        true
      );
    }
    this.debouncedSyncNow();
  }
  startPolling() {
    this.stopPolling();
    if (!this.shouldAutoPoll()) {
      return;
    }
    this.pollIntervalHandle = window.setInterval(() => {
      this.pollForChanges().catch((error) => new obsidian2.Notice(String(error)));
    }, this.settings.pollIntervalSeconds * 1e3);
  }
  stopPolling() {
    if (this.pollIntervalHandle) {
      window.clearInterval(this.pollIntervalHandle);
      this.pollIntervalHandle = null;
    }
  }
  async pollForChanges() {
    if (this.syncInFlight) return;
    try {
      let state = await this.stateStore.load();
      if (!state.changesPageToken) {
        const token = await this.backend.getStartPageToken();
        state = updateChangesPageToken(state, token);
        await this.stateStore.save(state);
        if (this.isColdStartCandidate(state)) {
          await this.runSyncNow();
          return;
        }
      }
      const result = await this.backend.listChanges(state.changesPageToken);
      const hasChanges = (result.changes || []).some((change) => {
        if (change.removed) {
          return true;
        }
        const props = change.file && change.file.appProperties;
        return props && props.vault === this.app.vault.getName();
      });
      if (result.newStartPageToken || result.nextPageToken) {
        state = await this.stateStore.load();
        state = updateChangesPageToken(state, result.newStartPageToken || result.nextPageToken);
        await this.stateStore.save(state);
      }
      if (hasChanges) {
        await this.runSyncNow();
      }
    } catch (error) {
      console.warn("obsidian-gdrive-sync: poll failed, falling back to full sync", error);
      await this.runSyncNow();
    }
  }
  async runSyncNow() {
    if (this.syncInFlight) {
      return;
    }
    this.syncInFlight = true;
    try {
      await this.syncEngine.syncNow();
    } finally {
      this.syncInFlight = false;
    }
  }
  async runInitialSyncIfNeeded() {
    if (!this.settings.enableAutoSync) {
      return;
    }
    const state = await this.stateStore.load();
    if (this.isColdStartCandidate(state)) {
      await this.runSyncNow();
    }
  }
  isColdStartCandidate(state) {
    const current = state || {};
    return Object.keys(current.cursorByDevice || {}).length === 0 && Object.keys(current.files || {}).length === 0;
  }
  shouldAutoPoll() {
    if (!this.settings.enableAutoSync || this.settings.pollIntervalSeconds <= 0) {
      return false;
    }
    if (this.settings.pollMode === "manual") {
      return false;
    }
    if (this.settings.pollMode === "always") {
      return true;
    }
    if (typeof document === "undefined") {
      return true;
    }
    return document.visibilityState !== "hidden";
  }
  registerForegroundPollingHooks() {
    if (typeof document !== "undefined") {
      this.registerDomEvent(document, "visibilitychange", () => {
        this.startPolling();
        if (this.settings.pollMode === "foreground" && document.visibilityState !== "hidden") {
          this.runSyncNow().catch((error) => new obsidian2.Notice(String(error)));
        }
      });
    }
    if (typeof window !== "undefined") {
      this.registerDomEvent(window, "focus", () => {
        if (this.settings.pollMode === "foreground") {
          this.startPolling();
          this.runSyncNow().catch((error) => new obsidian2.Notice(String(error)));
        }
      });
    }
  }
  async startGoogleAuth() {
    if (!this.settings.googleClientId) {
      throw new Error("Google client ID is required before starting OAuth");
    }
    const tokenSet = await startOAuthFlow({
      clientId: this.settings.googleClientId,
      clientSecret: this.settings.googleClientSecret,
      tokenEndpoint: this.settings.googleTokenEndpoint,
      fetchImpl: createObsidianFetch(obsidian2)
    });
    this.settings.googleAccessToken = tokenSet.accessToken;
    this.settings.googleAccessTokenExpiresAt = tokenSet.expiresAt;
    if (tokenSet.refreshToken) {
      this.settings.googleRefreshToken = tokenSet.refreshToken;
    }
    await this.saveSettings();
    new obsidian2.Notice("Google Drive authentication complete.");
  }
};
module.exports = ObsidianGDriveSyncPlugin;
