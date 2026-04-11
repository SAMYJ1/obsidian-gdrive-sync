const assert = require("assert");
const {
  DEFAULT_LOCAL_STATE,
  normalizeLocalState,
  reserveOperation,
  bindReservedOperation,
  markOperationPublished,
  markOperationCommitted,
  updateCursorVector,
  hasPendingOutboxEntries
} = require("../dist/sync/state");

let state = normalizeLocalState();
assert.deepStrictEqual(
  state,
  DEFAULT_LOCAL_STATE,
  "normalizeLocalState should populate default sync state"
);

state = reserveOperation(state);
assert.strictEqual(state.nextSeq, 2, "reserveOperation should increment nextSeq");
assert.strictEqual(state.outbox[0].status, "reserved", "a reserved outbox entry should be created");

state = bindReservedOperation(state, 1, {
  op: "modify",
  path: "20 Wiki/Topics/example.md",
  blobHash: "sha256-1"
});
assert.strictEqual(state.outbox[0].status, "pending", "bound operation should move to pending");
assert.strictEqual(state.outbox[0].path, "20 Wiki/Topics/example.md");

state = markOperationPublished(state, 1, {
  remoteOpLogId: "remote-op-1"
});
assert.strictEqual(state.outbox[0].status, "published", "operation should be publishable");
assert.strictEqual(state.outbox[0].remoteOpLogId, "remote-op-1");

state = markOperationCommitted(state, 1);
assert.deepStrictEqual(state.outbox, [], "committed operations should be pruned from the outbox");

state = updateCursorVector(state, {
  "device-a": 10,
  "device-b": 5
});
assert.deepStrictEqual(
  state.cursorByDevice,
  {
    "device-a": 10,
    "device-b": 5
  },
  "cursor vectors should be replaceable in one step"
);

assert.strictEqual(
  hasPendingOutboxEntries(state),
  false,
  "state without pending or published outbox entries should not trigger a foreground sync"
);

const pendingState = normalizeLocalState({
  outbox: [
    { seq: 2, status: "pending", op: "modify", path: "note.md" }
  ]
});
assert.strictEqual(
  hasPendingOutboxEntries(pendingState),
  true,
  "pending outbox entries should be detected"
);

let binaryState = normalizeLocalState({
  outbox: [
    {
      seq: 9,
      status: "pending",
      op: "create",
      path: "attachments/image.png",
      content: new Uint8Array([137, 80, 78, 71])
    }
  ],
  files: {
    "attachments/image.png": {
      path: "attachments/image.png",
      content: new Uint8Array([137, 80, 78, 71])
    }
  }
});
binaryState = markOperationPublished(binaryState, 9, { remoteOpLogId: "remote-op-9" });
binaryState = updateCursorVector(binaryState, { "device-a": 11 });
assert.ok(
  binaryState.outbox[0].content instanceof Uint8Array,
  "outbox binary content should remain a Uint8Array after state mutations"
);
assert.ok(
  binaryState.files["attachments/image.png"].content instanceof Uint8Array,
  "tracked file binary content should remain a Uint8Array after state mutations"
);
