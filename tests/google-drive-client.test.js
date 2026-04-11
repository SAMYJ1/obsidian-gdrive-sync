const assert = require("assert");
const { GoogleDriveClient } = require("../dist/drive/client");

function createJsonResponse(payload, extra) {
  const headers = (extra && extra.headers) || {};
  return {
    ok: !extra || extra.ok !== false,
    status: (extra && extra.status) || 200,
    headers: {
      get(name) {
        const lower = String(name || "").toLowerCase();
        return Object.keys(headers).reduce((found, key) => {
          if (found != null) return found;
          return key.toLowerCase() === lower ? headers[key] : null;
        }, null);
      }
    },
    async text() {
      return JSON.stringify(payload);
    },
    async json() {
      return payload;
    }
  };
}

module.exports = (async function() {
  {
    const client = new GoogleDriveClient({
      fetchImpl: async function() {
        throw new Error("fetch should not be called in path mapping test");
      },
      getAccessToken: async function() {
        return "token";
      },
      rootFolderName: "ObsidianSync",
      vaultName: "eugene"
    });

    assert.strictEqual(
      client.toManagedLogicalPath("manifest.json"),
      "eugene/manifest.json",
      "managed paths should be namespaced by vault name"
    );
    assert.strictEqual(
      client.toManagedLogicalPath("vault/20 Wiki/a.md"),
      "eugene/vault/20 Wiki/a.md",
      "snapshot paths should live under the vault-specific namespace"
    );
    assert.strictEqual(
      client.fromManagedLogicalPath("eugene/ops/live/device-a.jsonl"),
      "ops/live/device-a.jsonl",
      "managed path decoding should strip the vault namespace"
    );
    assert.strictEqual(
      client.fromManagedLogicalPath("other-vault/manifest.json"),
      null,
      "managed path decoding should ignore files from other vault namespaces"
    );
  }

  {
    const calls = [];
    const client = new GoogleDriveClient({
      fetchImpl: async function(url) {
        calls.push(url);
        if (calls.length === 1) {
          return createJsonResponse({
            files: [{ id: "1" }],
            nextPageToken: "page-2"
          });
        }
        return createJsonResponse({
          files: [{ id: "2" }]
        });
      },
      getAccessToken: async function() {
        return "token";
      }
    });

    const files = await client.listFiles("trashed=false");
    assert.deepStrictEqual(
      files.map((file) => file.id),
      ["1", "2"],
      "listFiles should collect all pages"
    );
    assert(
      calls[1].indexOf("pageToken=page-2") !== -1,
      "listFiles should request subsequent pages with nextPageToken"
    );
  }

  {
    const responses = {
      "manifest.json": JSON.stringify({
        version: 1,
        devices: {
          "device-a": { opsHead: 2 },
          "device-b": { opsHead: 1 }
        },
        files: {}
      }),
      "ops/live/device-a.jsonl": [
        JSON.stringify({ device: "device-a", seq: 1, ts: 10 }),
        JSON.stringify({ device: "device-a", seq: 2, ts: 20 }),
        JSON.stringify({ device: "device-a", seq: 3, ts: 30 })
      ].join("\n") + "\n",
      "ops/live/device-b.jsonl": [
        JSON.stringify({ device: "device-b", seq: 1, ts: 15 }),
        JSON.stringify({ device: "device-b", seq: 2, ts: 25 })
      ].join("\n") + "\n"
    };
    const client = new GoogleDriveClient({
      fetchImpl: async function() {
        throw new Error("fetch should not be called in stubbed readFile/list path");
      },
      getAccessToken: async function() {
        return "token";
      }
    });
    client.findByLogicalPath = async function(logicalPath) {
      if (responses[logicalPath] == null) {
        return null;
      }
      return { id: logicalPath };
    };
    client.request = async function(method, resourcePath) {
      const logicalPath = resourcePath.replace("/drive/v3/files/", "");
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return String(name).toLowerCase() === "etag" ? '"manifest-etag-1"' : null;
          }
        },
        async text() {
          return responses[logicalPath];
        }
      };
    };

    const ops = await client.listOperationsSince({
      "device-a": 1,
      "device-b": 0
    });
    assert.deepStrictEqual(
      ops.map((entry) => entry.device + ":" + entry.seq),
      ["device-b:1", "device-a:2"],
      "listOperationsSince should only return committed ops within manifest heads"
    );
  }

  {
    let writeAttempts = 0;
    const client = new GoogleDriveClient({
      fetchImpl: async function() {
        throw new Error("fetch should not be called in appendOperation CAS test");
      },
      getAccessToken: async function() {
        return "token";
      }
    });
    client.findByLogicalPath = async function(logicalPath) {
      return { id: logicalPath };
    };
    client.request = async function(method, resourcePath) {
      assert.strictEqual(method, "GET");
      assert(resourcePath.indexOf("/drive/v3/files/") === 0);
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return String(name).toLowerCase() === "etag" ? '"log-etag-1"' : null;
          }
        },
        async text() {
          return JSON.stringify({ seq: 1, device: "device-a" }) + "\n";
        }
      };
    };
    client.createOrUpdateFile = async function(logicalPath, body, mimeType, kind, options) {
      writeAttempts += 1;
      assert.strictEqual(logicalPath, "ops/live/device-a.jsonl");
      assert.strictEqual(options.ifMatch, '"log-etag-1"', "appendOperation should protect log rewrites with If-Match");
      if (writeAttempts === 1) {
        const error = new Error("precondition failed");
        error.status = 412;
        throw error;
      }
      assert(body.indexOf('"seq":2') !== -1, "appendOperation should append the new entry to the existing log");
      return { id: "ok" };
    };

    const result = await client.appendOperation({
      device: "device-a",
      seq: 2,
      path: "notes/a.md"
    });
    assert.strictEqual(writeAttempts, 2, "appendOperation should retry once after a CAS conflict");
    assert.strictEqual(result.remoteOpLogId, "ops/live/device-a.jsonl#2");
  }

  {
    const files = [
      {
        id: "a",
        appProperties: {
          logicalPath: "eugene/vault/a.md",
          vault: "eugene"
        }
      },
      {
        id: "b",
        appProperties: {
          logicalPath: "other-vault/vault/b.md",
          vault: "other-vault"
        }
      }
    ];
    const client = new GoogleDriveClient({
      fetchImpl: async function() {
        throw new Error("fetch should not be called in managed files filter test");
      },
      getAccessToken: async function() {
        return "token";
      },
      vaultName: "eugene"
    });
    client.listFiles = async function() {
      return files;
    };

    const managedFiles = await client.listManagedFiles();
    assert.deepStrictEqual(
      managedFiles.map((file) => file.id),
      ["a"],
      "listManagedFiles should only expose the active vault namespace"
    );
  }
})();
