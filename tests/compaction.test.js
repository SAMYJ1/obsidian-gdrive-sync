const assert = require("assert");
const {
  shouldCompact,
  computeCompactionFloor,
  compact
} = require("../dist/sync/engine");

module.exports = (async function() {
  assert.strictEqual(shouldCompact(999), false, "compaction should stay idle below the threshold");
  assert.strictEqual(shouldCompact(1001), true, "compaction should trigger above the threshold");

  assert.strictEqual(
    computeCompactionFloor(
      [
        { "device-a": 120 },
        { "device-a": 80 },
        { "device-a": 95 }
      ],
      { "device-a": 90 },
      "device-a"
    ),
    80,
    "compaction floor should be the minimum active cursor when it is below snapshot coverage"
  );

  assert.strictEqual(
    computeCompactionFloor(
      [
        { "device-a": 120 },
        { "device-a": 110 }
      ],
      { "device-a": 90 },
      "device-a"
    ),
    90,
    "compaction floor should not advance beyond the published snapshot coverage"
  );

  const writes = [];
  await compact({
    backend: {
      async readOperationLog(deviceId) {
        assert.strictEqual(deviceId, "device-a");
        return [
          { device: "device-a", seq: 1 },
          { device: "device-a", seq: 2 },
          { device: "device-a", seq: 3 }
        ];
      },
      async writeArchiveLog(deviceId, startSeq, endSeq, entries) {
        writes.push(["archive", deviceId, startSeq, endSeq, entries.map((entry) => entry.seq)]);
      },
      async overwriteOperationLog(deviceId, entries) {
        writes.push(["overwrite", deviceId, entries.map((entry) => entry.seq)]);
      }
    },
    deviceId: "device-a",
    floor: 3
  });

  assert.deepStrictEqual(
    writes,
    [
      ["archive", "device-a", 1, 2, [1, 2]],
      ["overwrite", "device-a", [3]]
    ],
    "compaction should archive entries below the floor and keep active entries in the live log"
  );
})();
