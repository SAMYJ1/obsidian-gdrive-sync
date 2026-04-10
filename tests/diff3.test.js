const assert = require("assert");
const { merge3 } = require("../dist/utils/diff3");

// Test 1: No changes — all three identical
var result1 = merge3("line1\nline2\nline3\n", "line1\nline2\nline3\n", "line1\nline2\nline3\n");
assert.strictEqual(result1.hasConflicts, false, "identical files should have no conflicts");
assert.strictEqual(result1.merged, "line1\nline2\nline3\n", "identical files should merge cleanly");

// Test 2: Only local changed
var result2 = merge3("line1\nLOCAL\nline3\n", "line1\nline2\nline3\n", "line1\nline2\nline3\n");
assert.strictEqual(result2.hasConflicts, false, "local-only changes should merge cleanly");
assert.strictEqual(result2.merged, "line1\nLOCAL\nline3\n");

// Test 3: Only remote changed
var result3 = merge3("line1\nline2\nline3\n", "line1\nline2\nline3\n", "line1\nREMOTE\nline3\n");
assert.strictEqual(result3.hasConflicts, false, "remote-only changes should merge cleanly");
assert.strictEqual(result3.merged, "line1\nREMOTE\nline3\n");

// Test 4: Both changed different lines — clean merge
var result4 = merge3("LOCAL\nline2\nline3\n", "line1\nline2\nline3\n", "line1\nline2\nREMOTE\n");
assert.strictEqual(result4.hasConflicts, false, "non-overlapping changes should merge cleanly");
assert.strictEqual(result4.merged, "LOCAL\nline2\nREMOTE\n");

// Test 5: Both changed same line — conflict
var result5 = merge3("line1\nLOCAL\nline3\n", "line1\nline2\nline3\n", "line1\nREMOTE\nline3\n");
assert.strictEqual(result5.hasConflicts, true, "overlapping changes should produce conflicts");
assert.strictEqual(result5.conflictCount, 1);
assert(result5.merged.indexOf("<<<<<<< local") !== -1, "should contain local conflict marker");
assert(result5.merged.indexOf(">>>>>>> remote") !== -1, "should contain remote conflict marker");

// Test 6: Both changed identically — no conflict
var result6 = merge3("line1\nSAME\nline3\n", "line1\nline2\nline3\n", "line1\nSAME\nline3\n");
assert.strictEqual(result6.hasConflicts, false, "identical changes should not conflict");
assert.strictEqual(result6.merged, "line1\nSAME\nline3\n");

// Test 7: Empty base (new file on both sides)
var result7 = merge3("local content\n", "", "remote content\n");
assert.strictEqual(result7.hasConflicts, true, "both creating content from empty base should conflict");

// Test 8: Custom labels
var result8 = merge3("A\n", "B\n", "C\n", { localLabel: "my-mac", remoteLabel: "office-mac (device-123)" });
assert(result8.merged.indexOf("<<<<<<< my-mac") !== -1, "should use custom local label");
assert(result8.merged.indexOf(">>>>>>> office-mac (device-123)") !== -1, "should use custom remote label");
