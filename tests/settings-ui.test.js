const assert = require("assert");
const fs = require("fs");
const path = require("path");

const settingsSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "settings.ts"),
  "utf8"
);

assert(
  !settingsSource.includes("Google access token"),
  "settings UI should not expose the Google access token field directly"
);

assert(
  !settingsSource.includes("Google refresh token"),
  "settings UI should not expose the Google refresh token field directly"
);

assert(
  settingsSource.includes("Sync now"),
  "settings UI should provide a visible Sync now action"
);

assert(
  settingsSource.includes("Advanced / Experimental"),
  "settings UI should separate advanced settings from the main tab"
);
