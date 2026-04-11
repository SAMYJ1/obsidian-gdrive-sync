const assert = require("assert");
const {
  prepareLocalStateForStorage,
  restoreLocalStateFromStorage
} = require("../dist/sync/local-state-serialization");

module.exports = (async function() {
  const binary = new Uint8Array([1, 2, 3, 4]);
  const state = {
    outbox: [
      { seq: 1, content: binary }
    ],
    files: {
      "attachments/image.png": {
        path: "attachments/image.png",
        content: binary
      }
    }
  };

  const serialized = prepareLocalStateForStorage(state);
  assert.strictEqual(typeof serialized.outbox[0].content, "string");
  assert.strictEqual(serialized.outbox[0]._contentEncoding, "base64");
  assert.strictEqual(typeof serialized.files["attachments/image.png"].content, "string");
  assert.strictEqual(serialized.files["attachments/image.png"]._contentEncoding, "base64");

  const restored = restoreLocalStateFromStorage(serialized);
  assert(restored.outbox[0].content instanceof Uint8Array);
  assert(restored.files["attachments/image.png"].content instanceof Uint8Array);
  assert.deepStrictEqual(Array.from(restored.outbox[0].content), [1, 2, 3, 4]);
  assert.deepStrictEqual(Array.from(restored.files["attachments/image.png"].content), [1, 2, 3, 4]);

  const legacy = {
    files: {
      "attachments/legacy.png": {
        path: "attachments/legacy.png",
        content: { 0: 9, 1: 8, 2: 7 }
      }
    }
  };
  const restoredLegacy = restoreLocalStateFromStorage(legacy);
  assert(restoredLegacy.files["attachments/legacy.png"].content instanceof Uint8Array);
  assert.deepStrictEqual(Array.from(restoredLegacy.files["attachments/legacy.png"].content), [9, 8, 7]);
})();
