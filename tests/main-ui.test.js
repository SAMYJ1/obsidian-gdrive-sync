const assert = require("assert");
const PluginClass = require("../dist/main");

module.exports = (async function () {
  const plugin = new PluginClass();

  let runSyncNowCalls = 0;
  let pollForChangesCalls = 0;

  plugin.stateStore = {
    async load() {
      return {
        outbox: [],
        cursorByDevice: {
          "device-a": 1
        },
        files: {
          "note.md": {
            path: "note.md"
          }
        }
      };
    }
  };
  plugin.runSyncNow = async () => {
    runSyncNowCalls += 1;
  };
  plugin.pollForChanges = async () => {
    pollForChangesCalls += 1;
  };

  await plugin.handleForegroundSyncTrigger();

  assert.strictEqual(runSyncNowCalls, 0, "foreground entry should not force a full sync when no local outbox is pending");
  assert.strictEqual(pollForChangesCalls, 1, "foreground entry should poll for remote changes when there are no local pending ops");

  plugin.stateStore = {
    async load() {
      return {
        outbox: [
          { seq: 1, status: "pending", path: "note.md", op: "modify" }
        ],
        cursorByDevice: {},
        files: {}
      };
    }
  };

  await plugin.handleForegroundSyncTrigger();

  assert.strictEqual(runSyncNowCalls, 1, "foreground entry should run a full sync when local outbox entries are pending");

  runSyncNowCalls = 0;
  pollForChangesCalls = 0;
  plugin.settings = { enableAutoSync: true };
  plugin.isColdStartCandidate = () => false;
  plugin.stateStore = {
    async load() {
      return {
        outbox: [],
        cursorByDevice: {
          "device-a": 1
        },
        files: {
          "note.md": {
            path: "note.md"
          }
        }
      };
    }
  };

  await plugin.runInitialSyncIfNeeded();

  assert.strictEqual(runSyncNowCalls, 0, "initial load should not force a full sync when local state is already initialized");
  assert.strictEqual(pollForChangesCalls, 1, "initial load should silently poll for remote updates before deciding whether to sync");

  const classSet = new Set();
  plugin.ribbonIconEl = {
    addClass(name) { classSet.add(name); },
    removeClass(name) { classSet.delete(name); }
  };
  plugin.statusBarEl = {
    text: "",
    setText(value) { this.text = value; }
  };

  plugin.syncPhase = "pushing";
  plugin.updateStatusBar();
  assert(classSet.has("obsidian-gdrive-sync-is-syncing"), "ribbon icon should gain syncing class while sync is active");

  plugin.syncPhase = "idle";
  plugin.updateStatusBar();
  assert(!classSet.has("obsidian-gdrive-sync-is-syncing"), "ribbon icon should drop syncing class after sync finishes");
})();
