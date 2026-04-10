const fs = require("fs");
const path = require("path");
const Module = require("module");

// Register obsidian mock so compiled TypeScript modules can be required in tests
const obsidianMock = {
  Plugin: class Plugin {
    addRibbonIcon() { return { addClass() {} }; }
    addStatusBarItem() { return { setText() {} }; }
  },
  PluginSettingTab: class PluginSettingTab { constructor() {} },
  Setting: class Setting {
    constructor() { return new Proxy(this, { get: () => () => this }); }
  },
  Notice: class Notice { constructor() {} },
  TFile: class TFile {},
  debounce: (fn) => fn,
  requestUrl: async () => ({ status: 200, headers: {}, text: "", json: {} })
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "obsidian") {
    return "obsidian";
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.cache["obsidian"] = {
  id: "obsidian",
  filename: "obsidian",
  loaded: true,
  children: [],
  paths: [],
  exports: obsidianMock
};


async function main() {
  const testsDir = __dirname;
  const files = fs
    .readdirSync(testsDir)
    .filter((file) => file.endsWith(".test.js"))
    .sort();

  let failures = 0;

  for (const file of files) {
    const filePath = path.join(testsDir, file);
    try {
      const result = require(filePath);
      if (result && typeof result.then === "function") {
        await result;
      }
      console.log("PASS", file);
    } catch (error) {
      failures += 1;
      console.error("FAIL", file);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    console.error("\n%s test file(s) failed.", failures);
  } else {
    console.log("\nAll tests passed.");
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
