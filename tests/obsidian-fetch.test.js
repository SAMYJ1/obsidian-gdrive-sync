const assert = require("assert");
const { createObsidianFetch } = require("../dist/utils/obsidian-fetch");

module.exports = (async function () {
  let nativeFetchCalls = 0;
  let requestUrlCalls = 0;

  const originalFetch = global.fetch;
  global.fetch = async () => {
    nativeFetchCalls += 1;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async text() { return ""; },
      async json() { return {}; },
      async arrayBuffer() { return new ArrayBuffer(0); }
    };
  };

  try {
    const fetchImpl = createObsidianFetch({
      async requestUrl() {
        requestUrlCalls += 1;
        return {
          status: 200,
          headers: {},
          text: "",
          json: {}
        };
      }
    });

    await fetchImpl("https://example.com/upload", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/related; boundary=test"
      },
      body: Buffer.from("payload")
    });

    assert.strictEqual(nativeFetchCalls, 1, "binary or multipart uploads should prefer native fetch");
    assert.strictEqual(requestUrlCalls, 0, "requestUrl should not handle multipart buffer uploads");
  } finally {
    global.fetch = originalFetch;
  }
})();
