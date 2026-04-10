const assert = require("assert");
const {
  GOOGLE_DRIVE_BACKEND_CAPABILITIES,
  supportsSnapshotMode
} = require("../dist/drive/provider");

assert.strictEqual(
  GOOGLE_DRIVE_BACKEND_CAPABILITIES.publicProviderApi,
  false,
  "the provider seam should remain internal in v1"
);

assert.strictEqual(
  supportsSnapshotMode(GOOGLE_DRIVE_BACKEND_CAPABILITIES, "inplace"),
  true,
  "Google Drive backend should support inplace mode"
);

assert.strictEqual(
  supportsSnapshotMode(GOOGLE_DRIVE_BACKEND_CAPABILITIES, "generations"),
  true,
  "Google Drive backend should support generations mode"
);
